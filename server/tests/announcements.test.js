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

// Announcements are read-only for members. Writing belongs to whoever looks
// after them — and to the calendar area, but only for rows with a date.
const ADMIN_USER    = { id: 1, role: 'admin' };
const APPROVED_USER = { id: 2, role: 'approved', areas: [] };
const PENDING_USER  = { id: 3, role: 'pending' };
const WRITER_USER   = { id: 4, role: 'approved', areas: ['announcements'] };
const CALENDAR_USER = { id: 5, role: 'approved', areas: ['calendar'] };

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

  test('403 with a member who does not look after announcements', async () => {
    const res = await request(buildApp(APPROVED_USER))
      .post('/api/announcements')
      .send({ title: 'Members cannot post this' });
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  test('200 and returns created item for an admin', async () => {
    const res = await request(buildApp(ADMIN_USER))
      .post('/api/announcements')
      .send({ title: 'Sunday Potluck', type: 'event', body: 'Bring a dish!' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.item).toMatchObject({ title: 'Sunday Potluck', type: 'event' });
    expect(typeof res.body.item.id).toBe('number');
  });

  test('400 when title is missing', async () => {
    const res = await request(buildApp(ADMIN_USER))
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

  test('403 with an approved member', async () => {
    const created = await request(buildApp(ADMIN_USER))
      .post('/api/announcements')
      .send({ title: 'Admin only' });
    const res = await request(buildApp(APPROVED_USER)).delete(`/api/announcements/${created.body.item.id}`);
    expect(res.status).toBe(403);
  });

  test('200 after creating then deleting an item', async () => {
    const app = buildApp(ADMIN_USER);
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

  test('403 with an approved member', async () => {
    const created = await request(buildApp(ADMIN_USER))
      .post('/api/announcements')
      .send({ title: 'Toggle guard' });
    const res = await request(buildApp(APPROVED_USER)).patch(`/api/announcements/${created.body.item.id}/toggle`);
    expect(res.status).toBe(403);
  });

  beforeAll(async () => {
    const res = await request(buildApp(ADMIN_USER))
      .post('/api/announcements')
      .send({ title: 'Toggle Test', active: 1 });
    itemId = res.body.item.id;
  });

  test('toggles active from 1 to 0', async () => {
    const res = await request(buildApp(ADMIN_USER))
      .patch(`/api/announcements/${itemId}/toggle`);
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(0);
  });

  test('toggles active from 0 to 1', async () => {
    const res = await request(buildApp(ADMIN_USER))
      .patch(`/api/announcements/${itemId}/toggle`);
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(1);
  });

  test('404 for non-existent id', async () => {
    const res = await request(buildApp(ADMIN_USER))
      .patch('/api/announcements/99999/toggle');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

// ─── Areas ────────────────────────────────────────────────────────────────────

describe('who may write', () => {
  test('the announcements area may post without being an admin', async () => {
    const res = await request(buildApp(WRITER_USER))
      .post('/api/announcements')
      .send({ title: 'From the announcements area' });
    expect(res.status).toBe(200);
    expect(res.body.item.title).toBe('From the announcements area');
  });

  test('the calendar area may post a dated event', async () => {
    const res = await request(buildApp(CALENDAR_USER))
      .post('/api/announcements')
      .send({ title: 'Fellowship meal', event_date: '2026-06-14' });
    expect(res.status).toBe(200);
    expect(res.body.item.event_date).toBe('2026-06-14');
  });

  test('the calendar area may not post an undated notice', async () => {
    const res = await request(buildApp(CALENDAR_USER))
      .post('/api/announcements')
      .send({ title: 'Not a calendar entry' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/date/i);
  });

  test('the calendar area may not take the date off an event', async () => {
    const created = await request(buildApp(WRITER_USER))
      .post('/api/announcements')
      .send({ title: 'Work day', event_date: '2026-07-04' });

    const res = await request(buildApp(CALENDAR_USER))
      .put(`/api/announcements/${created.body.item.id}`)
      .send({ title: 'Work day', event_date: '' });
    expect(res.status).toBe(403);

    const still = await request(buildApp(null)).get('/api/announcements');
    expect(still.body.items.find(i => i.id === created.body.item.id).event_date).toBe('2026-07-04');
  });

  test('the calendar area may edit and delete a dated event', async () => {
    const created = await request(buildApp(WRITER_USER))
      .post('/api/announcements')
      .send({ title: 'Singing', event_date: '2026-08-02' });
    const { id } = created.body.item;

    const edited = await request(buildApp(CALENDAR_USER))
      .put(`/api/announcements/${id}`)
      .send({ title: 'Monthly singing', event_date: '2026-08-02' });
    expect(edited.status).toBe(200);

    const removed = await request(buildApp(CALENDAR_USER)).delete(`/api/announcements/${id}`);
    expect(removed.status).toBe(200);
  });
});
