// capshawClient is how the server signs in to the church website and reads
// member-only pages. The https/http modules are mocked, so these tests cover
// the cookie handling, the redirect chase, the login exchange and the session
// cache without a network.
jest.mock('https', () => {
  globalThis.__capshawHttps ||= require('./helpers/httpsMock').createHttpsMock();
  return globalThis.__capshawHttps;
});
jest.mock('http', () => {
  globalThis.__capshawHttp ||= require('./helpers/httpsMock').createHttpsMock();
  return globalThis.__capshawHttp;
});

const https = require('https');
const http  = require('http');

let client;

const LOGIN_HTML = '<form><input name="_token" value="csrf-abc123"></form>';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  // The module caches the signed-in session for 90 minutes, so each test needs
  // its own copy of it.
  jest.resetModules();
  client = require('../lib/capshawClient');
  https.__reset();
  http.__reset();
  process.env = { ...ORIGINAL_ENV, CAPSHAW_MEMBER_USERNAME: 'member', CAPSHAW_MEMBER_PASSWORD: 'secret' };
});

afterAll(() => { process.env = ORIGINAL_ENV; });

function routeWorkingLogin() {
  https.__route('GET',  '/members/login', () => ({ body: LOGIN_HTML, setCookie: 'session=abc; Path=/; HttpOnly' }));
  https.__route('POST', '/members/login', () => ({ status: 302, location: '/members', setCookie: 'auth=xyz; Path=/' }));
  https.__route('GET',  '/members',       () => ({ body: '<html>signed in</html>' }));
}

// ─── Cookie helpers ───────────────────────────────────────────────────────────

describe('parseCookies', () => {
  test('reads name and value, dropping the attributes after them', () => {
    expect(client.parseCookies(['session=abc123; Path=/; HttpOnly; SameSite=Lax']))
      .toEqual({ session: 'abc123' });
  });

  test('accepts a bare string as well as an array', () => {
    expect(client.parseCookies('a=1')).toEqual({ a: '1' });
  });

  test('handles several cookies at once', () => {
    expect(client.parseCookies(['a=1; Path=/', 'b=2'])).toEqual({ a: '1', b: '2' });
  });

  test('keeps an "=" inside the value', () => {
    expect(client.parseCookies(['token=abc=def==; Path=/'])).toEqual({ token: 'abc=def==' });
  });

  test('no header at all means no cookies', () => {
    expect(client.parseCookies(undefined)).toEqual({});
    expect(client.parseCookies(null)).toEqual({});
  });

  test('ignores a fragment with no name', () => {
    expect(client.parseCookies(['=orphan', 'good=1'])).toEqual({ good: '1' });
  });
});

describe('cookieStr', () => {
  test('renders a jar as a request header', () => {
    expect(client.cookieStr({ a: '1', b: '2' })).toBe('a=1; b=2');
  });

  test('an empty jar renders as an empty header', () => {
    expect(client.cookieStr({})).toBe('');
  });
});

describe('mergeCookieStr', () => {
  test('adds new cookies to an existing header', () => {
    expect(client.mergeCookieStr('a=1', { b: '2' })).toBe('a=1; b=2');
  });

  test('a new value replaces the old one', () => {
    expect(client.mergeCookieStr('a=1; b=2', { a: '9' })).toBe('a=9; b=2');
  });

  test('merging into nothing just yields the new cookies', () => {
    expect(client.mergeCookieStr('', { a: '1' })).toBe('a=1');
    expect(client.mergeCookieStr(null, { a: '1' })).toBe('a=1');
  });

  test('tolerates the spacing of a real Cookie header', () => {
    expect(client.mergeCookieStr('  a=1 ;  b=2  ', { c: '3' })).toBe('a=1; b=2; c=3');
  });
});

// ─── rawGet ───────────────────────────────────────────────────────────────────

describe('rawGet', () => {
  test('returns the status, body, url and any cookies the site set', async () => {
    https.__route('GET', '/members/attendance', () => ({
      status: 200, body: '<html>attendance</html>', setCookie: 'session=abc; Path=/',
    }));

    const res = await client.rawGet('https://capshawchurch.org/members/attendance', '');
    expect(res).toMatchObject({
      status: 200, body: '<html>attendance</html>',
      url: 'https://capshawchurch.org/members/attendance',
      setCookies: { session: 'abc' },
    });
  });

  test('sends the cookie header it was given', async () => {
    https.__route('GET', '/members', () => ({ body: 'ok' }));
    await client.rawGet('https://capshawchurch.org/members', 'session=abc');
    expect(https.__calls[0]).toMatchObject({ method: 'GET', path: '/members' });
  });

  test('keeps the query string on the path', async () => {
    https.__route('GET', '/members/attendance?page=2', () => ({ body: 'ok' }));
    const res = await client.rawGet('https://capshawchurch.org/members/attendance?page=2', '');
    expect(res.status).toBe(200);
  });

  test('a binary request yields a Buffer, a normal one a string', async () => {
    https.__route('GET', '/media/photo.jpg', () => ({ body: Buffer.from([0xff, 0xd8, 0xff]) }));

    const binary = await client.rawGet('https://capshawchurch.org/media/photo.jpg', '', true);
    expect(Buffer.isBuffer(binary.body)).toBe(true);
    expect(binary.body).toEqual(Buffer.from([0xff, 0xd8, 0xff]));

    const text = await client.rawGet('https://capshawchurch.org/media/photo.jpg', '', false);
    expect(typeof text.body).toBe('string');
  });

  test('reports the redirect target without following it', async () => {
    https.__route('GET', '/members', () => ({ status: 302, location: '/members/login' }));
    const res = await client.rawGet('https://capshawchurch.org/members', '');
    expect(res).toMatchObject({ status: 302, location: '/members/login' });
  });

  test('an http:// url goes over http, not https', async () => {
    http.__route('GET', '/plain', () => ({ body: 'over http' }));
    const res = await client.rawGet('http://capshawchurch.org/plain', '');
    expect(res.body).toBe('over http');
    expect(https.__calls).toHaveLength(0);
  });

  test('rejects when the request errors', async () => {
    https.__route('GET', '/members', () => ({ error: new Error('ECONNREFUSED') }));
    await expect(client.rawGet('https://capshawchurch.org/members', '')).rejects.toThrow('ECONNREFUSED');
  });
});

// ─── getFollowingRedirects ────────────────────────────────────────────────────

describe('getFollowingRedirects', () => {
  test('returns a page that does not redirect as it is', async () => {
    https.__route('GET', '/members', () => ({ body: 'here already' }));
    const res = await client.getFollowingRedirects('https://capshawchurch.org/members', '');
    expect(res.body).toBe('here already');
    expect(https.__calls).toHaveLength(1);
  });

  test('follows a chain of relative redirects to the end', async () => {
    https.__route('GET', '/a', () => ({ status: 302, location: '/b' }));
    https.__route('GET', '/b', () => ({ status: 301, location: '/c' }));
    https.__route('GET', '/c', () => ({ status: 200, body: 'arrived' }));

    const res = await client.getFollowingRedirects('https://capshawchurch.org/a', '');
    expect(res.body).toBe('arrived');
    expect(https.__calls.map(c => c.path)).toEqual(['/a', '/b', '/c']);
  });

  test('follows an absolute redirect too', async () => {
    https.__route('GET', '/a',    () => ({ status: 302, location: 'https://cdn.example.com/signed.jpg' }));
    https.__route('GET', '/signed.jpg', () => ({ status: 200, body: 'image bytes' }));

    const res = await client.getFollowingRedirects('https://capshawchurch.org/a', '');
    expect(res.body).toBe('image bytes');
  });

  test('carries cookies picked up along the way into the next hop', async () => {
    https.__route('GET', '/a', () => ({ status: 302, location: '/b', setCookie: 'hop=1; Path=/' }));
    https.__route('GET', '/b', () => ({ status: 200, body: 'done' }));

    const res = await client.getFollowingRedirects('https://capshawchurch.org/a', 'session=abc');
    expect(res.body).toBe('done');
    expect(https.__calls).toHaveLength(2);
  });

  test('gives up after the hop limit rather than looping forever', async () => {
    https.__route('GET', '/loop', () => ({ status: 302, location: '/loop' }));
    const res = await client.getFollowingRedirects('https://capshawchurch.org/loop', '', false, 3);
    expect(res.status).toBe(302);
    // three attempts inside the loop, plus the final unconditional fetch
    expect(https.__calls).toHaveLength(4);
  });

  test('a 3xx with no location is treated as the destination', async () => {
    https.__route('GET', '/a', () => ({ status: 304, body: '' }));
    const res = await client.getFollowingRedirects('https://capshawchurch.org/a', '');
    expect(res.status).toBe(304);
    expect(https.__calls).toHaveLength(1);
  });
});

// ─── getSession ───────────────────────────────────────────────────────────────

describe('getSession', () => {
  test('signs in and returns the combined cookie header', async () => {
    routeWorkingLogin();
    const cookies = await client.getSession();
    expect(cookies).toContain('session=abc');
    expect(cookies).toContain('auth=xyz');
  });

  test('posts the CSRF token from the login page with the credentials', async () => {
    routeWorkingLogin();
    await client.getSession();

    const post = https.__calls.find(c => c.method === 'POST');
    expect(post.body).toContain('_token=csrf-abc123');
    expect(post.body).toContain('username=member');
    expect(post.body).toContain('password=secret');
  });

  test('warms the page the site redirects to after signing in', async () => {
    routeWorkingLogin();
    await client.getSession();
    expect(https.__calls.map(c => `${c.method} ${c.path}`)).toEqual([
      'GET /members/login', 'POST /members/login', 'GET /members',
    ]);
  });

  test('follows an absolute post-login redirect', async () => {
    https.__route('GET',  '/members/login', () => ({ body: LOGIN_HTML, setCookie: 'session=abc' }));
    https.__route('POST', '/members/login', () => ({ status: 302, location: 'https://capshawchurch.org/members/home' }));
    https.__route('GET',  '/members/home',  () => ({ body: 'home' }));

    await expect(client.getSession()).resolves.toContain('session=abc');
  });

  test('signs in once and reuses the session afterwards', async () => {
    routeWorkingLogin();
    await client.getSession();
    const after = https.__calls.length;

    await client.getSession();
    expect(https.__calls).toHaveLength(after);
  });

  test('two callers at once share a single sign-in', async () => {
    routeWorkingLogin();
    const [a, b] = await Promise.all([client.getSession(), client.getSession()]);
    expect(a).toBe(b);
    expect(https.__calls.filter(c => c.method === 'POST')).toHaveLength(1);
  });

  test('resetSession forces the next call to sign in again', async () => {
    routeWorkingLogin();
    await client.getSession();
    client.resetSession();
    await client.getSession();
    expect(https.__calls.filter(c => c.method === 'POST')).toHaveLength(2);
  });

  test('throws when the credentials are not configured', async () => {
    delete process.env.CAPSHAW_MEMBER_PASSWORD;
    await expect(client.getSession()).rejects.toThrow(/CAPSHAW_MEMBER_USERNAME \/ PASSWORD/);
  });

  test('throws when the login page carries no CSRF token', async () => {
    https.__route('GET', '/members/login', () => ({ body: '<form></form>' }));
    await expect(client.getSession()).rejects.toThrow(/CSRF token/);
  });

  test('surfaces the message the site puts on the page when a login is refused', async () => {
    https.__route('GET',  '/members/login', () => ({ body: LOGIN_HTML }));
    https.__route('POST', '/members/login', () => ({
      status: 200, body: '<div class="alert alert-danger">Those credentials do not match our records.</div>',
    }));

    await expect(client.getSession()).rejects.toThrow('Those credentials do not match our records.');
  });

  test('falls back to a plain message when a refusal carries no explanation', async () => {
    https.__route('GET',  '/members/login', () => ({ body: LOGIN_HTML }));
    https.__route('POST', '/members/login', () => ({ status: 200, body: '<html>try again</html>' }));
    await expect(client.getSession()).rejects.toThrow('Login failed');
  });

  test('a 302 with no location is treated as a failed login', async () => {
    https.__route('GET',  '/members/login', () => ({ body: LOGIN_HTML }));
    https.__route('POST', '/members/login', () => ({ status: 302, body: '' }));
    await expect(client.getSession()).rejects.toThrow('Login failed');
  });

  test('a failed sign-in does not poison the next attempt', async () => {
    https.__route('GET', '/members/login', () => ({ body: '<form></form>' }));
    await expect(client.getSession()).rejects.toThrow(/CSRF token/);

    routeWorkingLogin();
    await expect(client.getSession()).resolves.toContain('auth=xyz');
  });

  test('rejects when the network is unreachable', async () => {
    https.__route('GET', '/members/login', () => ({ error: new Error('ENOTFOUND') }));
    await expect(client.getSession()).rejects.toThrow('ENOTFOUND');
  });
});

// ─── fetchPage / fetchBinary ──────────────────────────────────────────────────

describe('fetchPage', () => {
  test('signs in first, then reads the page under the session', async () => {
    routeWorkingLogin();
    https.__route('GET', '/members/attendance', () => ({ body: '<html>attendance</html>' }));

    const res = await client.fetchPage('/members/attendance');
    expect(res.body).toBe('<html>attendance</html>');
    expect(https.__calls.map(c => c.path)).toContain('/members/login');
  });

  test('follows a redirect back to the requested page', async () => {
    routeWorkingLogin();
    https.__route('GET', '/members/sermons',  () => ({ status: 302, location: '/members/sermons/1' }));
    https.__route('GET', '/members/sermons/1', () => ({ body: 'sermon list' }));

    expect((await client.fetchPage('/members/sermons')).body).toBe('sermon list');
  });

  test('a second page reuses the session rather than signing in again', async () => {
    routeWorkingLogin();
    https.__route('GET', /^\/members\/(attendance|sermons)$/, () => ({ body: 'page' }));

    await client.fetchPage('/members/attendance');
    await client.fetchPage('/members/sermons');
    expect(https.__calls.filter(c => c.method === 'POST')).toHaveLength(1);
  });
});

describe('fetchBinary', () => {
  test('returns the image as a Buffer, following the signed CDN redirect', async () => {
    routeWorkingLogin();
    https.__route('GET', '/media/uploads/photos/families/1.jpg', () => ({ status: 302, location: 'https://cdn.example.com/signed/1.jpg?sig=x' }));
    https.__route('GET', '/signed/1.jpg?sig=x', () => ({ body: Buffer.from([0xff, 0xd8]) }));

    const res = await client.fetchBinary('/media/uploads/photos/families/1.jpg');
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(res.body).toEqual(Buffer.from([0xff, 0xd8]));
  });

  test('accepts an absolute url as well as a site path', async () => {
    routeWorkingLogin();
    https.__route('GET', '/signed/2.jpg', () => ({ body: Buffer.from([0x89, 0x50]) }));

    const res = await client.fetchBinary('https://cdn.example.com/signed/2.jpg');
    expect(res.body).toEqual(Buffer.from([0x89, 0x50]));
  });
});
