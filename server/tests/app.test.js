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
