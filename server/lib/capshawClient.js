require('dotenv').config();
const https = require('https');
const http  = require('http');
const qs    = require('querystring');

const BASE = 'https://capshawchurch.org';

const httpsAgent = new https.Agent({ keepAlive: false });
const httpAgent  = new http.Agent({ keepAlive: false });

// ─── Cookie helpers ───────────────────────────────────────────────────────────

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

// ─── HTTP ─────────────────────────────────────────────────────────────────────

// Bodies are buffered either way; `binary` decides whether the caller gets the
// raw Buffer (images) or a utf8 string (HTML/vCard).
function rawGet(urlStr, cookieHeader, binary = false) {
  return new Promise((resolve, reject) => {
    const u     = new URL(urlStr);
    const lib   = u.protocol === 'https:' ? https : http;
    const agent = u.protocol === 'https:' ? httpsAgent : httpAgent;
    lib.get({
      agent, hostname: u.hostname, path: u.pathname + u.search,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Connection': 'close', 'Cookie': cookieHeader || '' },
    }, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({
          status:      res.statusCode,
          url:         urlStr,
          headers:     res.headers,
          body:        binary ? buf : buf.toString('utf8'),
          setCookies:  parseCookies(res.headers['set-cookie']),
          location:    res.headers.location,
        });
      });
    }).on('error', reject);
  });
}

async function getFollowingRedirects(urlStr, cookieHeader, binary = false, max = 8) {
  let current = urlStr;
  let ck      = cookieHeader;
  for (let i = 0; i < max; i++) {
    const r = await rawGet(current, ck, binary);
    if (!r.location || r.status < 300 || r.status >= 400) return r;
    ck      = mergeCookieStr(ck, r.setCookies);
    current = r.location.startsWith('http') ? r.location : new URL(current).origin + r.location;
  }
  return rawGet(current, ck, binary);
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

let _sessionCookies = null;
let _sessionExpiry  = 0;
let _loginPromise   = null;

function resetSession() {
  _sessionCookies = null;
  _sessionExpiry  = 0;
  _loginPromise   = null;
}

async function getSession() {
  if (_sessionCookies && Date.now() < _sessionExpiry) return _sessionCookies;
  if (_loginPromise) return _loginPromise;

  _loginPromise = (async () => {
    const username = process.env.CAPSHAW_MEMBER_USERNAME;
    const password = process.env.CAPSHAW_MEMBER_PASSWORD;
    if (!username || !password) throw new Error('CAPSHAW_MEMBER_USERNAME / PASSWORD not set in .env');

    const loginGet = await rawGet(`${BASE}/members/login`, '');
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
          'Referer': `${BASE}/members/login`,
          'Origin': BASE,
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
    if (!loc.startsWith('http')) loc = BASE + loc;

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
  return getFollowingRedirects(`${BASE}${path}`, ck);
}

// Media URLs 302 to a signed, expiring CDN link, so redirects must be followed
// with the session cookie attached.
async function fetchBinary(path) {
  const ck = await getSession();
  return getFollowingRedirects(path.startsWith('http') ? path : `${BASE}${path}`, ck, true);
}

module.exports = {
  BASE,
  parseCookies,
  cookieStr,
  mergeCookieStr,
  rawGet,
  getFollowingRedirects,
  getSession,
  resetSession,
  fetchPage,
  fetchBinary,
};
