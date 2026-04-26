require('dotenv').config();
const express = require('express');
const router  = express.Router();
const https   = require('https');
const qs      = require('querystring');

const { requireAuth, requireApproved } = require('../middleware/auth');
const { parseCookies, cookieStr, mergeCookieStr } = require('./scraper');
const db = require('../db');

// ─── HTTP helpers (admin-specific; reuse cookie utilities from scraper) ───────

const httpsAgent = new https.Agent({ keepAlive: false });

function adminGet(urlStr, cookieHeader, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    https.get({
      agent: httpsAgent,
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Connection': 'close', Cookie: cookieHeader || '', ...extraHeaders },
    }, res => {
      const sc  = parseCookies(res.headers['set-cookie']);
      const loc = res.headers.location;
      let body  = '';
      res.on('data', d => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, url: urlStr, body, setCookies: sc, location: loc }));
    }).on('error', reject);
  });
}

async function adminFollow(urlStr, cookieHeader, max = 8) {
  let current = urlStr, ck = cookieHeader;
  for (let i = 0; i < max; i++) {
    const r = await adminGet(current, ck);
    if (!r.location || r.status < 300 || r.status >= 400) return r;
    ck      = mergeCookieStr(ck, r.setCookies);
    current = r.location.startsWith('http') ? r.location : new URL(current).origin + r.location;
  }
  return adminGet(current, ck);
}

function adminPost(path, body, cookieHeader) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      agent:    httpsAgent,
      hostname: 'capshawchurch.org',
      path,
      method:   'POST',
      headers: {
        'User-Agent':    'Mozilla/5.0',
        'Content-Type':  'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        Cookie:   cookieHeader || '',
        Referer:  `https://capshawchurch.org${path}`,
        Origin:   'https://capshawchurch.org',
        Connection: 'close',
      },
    }, res => {
      const sc = parseCookies(res.headers['set-cookie']);
      let b = '';
      res.on('data', d => (b += d));
      res.on('end', () => resolve({ status: res.statusCode, setCookies: sc, location: res.headers.location, body: b }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Admin session ─────────────────────────────────────────────────────────────

let _adminCookies = null;
let _adminExpiry  = 0;
let _adminPromise = null;

async function getAdminSession() {
  if (_adminCookies && Date.now() < _adminExpiry) return _adminCookies;
  if (_adminPromise) return _adminPromise;

  _adminPromise = (async () => {
    const username = process.env.CAPSHAW_MEMBER_USERNAME;
    const password = process.env.CAPSHAW_MEMBER_PASSWORD;
    if (!username || !password) throw new Error('CAPSHAW_MEMBER_USERNAME / PASSWORD not set in .env');

    const loginGet = await adminGet('https://capshawchurch.org/admin/login', '');
    let cookies    = loginGet.setCookies;
    const csrf     = loginGet.body.match(/name="_token"\s+value="([^"]+)"/)?.[1];
    if (!csrf) throw new Error('Could not find CSRF token on admin login page');

    const postBody = qs.stringify({ _token: csrf, username, password, remember: '1', r: 'admin/songsdb' });
    const postRes  = await adminPost('/admin/login', postBody, cookieStr(cookies));

    if (postRes.status !== 302 || !postRes.location)
      throw new Error('Admin login failed — check credentials in .env');

    cookies = { ...cookies, ...postRes.setCookies };
    let loc = postRes.location;
    if (!loc.startsWith('http')) loc = 'https://capshawchurch.org' + loc;

    const warm = await adminFollow(loc, cookieStr(cookies));
    const all  = { ...cookies, ...warm.setCookies };

    _adminCookies = cookieStr(all);
    _adminExpiry  = Date.now() + 90 * 60 * 1000;
    _adminPromise = null;
    return _adminCookies;
  })();

  _adminPromise.catch(() => { _adminPromise = null; });
  return _adminPromise;
}

async function fetchAdmin(path) {
  const ck = await getAdminSession();
  return adminFollow(`https://capshawchurch.org${path}`, ck);
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

// Parse the songsdb list page HTML → array of { id, date, service, count, leader }
function parseSongsList(html) {
  const results = [];
  const rowRe = /<td[^>]*><a href="\/admin\/songsdb\/edit\/(\d+)[^"]*">([^<]+)<\/a><\/td>\s*<td>([^<]*)<\/td>\s*<td>(\d+)<\/td>\s*<td>([^<]*)<\/td>/g;
  for (const m of html.matchAll(rowRe)) {
    results.push({
      id:      parseInt(m[1]),
      date:    m[2].trim(),
      service: m[3].trim(),
      count:   parseInt(m[4]),
      leader:  m[5].trim(),
    });
  }
  return results;
}

// Parse prePopulate JSON from edit page → [{ id, name }]
function parsePrePopulate(html) {
  const m = html.match(/prePopulate:\s*(\[[\s\S]*?\])/);
  if (!m) return [];
  try { return JSON.parse(m[1]); } catch { return []; }
}

// Parse "TITLE (number - Hymnal Name)" → { title, number, hymnal }
function parseSongName(nameStr) {
  const m = nameStr.match(/^(.+?)\s*\((\S+)\s*-\s*(.+)\)\s*$/);
  if (m) return { title: m[1].trim(), number: m[2].trim(), hymnal: m[3].trim() };
  return { title: nameStr.trim(), number: '', hymnal: '' };
}

// MM/DD/YY → YYYY-MM-DD
function toIso(dateStr) {
  const [mm, dd, yy] = dateStr.split('/');
  return `${2000 + parseInt(yy)}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

// ─── Form options cache (leaders + services) ──────────────────────────────────

let _options       = null;
let _optionsExpiry = 0;

async function getFormOptions() {
  if (_options && Date.now() < _optionsExpiry) return _options;

  const r = await fetchAdmin('/admin/songsdb/add');

  // Leader select
  const leaderBlock = r.body.match(/song_track\[leader_id\][\s\S]*?<\/select>/)?.[0] || '';
  const leaders = [...leaderBlock.matchAll(/<option value="(\d+)">([^<]+)<\/option>/g)]
    .filter(m => m[2].includes(','))
    .map(m => ({ id: parseInt(m[1]), name: m[2].trim() }));

  // Service select
  const serviceBlock = r.body.match(/song_track\[service_id\][\s\S]*?<\/select>/)?.[0] || '';
  const services = [...serviceBlock.matchAll(/<option value="(\d+)">([^<]+)<\/option>/g)]
    .map(m => ({ id: parseInt(m[1]), name: m[2].trim() }));

  _options       = { leaders, services };
  _optionsExpiry = Date.now() + 60 * 60 * 1000;
  return _options;
}

// ─── Upsert helpers ───────────────────────────────────────────────────────────

function upsertSongs(songData) {
  const insert = db.prepare('INSERT OR IGNORE INTO songs (id, title, hymnal, number) VALUES (?, ?, ?, ?)');
  for (const s of songData) {
    const p = parseSongName(s.name);
    insert.run(s.id, p.title, p.hymnal, p.number);
  }
}

function upsertServiceSongs(serviceId, songData) {
  db.transaction(() => {
    upsertSongs(songData);
    db.prepare('DELETE FROM service_songs WHERE service_id = ?').run(serviceId);
    const ins = db.prepare('INSERT OR IGNORE INTO service_songs (service_id, song_id, position) VALUES (?, ?, ?)');
    songData.forEach((s, i) => ins.run(serviceId, s.id, i));
  })();
}

// ─── Routes — specific paths MUST come before /:id ────────────────────────────

// GET /api/songs/options — leaders + services for the add form
router.get('/options', requireAuth, async (req, res) => {
  try {
    res.json({ success: true, ...(await getFormOptions()) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/songs/search?q= — proxy admin tokenize endpoint
router.get('/search', requireAuth, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ success: true, results: [] });
  try {
    const ck  = await getAdminSession();
    const r   = await adminGet(
      `https://capshawchurch.org/admin/songsdb/tokenize?q=${encodeURIComponent(q)}`, ck,
      { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' }
    );
    const raw = JSON.parse(r.body);
    // tokenize returns [{id, name}] — parse name into title/number/hymnal
    const results = raw.map(s => ({ id: s.id, ...parseSongName(s.name) }));
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/songs/analytics
router.get('/analytics', requireAuth, (req, res) => {
  const topSongs = db.prepare(`
    SELECT s.id, s.title, s.hymnal, s.number,
           COUNT(sx.service_id) AS count,
           MAX(ss.date)         AS last_sung
    FROM   songs s
    JOIN   service_songs sx ON sx.song_id    = s.id
    JOIN   song_services ss ON ss.id          = sx.service_id
    GROUP  BY s.id
    ORDER  BY count DESC
    LIMIT  20
  `).all();

  const byService = db.prepare(`
    SELECT service, COUNT(*) AS count
    FROM   song_services
    GROUP  BY service
    ORDER  BY count DESC
  `).all();

  const byLeader = db.prepare(`
    SELECT leader, COUNT(*) AS count
    FROM   song_services
    WHERE  leader != ''
    GROUP  BY leader
    ORDER  BY count DESC
    LIMIT  10
  `).all();

  const monthly = db.prepare(`
    SELECT substr(date, 1, 7) AS month, COUNT(*) AS count
    FROM   song_services
    WHERE  date >= date('now', '-12 months')
    GROUP  BY month
    ORDER  BY month ASC
  `).all();

  const totals = {
    services:    db.prepare('SELECT COUNT(*) AS n FROM song_services').get().n,
    uniqueSongs: db.prepare('SELECT COUNT(*) AS n FROM songs').get().n,
    plays:       db.prepare('SELECT COUNT(*) AS n FROM service_songs').get().n,
  };

  res.json({ success: true, topSongs, byService, byLeader, monthly, totals });
});

// POST /api/songs/sync — scrape latest records from admin panel
router.post('/sync', requireAuth, requireApproved, async (req, res) => {
  const pages    = Math.min(parseInt(req.body?.pages || 5), 20);
  const warnings = [];
  let   synced   = 0;

  try {
    for (let page = 1; page <= pages; page++) {
      const r       = await fetchAdmin(`/admin/songsdb?page=${page}`);
      const records = parseSongsList(r.body);
      if (!records.length) break;

      for (const rec of records) {
        const isoDate = toIso(rec.date);

        // Upsert the service record header
        db.prepare(`
          INSERT INTO song_services (id, date, service, leader) VALUES (?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET date=excluded.date, service=excluded.service, leader=excluded.leader
        `).run(rec.id, isoDate, rec.service, rec.leader);

        // Fetch song detail for new records and any within the last 60 days
        const hasSongs  = db.prepare('SELECT COUNT(*) AS n FROM service_songs WHERE service_id = ?').get(rec.id).n;
        const daysOld   = (Date.now() - new Date(isoDate).getTime()) / 86_400_000;
        const needFetch = hasSongs === 0 || daysOld <= 60;

        if (needFetch && rec.count > 0) {
          try {
            const detail   = await fetchAdmin(`/admin/songsdb/edit/${rec.id}`);
            const songData = parsePrePopulate(detail.body);
            if (songData.length) upsertServiceSongs(rec.id, songData);
          } catch (e) {
            warnings.push(`Record ${rec.id}: ${e.message}`);
          }
        }

        synced++;
      }
    }
    res.json({ success: true, synced, pages, warnings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/songs/add — submit new service record to admin + cache locally
router.post('/add', requireAuth, requireApproved, async (req, res) => {
  const { day, month, year, serviceId, leaderId, songIds } = req.body;
  if (!day || !month || !year || !serviceId || !leaderId || !Array.isArray(songIds) || !songIds.length)
    return res.status(400).json({ success: false, error: 'day, month, year, serviceId, leaderId, and songIds are required' });

  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  try {
    const ck      = await getAdminSession();
    const addPage = await adminFollow('https://capshawchurch.org/admin/songsdb/add', ck);
    const csrf    = addPage.body.match(/name="_token"\s+value="([^"]+)"/)?.[1];
    if (!csrf) throw new Error('Could not get CSRF token');

    const body = qs.stringify({
      _token:                    csrf,
      'song_track[date][year]':  year,
      'song_track[date][month]': parseInt(month).toString(),
      'song_track[date][day]':   parseInt(day).toString(),
      'song_track[leader_id]':   leaderId.toString(),
      'song_track[service_id]':  serviceId.toString(),
      'song_track[songs]':       songIds.join(','),
    });

    const postRes = await adminPost('/admin/songsdb/add', body, ck);
    if (postRes.status !== 302)
      throw new Error('Admin panel rejected the submission');

    const newId = parseInt(postRes.location?.match(/\/edit\/(\d+)/)?.[1] ?? 0);

    // Look up service name for SQLite storage
    const opts        = await getFormOptions();
    const serviceName = opts.services.find(s => s.id === parseInt(serviceId))?.name || serviceId.toString();
    const leaderName  = opts.leaders.find(l => l.id === parseInt(leaderId))?.name || leaderId.toString();

    if (newId) {
      db.prepare('INSERT OR REPLACE INTO song_services (id, date, service, leader) VALUES (?, ?, ?, ?)')
        .run(newId, date, serviceName, leaderName);

      // Fetch the edit page so we have song names too
      try {
        const editPage = await fetchAdmin(`/admin/songsdb/edit/${newId}`);
        const songData = parsePrePopulate(editPage.body);
        if (songData.length) upsertServiceSongs(newId, songData);
      } catch { /* non-fatal */ }
    }

    res.json({ success: true, id: newId });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/songs — list cached service records with optional filters
router.get('/', requireAuth, (req, res) => {
  const { service = '', q = '', limit = 50, offset = 0 } = req.query;

  const conditions = [];
  const params     = [];

  if (service) { conditions.push('ss.service LIKE ?'); params.push(`%${service}%`); }
  if (q)       {
    conditions.push(`EXISTS (
      SELECT 1 FROM service_songs sx
      JOIN songs sg ON sg.id = sx.song_id
      WHERE sx.service_id = ss.id AND sg.title LIKE ?
    )`);
    params.push(`%${q}%`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const records = db.prepare(`
    SELECT ss.id, ss.date, ss.service, ss.leader,
           COUNT(sx.song_id) AS song_count
    FROM   song_services ss
    LEFT   JOIN service_songs sx ON sx.service_id = ss.id
    ${where}
    GROUP  BY ss.id
    ORDER  BY ss.date DESC
    LIMIT  ? OFFSET ?
  `).all(...params, parseInt(limit), parseInt(offset));

  const total = db.prepare(`
    SELECT COUNT(DISTINCT ss.id) AS n
    FROM   song_services ss
    LEFT   JOIN service_songs sx ON sx.service_id = ss.id
    ${where}
  `).get(...params).n;

  res.json({ success: true, records, total });
});

// GET /api/songs/:id — get service record with songs (lazy-fetches from admin if uncached)
router.get('/:id', requireAuth, async (req, res) => {
  const id     = parseInt(req.params.id);
  const record = db.prepare('SELECT * FROM song_services WHERE id = ?').get(id);
  if (!record) return res.status(404).json({ success: false, error: 'Not found' });

  const cached = db.prepare(`
    SELECT s.id, s.title, s.hymnal, s.number, sx.position
    FROM   service_songs sx
    JOIN   songs s ON s.id = sx.song_id
    WHERE  sx.service_id = ?
    ORDER  BY sx.position
  `).all(id);

  if (cached.length) return res.json({ success: true, record, songs: cached });

  // Not cached — fetch from admin
  try {
    const r        = await fetchAdmin(`/admin/songsdb/edit/${id}`);
    const songData = parsePrePopulate(r.body);
    if (songData.length) upsertServiceSongs(id, songData);

    const songs = songData.map((s, i) => {
      const p = parseSongName(s.name);
      return { id: s.id, title: p.title, hymnal: p.hymnal, number: p.number, position: i };
    });
    res.json({ success: true, record, songs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/songs/:id/refresh — force re-fetch this one record from admin panel
router.post('/:id/refresh', requireAuth, requireApproved, async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const detail   = await fetchAdmin(`/admin/songsdb/edit/${id}`);
    const songData = parsePrePopulate(detail.body);
    if (songData.length) upsertServiceSongs(id, songData);

    const songs = db.prepare(`
      SELECT s.id, s.title, s.hymnal, s.number, sx.position
      FROM   service_songs sx
      JOIN   songs s ON s.id = sx.song_id
      WHERE  sx.service_id = ?
      ORDER  BY sx.position
    `).all(id);

    res.json({ success: true, songs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
