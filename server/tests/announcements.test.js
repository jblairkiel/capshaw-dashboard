// Swap db.js for an in-memory SQLite instance before any route requires it.
// jest.mock is hoisted above imports, so the routes pick up the mocked db.
jest.mock('../db', () => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS announcements (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      type       TEXT    NOT NULL DEFAULT 'announcement',
      title      TEXT    NOT NULL,
      body       TEXT    NOT NULL DEFAULT '',
      event_date TEXT,
      event_time TEXT,
      location   TEXT,
      priority   TEXT    NOT NULL DEFAULT 'normal',
      active     INTEGER NOT NULL DEFAULT 1,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
});

const request          = require('supertest');
const express          = require('express');
const announcementRouter = require('../routes/announcements');

const APPROVED_USER = { id: 1, role: 'approved' };
const PENDING_USER  = { id: 2, role: 'pending' };

function buildApp(user = null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/announcements', announcementRouter);
  return app;
}

// ─── GET / ────────────────────────────────────────────────────────────────────

describe('GET /api/announcements', () => {
  test('returns 200 with items array (no auth required)', async () => {
    const res = await request(buildApp(null)).get('/api/announcements');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.items)).toBe(true);
  });
});

// ─── POST / ───────────────────────────────────────────────────────────────────

describe('POST /api/announcements', () => {
  test('401 with no session user', async () => {
    const res = await request(buildApp(null))
      .post('/api/announcements')
      .send({ title: 'Test' });
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test('403 with pending user', async () => {
    const res = await request(buildApp(PENDING_USER))
      .post('/api/announcements')
      .send({ title: 'Test' });
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  test('200 and returns created item for approved user', async () => {
    const res = await request(buildApp(APPROVED_USER))
      .post('/api/announcements')
      .send({ title: 'Sunday Potluck', type: 'event', body: 'Bring a dish!' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.item).toMatchObject({ title: 'Sunday Potluck', type: 'event' });
    expect(typeof res.body.item.id).toBe('number');
  });

  test('400 when title is missing', async () => {
    const res = await request(buildApp(APPROVED_USER))
      .post('/api/announcements')
      .send({ body: 'No title here' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

// ─── DELETE /:id ──────────────────────────────────────────────────────────────

describe('DELETE /api/announcements/:id', () => {
  test('401 with no session user', async () => {
    const res = await request(buildApp(null)).delete('/api/announcements/1');
    expect(res.status).toBe(401);
  });

  test('200 after creating then deleting an item', async () => {
    const app = buildApp(APPROVED_USER);
    const created = await request(app)
      .post('/api/announcements')
      .send({ title: 'To Be Deleted' });
    const { id } = created.body.item;

    const del = await request(app).delete(`/api/announcements/${id}`);
    expect(del.status).toBe(200);
    expect(del.body.success).toBe(true);

    // Verify it's gone
    const list = await request(app).get('/api/announcements');
    expect(list.body.items.find(i => i.id === id)).toBeUndefined();
  });
});

// ─── PATCH /:id/toggle ────────────────────────────────────────────────────────

describe('PATCH /api/announcements/:id/toggle', () => {
  let itemId;

  beforeAll(async () => {
    const res = await request(buildApp(APPROVED_USER))
      .post('/api/announcements')
      .send({ title: 'Toggle Test', active: 1 });
    itemId = res.body.item.id;
  });

  test('toggles active from 1 to 0', async () => {
    const res = await request(buildApp(APPROVED_USER))
      .patch(`/api/announcements/${itemId}/toggle`);
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(0);
  });

  test('toggles active from 0 to 1', async () => {
    const res = await request(buildApp(APPROVED_USER))
      .patch(`/api/announcements/${itemId}/toggle`);
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(1);
  });

  test('404 for non-existent id', async () => {
    const res = await request(buildApp(APPROVED_USER))
      .patch('/api/announcements/99999/toggle');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
