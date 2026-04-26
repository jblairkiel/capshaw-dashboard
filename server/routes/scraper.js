require('dotenv').config();
const express = require('express');
const router  = express.Router();
const { requireAuth, requireApproved } = require('../middleware/auth');
const https   = require('https');
const http    = require('http');
const qs      = require('querystring');
const fs      = require('fs');
const path    = require('path');

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
} = require('../lib/parsers');

// ─── File persistence ─────────────────────────────────────────────────────────

function readData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const obj = JSON.parse(raw);
    return Object.keys(obj).length > 0 ? obj : null;
  } catch {
    return null;
  }
}

function saveData(data) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET /api/members/data — return stored data (no scraping)
router.get('/data', requireAuth, (req, res) => {
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
router.post('/update', requireAuth, requireApproved, async (req, res) => {
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
router.get('/status', requireAuth, (req, res) => {
  const stored = readData();
  res.json({
    hasData:          !!stored,
    lastUpdated:      stored?.lastUpdated || null,
    updateInProgress: _updateInProgress,
  });
});

module.exports = { router, runUpdate, readData, parseCookies, cookieStr, mergeCookieStr };
