const request = require('supertest');
const express = require('express');
const { rateLimit } = require('../middleware/rateLimit');

function buildApp(options) {
  const app = express();
  app.use('/try', rateLimit(options), (req, res) => res.json({ success: true }));
  return app;
}

describe('rateLimit', () => {
  test('lets through up to the cap, then refuses', async () => {
    const app = buildApp({ max: 3 });

    for (let i = 0; i < 3; i++) {
      expect((await request(app).get('/try')).status).toBe(200);
    }

    const refused = await request(app).get('/try');
    expect(refused.status).toBe(429);
    expect(refused.body.code).toBe('rate_limited');
    expect(refused.headers['retry-after']).toBeTruthy();
  });

  test('forgets the count once the window has passed', async () => {
    const app = buildApp({ max: 1, windowMs: 30 });

    expect((await request(app).get('/try')).status).toBe(200);
    expect((await request(app).get('/try')).status).toBe(429);

    await new Promise(resolve => setTimeout(resolve, 50));
    expect((await request(app).get('/try')).status).toBe(200);
  });

  test('counts each caller separately', async () => {
    const app = express();
    // Exactly how the deployed app sees callers: nginx in front, so the
    // forwarded address is the one that counts.
    app.set('trust proxy', true);
    app.use('/try', rateLimit({ max: 1 }), (req, res) => res.json({ success: true }));

    const from = who => request(app).get('/try').set('X-Forwarded-For', who);

    expect((await from('10.0.0.1')).status).toBe(200);
    expect((await from('10.0.0.2')).status).toBe(200);
    expect((await from('10.0.0.1')).status).toBe(429);
  });

  test('with one trusted hop, a forwarded address the visitor typed cannot dodge the limit', async () => {
    const app = express();
    // What production runs (app.js): trust exactly one proxy. If nginx ever
    // appends instead of overwriting, Express takes the address nginx added,
    // not whatever the visitor put in front of it.
    app.set('trust proxy', 1);
    app.use('/try', rateLimit({ max: 1 }), (req, res) => res.json({ success: true }));

    const spoofed = typed => request(app).get('/try').set('X-Forwarded-For', `${typed}, 203.0.113.7`);

    expect((await spoofed('1.1.1.1')).status).toBe(200);
    expect((await spoofed('2.2.2.2')).status).toBe(429);
  });

  test('warns once when a trusted proxy forwards no address', async () => {
    const limiter = rateLimit({ max: 100 });
    const app = express();
    app.set('trust proxy', 1);
    app.use('/try', limiter, (req, res) => res.json({ success: true }));

    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      limiter.reset();
      await request(app).get('/try').set('X-Forwarded-For', '10.0.0.1');
      expect(warn).not.toHaveBeenCalled();

      await request(app).get('/try');
      await request(app).get('/try');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toMatch(/X-Forwarded-For/);
    } finally {
      warn.mockRestore();
      limiter.reset();
    }
  });

  test('reset clears everything it has counted', async () => {
    const limiter = rateLimit({ max: 1 });
    const app = express();
    app.use('/try', limiter, (req, res) => res.json({ success: true }));

    expect((await request(app).get('/try')).status).toBe(200);
    expect((await request(app).get('/try')).status).toBe(429);

    limiter.reset();
    expect((await request(app).get('/try')).status).toBe(200);
  });
});
