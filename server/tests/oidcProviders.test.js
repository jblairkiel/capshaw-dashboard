// Yahoo, Microsoft and Apple sign-in (lib/oidcProviders.js and the routes for
// them in routes/auth.js). No provider is ever talked to: the id_tokens are
// made here, and passport is mocked where a route is driven, as in
// oauthAccounts.test.js.
jest.mock('../db', () => {
  globalThis.__oidcDb ||= require('./helpers/memoryDb').createMemoryDb();
  return globalThis.__oidcDb;
});

const crypto  = require('crypto');
const request = require('supertest');
const express = require('express');
const db      = require('../db');
const oidc    = require('../lib/oidcProviders');
const { requireTrustedOrigin } = require('../middleware/csrf');

const ORIGINAL_ENV = { ...process.env };
const CLIENT_URL   = 'http://localhost:5173';

// An Apple signing key of the kind the Apple Developer account hands out, with
// its line breaks written as "\n" the way a .env file has to hold it.
const appleKeys = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const APPLE_PEM = appleKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }).replace(/\n/g, '\\n');

const YAHOO     = { YAHOO_CLIENT_ID: 'yid', YAHOO_CLIENT_SECRET: 'ysecret' };
const MICROSOFT = { MICROSOFT_CLIENT_ID: 'mid', MICROSOFT_CLIENT_SECRET: 'msecret' };
const APPLE     = { APPLE_CLIENT_ID: 'org.capshaw.members', APPLE_TEAM_ID: 'TEAM123456', APPLE_KEY_ID: 'KEY1234567', APPLE_PRIVATE_KEY: APPLE_PEM };
const ALL_THREE = { ...YAHOO, ...MICROSOFT, ...APPLE };
const NONE      = {
  GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', FACEBOOK_APP_ID: '', FACEBOOK_APP_SECRET: '',
  YAHOO_CLIENT_ID: '', MICROSOFT_CLIENT_ID: '', APPLE_CLIENT_ID: '',
};

function loadAuth(env = {}) {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, ...NONE, ...env };
  const passport   = require('passport');
  const registered = {};
  jest.spyOn(passport, 'use').mockImplementation(strategy => {
    registered[strategy.name] = strategy;
    return passport;
  });
  jest.spyOn(passport, 'serializeUser').mockImplementation(() => {});
  jest.spyOn(passport, 'deserializeUser').mockImplementation(() => {});
  const router = require('../routes/auth');
  return { router, registered, passport };
}

function buildApp(router) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.logIn = (u, cb) => { app.loggedInUser = u; cb(null); };
    next();
  });
  app.use('/api/auth', router);
  return app;
}

// An unsigned id_token is all these tests need: the code reads one only as it
// arrives from the provider's own token endpoint.
const NOW = Math.floor(Date.now() / 1000);
function idToken(claims) {
  const encode = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode({ iat: NOW, exp: NOW + 600, ...claims })}.sig`;
}

const yahooToken = claims => idToken({ iss: 'https://api.login.yahoo.com', aud: 'yid', sub: 'Y-1', ...claims });
const PERSONAL   = oidc.MICROSOFT.personalTenant;
const WORK       = '11111111-2222-3333-4444-555555555555';
const msToken    = (tid, claims) => idToken({ iss: `https://login.microsoftonline.com/${tid}/v2.0`, aud: 'mid', sub: 'M-1', tid, ...claims });
const appleToken = claims => idToken({ iss: 'https://appleid.apple.com', aud: 'org.capshaw.members', sub: '001234.abc', ...claims });

// The account a sign-in lands on, or why there is nobody to sign in to.
function verifyWith(strategy, { idToken: token, profile = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = { body };
    strategy._verify(req, 'access-token', 'refresh-token', { id_token: token }, profile, (err, user, info) => {
      if (err) return reject(err);
      resolve(user || { refusal: info?.code });
    });
  });
}

beforeEach(() => {
  jest.restoreAllMocks();
  db.prepare('DELETE FROM user_identities').run();
  db.prepare('DELETE FROM users').run();
  db.prepare('DELETE FROM directory').run();
  db.prepare('DELETE FROM mail_outbox').run();
});
afterAll(() => { jest.restoreAllMocks(); process.env = ORIGINAL_ENV; });

// ─── Which are offered ────────────────────────────────────────────────────────

describe('which providers are offered', () => {
  const list = async env => {
    const { router } = loadAuth(env);
    return (await request(buildApp(router)).get('/api/auth/providers')).body.providers;
  };

  test('none of the three without credentials', async () => {
    expect(await list({})).toEqual([]);
  });

  test('each one once every one of its credentials is set, after Google and Facebook', async () => {
    expect(await list({ GOOGLE_CLIENT_ID: 'g', GOOGLE_CLIENT_SECRET: 'g', ...ALL_THREE }))
      .toEqual(['google', 'yahoo', 'microsoft', 'apple']);
  });

  test('part of a credential is not enough', async () => {
    expect(await list({ YAHOO_CLIENT_ID: 'yid', MICROSOFT_CLIENT_SECRET: 'm', ...APPLE, APPLE_KEY_ID: '' })).toEqual([]);
  });

  test('an Apple key that will not parse switches Apple off, and nothing else', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(await list({ ...ALL_THREE, APPLE_PRIVATE_KEY: 'not a key' })).toEqual(['yahoo', 'microsoft']);
  });

  test.each(['yahoo', 'microsoft', 'apple'])('a link to %s while it is not set up goes back to the sign-in page', async provider => {
    const { router } = loadAuth({});
    const res = await request(buildApp(router)).get(`/api/auth/${provider}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${CLIENT_URL}/?auth_error=${provider}`);
  });
});

// ─── The id_token ─────────────────────────────────────────────────────────────

describe('reading the id_token', () => {
  const check = (claims, issuer = 'https://appleid.apple.com') =>
    oidc.checkedClaims(appleToken(claims), { issuer, clientId: 'org.capshaw.members' });

  test('is accepted from the right issuer, for this app, in date', () => {
    expect(check({}).sub).toBe('001234.abc');
  });
  test('is refused from another issuer', () => {
    expect(() => check({ iss: 'https://evil.example' })).toThrow(/issuer/);
  });
  test('is refused when it was made for another app', () => {
    expect(() => check({ aud: 'someone.else' })).toThrow(/another app/);
  });
  test('is refused once expired', () => {
    expect(() => check({ exp: NOW - 3600 })).toThrow(/expired/);
  });
  test('is refused when it is not a token at all', () => {
    expect(() => oidc.checkedClaims('nonsense', { issuer: 'x', clientId: 'y' })).toThrow(/id_token/);
  });
});

// ─── Yahoo ────────────────────────────────────────────────────────────────────

describe('Yahoo', () => {
  const yahoo = (env = {}) => loadAuth({ ...YAHOO, ...env }).registered.yahoo;

  test('a new account arrives pending, with the name and address Yahoo gives', async () => {
    const user = await verifyWith(yahoo(), {
      idToken: yahooToken({}),
      profile: { _json: { email: 'ray@yahoo.com', email_verified: true, name: 'Ray Harris', picture: 'https://cdn/ray.jpg' } },
    });
    expect(user).toMatchObject({ provider: 'yahoo', provider_id: 'Y-1', email: 'ray@yahoo.com', name: 'Ray Harris', role: 'pending' });
  });

  test('an AOL or Yahoo mailbox counts as confirmed even when Yahoo does not say', () => {
    const who = oidc.yahooIdentity({ params: { id_token: yahooToken({ email: 'pat@aol.com' }) }, clientId: 'yid' });
    expect(who).toMatchObject({ email: 'pat@aol.com', emailVerified: true });
  });

  test('a token from a look-alike issuer is refused', () => {
    const token = yahooToken({ iss: 'https://api.login.yahoo.com.evil.example' });
    expect(() => oidc.yahooIdentity({ params: { id_token: token }, clientId: 'yid' })).toThrow(/issuer/);
  });

  test('any other address needs Yahoo to say it is confirmed', () => {
    const silent = oidc.yahooIdentity({ params: { id_token: yahooToken({ email: 'pat@gmail.com' }) }, clientId: 'yid' });
    const denied = oidc.yahooIdentity({ params: { id_token: yahooToken({ email: 'pat@yahoo.com', email_verified: false }) }, clientId: 'yid' });
    expect(silent.emailVerified).toBe(false);
    expect(denied.emailVerified).toBe(false);
  });

  test('a matching address on an existing account is held for an admin, like Google', async () => {
    db.prepare("INSERT INTO users (provider, provider_id, email, name, role) VALUES ('google', 'g-1', 'ray@yahoo.com', 'Ray', 'approved')").run();
    const result = await verifyWith(yahoo(), { idToken: yahooToken({ email: 'ray@yahoo.com', email_verified: true }) });
    expect(result.refusal).toBe('link_pending');
    expect(db.prepare("SELECT status FROM user_identities WHERE provider = 'yahoo'").get().status).toBe('pending');
  });

  test('asks for the address and profile, and keeps its state in a cookie', async () => {
    const strategy = yahoo();
    const app = express();
    app.get('/api/auth/yahoo', (req, res) => {
      strategy.redirect = url => res.redirect(url);
      strategy.error = err => res.status(500).send(err.message);
      strategy.authenticate(req, {});
    });
    const res = await request(app).get('/api/auth/yahoo');
    const location = new URL(res.headers.location);
    expect(location.origin + location.pathname).toBe('https://api.login.yahoo.com/oauth2/request_auth');
    expect(location.searchParams.get('scope')).toBe('openid email profile');
    expect(location.searchParams.get('redirect_uri')).toBe('http://localhost:3001/api/auth/yahoo/callback');
    const cookie = res.headers['set-cookie'].find(c => c.startsWith('oauth_state_yahoo='));
    expect(cookie).toContain(`oauth_state_yahoo=${location.searchParams.get('state')}`);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
  });
});

// ─── Microsoft ────────────────────────────────────────────────────────────────

describe('Microsoft', () => {
  const microsoft = (env = {}) => loadAuth({ ...MICROSOFT, ...env }).registered.microsoft;

  test('a personal account (Outlook, Hotmail, MSN) comes with a confirmed address', async () => {
    const user = await verifyWith(microsoft(), { idToken: msToken(PERSONAL, { email: 'ray@hotmail.com', name: 'Ray Harris' }) });
    expect(user).toMatchObject({ provider: 'microsoft', provider_id: 'M-1', email: 'ray@hotmail.com', name: 'Ray Harris', role: 'pending' });
  });

  test('a work or school address is not trusted: the account arrives without one', async () => {
    db.prepare("INSERT INTO users (provider, provider_id, email, name, role) VALUES ('local', 'pat@uab.edu', 'pat@uab.edu', 'Pat', 'approved')").run();
    const user = await verifyWith(microsoft(), { idToken: msToken(WORK, { email: 'pat@uab.edu', name: 'Pat Nolan' }) });
    expect(user).toMatchObject({ provider: 'microsoft', email: null, role: 'pending' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM user_identities').get().n).toBe(0);
  });

  test('somebody\'s own Microsoft tenant cannot claim the owner address', async () => {
    const user = await verifyWith(
      microsoft({ ADMIN_EMAIL: 'owner@example.com' }),
      { idToken: msToken(WORK, { email: 'owner@example.com', name: 'Not the owner' }) },
    );
    expect(user.role).toBe('pending');
    expect(user.email).toBeNull();
  });

  test('a work or school address counts when Microsoft says the organization owns its domain', () => {
    const who = oidc.microsoftIdentity({ params: { id_token: msToken(WORK, { email: 'pat@uab.edu', xms_edov: true }) }, clientId: 'mid' });
    expect(who).toMatchObject({ email: 'pat@uab.edu', emailVerified: true });
  });

  test('a token whose issuer is not its own tenant is refused', () => {
    const token = idToken({ iss: `https://login.microsoftonline.com/${WORK}/v2.0`, aud: 'mid', sub: 'M-1', tid: PERSONAL });
    expect(() => oidc.microsoftIdentity({ params: { id_token: token }, clientId: 'mid' })).toThrow(/issuer/);
  });

  test('a personal account signed in by phone number has no address', () => {
    const who = oidc.microsoftIdentity({ params: { id_token: msToken(PERSONAL, { preferred_username: '+12565550100' }) }, clientId: 'mid' });
    expect(who.email).toBeNull();
  });
});

// ─── Apple ────────────────────────────────────────────────────────────────────

describe('Apple', () => {
  const apple = (env = {}) => loadAuth({ ...APPLE, ...env }).registered.apple;
  const firstTime = JSON.stringify({ name: { firstName: 'Ray', lastName: 'Harris' }, email: 'ray@icloud.com' });

  test('takes the name Apple sends the first time, and keeps it after', async () => {
    const strategy = apple();
    const first  = await verifyWith(strategy, { idToken: appleToken({ email: 'ray@icloud.com', email_verified: 'true' }), body: { user: firstTime } });
    const second = await verifyWith(strategy, { idToken: appleToken({ email: 'ray@icloud.com', email_verified: 'true' }), body: {} });
    expect(first).toMatchObject({ provider: 'apple', name: 'Ray Harris', email: 'ray@icloud.com', role: 'pending' });
    expect(second.id).toBe(first.id);
    expect(second.name).toBe('Ray Harris');
  });

  test('an account made without a name still gets one', async () => {
    const user = await verifyWith(apple(), { idToken: appleToken({ email: 'x1y2@privaterelay.appleid.com', email_verified: true, is_private_email: true }) });
    expect(user).toMatchObject({ name: 'New member', email: 'x1y2@privaterelay.appleid.com' });
  });

  test('a hidden (private relay) address is kept but matches nobody in the directory', () => {
    const who = oidc.appleIdentity({
      params: { id_token: appleToken({ email: 'x1y2@privaterelay.appleid.com', email_verified: true, is_private_email: 'true' }) },
      req: { body: {} }, clientId: 'org.capshaw.members',
    });
    expect(who).toMatchObject({ emailVerified: true, privateRelay: true, name: null });
  });

  test('a garbled name field is ignored rather than failing the sign-in', () => {
    expect(oidc.appleNameFrom({ user: '{not json' })).toBeNull();
    expect(oidc.appleNameFrom({ user: { name: { firstName: '  ', lastName: 'Harris' } } })).toBe('Harris');
  });

  test('the client secret is a short-lived ES256 token Apple can check against the key', () => {
    const now = Date.now();
    const secret = oidc.appleClientSecret({
      teamId: 'TEAM123456', keyId: 'KEY1234567', clientId: 'org.capshaw.members',
      privateKey: oidc.readApplePrivateKey(APPLE_PEM), now,
    });
    const [header, payload, signature] = secret.split('.');
    const read = part => JSON.parse(Buffer.from(part, 'base64url').toString());
    expect(read(header)).toEqual({ alg: 'ES256', kid: 'KEY1234567', typ: 'JWT' });
    expect(read(payload)).toMatchObject({ iss: 'TEAM123456', aud: 'https://appleid.apple.com', sub: 'org.capshaw.members' });
    expect(read(payload).exp - read(payload).iat).toBe(300);
    const ok = crypto.verify('sha256', Buffer.from(`${header}.${payload}`), {
      key: appleKeys.publicKey, dsaEncoding: 'ieee-p1363',
    }, Buffer.from(signature, 'base64url'));
    expect(ok).toBe(true);
  });

  test('asks Apple to post the answer back, with a state cookie that survives the cross-site POST', async () => {
    const strategy = loadAuth({ ...APPLE, NODE_ENV: 'production', SESSION_SECRET: 's' }).registered.apple;
    const app = express();
    app.get('/api/auth/apple', (req, res) => {
      strategy.redirect = url => res.redirect(url);
      strategy.error = err => res.status(500).send(err.message);
      strategy.authenticate(req, {});
    });
    const res = await request(app).get('/api/auth/apple');
    const location = new URL(res.headers.location);
    expect(location.searchParams.get('response_mode')).toBe('form_post');
    expect(location.searchParams.get('scope')).toBe('name email');
    const cookie = res.headers['set-cookie'].find(c => c.startsWith('oauth_state_apple='));
    expect(cookie).toMatch(/SameSite=None/);
    expect(cookie).toMatch(/Secure/);
  });
});

// ─── State ────────────────────────────────────────────────────────────────────

describe('the state cookie', () => {
  function verifyState(cookieHeader, state) {
    const store = new oidc.CookieStateStore('yahoo');
    const cleared = [];
    const req = { headers: { cookie: cookieHeader }, res: { clearCookie: name => cleared.push(name) } };
    return new Promise(resolve => store.verify(req, state, {}, (err, ok) => resolve({ ok, cleared })));
  }

  test('lets back a sign-in that started here', async () => {
    const { ok, cleared } = await verifyState('a=1; oauth_state_yahoo=abc123', 'abc123');
    expect(ok).toBe(true);
    expect(cleared).toEqual(['oauth_state_yahoo']);
  });
  test('refuses one that did not', async () => {
    expect((await verifyState('oauth_state_yahoo=abc123', 'other')).ok).toBe(false);
    expect((await verifyState('', 'abc123')).ok).toBe(false);
    expect((await verifyState('oauth_state_yahoo=abc123', undefined)).ok).toBe(false);
  });
});

// ─── The callbacks ────────────────────────────────────────────────────────────

describe.each(['yahoo', 'microsoft', 'apple'])('the %s callback', provider => {
  const method = provider === 'apple' ? 'post' : 'get';

  function appFor(...outcome) {
    const { router, passport } = loadAuth(ALL_THREE);
    jest.spyOn(passport, 'authenticate').mockImplementation((_name, handler) =>
      (req, res, next) => handler(...outcome));
    return buildApp(router);
  }
  const call = app => {
    const r = request(app)[method](`/api/auth/${provider}/callback`);
    return provider === 'apple' ? r.type('form').send({ code: 'c', state: 's' }) : r;
  };

  test('signs the member in and sends them to the portal', async () => {
    const app = appFor(null, { id: 7, role: 'approved' }, null);
    const res = await call(app);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(CLIENT_URL);
    expect(app.loggedInUser).toMatchObject({ id: 7 });
  });

  test('goes back to the sign-in page when the exchange fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await call(appFor(new Error('token exchange failed'), null, null));
    expect(res.headers.location).toBe(`${CLIENT_URL}/?auth_error=${provider}`);
  });

  test('says a join is waiting on an admin', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const res = await call(appFor(null, false, { code: 'link_pending' }));
    expect(res.headers.location).toBe(`${CLIENT_URL}/?auth_error=link_pending`);
  });
});

describe('Apple posting back without a code', () => {
  const app = () => buildApp(loadAuth(APPLE).router);

  test('somebody who cancelled on Apple\'s page is simply back at the sign-in page', async () => {
    const res = await request(app()).post('/api/auth/apple/callback').type('form').send({ error: 'user_cancelled_authorize' });
    expect(res.headers.location).toBe(CLIENT_URL);
  });

  test('any other error is reported as an Apple failure', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const res = await request(app()).post('/api/auth/apple/callback').type('form').send({ error: 'invalid_request' });
    expect(res.headers.location).toBe(`${CLIENT_URL}/?auth_error=apple`);
  });

  test('a GET is never Apple, and goes back with an error', async () => {
    const res = await request(app()).get('/api/auth/apple/callback');
    expect(res.headers.location).toBe(`${CLIENT_URL}/?auth_error=apple`);
  });
});

// ─── The one origin let through ───────────────────────────────────────────────

describe('the origin check', () => {
  function appWith() {
    const app = express();
    app.use('/api', requireTrustedOrigin(['https://capshaw.jblairkiel.com'], {
      exceptions: { '/auth/apple/callback': ['https://appleid.apple.com'] },
    }));
    app.post('/api/*', (req, res) => res.json({ ok: true }));
    return app;
  }

  test('lets Apple post to its callback', async () => {
    const res = await request(appWith()).post('/api/auth/apple/callback').set('Origin', 'https://appleid.apple.com');
    expect(res.status).toBe(200);
  });
  test('but nowhere else', async () => {
    const res = await request(appWith()).post('/api/auth/logout').set('Origin', 'https://appleid.apple.com');
    expect(res.status).toBe(403);
  });
  test('and lets no other site post to the callback', async () => {
    const res = await request(appWith()).post('/api/auth/apple/callback').set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
  });
});
