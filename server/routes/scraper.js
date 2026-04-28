require('dotenv').config();
const express = require('express');
const router  = express.Router();
const { requireAdmin } = require('../middleware/auth');
const https   = require('https');
const http    = require('http');
const qs      = require('querystring');
const fs      = require('fs');
const path    = require('path');
const db      = require('../db');

const DATA_FILE = path.join(__dirname, '../data/members.json');

const httpsAgent = new https.Agent({ keepAlive: false });
const httpAgent  = new http.Agent({ keepAlive: false });

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function parseCookies(headers) {
  const c = {};
  if (!headers) return c;
  (Array.isArray(headers) ? headers : [headers]).forEach(h => {
    const [pair] = h.split(';');
    const idx = pair.indexOf('=');
    if (idx > 0) c[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  });
  return c;
}

function cookieStr(obj) {
  return Object.entries(obj).map(([k, v]) => `${k}=${v}`).join('; ');
}

function mergeCookieStr(existingStr, newObj) {
  const map = {};
  (existingStr || '').split(';').forEach(p => {
    const t = p.trim(); const i = t.indexOf('=');
    if (i > 0) map[t.slice(0, i)] = t.slice(i + 1);
  });
  return cookieStr({ ...map, ...newObj });
}

function rawGet(urlStr, cookieHeader) {
  return new Promise((resolve, reject) => {
    const u     = new URL(urlStr);
    const lib   = u.protocol === 'https:' ? https : http;
    const agent = u.protocol === 'https:' ? httpsAgent : httpAgent;
    lib.get({
      agent, hostname: u.hostname, path: u.pathname + u.search,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Connection': 'close', 'Cookie': cookieHeader || '' },
    }, res => {
      const sc  = parseCookies(res.headers['set-cookie']);
      const loc = res.headers.location;
      let body  = '';
      res.on('data', d => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, url: urlStr, body, setCookies: sc, location: loc }));
    }).on('error', reject);
  });
}

async function getFollowingRedirects(urlStr, cookieHeader, max = 8) {
  let current = urlStr;
  let ck      = cookieHeader;
  for (let i = 0; i < max; i++) {
    const r = await rawGet(current, ck);
    if (!r.location || r.status < 300 || r.status >= 400) return r;
    ck      = mergeCookieStr(ck, r.setCookies);
    current = r.location.startsWith('http') ? r.location : new URL(current).origin + r.location;
  }
  return rawGet(current, ck);
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

let _sessionCookies = null;
let _sessionExpiry  = 0;
let _loginPromise   = null;

async function getSession() {
  if (_sessionCookies && Date.now() < _sessionExpiry) return _sessionCookies;
  if (_loginPromise) return _loginPromise;

  _loginPromise = (async () => {
    const username = process.env.CAPSHAW_MEMBER_USERNAME;
    const password = process.env.CAPSHAW_MEMBER_PASSWORD;
    if (!username || !password) throw new Error('CAPSHAW_MEMBER_USERNAME / PASSWORD not set in .env');

    const loginGet = await rawGet('https://capshawchurch.org/members/login', '');
    let cookies    = loginGet.setCookies;
    const csrf     = loginGet.body.match(/name="_token"\s+value="([^"]+)"/)?.[1];
    if (!csrf) throw new Error('Could not find CSRF token on login page');

    const body = qs.stringify({ _token: csrf, username, password, remember: '1' });

    const postResult = await new Promise((resolve, reject) => {
      const req = https.request({
        agent: httpsAgent,
        hostname: 'capshawchurch.org',
        path: '/members/login',
        method: 'POST',
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
          'Cookie': cookieStr(cookies),
          'Referer': 'https://capshawchurch.org/members/login',
          'Origin': 'https://capshawchurch.org',
          'Connection': 'close',
        },
      }, res => {
        const sc = parseCookies(res.headers['set-cookie']);
        let b    = '';
        res.on('data', d => (b += d));
        res.on('end', () => resolve({ status: res.statusCode, setCookies: sc, location: res.headers.location, body: b }));
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });

    if (postResult.status !== 302 || !postResult.location) {
      const msg = postResult.body.match(/class="[^"]*alert[^"]*"[^>]*>\s*([^<]{5,})/)?.[1] || 'Login failed';
      throw new Error(msg.trim());
    }

    cookies = { ...cookies, ...postResult.setCookies };
    let loc = postResult.location;
    if (!loc.startsWith('http')) loc = 'https://capshawchurch.org' + loc;

    const warm = await getFollowingRedirects(loc, cookieStr(cookies));
    const all  = { ...cookies, ...warm.setCookies };

    _sessionCookies = cookieStr(all);
    _sessionExpiry  = Date.now() + 90 * 60 * 1000;
    _loginPromise   = null;
    return _sessionCookies;
  })();

  _loginPromise.catch(() => { _loginPromise = null; });
  return _loginPromise;
}

async function fetchPage(path) {
  const ck = await getSession();
  return getFollowingRedirects(`https://capshawchurch.org${path}`, ck);
}

// ─── HTML parsers ─────────────────────────────────────────────────────────────

const {
  parseJobAssignments,
  parseAttendance,
  parseSermons,
  parseVisitors,
  parseAnniversaries,
  parseDeacons,
  parseBulletins,
  parseDirectory,
} = require('../lib/parsers');

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

  // Job assignments
  db.prepare('DELETE FROM job_assignments').run();
  const insJA = db.prepare('INSERT INTO job_assignments (month, date, service, job, name) VALUES (?, ?, ?, ?, ?)');
  const ja = data.jobAssignments;
  if (ja && ja.assignments) {
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

  // Directory
  db.prepare('DELETE FROM directory').run();
  const insDir = db.prepare('INSERT INTO directory (name, address, city, state, zip, phone, cell, email, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const d of (data.directory || [])) insDir.run(d.name, d.address || '', d.city || '', d.state || '', d.zip || '', d.phone || '', d.cell || '', d.email || '', d.notes || '');

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

    const jaRows = db.prepare('SELECT * FROM job_assignments ORDER BY date').all();
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

// ─── Core scrape function (used by route + scheduler) ────────────────────────

let _updateInProgress = false;

async function runUpdate() {
  if (_updateInProgress) throw new Error('Update already in progress');
  _updateInProgress = true;
  const warnings = [];
  try {
    _sessionCookies = null;
    _sessionExpiry  = 0;
    _loginPromise   = null;

    const pages = await Promise.all([
      fetchPage('/members/job-assignments').catch(e => ({ body: '', status: 0, _err: e.message })),
      fetchPage('/members/attendance'),
      fetchPage('/members/sermons').catch(e => ({ body: '', status: 0, _err: e.message })),
      fetchPage('/members/visitor-tracker').catch(e => ({ body: '', status: 0, _err: e.message })),
      fetchPage('/members/anniversaries-members-non-members').catch(e => ({ body: '', status: 0, _err: e.message })),
      fetchPage('/members/deacons').catch(e => ({ body: '', status: 0, _err: e.message })),
      fetchPage('/members'),
      fetchPage('/members/directory/vcard').catch(e => ({ body: '', status: 0, _err: e.message })),
    ]);
    const [jaPage, attPage, serPage, visPage, annPage, deaPage, dashPage, dirPage] = pages;

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

    const data = {
      lastUpdated:    new Date().toISOString(),
      warnings,
      jobAssignments: tryParse('jobAssignments', jaPage, parseJobAssignments, existing.jobAssignments || []),
      attendance:     parseAttendance(attPage.body),
      sermons:        tryParse('sermons', serPage, parseSermons, existing.sermons || []),
      visitors:       tryParse('visitors', visPage, parseVisitors, existing.visitors || []),
      anniversaries:  tryParse('anniversaries', annPage, parseAnniversaries, existing.anniversaries || []),
      deacons:        tryParse('deacons', deaPage, parseDeacons, existing.deacons || []),
      bulletins:      parseBulletins(dashPage.body),
      directory:      tryParse('directory', dirPage, parseDirectory, existing.directory || []),
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
router.post('/update', requireAdmin, async (req, res) => {
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


module.exports = { router, runUpdate, readData, parseCookies, cookieStr, mergeCookieStr };
