// The services the congregation meets for are a list an admin keeps, not free
// text retyped on every attendance record. These check both halves of that:
// everybody can read the list, and only an admin can change it.
jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const request = require('supertest');
const express = require('express');
const db      = require('../db');
const recordsRouter = require('../routes/records');

function buildApp(user = null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/records', recordsRouter);
  return app;
}

const ADMIN      = { id: 1, role: 'admin',    name: 'Ada' };
const ATTENDANCE = { id: 2, role: 'approved', name: 'Ann', areas: ['attendance'] };
const MEMBER     = { id: 3, role: 'approved', name: 'Mel', areas: [] };

beforeEach(() => {
  for (const table of ['action_log', 'attendance', 'user_areas', 'users']) {
    db.prepare(`DELETE FROM ${table}`).run();
  }
  const insert = db.prepare('INSERT INTO users (id, provider, provider_id, email, name, role) VALUES (?,?,?,?,?,?)');
  for (const u of [ADMIN, ATTENDANCE, MEMBER]) {
    insert.run(u.id, 'google', `${u.name}-id`, `${u.name.toLowerCase()}@example.com`, u.name, u.role);
  }
});

function typeNames() {
  return db.prepare('SELECT name FROM service_types ORDER BY sort_order, name').all().map(r => r.name);
}

describe('the service type list', () => {
  test('is seeded so attendance can be recorded straight away', () => {
    expect(typeNames().length).toBeGreaterThan(0);
  });

  test('anybody signed in can read it — the attendance form is built from it', async () => {
    const res = await request(buildApp(MEMBER)).get('/api/records/service_types');
    expect(res.status).toBe(200);
    expect(res.body.rows.length).toBeGreaterThan(0);
    expect(res.body.canWrite).toBe(false);
  });

  test('an admin can add one, and it is recorded in the action history', async () => {
    const res = await request(buildApp(ADMIN))
      .post('/api/records/service_types')
      .send({ name: 'Sunrise Service', sort_order: 9 });

    expect(res.status).toBe(200);
    expect(typeNames()).toContain('Sunrise Service');

    const entry = db.prepare('SELECT * FROM action_log ORDER BY id DESC').get();
    expect(entry).toMatchObject({ user_id: ADMIN.id, action: 'create', entity: 'service type' });
    expect(entry.summary).toMatch(/Sunrise Service/);
  });

  test('even the attendance area cannot change the list — it is every record\'s to agree on', async () => {
    const before = typeNames();

    const added = await request(buildApp(ATTENDANCE))
      .post('/api/records/service_types')
      .send({ name: 'Mine Alone' });
    expect(added.status).toBe(403);
    expect(added.body.error).toMatch(/admin/i);

    const id = db.prepare('SELECT id FROM service_types ORDER BY id').get().id;
    expect((await request(buildApp(ATTENDANCE)).patch(`/api/records/service_types/${id}`).send({ name: 'Renamed' })).status).toBe(403);
    expect((await request(buildApp(ATTENDANCE)).delete(`/api/records/service_types/${id}`)).status).toBe(403);

    expect(typeNames()).toEqual(before);
    expect(db.prepare('SELECT COUNT(*) n FROM action_log').get().n).toBe(0);
  });

  test('a service can be retired without touching the attendance recorded under it', async () => {
    const type = db.prepare('SELECT * FROM service_types ORDER BY sort_order').get();
    db.prepare('INSERT INTO attendance (date, service, count) VALUES (?, ?, ?)').run('2026-06-07', type.name, 91);

    const res = await request(buildApp(ADMIN))
      .patch(`/api/records/service_types/${type.id}`)
      .send({ active: 0 });

    expect(res.status).toBe(200);
    expect(res.body.row.active).toBe(0);
    // Still on the list, and the record that used it is untouched.
    expect(typeNames()).toContain(type.name);
    expect(db.prepare('SELECT count FROM attendance WHERE service = ?').get(type.name).count).toBe(91);
  });

  test('renaming one leaves the records already saved under the old name alone', async () => {
    const type = db.prepare('SELECT * FROM service_types ORDER BY sort_order').get();
    db.prepare('INSERT INTO attendance (date, service, count) VALUES (?, ?, ?)').run('2026-06-07', type.name, 91);

    await request(buildApp(ADMIN))
      .patch(`/api/records/service_types/${type.id}`)
      .send({ name: 'Renamed Service' });

    expect(db.prepare('SELECT service FROM attendance').get().service).toBe(type.name);
    expect(typeNames()).toContain('Renamed Service');
  });

  test('two services cannot share a name', async () => {
    const existing = db.prepare('SELECT name FROM service_types ORDER BY sort_order').get().name;
    const res = await request(buildApp(ADMIN)).post('/api/records/service_types').send({ name: existing });
    expect(res.status).toBe(500);
    expect(db.prepare('SELECT COUNT(*) n FROM service_types WHERE name = ?').get(existing).n).toBe(1);
  });
});
