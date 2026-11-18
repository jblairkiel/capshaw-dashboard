// Sessions live in the database (server/lib/sessionStore.js) so a restart does
// not sign everybody out. These tests cover the store on its own, and then the
// thing it is for: a cookie issued by one app still signs in against a second
// app built on the same database file, the way the server is after a restart.
const fs      = require('fs');
const os      = require('os');
const path    = require('path');
const express = require('express');
const session = require('express-session');
const request = require('supertest');
const Database = require('better-sqlite3');

const { initSchema } = require('../schema');
const { SqliteSessionStore } = require('../lib/sessionStore');

function call(store, method, ...args) {
  return new Promise((resolve, reject) => {
    store[method](...args, (err, value) => (err ? reject(err) : resolve(value)));
  });
}

function freshDb(file = ':memory:') {
  const db = new Database(file);
  initSchema(db);
  return db;
}

const inAWeek = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

describe('SqliteSessionStore', () => {
  let db, store;
  beforeEach(() => {
    db = freshDb();
    store = new SqliteSessionStore(db, { pruneEveryMs: 0 });
  });
  afterEach(() => { store.close(); db.close(); });

  test('keeps a session and gives it back', async () => {
    const sess = { cookie: { expires: inAWeek() }, passport: { user: 42 } };
    await call(store, 'set', 'abc', sess);
    expect(await call(store, 'get', 'abc')).toEqual(sess);
    expect(await call(store, 'length')).toBe(1);
  });

  test('saving again replaces the session rather than adding a second', async () => {
    await call(store, 'set', 'abc', { cookie: { expires: inAWeek() }, passport: { user: 1 } });
    await call(store, 'set', 'abc', { cookie: { expires: inAWeek() }, passport: { user: 2 } });
    expect((await call(store, 'get', 'abc')).passport.user).toBe(2);
    expect(await call(store, 'length')).toBe(1);
  });

  test('an unknown session id finds nothing', async () => {
    expect(await call(store, 'get', 'nope')).toBeNull();
  });

  test('destroy removes the session — signing out', async () => {
    await call(store, 'set', 'abc', { cookie: { expires: inAWeek() } });
    await call(store, 'destroy', 'abc');
    expect(await call(store, 'get', 'abc')).toBeNull();
  });

  test('an expired session is never handed back, and prune sweeps it away', async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    await call(store, 'set', 'old', { cookie: { expires: past } });
    await call(store, 'set', 'new', { cookie: { expires: inAWeek() } });
    expect(await call(store, 'get', 'old')).toBeNull();
    expect(store.prune()).toBe(1);
    expect(db.prepare('SELECT sid FROM sessions').all()).toEqual([{ sid: 'new' }]);
  });

  test('touch pushes the expiry out', async () => {
    const soon = new Date(Date.now() + 1000).toISOString();
    await call(store, 'set', 'abc', { cookie: { expires: soon } });
    const later = inAWeek();
    await call(store, 'touch', 'abc', { cookie: { expires: later } });
    const row = db.prepare('SELECT expires_at FROM sessions WHERE sid = ?').get('abc');
    expect(row.expires_at).toBe(new Date(later).getTime());
  });

  test('a session with no cookie expiry is given a week', async () => {
    await call(store, 'set', 'abc', { cookie: {} });
    const row = db.prepare('SELECT expires_at FROM sessions WHERE sid = ?').get('abc');
    expect(row.expires_at).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000);
  });

  test('clear and all', async () => {
    await call(store, 'set', 'a', { cookie: { expires: inAWeek() }, n: 1 });
    await call(store, 'set', 'b', { cookie: { expires: inAWeek() }, n: 2 });
    expect(Object.keys(await call(store, 'all')).sort()).toEqual(['a', 'b']);
    await call(store, 'clear');
    expect(await call(store, 'length')).toBe(0);
  });
});

describe('a session survives a restart', () => {
  // One small app per "process": it signs you in, tells you who you are, and
  // signs you out — the same shape as the portal's own auth routes.
  function buildServer(file) {
    const db = freshDb(file);
    const store = new SqliteSessionStore(db, { pruneEveryMs: 0 });
    const app = express();
    app.use(session({ store, secret: 'test-secret', resave: false, saveUninitialized: false }));
    app.post('/login', (req, res) => req.session.regenerate(() => {
      req.session.user = 'Pat';
      res.json({ ok: true });
    }));
    app.get('/me', (req, res) => res.json({ user: req.session.user || null }));
    app.post('/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
    return { app, close: () => { store.close(); db.close(); } };
  }

  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capshaw-sessions-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('the cookie from before the restart still signs you in after it', async () => {
    const file = path.join(dir, 'portal.db');

    const before = buildServer(file);
    const login = await request(before.app).post('/login');
    const cookie = login.headers['set-cookie'];
    expect((await request(before.app).get('/me').set('Cookie', cookie)).body.user).toBe('Pat');
    before.close();

    const after = buildServer(file);
    expect((await request(after.app).get('/me').set('Cookie', cookie)).body.user).toBe('Pat');

    // And signing out still means signed out, on the new process too.
    await request(after.app).post('/logout').set('Cookie', cookie);
    expect((await request(after.app).get('/me').set('Cookie', cookie)).body.user).toBeNull();
    after.close();
  });
});
