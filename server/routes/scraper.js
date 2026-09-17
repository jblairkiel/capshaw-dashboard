require('dotenv').config();
const express = require('express');
const router  = express.Router();
const { requireApproved, requireAdmin } = require('../middleware/auth');
const { syncDirectory } = require('../lib/directorySync');
const fs      = require('fs');
const path    = require('path');
const db      = require('../db');

// Redirectable for the same reason as the photo directory (lib/photoStore.js):
// a test run must never be able to overwrite the congregation's own cache.
const DATA_FILE = require('../lib/paths').scrapeCache;

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
  stripTags,
  parseJobAssignments,
  parseAttendance,
  parseSermons,
  parseVisitors,
  widestSpanQuery,
  pagerLinks,
  mergeVisitors,
  nameScore,
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

  // Visitors. Guests are matched by name and updated rather than wiped and
  // re-created, because `notes`, `invited_by` and the follow-up history are
  // ours and exist nowhere on the church site. What the tracker does publish —
  // the visit list, the comments, and now the address, phone and email on each
  // card — is the site's to own, and replaces what is held here whenever the
  // scrape actually read something. A field the tracker leaves blank keeps
  // whatever somebody typed in: an empty scrape is not a correction.
  const SCRAPED_FIELDS = ['phone', 'email', 'address', 'city', 'state', 'zip'];

  const findVisitor = db.prepare('SELECT * FROM visitors WHERE lower(trim(name)) = lower(trim(?))');
  const insVisitor  = db.prepare("INSERT INTO visitors (name, created_at) VALUES (?, datetime('now'))");
  const setComments = db.prepare('UPDATE visitors SET comments = ? WHERE id = ?');
  const setDetails  = db.prepare(`
    UPDATE visitors
       SET phone = ?, email = ?, address = ?, city = ?, state = ?, zip = ?
     WHERE id = ?
  `);
  const clearVisits = db.prepare('DELETE FROM visitor_visits WHERE visitor_id = ?');
  const insVisit    = db.prepare('INSERT INTO visitor_visits (visitor_id, date, service) VALUES (?, ?, ?)');
  for (const v of (data.visitors || [])) {
    const existing = findVisitor.get(v.name);
    const vid      = existing?.id ?? insVisitor.run(v.name).lastInsertRowid;

    // The tracker's own comments are the site's to own; `notes` is ours and is
    // never written here.
    setComments.run(v.comments || '', vid);

    const merged = SCRAPED_FIELDS.map(field =>
      String(v[field] ?? '').trim() || String(existing?.[field] ?? '').trim());
    if (merged.some(Boolean)) setDetails.run(...merged, vid);

    clearVisits.run(vid);
    for (const vv of (v.visits || [])) insVisit.run(vid, vv.date, vv.service);
  }

  // Every earlier reading of this page mistook some other line in a guest's
  // card for their name, and guests are matched by name, so those rows survive
  // the scrape that fixes them — the real person arriving beside a row called
  // "Just moved from Foley, AL" or "Last on 09/13/26". Once a scrape has read
  // guests properly they are cleared: first a name this scrape has just read
  // as somebody's comment. Anything typed in by hand — details, our own notes,
  // a follow-up — is left alone however it is named, exactly as when a guest
  // is matched rather than re-created. A duplicate in the list can be fixed by
  // hand; a deleted phone number cannot.
  const removeMisread = db.prepare(`
    DELETE FROM visitors
     WHERE lower(trim(name)) = lower(trim(?))
       AND trim(coalesce(phone, ''))             = ''
       AND trim(coalesce(email, ''))             = ''
       AND trim(coalesce(address, ''))           = ''
       AND trim(coalesce(invited_by, ''))        = ''
       AND trim(coalesce(status, ''))            = ''
       AND trim(coalesce(notes, ''))             = ''
       AND trim(coalesce(last_contacted_at, '')) = ''
  `);
  // And a row whose name is one this parser would never produce: the summary
  // line off a card ("Last on 09/13/26"), a link out of the site's own menu
  // ("About Us"), the placeholder standing in for a hidden address. The test
  // is the same one the parser applies when it picks a name, so the two cannot
  // drift apart and start disagreeing about what a guest is called.
  const untouchedNames = db.prepare(`
    SELECT id, name FROM visitors
     WHERE trim(coalesce(phone, ''))             = ''
       AND trim(coalesce(email, ''))             = ''
       AND trim(coalesce(address, ''))           = ''
       AND trim(coalesce(invited_by, ''))        = ''
       AND trim(coalesce(status, ''))            = ''
       AND trim(coalesce(notes, ''))             = ''
       AND trim(coalesce(last_contacted_at, '')) = ''
  `);
  const removeById = db.prepare('DELETE FROM visitors WHERE id = ?');

  // Only once this scrape has actually read guests: a page that parsed to
  // nothing is a reason to keep every row, not to tidy them.
  if ((data.visitors || []).length) {
    for (const v of data.visitors) {
      for (const line of String(v.comments || '').split('\n')) {
        if (line.trim()) removeMisread.run(line);
      }
    }
    for (const row of untouchedNames.all()) {
      if (nameScore(row.name) === 0) removeById.run(row.id);
    }
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
      name:     v.name,
      comments: v.comments || '',
      visits:   db.prepare('SELECT date, service FROM visitor_visits WHERE visitor_id = ? ORDER BY date DESC').all(v.id),
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

      // What a parser has to key on besides the tables: the page's headings,
      // and — because a name is not always in a heading — whatever text sits
      // immediately above each table. A section that parses to nothing while
      // its tables look right is a question about exactly this, and answering
      // it from a table dump alone meant guessing.
      report.headings = [...body.matchAll(/<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/gi)]
        .map(m => ({ level: m[1].toLowerCase(), text: stripTags(m[2]) }))
        .filter(h => h.text)
        .slice(0, 40);

      const tableMatches = [...body.matchAll(/<table[\s\S]*?<\/table>/gi)].slice(0, 10);

      report.aboveEachTable = tableMatches.map((m, i) => ({
        table: i,
        // The last 300 characters before the table, tags and all: enough to
        // see which element holds the name without returning the page.
        html: body.slice(Math.max(0, m.index - 300), m.index).replace(/\s+/g, ' ').trim(),
      }));

      // What the scrape would do with the page's own controls. A tracker that
      // comes back with fewer guests than the site shows is a question about
      // exactly these two, and neither is visible in a dump of the markup.
      report.controls = {
        widestSpan: widestSpanQuery(body, section.path) || null,
        pager:      pagerLinks(body, section.path),
      };

      // And the 300 characters *after the previous table*, which is where an
      // entry begins. The two windows are not the same view: a guest's name is
      // at the top of their card and their comment is at the bottom, so the
      // markup immediately above a table showed the comment every time and
      // never the name. Reading one without the other is what made the last
      // diagnosis take three tries.
      report.eachEntryStartsWith = tableMatches.map((m, i) => {
        const from = i === 0 ? 0 : tableMatches[i - 1].index + tableMatches[i - 1][0].length;
        return {
          table: i,
          html: body.slice(from, Math.min(m.index, from + 300)).replace(/\s+/g, ' ').trim(),
        };
      });
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

// ─── The tracker shows a slice; this collects the whole thing ─────────────────
//
// The page defaults to a date span and runs the rest onto further pages, so
// what arrives is whatever the site chose to show. Both controls are read off
// the page and used (see widestSpanQuery and pagerLinks in lib/parsers.js):
// the span is set as wide as the dropdown goes, then every page of the result
// is fetched. A page that will not load is a warning rather than a failure —
// the guests already read are worth keeping, and saying so beats silently
// returning fewer than there are.

const VISITOR_TRACKER   = '/members/visitor-tracker';
const MAX_TRACKER_PAGES = 40;

async function fetchVisitorTracker(warnings) {
  const first = await fetchPage(VISITOR_TRACKER).catch(e => ({ body: '', status: 0, _err: e.message }));
  if (first._err || !first.body || first.status === 404) return { page: first, more: [] };

  // The widest span the dropdown offers, if it is not already showing it.
  let page = first;
  const wide = widestSpanQuery(first.body, VISITOR_TRACKER);
  if (wide) {
    try {
      const widened = await fetchPage(wide);
      if (widened.status === 200 && widened.body) {
        page = widened;
        console.log(`[scraper] visitors — asked the tracker for every date it offers (${wide})`);
      }
    } catch (e) {
      warnings.push(`visitors: could not widen the date filter — ${e.message}`);
    }
  }

  // Then the rest of the pages, re-reading each one's pager so a window that
  // only ever shows a few page numbers at a time is still followed to the end.
  const more    = [];
  const visited = new Set([wide || VISITOR_TRACKER, VISITOR_TRACKER]);
  const queue   = pagerLinks(page.body, wide || VISITOR_TRACKER).filter(l => !visited.has(l));

  while (queue.length && more.length < MAX_TRACKER_PAGES) {
    const next = queue.shift();
    if (visited.has(next)) continue;
    visited.add(next);

    let following;
    try {
      following = await fetchPage(next);
    } catch (e) {
      warnings.push(`visitors: ${next} could not be loaded — ${e.message}; some guests may be missing`);
      continue;
    }
    if (following.status !== 200 || !following.body) {
      warnings.push(`visitors: ${next} came back ${following.status}; some guests may be missing`);
      continue;
    }

    more.push(following.body);
    for (const link of pagerLinks(following.body, next)) {
      if (!visited.has(link)) queue.push(link);
    }
  }

  if (queue.length) {
    warnings.push(`visitors: stopped after ${MAX_TRACKER_PAGES} pages of the tracker — there may be more`);
  }
  if (more.length) console.log(`[scraper] visitors — followed ${more.length} further page(s) of the tracker`);

  return { page, more };
}

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
      fetchVisitorTracker(warnings),
      fetchPage('/members/anniversaries-members-non-members').catch(e => ({ body: '', status: 0, _err: e.message })),
      fetchPage('/members/deacons').catch(e => ({ body: '', status: 0, _err: e.message })),
      fetchPage('/members'),
    ]);
    const [jaPage, attPage, serPage, visitorTracker, annPage, deaPage, dashPage] = pages;
    const visPage = visitorTracker.page;

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
        const parsed = parser(page.body);
        // A page that came back full and parsed to nothing is a parse miss, and
        // it used to look exactly like a section that is genuinely empty: the
        // old data was kept and nobody was told. Say so, so Church Office →
        // Church Records shows it rather than the scrape reporting success.
        if (Array.isArray(parsed) && parsed.length === 0 && page.body.length > 2000) {
          warnings.push(`${name}: the page loaded but nothing could be read from it — the site's layout may have changed`);
          return fallback;
        }
        return parsed;
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
      visitors:       tryParse('visitors', visPage,
        body => mergeVisitors([parseVisitors(body), ...visitorTracker.more.map(parseVisitors)]),
        existing.visitors || []),
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
