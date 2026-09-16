// server/app.js assembles the whole Express app — the pieces that are hard to
// see from any single router's own tests: the security headers every response
// carries, the site-wide auth gate, and the refusal to boot into production
// on the well-known development session secret.
jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const request = require('supertest');

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  jest.resetModules();
});

function buildApp(env = {}) {
  process.env = { ...ORIGINAL_ENV, ...env };
  jest.resetModules();
  const { createApp } = require('../app');
  return createApp();
}

describe('createApp — security headers', () => {
  test('every response carries the standard hardening headers', async () => {
    const app = buildApp({ NODE_ENV: 'test' });
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['content-security-policy']).toBeTruthy();
    // Helmet's default policy keeps everything same-origin, which is exactly
    // this app's shape: no external scripts, fonts, or images anywhere.
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    // Framework fingerprinting header should be gone.
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('createApp — the site-wide auth gate', () => {
  test('the health check stays public', async () => {
    const app = buildApp({ NODE_ENV: 'test' });
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test('everything else under /api requires a session', async () => {
    const app = buildApp({ NODE_ENV: 'test' });
    const res = await request(app).get('/api/admin/overview');
    expect(res.status).toBe(401);
  });

  test('the auth routes themselves stay reachable while signed out', async () => {
    const app = buildApp({ NODE_ENV: 'test' });
    const res = await request(app).get('/api/auth/password-policy');
    expect(res.status).toBe(200);
  });
});

describe('createApp — CSRF via trusted-origin check', () => {
  test('a mutating request with no Origin or Referer is rejected before auth runs', async () => {
    const app = buildApp({ NODE_ENV: 'test' });
    // /api/auth/login is public, so a 403 here can only come from the
    // origin check — proof it runs ahead of (and independent from) auth.
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Request origin not allowed');
  });

  test('a mutating request from an origin outside the allowed list is rejected', async () => {
    const app = buildApp({ NODE_ENV: 'test' });
    const res = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'https://evil.example.com')
      .send({});
    expect(res.status).toBe(403);
  });

  test('a mutating request from an allowed dev origin reaches the route', async () => {
    const app = buildApp({ NODE_ENV: 'test' });
    const res = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'http://localhost:5173')
      .send({});
    // Past the origin check; the login itself fails for lack of real
    // credentials, but that 400/401 (not 403) is the proof.
    expect(res.status).not.toBe(403);
  });

  test('a safe GET request needs no Origin at all', async () => {
    const app = buildApp({ NODE_ENV: 'test' });
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
  });
});

describe('createApp — session secret', () => {
  test('refuses to start in production without SESSION_SECRET', () => {
    expect(() => buildApp({ NODE_ENV: 'production', SESSION_SECRET: '' }))
      .toThrow(/SESSION_SECRET/);
  });

  test('starts in production once SESSION_SECRET is set', () => {
    expect(() => buildApp({ NODE_ENV: 'production', SESSION_SECRET: 'a-real-secret' }))
      .not.toThrow();
  });

  test('the development fallback is still fine outside production', () => {
    expect(() => buildApp({ NODE_ENV: 'test', SESSION_SECRET: '' })).not.toThrow();
  });
});

// ─── Viewing the portal as a member, as the real app wires it ─────────────────
//
// The impersonation tests mount the middleware themselves, which proves it
// works but not that the app uses it. This signs in for real — session cookie,
// passport, the whole chain — so it is the wiring that is under test: that the
// swap happens for API requests, and that it sits behind the rate limit rather
// than above it, where it would have read the database on every static asset.

describe('createApp — viewing the portal as a member', () => {
  const PASSWORD = 'correct horse battery staple';

  // buildApp resets the module registry, and the mocked db hands out a fresh
  // in-memory database each time it is required afresh. So the handle has to
  // be taken *after* the app is built, or the test would be seeding one
  // database while the app read another.
  let app;
  let db;
  let hashPassword;

  async function addLocalAdmin(name, email) {
    const { lastInsertRowid: id } = db.prepare(`
      INSERT INTO users (provider, provider_id, email, name, role, password_hash, email_verified_at)
      VALUES ('local', ?, ?, ?, 'admin', ?, datetime('now'))
    `).run(email, email, name, await hashPassword(PASSWORD));
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  }

  function addMember(name) {
    const { lastInsertRowid: id } = db.prepare(
      "INSERT INTO users (provider, provider_id, email, name, role) VALUES ('google', ?, ?, ?, 'approved')"
    ).run(`${name}-id`, `${name.toLowerCase()}@example.com`, name);
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  }

  // The origin check runs ahead of auth on every mutating request, so each
  // one here carries the header a real browser on the dev site would send.
  const ORIGIN = 'http://localhost:5173';

  // A signed-in admin, holding their session cookie between requests.
  async function signIn(app, email) {
    const agent = request.agent(app);
    const res = await agent.post('/api/auth/login').set('Origin', ORIGIN).send({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    return agent;
  }

  beforeEach(() => {
    app = buildApp({ NODE_ENV: 'test', SESSION_SECRET: 'test-secret' });
    db = require('../db');
    ({ hashPassword } = require('../lib/passwords'));
    db.prepare('DELETE FROM users').run();
    require('../routes/auth').resetRateLimits();
  });

  test('an admin can start, use and stop it, and the portal answers as the member throughout', async () => {
    const admin  = await addLocalAdmin('Ada', 'ada@example.com');
    const member = addMember('Mel');
    const agent  = await signIn(app, 'ada@example.com');

    // Their own account, before anything.
    const before = await agent.get('/api/auth/me');
    expect(before.body.user).toMatchObject({ id: admin.id, name: 'Ada' });
    expect(before.body.impersonatedBy).toBeNull();

    const started = await agent.post('/api/auth/impersonate').set('Origin', ORIGIN).send({ userId: member.id });
    expect(started.status).toBe(200);

    // Every API request is now answered as Mel, and says who is really here.
    const during = await agent.get('/api/auth/me');
    expect(during.body.user).toMatchObject({ id: member.id, name: 'Mel' });
    expect(during.body.impersonatedBy).toMatchObject({ id: admin.id, name: 'Ada' });

    // Including the admin-only screens, which are Mel's to be refused.
    expect((await agent.get('/api/auth/users')).status).toBe(403);

    const stopped = await agent.delete('/api/auth/impersonate').set('Origin', ORIGIN);
    expect(stopped.status).toBe(200);

    const after = await agent.get('/api/auth/me');
    expect(after.body.user).toMatchObject({ id: admin.id, name: 'Ada' });
    expect(after.body.impersonatedBy).toBeNull();
    expect((await agent.get('/api/auth/users')).status).toBe(200);
  });

  test('another admin\'s view cannot be borrowed, even by a signed-in admin', async () => {
    await addLocalAdmin('Ada', 'ada@example.com');
    const { lastInsertRowid: otherAdminId } = db.prepare(
      "INSERT INTO users (provider, provider_id, email, name, role) VALUES ('google', 'bea-id', 'bea@example.com', 'Bea', 'admin')"
    ).run();
    const agent = await signIn(app, 'ada@example.com');

    const res = await agent.post('/api/auth/impersonate').set('Origin', ORIGIN).send({ userId: otherAdminId });
    expect(res.status).toBe(400);
    expect((await agent.get('/api/auth/me')).body.impersonatedBy).toBeNull();
  });

  test('somebody signed out cannot start one at all', async () => {
    const member = addMember('Mel');
    const res = await request(app).post('/api/auth/impersonate').set('Origin', ORIGIN).send({ userId: member.id });
    expect(res.status).toBe(401);
  });
});
