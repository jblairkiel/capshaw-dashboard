require('dotenv').config();
const express = require('express');
const router  = express.Router();
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
  return getFollowingRedirects(`https://www.capshawchurch.org${path}`, ck);
}

// ─── HTML parsers ─────────────────────────────────────────────────────────────

function stripTags(str) {
  return str
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&bull;/g, '•').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&laquo;/g, '«')
    .replace(/&raquo;/g, '»').replace(/&lsaquo;/g, '‹').replace(/&rsaquo;/g, '›')
    .replace(/&#\d+;/g, '').replace(/&[a-z]+;/g, '')
    .replace(/\s+/g, ' ').trim();
}

function extractTables(html) {
  return [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map(t => {
    const rows = [...t[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)];
    return rows.map(row =>
      [...row[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
        .map(c => stripTags(c[1])).filter(Boolean)
    ).filter(r => r.length > 0);
  });
}

function parseJobAssignments(html) {
  const tables = extractTables(html);
  const main   = tables.sort((a, b) => b.length - a.length)[0] || [];
  const mMatch = html.match(/>\s*((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})\s*</);

  const assignments = [];
  let currentDate   = '';
  for (const row of main) {
    if (row.length === 4 && row[1] === 'Service') {
      currentDate = row[0]; // section header: [date, "Service", "Job", "Name"]
    } else if (row.length === 3 && currentDate) {
      assignments.push({ date: currentDate, service: row[0], job: row[1], name: row[2] });
    }
  }
  return { month: mMatch ? mMatch[1] : '', assignments };
}

function parseAttendance(html) {
  const records = [];
  for (const table of extractTables(html)) {
    for (const row of table) {
      if (row[0] === 'Date') continue;
      if (row.length >= 3 && row[0].match(/\d{2}\/\d{2}\/\d{2}/)) {
        records.push({ date: row[0], service: row[1], count: parseInt(row[2], 10) || 0 });
      }
    }
  }
  return records.sort((a, b) => b.date.localeCompare(a.date));
}

function parseSermons(html) {
  const sermons = [];
  for (const table of extractTables(html)) {
    for (const row of table) {
      if (row[0] === 'Date') continue;
      if (row.length >= 4 && row[0].match(/\d{2}\/\d{2}\/\d{2}/)) {
        sermons.push({ date: row[0], title: row[1], speaker: row[2], type: row[3] || '', series: row[4] || '', service: row[5] || '' });
      }
    }
  }
  return sermons;
}

function parseVisitors(html) {
  const visitors = [];
  for (const sec of [...html.matchAll(/<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>[\s\S]*?(<table[\s\S]*?<\/table>)/gi)]) {
    const name = stripTags(sec[1]);
    if (name === 'Visitor Tracker') continue;
    const visits = (extractTables(sec[2])[0] || [])
      .filter(r => r[0] !== 'Date' && r[0]?.match(/\d{2}\/\d{2}\/\d{2}/))
      .map(r => ({ date: r[0], service: r[1] || '' }));
    if (visits.length > 0) visitors.push({ name, visits });
  }
  return visitors;
}

// Anniversaries: table rows are either [month] or [MM/DD, names]
function parseAnniversaries(html) {
  const tables = extractTables(html);
  const main   = tables.sort((a, b) => b.length - a.length)[0] || [];
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const entries = [];
  let currentMonth = '';
  for (const row of main) {
    if (row.length === 1 && MONTHS.includes(row[0])) {
      currentMonth = row[0];
    } else if (row.length === 2 && currentMonth && row[0].match(/^\d+\/\d+/)) {
      const [m, d] = row[0].split('/').map(Number);
      entries.push({ month: currentMonth, date: row[0], names: row[1], monthNum: m, day: d });
    }
  }
  return entries;
}

// Deacons: <strong>Name</strong> followed by <li> duties until next <strong>
function parseDeacons(html) {
  const SKIP = new Set(['Our Deacons', 'Their Duties', 'Deacons', 'Capshaw', 'Sunday', 'Wednesday', 'YouTube', 'Menu']);
  const deacons = [];
  // Isolate body content (after the title heading)
  const bodyStart = html.indexOf('Our Deacons');
  const bodyContent = bodyStart > -1 ? html.slice(bodyStart) : html;
  // Split on <strong> tags to find name sections
  const parts = bodyContent.split(/<strong[^>]*>/i);
  for (const part of parts) {
    const nameMatch = part.match(/^([^<]{4,50})<\/strong>/i);
    if (!nameMatch) continue;
    const name = stripTags(nameMatch[1]);
    if (!name || SKIP.has(name) || name.includes('Duties') || name.includes('shepherds') || name.length > 50) continue;
    // Collect <li> items after this name, before the next potential name block
    const duties = [...part.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
      .map(m => stripTags(m[1]))
      .filter(d => d.length > 5 && d.length < 120 && !d.includes('Bible Study') && !d.includes('YouTube'));
    if (duties.length > 0) deacons.push({ name, duties });
  }
  return deacons;
}

// Bulletins: extract PDF links from dashboard
function parseBulletins(html) {
  const section = html.match(/Capshaw Bulletin([\s\S]*?)(?:Member News|<h[1-4])/i)?.[1] || '';
  return [...section.matchAll(/href="([^"]+\.pdf[^"]*)"[^>]*>\s*([^<]+)/gi)]
    .map(m => ({ url: m[1], label: stripTags(m[2]).trim() }))
    .filter(b => b.label && b.label.length > 3);
}

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
router.get('/data', (req, res) => {
  const data = readData();
  res.json({ success: true, data });
});

// ─── Core scrape function (used by route + scheduler) ────────────────────────

let _updateInProgress = false;

async function runUpdate() {
  if (_updateInProgress) throw new Error('Update already in progress');
  _updateInProgress = true;
  try {
    _sessionCookies = null;
    _sessionExpiry  = 0;
    _loginPromise   = null;

    const [jaPage, attPage, serPage, visPage, annPage, deaPage, dashPage] = await Promise.all([
      fetchPage('/members/job-assignments'),
      fetchPage('/members/attendance'),
      fetchPage('/members/sermons'),
      fetchPage('/members/visitor-tracker'),
      fetchPage('/members/anniversaries-members-non-members'),
      fetchPage('/members/deacons'),
      fetchPage('/members'),
    ]);

    if (jaPage.url.includes('login') || attPage.url.includes('login')) {
      throw new Error('Session expired or login failed — check credentials in .env');
    }

    const data = {
      lastUpdated:    new Date().toISOString(),
      jobAssignments: parseJobAssignments(jaPage.body),
      attendance:     parseAttendance(attPage.body),
      sermons:        parseSermons(serPage.body),
      visitors:       parseVisitors(visPage.body),
      anniversaries:  parseAnniversaries(annPage.body),
      deacons:        parseDeacons(deaPage.body),
      bulletins:      parseBulletins(dashPage.body),
    };

    saveData(data);
    console.log(`[scraper] update complete — ${data.lastUpdated}`);
    return data.lastUpdated;
  } finally {
    _updateInProgress = false;
  }
}

// POST /api/members/update
router.post('/update', async (req, res) => {
  if (_updateInProgress) {
    return res.status(409).json({ success: false, error: 'Update already in progress' });
  }
  try {
    const lastUpdated = await runUpdate();
    res.json({ success: true, lastUpdated });
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

module.exports = { router, runUpdate, readData };
