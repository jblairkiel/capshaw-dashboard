jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const request       = require('supertest');
const express       = require('express');
const db            = require('../db');
const profileRouter = require('../routes/profile');
const displayPrefs  = require('../lib/displayPrefs');

function buildApp(user = null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/profile', profileRouter);
  return app;
}

function addUser(fields = {}) {
  const { lastInsertRowid: id } = db.prepare(
    "INSERT INTO users (provider, provider_id, name, role) VALUES ('local', ?, 'Ray Harris', 'approved')"
  ).run(`ray-${Math.random()}`);
  if (fields.display_prefs) db.prepare('UPDATE users SET display_prefs = ? WHERE id = ?').run(fields.display_prefs, id);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

const stored = id => JSON.parse(db.prepare('SELECT display_prefs FROM users WHERE id = ?').get(id).display_prefs);

beforeEach(() => { db.prepare('DELETE FROM users').run(); });

describe('lib/displayPrefs', () => {
  test('a new account has the usual look', () => {
    const user = addUser();
    expect(user.display_prefs).toBe('{}');
    expect(displayPrefs.read(user.display_prefs))
      .toEqual({ textSize: 'standard', theme: 'standard', motion: 'standard' });
  });

  test('unknown or damaged values read as the default', () => {
    expect(displayPrefs.read('not json')).toEqual(displayPrefs.DEFAULTS);
    expect(displayPrefs.read('[1,2]')).toEqual(displayPrefs.DEFAULTS);
    expect(displayPrefs.read(JSON.stringify({ theme: 'neon', textSize: 'large', extra: 1 })))
      .toEqual({ textSize: 'large', theme: 'standard', motion: 'standard' });
  });
});

describe('PATCH /api/profile/display', () => {
  test('401 with no session user', async () => {
    const res = await request(buildApp(null)).patch('/api/profile/display').send({ theme: 'dark' });
    expect(res.status).toBe(401);
  });

  test('saves a change for the signed-in member and keeps the rest', async () => {
    const user = addUser({ display_prefs: JSON.stringify({ textSize: 'largest' }) });
    const res = await request(buildApp(user)).patch('/api/profile/display').send({ theme: 'dark' });
    expect(res.status).toBe(200);
    expect(res.body.display).toEqual({ textSize: 'largest', theme: 'dark', motion: 'standard' });
    expect(stored(user.id)).toEqual(res.body.display);
  });

  test('changes only their own account', async () => {
    const ray = addUser();
    const other = addUser();
    await request(buildApp(ray)).patch('/api/profile/display').send({ motion: 'reduce' });
    expect(stored(ray.id).motion).toBe('reduce');
    expect(db.prepare('SELECT display_prefs FROM users WHERE id = ?').get(other.id).display_prefs).toBe('{}');
  });

  test.each([
    [{ theme: 'neon' }, /theme must be one of/],
    [{ fontFamily: 'Comic Sans' }, /Unknown setting/],
    [{}, /Nothing to change/],
    [['dark'], /as an object/],
  ])('refuses %j', async (body, message) => {
    const user = addUser();
    const res = await request(buildApp(user)).patch('/api/profile/display').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
    expect(stored(user.id)).toEqual({});
  });
});
