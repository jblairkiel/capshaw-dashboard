// Swap db.js for an in-memory SQLite instance before any route requires it.
jest.mock('../db', () => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE directory_families (
      id            INTEGER PRIMARY KEY,
      name          TEXT NOT NULL DEFAULT '',
      address       TEXT NOT NULL DEFAULT '',
      city          TEXT NOT NULL DEFAULT '',
      state         TEXT NOT NULL DEFAULT '',
      zip           TEXT NOT NULL DEFAULT '',
      photo_file    TEXT NOT NULL DEFAULT '',
      photo_version TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE directory (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      name      TEXT NOT NULL DEFAULT '',
      address   TEXT NOT NULL DEFAULT '',
      city      TEXT NOT NULL DEFAULT '',
      state     TEXT NOT NULL DEFAULT '',
      zip       TEXT NOT NULL DEFAULT '',
      phone     TEXT NOT NULL DEFAULT '',
      cell      TEXT NOT NULL DEFAULT '',
      email     TEXT NOT NULL DEFAULT '',
      notes     TEXT NOT NULL DEFAULT '',
      family_id INTEGER
    );
  `);
  return db;
});

const request = require('supertest');
const express = require('express');
const fs      = require('fs');
const path    = require('path');
const db      = require('../db');
const { PHOTO_DIR } = require('../lib/directory');
const adminRouter   = require('../routes/admin');

const ADMIN    = { id: 1, role: 'admin' };
const APPROVED = { id: 2, role: 'approved' };

function buildApp(user = null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/admin', adminRouter);
  return app;
}

const PHOTO_FILE = 'family-901.jpg';
const PHOTO_PATH = path.join(PHOTO_DIR, PHOTO_FILE);
// Smallest valid JPEG header is enough — the route only streams the file.
const PHOTO_BYTES = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');

beforeAll(() => {
  db.prepare("INSERT INTO directory_families (id, name, address, city, state, zip, photo_file, photo_version) VALUES (901, 'Allen, Josh & Tylan', '165 Kelly Spring Road', 'Harvest', 'AL', '35749', ?, '17575')").run(PHOTO_FILE);
  db.prepare("INSERT INTO directory_families (id, name, photo_file) VALUES (902, 'Reaves, Will', '')").run();
  db.prepare("INSERT INTO directory (name, family_id) VALUES ('Josh Allen', 901)").run();
  db.prepare("INSERT INTO directory (name, family_id) VALUES ('Tylan Allen', 901)").run();
  db.prepare("INSERT INTO directory (name, family_id) VALUES ('Will Reaves', 902)").run();
  db.prepare("INSERT INTO directory (name, family_id) VALUES ('Hand Added', NULL)").run();

  fs.mkdirSync(PHOTO_DIR, { recursive: true });
  fs.writeFileSync(PHOTO_PATH, PHOTO_BYTES);
});

afterAll(() => { fs.rmSync(PHOTO_PATH, { force: true }); });

// ─── GET /directory-families ──────────────────────────────────────────────────

describe('GET /api/admin/directory-families', () => {
  test('requires an admin', async () => {
    expect((await request(buildApp(null)).get('/api/admin/directory-families')).status).toBe(401);
    expect((await request(buildApp(APPROVED)).get('/api/admin/directory-families')).status).toBe(403);
  });

  test('nests members under their family', async () => {
    const res = await request(buildApp(ADMIN)).get('/api/admin/directory-families');
    expect(res.status).toBe(200);
    expect(res.body.memberCount).toBe(4);

    const allen = res.body.families.find(f => f.id === 901);
    expect(allen.members.map(m => m.name)).toEqual(['Josh Allen', 'Tylan Allen']);
    expect(allen.photoUrl).toBe('/api/admin/directory-photo/901');
  });

  test('families without a photo have a null photoUrl', async () => {
    const res = await request(buildApp(ADMIN)).get('/api/admin/directory-families');
    expect(res.body.families.find(f => f.id === 902).photoUrl).toBeNull();
  });

  test('collects members with no family under an Unassigned bucket', async () => {
    const res = await request(buildApp(ADMIN)).get('/api/admin/directory-families');
    const unassigned = res.body.families.find(f => f.id === null);
    expect(unassigned.name).toBe('Unassigned');
    expect(unassigned.members.map(m => m.name)).toEqual(['Hand Added']);
  });
});

// ─── GET /directory-photo/:familyId ───────────────────────────────────────────

describe('GET /api/admin/directory-photo/:familyId', () => {
  test('serves the photo file', async () => {
    const res = await request(buildApp(ADMIN)).get('/api/admin/directory-photo/901');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/jpeg/);
    expect(Buffer.from(res.body)).toEqual(PHOTO_BYTES);
  });

  test('404s for a family with no photo', async () => {
    expect((await request(buildApp(ADMIN)).get('/api/admin/directory-photo/902')).status).toBe(404);
  });

  test('404s for an unknown family', async () => {
    expect((await request(buildApp(ADMIN)).get('/api/admin/directory-photo/9999')).status).toBe(404);
  });

  test('404s when the file is missing from disk', async () => {
    db.prepare("UPDATE directory_families SET photo_file = 'family-gone.jpg' WHERE id = 902").run();
    const res = await request(buildApp(ADMIN)).get('/api/admin/directory-photo/902');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/re-run the directory scrape/);
    db.prepare("UPDATE directory_families SET photo_file = '' WHERE id = 902").run();
  });

  test('requires an admin', async () => {
    expect((await request(buildApp(APPROVED)).get('/api/admin/directory-photo/901')).status).toBe(403);
  });
});
