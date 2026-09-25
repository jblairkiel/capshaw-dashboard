// /api/member-match — the data behind the "who is this?" game. A round is one
// photo and who is in it; a photo two people share is a family portrait, told
// apart from a single photo only by how many directory rows point at it.
jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const fs      = require('fs');
const path    = require('path');
const request = require('supertest');
const express = require('express');

const db     = require('../db');
const router = require('../routes/memberMatch');

const photoDir = process.env.CAPSHAW_PHOTO_DIR;

function buildApp(user = null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/member-match', router);
  return app;
}

const ADMIN   = { id: 1, role: 'admin' };
const MEMBER  = { id: 2, role: 'approved' };
const PENDING = { id: 3, role: 'pending' };

// A 1x1 PNG — small enough to write inline, real enough to sendFile.
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000155a2415a0000000049454e44ae426082',
  'hex'
);

function addPerson(name, photo = '') {
  return db.prepare('INSERT INTO directory (name, photo) VALUES (?, ?)').run(name, photo).lastInsertRowid;
}

beforeEach(() => {
  db.prepare('DELETE FROM directory').run();
  for (const f of fs.readdirSync(photoDir)) fs.unlinkSync(path.join(photoDir, f));
});

describe('GET /api/member-match/rounds', () => {
  test('401 signed out, 403 for a pending account', async () => {
    addPerson('Ray Harris', 'ray.jpg');
    for (const [user, status] of [[null, 401], [PENDING, 403]]) {
      const res = await request(buildApp(user)).get('/api/member-match/rounds');
      expect(res.status).toBe(status);
    }
  });

  test('groups a photo one person holds as a single round', async () => {
    addPerson('Ray Harris', 'ray.jpg');
    const res = await request(buildApp(MEMBER)).get('/api/member-match/rounds');
    expect(res.status).toBe(200);
    expect(res.body.rounds).toEqual([{ photo: 'ray.jpg', members: [{ id: expect.any(Number), name: 'Ray Harris' }] }]);
  });

  test('groups a photo several people share as one family round', async () => {
    addPerson('Ray Harris', 'harris-family.jpg');
    addPerson('Jan Harris', 'harris-family.jpg');
    addPerson('Tommy Harris', 'harris-family.jpg');

    const res = await request(buildApp(MEMBER)).get('/api/member-match/rounds');
    expect(res.body.rounds).toHaveLength(1);
    expect(res.body.rounds[0].photo).toBe('harris-family.jpg');
    expect(res.body.rounds[0].members.map(m => m.name).sort())
      .toEqual(['Jan Harris', 'Ray Harris', 'Tommy Harris']);
  });

  test('leaves out anybody with no photo on file', async () => {
    addPerson('Ray Harris', 'ray.jpg');
    addPerson('No Photo Nelson', '');
    const res = await request(buildApp(MEMBER)).get('/api/member-match/rounds');
    expect(res.body.rounds.flatMap(r => r.members.map(m => m.name))).toEqual(['Ray Harris']);
  });

  test('nothing on file yet is an empty list, not an error', async () => {
    const res = await request(buildApp(MEMBER)).get('/api/member-match/rounds');
    expect(res.status).toBe(200);
    expect(res.body.rounds).toEqual([]);
  });
});

describe('GET /api/member-match/photo/:filename', () => {
  test('401 signed out, 403 for a pending account', async () => {
    fs.writeFileSync(path.join(photoDir, 'ray.jpg'), PNG);
    for (const [user, status] of [[null, 401], [PENDING, 403]]) {
      const res = await request(buildApp(user)).get('/api/member-match/photo/ray.jpg');
      expect(res.status).toBe(status);
    }
  });

  test('any approved member gets it, not just their own household', async () => {
    fs.writeFileSync(path.join(photoDir, 'ray.jpg'), PNG);
    const res = await request(buildApp(MEMBER)).get('/api/member-match/photo/ray.jpg');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image/);
  });

  test('404 for a photo not on file', async () => {
    const res = await request(buildApp(ADMIN)).get('/api/member-match/photo/nothing-here.jpg');
    expect(res.status).toBe(404);
  });

  test('an encoded traversal cannot escape the photo directory', async () => {
    const outside = path.join(photoDir, '..', 'traversal-canary.txt');
    fs.writeFileSync(outside, 'top secret contents');
    try {
      const res = await request(buildApp(ADMIN)).get('/api/member-match/photo/..%2Ftraversal-canary.txt');
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain('top secret');
    } finally {
      fs.unlinkSync(outside);
    }
  });
});
