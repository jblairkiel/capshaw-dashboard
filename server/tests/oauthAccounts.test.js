// The Google and Facebook halves of sign-in: the strategies are only registered
// when their credentials are configured, and both callbacks turn a provider
// profile into an account here. Passport itself is mocked so the exchange can be
// driven directly, without a provider.
jest.mock('../db', () => {
  globalThis.__oauthDb ||= require('./helpers/memoryDb').createMemoryDb();
  return globalThis.__oauthDb;
});

const request = require('supertest');
const express = require('express');
const db      = require('../db');

const ORIGINAL_ENV = { ...process.env };

// Loads routes/auth.js afresh, which is what decides whether each strategy is
// registered, and hands back the router, the strategies it registered, and the
// passport instance it is bound to.
//
// The reset is what makes the environment checks at the top of routes/auth.js
// run again — and it gives the module a new passport, so the spies have to go
// on that one rather than on any instance required earlier.
function loadAuth(env = {}) {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env };

  const passport   = require('passport');
  const registered = {};
  const hooks      = {};

  jest.spyOn(passport, 'use').mockImplementation(strategy => {
    registered[strategy.name] = strategy;
    return passport;
  });
  jest.spyOn(passport, 'serializeUser').mockImplementation(fn => { hooks.serialize = fn; });
  jest.spyOn(passport, 'deserializeUser').mockImplementation(fn => { hooks.deserialize = fn; });

  const router = require('../routes/auth');
  return { router, registered, passport, hooks };
}

function buildApp(router, user = null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user   = user;
    req.logIn  = (u, cb) => { app.loggedInUser = u; cb(null); };
    req.logout = cb => { app.loggedOut = true; cb(null); };
    req.session = { destroy: cb => cb() };
    next();
  });
  app.use('/api/auth', router);
  return app;
}

// The shape passport-google-oauth20 hands its verify callback.
const profile = (id, { email, name = 'Ray Harris', photo } = {}) => ({
  id,
  displayName: name,
  emails: email ? [{ value: email }] : [],
  photos: photo ? [{ value: photo }] : [],
});

function verifyWith(strategy, prof) {
  return new Promise((resolve, reject) => {
    strategy._verify('access-token', 'refresh-token', prof, (err, user) => (err ? reject(err) : resolve(user)));
  });
}

beforeEach(() => {
  jest.restoreAllMocks();
  db.prepare('DELETE FROM users').run();
  db.prepare('DELETE FROM directory').run();
});

afterEach(() => { process.env = ORIGINAL_ENV; });
afterAll(() => { jest.restoreAllMocks(); process.env = ORIGINAL_ENV; });

// ─── Strategy registration ────────────────────────────────────────────────────

describe('strategy registration', () => {
  test('neither provider is registered when nothing is configured', () => {
    const { registered } = loadAuth({
      GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '',
      FACEBOOK_APP_ID: '',  FACEBOOK_APP_SECRET: '',
    });
    expect(Object.keys(registered)).toEqual([]);
  });

  test('Google is registered once both halves of its credential are present', () => {
    const { registered } = loadAuth({ GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsecret' });
    expect(registered.google).toBeDefined();
  });

  test('half a credential is not enough to register a provider', () => {
    const { registered } = loadAuth({ GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: '' });
    expect(registered.google).toBeUndefined();
  });

  test('Facebook is registered on its own credentials', () => {
    const { registered } = loadAuth({ FACEBOOK_APP_ID: 'fid', FACEBOOK_APP_SECRET: 'fsecret' });
    expect(registered.facebook).toBeDefined();
  });
});

// ─── What a provider profile becomes ──────────────────────────────────────────

describe('signing in through a provider', () => {
  function google(env = {}) {
    return loadAuth({ GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsecret', ...env }).registered.google;
  }

  test('a new account arrives pending, never approved', async () => {
    const user = await verifyWith(google(), profile('g-1', { email: 'ray@example.com', photo: 'https://cdn/ray.jpg' }));

    expect(user).toMatchObject({
      provider: 'google', provider_id: 'g-1', email: 'ray@example.com',
      name: 'Ray Harris', photo: 'https://cdn/ray.jpg', role: 'pending',
    });
    expect(user.last_login).toBeTruthy();
  });

  test('signing in again updates the same account rather than making a second', async () => {
    const first  = await verifyWith(google(), profile('g-1', { email: 'ray@example.com' }));
    const second = await verifyWith(google(), profile('g-1', { email: 'ray.harris@example.com', name: 'Raymond Harris' }));

    expect(second.id).toBe(first.id);
    expect(second).toMatchObject({ name: 'Raymond Harris', email: 'ray.harris@example.com' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get().n).toBe(1);
  });

  test('a profile that stops carrying an address keeps the one on file', async () => {
    const first  = await verifyWith(google(), profile('g-1', { email: 'ray@example.com', photo: 'https://cdn/ray.jpg' }));
    const second = await verifyWith(google(), profile('g-1', {}));

    expect(second.id).toBe(first.id);
    expect(second.email).toBe('ray@example.com');
    expect(second.photo).toBe('https://cdn/ray.jpg');
  });

  test('the same address on two providers makes two accounts', async () => {
    const { registered } = loadAuth({
      GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsecret',
      FACEBOOK_APP_ID: 'fid',  FACEBOOK_APP_SECRET: 'fsecret',
    });

    await verifyWith(registered.google,   profile('g-1', { email: 'ray@example.com' }));
    await verifyWith(registered.facebook, profile('f-1', { email: 'ray@example.com' }));

    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get().n).toBe(2);
  });

  test('the configured owner address is made an admin on sign-in', async () => {
    const user = await verifyWith(
      google({ ADMIN_EMAIL: 'owner@example.com' }),
      profile('g-9', { email: 'owner@example.com' })
    );
    expect(user.role).toBe('admin');
  });

  test('an existing account matching the owner address is promoted', async () => {
    db.prepare('INSERT INTO users (provider, provider_id, email, name, role) VALUES (?,?,?,?,?)')
      .run('google', 'g-9', 'owner@example.com', 'Owner', 'pending');

    const user = await verifyWith(
      google({ ADMIN_EMAIL: 'owner@example.com' }),
      profile('g-9', { email: 'owner@example.com' })
    );
    expect(user.role).toBe('admin');
  });

  test('links a new account to the directory entry with the same address', async () => {
    const personId = db.prepare('INSERT INTO directory (name, email) VALUES (?,?)')
      .run('Ray Harris', 'ray@example.com').lastInsertRowid;

    const user = await verifyWith(google(), profile('g-1', { email: 'ray@example.com' }));
    expect(user.directory_id).toBe(personId);
  });

  test('links an existing unlinked account on its next sign-in', async () => {
    await verifyWith(google(), profile('g-1', { email: 'ray@example.com' }));
    const personId = db.prepare('INSERT INTO directory (name, email) VALUES (?,?)')
      .run('Ray Harris', 'ray@example.com').lastInsertRowid;

    const user = await verifyWith(google(), profile('g-1', { email: 'ray@example.com' }));
    expect(user.directory_id).toBe(personId);
  });

  test('never re-points a link an admin already made', async () => {
    const assigned = db.prepare('INSERT INTO directory (name, email) VALUES (?,?)')
      .run('Raymond Harris', 'other@example.com').lastInsertRowid;
    db.prepare('INSERT INTO directory (name, email) VALUES (?,?)').run('Ray Harris', 'ray@example.com');
    db.prepare('INSERT INTO users (provider, provider_id, email, name, role, directory_id) VALUES (?,?,?,?,?,?)')
      .run('google', 'g-1', 'ray@example.com', 'Ray', 'approved', assigned);

    const user = await verifyWith(google(), profile('g-1', { email: 'ray@example.com' }));
    expect(user.directory_id).toBe(assigned);
  });

  test('a database failure is handed to passport rather than thrown', async () => {
    const strategy = google();
    jest.spyOn(db, 'prepare').mockImplementation(() => { throw new Error('database is locked'); });
    await expect(verifyWith(strategy, profile('g-1', { email: 'ray@example.com' })))
      .rejects.toThrow('database is locked');
  });
});

// ─── Session serialization ────────────────────────────────────────────────────

describe('session serialization', () => {
  let serialize, deserialize;

  beforeEach(() => {
    ({ hooks: { serialize, deserialize } } = loadAuth());
  });

  test('only the account id goes into the session', done => {
    serialize({ id: 42, name: 'Ray', email: 'ray@example.com' }, (err, stored) => {
      expect(err).toBeNull();
      expect(stored).toBe(42);
      done();
    });
  });

  test('the id is read back into the current account row', done => {
    const id = db.prepare('INSERT INTO users (provider, provider_id, email, name, role) VALUES (?,?,?,?,?)')
      .run('google', 'g-1', 'ray@example.com', 'Ray Harris', 'approved').lastInsertRowid;

    deserialize(id, (err, user) => {
      expect(err).toBeNull();
      expect(user).toMatchObject({ id, name: 'Ray Harris', role: 'approved' });
      done();
    });
  });

  test('an account that has since been deleted deserializes to nobody', done => {
    deserialize(999999, (err, user) => {
      expect(err).toBeNull();
      expect(user).toBe(false);
      done();
    });
  });

  test('a database failure is reported rather than swallowed', done => {
    jest.spyOn(db, 'prepare').mockImplementation(() => { throw new Error('database is locked'); });
    deserialize(1, err => {
      expect(err).toEqual(new Error('database is locked'));
      done();
    });
  });
});

// ─── The callback routes ──────────────────────────────────────────────────────

describe.each(['google', 'facebook'])('GET /api/auth/%s/callback', provider => {
  const CLIENT_URL = 'http://localhost:5173';

  // Stands in for passport.authenticate, calling the route's own handler with
  // whatever a provider exchange would have produced.
  function appFor(...outcome) {
    const { router, passport } = loadAuth({
      CLIENT_URL,
      GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsecret',
      FACEBOOK_APP_ID: 'fid',  FACEBOOK_APP_SECRET: 'fsecret',
    });
    jest.spyOn(passport, 'authenticate').mockImplementation((_name, handler) =>
      (req, res, next) => handler(...outcome));
    return buildApp(router);
  }

  test('sends the member to the portal once signed in', async () => {
    const app = appFor(null, { id: 7, role: 'approved' }, null);
    const res = await request(app).get(`/api/auth/${provider}/callback`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(CLIENT_URL);
    expect(app.loggedInUser).toMatchObject({ id: 7 });
  });

  test('redirects with an error when the provider exchange fails', async () => {
    const res = await request(appFor(new Error('token exchange failed'), null, null))
      .get(`/api/auth/${provider}/callback`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${CLIENT_URL}/?auth_error=${provider}`);
  });

  test('redirects with an error when the provider returns nobody', async () => {
    const res = await request(appFor(null, null, { message: 'access denied' }))
      .get(`/api/auth/${provider}/callback`);
    expect(res.headers.location).toBe(`${CLIENT_URL}/?auth_error=${provider}`);
  });

  test('redirects with an error when the provider returns nobody and says nothing', async () => {
    const res = await request(appFor(null, null, null)).get(`/api/auth/${provider}/callback`);
    expect(res.headers.location).toBe(`${CLIENT_URL}/?auth_error=${provider}`);
  });

  test('redirects with an error when the session cannot be written', async () => {
    const { router, passport } = loadAuth({
      CLIENT_URL, GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsecret',
      FACEBOOK_APP_ID: 'fid', FACEBOOK_APP_SECRET: 'fsecret',
    });
    jest.spyOn(passport, 'authenticate').mockImplementation((_name, handler) =>
      (req, res, next) => handler(null, { id: 7, role: 'approved' }, null));

    const app = express();
    app.use((req, _res, next) => { req.logIn = (_u, cb) => cb(new Error('session store down')); next(); });
    app.use('/api/auth', router);

    const res = await request(app).get(`/api/auth/${provider}/callback`);
    expect(res.headers.location).toBe(`${CLIENT_URL}/?auth_error=${provider}`);
  });
});

// ─── /me, /logout and /password-policy ────────────────────────────────────────

describe('session endpoints', () => {
  test('GET /me is 401 when nobody is signed in', async () => {
    const { router } = loadAuth();
    const res = await request(buildApp(router)).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test('GET /me describes the signed-in member without leaking the password hash', async () => {
    const { router } = loadAuth();
    const id = db.prepare(
      'INSERT INTO users (provider, provider_id, email, name, role, password_hash) VALUES (?,?,?,?,?,?)'
    ).run('local', 'ray@example.com', 'ray@example.com', 'Ray Harris', 'approved', 'scrypt$secret').lastInsertRowid;
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(id);

    const res = await request(buildApp(router, user)).get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id, name: 'Ray Harris', role: 'approved' });
    expect(JSON.stringify(res.body)).not.toContain('scrypt$secret');
  });

  test('POST /logout clears the session', async () => {
    const { router } = loadAuth();
    const app = buildApp(router);

    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(app.loggedOut).toBe(true);
  });

  test('POST /logout reports a failure to clear the session', async () => {
    const { router } = loadAuth();
    const app = express();
    app.use((req, _res, next) => { req.logout = cb => cb(new Error('session store down')); next(); });
    app.use('/api/auth', router);

    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });

  test('GET /password-policy tells the sign-up form the minimum length', async () => {
    const { router } = loadAuth();
    const res = await request(buildApp(router)).get('/api/auth/password-policy');
    expect(res.status).toBe(200);
    expect(typeof res.body.minLength).toBe('number');
    expect(res.body.minLength).toBeGreaterThan(0);
  });
});
