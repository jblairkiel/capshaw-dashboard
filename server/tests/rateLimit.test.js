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
