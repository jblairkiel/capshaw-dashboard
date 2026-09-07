require('dotenv').config();
const express = require('express');
const router  = express.Router();
const { requireApproved, requireAdmin } = require('../middleware/auth');
const { syncDirectory } = require('../lib/directorySync');
const fs      = require('fs');
const path    = require('path');
const db      = require('../db');

const DATA_FILE = path.join(__dirname, '../data/members.json');

const {
  parseCookies,
  cookieStr,
  mergeCookieStr,
  resetSession,
  fetchPage,
} = require('../lib/capshawClient');
const { scrapeDirectory } = require('../lib/directoryPhotos');

// ─── HTML parsers ─────────────────────────────────────────────────────────────

const {
  parseJobAssignments,
  parseAttendance,
  parseSermons,
  parseVisitors,
  parseAnniversaries,
  parseDeacons,
  parseBulletins,
  parseDirectoryFamilies,
  extractTablesPreservingCells,
} = require('../lib/parsers');

// Job assignments are the one section whose parser returns an object rather
// than an array. Everything that touches them goes through these so a shape
// mismatch can never silently empty the table again.
const EMPTY_JOB_ASSIGNMENTS = { month: '', assignments: [] };

function normaliseJobAssignments(value) {
  if (Array.isArray(value))                return { month: '', assignments: value };
  if (value && Array.isArray(value.assignments)) return { month: value.month || '', assignments: value.assignments };
  return EMPTY_JOB_ASSIGNMENTS;
}

// ─── Persistence (SQLite primary, JSON backup) ────────────────────────────────

const _saveScraped = db.transaction((data) => {
  // Attendance
  db.prepare('DELETE FROM attendance').run();
  const insAttendance = db.prepare('INSERT INTO attendance (date, service, count) VALUES (?, ?, ?)');
  for (const r of (data.attendance || [])) insAttendance.run(r.date, r.service, r.count);

  // Sermons
  db.prepare('DELETE FROM sermons').run();
  const insSermon = db.prepare('INSERT INTO sermons (date, title, speaker, type, series, service) VALUES (?, ?, ?, ?, ?, ?)');
  for (const r of (data.sermons || [])) insSermon.run(r.date, r.title, r.speaker, r.type, r.series, r.service);

  // Job assignments. Only clear the table once we have rows to put back:
  // a failed fetch or an unexpected shape must never leave it empty.
  const ja = normaliseJobAssignments(data.jobAssignments);
  if (ja.assignments.length) {
    db.prepare('DELETE FROM job_assignments').run();
    const insJA = db.prepare('INSERT INTO job_assignments (month, date, service, job, name) VALUES (?, ?, ?, ?, ?)');
    for (const r of ja.assignments) insJA.run(ja.month || '', r.date, r.service, r.job, r.name);
  }

  // Visitors
  db.prepare('DELETE FROM visitor_visits').run();
  db.prepare('DELETE FROM visitors').run();
  const insVisitor = db.prepare('INSERT INTO visitors (name) VALUES (?)');
  const insVisit   = db.prepare('INSERT INTO visitor_visits (visitor_id, date, service) VALUES (?, ?, ?)');
  for (const v of (data.visitors || [])) {
    const vid = insVisitor.run(v.name).lastInsertRowid;
    for (const vv of (v.visits || [])) insVisit.run(vid, vv.date, vv.service);
  }

  // Anniversaries
  db.prepare('DELETE FROM anniversaries').run();
  const insAnn = db.prepare('INSERT INTO anniversaries (month, date, names, month_num, day) VALUES (?, ?, ?, ?, ?)');
  for (const r of (data.anniversaries || [])) insAnn.run(r.month || '', r.date, r.names, r.monthNum || 0, r.day || 0);

  // Deacons
  db.prepare('DELETE FROM deacon_duties').run();
  db.prepare('DELETE FROM deacons').run();
  const insDeacon = db.prepare('INSERT INTO deacons (name) VALUES (?)');
  const insDuty   = db.prepare('INSERT INTO deacon_duties (deacon_id, duty, position) VALUES (?, ?, ?)');
  for (const d of (data.deacons || [])) {
    const did = insDeacon.run(d.name).lastInsertRowid;
    (d.duties || []).forEach((duty, i) => insDuty.run(did, duty, i));
  }

  // Bulletins
  db.prepare('DELETE FROM bulletins').run();
  const insBulletin = db.prepare('INSERT INTO bulletins (url, label) VALUES (?, ?)');
  for (const b of (data.bulletins || [])) insBulletin.run(b.url, b.label);

  // Directory — upserted, never wiped: accounts and worship preferences are
  // keyed on these ids, and hand-edited fields must survive a re-scrape.
  //
  // syncDirectory removes people the site no longer lists, so an empty list
  // would clear the directory and prune its photos. A failed scrape looks
  // exactly like an empty one, so it is skipped rather than trusted.
  if (Array.isArray(data.directory) && data.directory.length > 0) {
    syncDirectory(db, data.directory);
  } else {
    console.warn('[scraper] directory not synced — the scrape returned nobody');
  }

  // Meta
  db.prepare('INSERT OR REPLACE INTO scraped_meta (id, last_updated, last_warnings) VALUES (1, ?, ?)').run(
    data.lastUpdated, JSON.stringify(data.warnings || [])
  );
});

function saveData(data) {
  try {
    _saveScraped(data);
    console.log('[scraper] saved to SQLite — attendance:', (data.attendance||[]).length,
      'sermons:', (data.sermons||[]).length,
      'jobs:', (data.jobAssignments?.assignments||[]).length);
  } catch (err) {
    console.error('[scraper] SQLite save failed:', err.message);
    throw err;
  }
  // Keep JSON as a human-readable backup
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch { /* non-fatal */ }
}

function readData() {
  try {
    const meta = db.prepare('SELECT * FROM scraped_meta WHERE id = 1').get();
    if (!meta) return _readDataFromJson();

    // Dates are stored as text ("April 6"), so sort on the trailing day number
    // rather than lexically — otherwise the 6th lands after the 27th.
    const jaRows = db.prepare(`
      SELECT * FROM job_assignments
      ORDER BY CAST(NULLIF(rtrim(substr(date, -2), ' '), '') AS INTEGER), id
    `).all();
    const months = [...new Set(jaRows.map(r => r.month).filter(Boolean))];
    const month  = months.sort().reverse()[0] || '';

    const visitorRows = db.prepare('SELECT * FROM visitors ORDER BY name').all();
    const visitors = visitorRows.map(v => ({
      name:   v.name,
      visits: db.prepare('SELECT date, service FROM visitor_visits WHERE visitor_id = ? ORDER BY date DESC').all(v.id),
    }));

    const deaconRows = db.prepare('SELECT * FROM deacons ORDER BY name').all();
    const deacons = deaconRows.map(d => ({
      name:   d.name,
      duties: db.prepare('SELECT duty FROM deacon_duties WHERE deacon_id = ? ORDER BY position').all(d.id).map(r => r.duty),
    }));

    return {
      lastUpdated:    meta.last_updated,
      warnings:       JSON.parse(meta.last_warnings || '[]'),
      jobAssignments: { month, assignments: jaRows.map(({ id, month: _m, ...r }) => r) },
      attendance:     db.prepare('SELECT date, service, count FROM attendance ORDER BY date DESC').all(),
      sermons:        db.prepare('SELECT date, title, speaker, type, series, service FROM sermons ORDER BY date DESC').all(),
      visitors,
      anniversaries:  db.prepare('SELECT month, date, names, month_num AS monthNum, day FROM anniversaries ORDER BY month_num, day').all(),
      deacons,
      bulletins:      db.prepare('SELECT url, label FROM bulletins').all(),
    };
  } catch {
    return _readDataFromJson();
  }
}

function _readDataFromJson() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const obj = JSON.parse(raw);
    return Object.keys(obj).length > 0 ? obj : null;
  } catch {
    return null;
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET /api/members/data — return stored data (no scraping)
router.get('/data', (req, res) => {
  const data = readData();
  res.json({ success: true, data });
});

// ─── GET /api/members/debug/:section — what did the site actually return? ─────
// A silent parse miss and a genuinely empty page look identical from the
// dashboard. This re-fetches one page and reports what came back and what the
// parser made of it, so an admin can tell the two apart without server access.

const DEBUG_SECTIONS = {
  jobAssignments: { path: '/members/job-assignments',                       parser: parseJobAssignments },
  attendance:     { path: '/members/attendance',                            parser: parseAttendance },
  sermons:        { path: '/members/sermons',                               parser: parseSermons },
  visitors:       { path: '/members/visitor-tracker',                       parser: parseVisitors },
  anniversaries:  { path: '/members/anniversaries-members-non-members',     parser: parseAnniversaries },
  deacons:        { path: '/members/deacons',                               parser: parseDeacons },
  directory:      { path: '/members/directory',                             parser: parseDirectoryFamilies },
};

router.get('/debug/:section', requireAdmin, async (req, res) => {
  const section = DEBUG_SECTIONS[req.params.section];
  if (!section) {
    return res.status(404).json({ success: false, error: `Unknown section. Try one of: ${Object.keys(DEBUG_SECTIONS).join(', ')}` });
  }

  try {
    const page = await fetchPage(section.path);
    const body = page.body || '';

    const report = {
      path:        section.path,
      status:      page.status,
      finalUrl:    page.url,
      bytes:       body.length,
      looksLikeLogin: /name="_token"|<form[^>]+login/i.test(body),
      pageNotFound:   page.status === 404 || body.includes('Page Not Found'),
    };

    // For HTML sections, describe every table so a shape change is visible.
    if (req.params.section !== 'directory') {
      report.tables = extractTablesPreservingCells(body).map((rows, i) => ({
        index:      i,
        rowCount:   rows.length,
        sampleRows: rows.slice(0, 5).map(r => r.map(c => (c.length > 40 ? c.slice(0, 40) + '…' : c))),
      }));
    }

    let parsed;
    try {
      parsed = section.parser(body);
    } catch (err) {
      report.parseError = err.message;
    }

    if (parsed !== undefined) {
      const rows = Array.isArray(parsed) ? parsed : (parsed.assignments ?? []);
      report.parsed = {
        shape:  Array.isArray(parsed) ? 'array' : 'object',
        count:  rows.length,
        month:  parsed?.month,
        // Photos are large; report how many were found, not their contents.
        sample: rows.slice(0, 3).map(r => (r && r.photo ? { ...r, photo: '(photo)' } : r)),
      };

      // Photos hang off families, so the useful question for this section is
      // how many families the page offered and how many carry a real portrait
      // rather than the shared placeholder.
      if (req.params.section === 'directory') {
        report.photos = {
          families:    rows.length,
          withPhoto:   rows.filter(r => r.hasPhoto).length,
          placeholder: rows.filter(r => !r.hasPhoto).length,
        };
      }
    }

    res.json({ success: true, section: req.params.section, report });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

// ─── Core scrape function (used by route + scheduler) ────────────────────────

let _updateInProgress = false;

async function runUpdate() {
  if (_updateInProgress) throw new Error('Update already in progress');
  _updateInProgress = true;
  const warnings = [];
  try {
    resetSession();

    const pages = await Promise.all([
      fetchPage('/members/job-assignments').catch(e => ({ body: '', status: 0, _err: e.message })),
      fetchPage('/members/attendance'),
      fetchPage('/members/sermons').catch(e => ({ body: '', status: 0, _err: e.message })),
      fetchPage('/members/visitor-tracker').catch(e => ({ body: '', status: 0, _err: e.message })),
      fetchPage('/members/anniversaries-members-non-members').catch(e => ({ body: '', status: 0, _err: e.message })),
      fetchPage('/members/deacons').catch(e => ({ body: '', status: 0, _err: e.message })),
      fetchPage('/members'),
    ]);
    const [jaPage, attPage, serPage, visPage, annPage, deaPage, dashPage] = pages;

    if (attPage.url && attPage.url.includes('login')) {
      throw new Error('Session expired or login failed — check credentials in .env');
    }

    function tryParse(name, page, parser, fallback) {
      if (page._err) {
        warnings.push(`${name}: fetch error — ${page._err}`);
        return fallback;
      }
      if (page.status === 404 || page.body.includes('Page Not Found')) {
        warnings.push(`${name}: page not found (404) — feature may be disabled on church site`);
        return fallback;
      }
      try {
        return parser(page.body);
      } catch (e) {
        warnings.push(`${name}: parse error — ${e.message}`);
        return fallback;
      }
    }

    const existing = readData() || {};

    // The directory is scraped family by family (see lib/directoryPhotos.js):
    // that is where the photos are, and the per-family vCards list people the
    // global export leaves out. If it fails we keep the last good copy rather
    // than handing syncDirectory an empty list.
    let directory = _readDataFromJson()?.directory || [];
    try {
      // Photos already downloaded keep their file unless the site's version
      // changed. readData() rebuilds from SQLite, which carries neither the
      // family id nor the photo version, so the previous scrape's own copy is
      // the only place this can come from.
      const previous = _readDataFromJson()?.directory || [];
      const known = new Map(
        previous
          .filter(p => p.familyId && p.photo?.file)
          .map(p => [p.familyId, p.photo])
      );
      const scraped = await scrapeDirectory({ known });
      warnings.push(...scraped.warnings);
      directory = scraped.people;
      console.log(`[scraper] directory — ${scraped.summary.people} people in ${scraped.summary.families} families, ` +
                  `${scraped.summary.photos} photos downloaded, ${scraped.summary.photosReused} unchanged`);
    } catch (e) {
      warnings.push(`directory: scrape failed — ${e.message}`);
    }

    const data = {
      lastUpdated:    new Date().toISOString(),
      warnings,
      jobAssignments: tryParse('jobAssignments', jaPage, parseJobAssignments, existing.jobAssignments || EMPTY_JOB_ASSIGNMENTS),
      attendance:     parseAttendance(attPage.body),
      sermons:        tryParse('sermons', serPage, parseSermons, existing.sermons || []),
      visitors:       tryParse('visitors', visPage, parseVisitors, existing.visitors || []),
      anniversaries:  tryParse('anniversaries', annPage, parseAnniversaries, existing.anniversaries || []),
      deacons:        tryParse('deacons', deaPage, parseDeacons, existing.deacons || []),
      bulletins:      parseBulletins(dashPage.body),
      directory:      directory,
    };

    saveData(data);
    if (warnings.length) console.log(`[scraper] warnings: ${warnings.join('; ')}`);
    console.log(`[scraper] update complete — ${data.lastUpdated}`);
    return { lastUpdated: data.lastUpdated, warnings };
  } finally {
    _updateInProgress = false;
  }
}

// POST /api/members/update
router.post('/update', requireApproved, async (req, res) => {
  if (_updateInProgress) {
    return res.status(409).json({ success: false, error: 'Update already in progress' });
  }
  try {
    const { lastUpdated, warnings } = await runUpdate();
    res.json({ success: true, lastUpdated, warnings });
  } catch (err) {
    console.error('[scraper] update error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/members/status
router.get('/status', (req, res) => {
  const stored = readData();
  res.json({
    hasData:          !!stored,
    lastUpdated:      stored?.lastUpdated || null,
    updateInProgress: _updateInProgress,
  });
});


module.exports = { router, runUpdate, readData, parseCookies, cookieStr, mergeCookieStr, normaliseJobAssignments };
