jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const request       = require('supertest');
const express       = require('express');
const db            = require('../db');
const profileRouter = require('../routes/profile');

function buildApp(user = null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/profile', profileRouter);
  return app;
}

function addPerson(fields) {
  const cols = Object.keys(fields);
  const { lastInsertRowid: id } = db.prepare(
    `INSERT INTO directory (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`
  ).run(...cols.map(c => fields[c]));
  return db.prepare('SELECT * FROM directory WHERE id=?').get(id);
}

// The Harris household (two people at one address), plus an unrelated person.
let DAD, MUM, KID, STRANGER;
let MEMBER, ADMIN, PENDING, UNLINKED;

beforeEach(() => {
  db.prepare('DELETE FROM worship_preferences').run();
  db.prepare('DELETE FROM worship_profile').run();
  db.prepare('DELETE FROM users').run();
  db.prepare('DELETE FROM directory').run();

  DAD      = addPerson({ name: 'Ray Harris',  address: '12 Oak St', zip: '35749', email: 'ray@example.com' });
  MUM      = addPerson({ name: 'Jo Harris',   address: '12 Oak St', zip: '35749', email: 'jo@example.com' });
  KID      = addPerson({ name: 'Sam Harris',  address: '12 Oak St', zip: '35749' });
  STRANGER = addPerson({ name: 'Pat Nolan',   address: '99 Elm St', zip: '35749' });

  MEMBER   = { id: 1, role: 'approved', directory_id: DAD.id };
  ADMIN    = { id: 2, role: 'admin',    directory_id: null };
  PENDING  = { id: 3, role: 'pending',  directory_id: MUM.id };
  UNLINKED = { id: 4, role: 'approved', directory_id: null };
});

// ─── GET /me ──────────────────────────────────────────────────────────────────

describe('GET /api/profile/me', () => {
  test('401 with no session user', async () => {
    const res = await request(buildApp(null)).get('/api/profile/me');
    expect(res.status).toBe(401);
  });

  test('returns the linked person and their whole household', async () => {
    const res = await request(buildApp(MEMBER)).get('/api/profile/me');
    expect(res.status).toBe(200);
    expect(res.body.linked).toBe(true);
    expect(res.body.person.name).toBe('Ray Harris');
    expect(res.body.household.map(p => p.name).sort())
      .toEqual(['Jo Harris', 'Ray Harris', 'Sam Harris']);
    expect(res.body.household.map(p => p.name)).not.toContain('Pat Nolan');
  });

  test('reports an unlinked account rather than failing', async () => {
    const res = await request(buildApp(UNLINKED)).get('/api/profile/me');
    expect(res.status).toBe(200);
    expect(res.body.linked).toBe(false);
    expect(res.body.person).toBeNull();
    expect(res.body.household).toEqual([]);
  });

  test('offers the worship role vocabulary', async () => {
    const res = await request(buildApp(MEMBER)).get('/api/profile/me');
    expect(res.body.roles).toContain('Song Leader');
    expect(res.body.levels).toEqual(['preferred', 'willing', 'unavailable']);
  });
});

// ─── PATCH /person/:id — contact details ──────────────────────────────────────

describe('PATCH /api/profile/person/:id', () => {
  test('a member may edit their own entry', async () => {
    const res = await request(buildApp(MEMBER))
      .patch(`/api/profile/person/${DAD.id}`)
      .send({ cell: '(256) 555-0142' });
    expect(res.status).toBe(200);
    expect(res.body.person.cell).toBe('(256) 555-0142');
  });

  test('a member may edit someone else in their household', async () => {
    const res = await request(buildApp(MEMBER))
      .patch(`/api/profile/person/${KID.id}`)
      .send({ phone: '(256) 555-0199' });
    expect(res.status).toBe(200);
    expect(res.body.person.phone).toBe('(256) 555-0199');
  });

  test('403 when reaching into another household', async () => {
    const res = await request(buildApp(MEMBER))
      .patch(`/api/profile/person/${STRANGER.id}`)
      .send({ phone: '(256) 555-0000' });
    expect(res.status).toBe(403);
    expect(db.prepare('SELECT phone FROM directory WHERE id=?').get(STRANGER.id).phone).toBe('');
  });

  test('403 for an account not linked to anyone', async () => {
    const res = await request(buildApp(UNLINKED))
      .patch(`/api/profile/person/${DAD.id}`)
      .send({ phone: '(256) 555-0000' });
    expect(res.status).toBe(403);
  });

  test('403 for a pending user, even on their own entry', async () => {
    const res = await request(buildApp(PENDING))
      .patch(`/api/profile/person/${MUM.id}`)
      .send({ phone: '(256) 555-0000' });
    expect(res.status).toBe(403);
  });

  test('an admin may edit anybody', async () => {
    const res = await request(buildApp(ADMIN))
      .patch(`/api/profile/person/${STRANGER.id}`)
      .send({ phone: '(256) 555-0123', notes: 'Prefers texts' });
    expect(res.status).toBe(200);
    expect(res.body.person.phone).toBe('(256) 555-0123');
    expect(res.body.person.notes).toBe('Prefers texts');
  });

  test('records which fields were hand-edited so a re-scrape leaves them alone', async () => {
    await request(buildApp(MEMBER)).patch(`/api/profile/person/${DAD.id}`).send({ cell: '(256) 555-0142' });
    await request(buildApp(MEMBER)).patch(`/api/profile/person/${DAD.id}`).send({ notes: 'Deacon' });
    const row = db.prepare('SELECT edited_fields FROM directory WHERE id=?').get(DAD.id);
    expect(JSON.parse(row.edited_fields).sort()).toEqual(['cell', 'notes']);
  });

  test('400 with no editable fields, and ignores unknown ones', async () => {
    const res = await request(buildApp(MEMBER))
      .patch(`/api/profile/person/${DAD.id}`)
      .send({ id: 999, edited_fields: '["everything"]' });
    expect(res.status).toBe(400);
    expect(db.prepare('SELECT id FROM directory WHERE id=?').get(DAD.id)).toBeTruthy();
  });

  test('400 when blanking the name', async () => {
    const res = await request(buildApp(MEMBER))
      .patch(`/api/profile/person/${DAD.id}`)
      .send({ name: '   ' });
    expect(res.status).toBe(400);
    expect(db.prepare('SELECT name FROM directory WHERE id=?').get(DAD.id).name).toBe('Ray Harris');
  });

  test('404 for an unknown person', async () => {
    const res = await request(buildApp(ADMIN)).patch('/api/profile/person/9999').send({ phone: '1' });
    expect(res.status).toBe(404);
  });

  test('someone with no address is a household of one', async () => {
    const loner  = addPerson({ name: 'Chris Bell' });
    const other  = addPerson({ name: 'Dana Reed' });
    const asLoner = { id: 9, role: 'approved', directory_id: loner.id };
    const res = await request(buildApp(asLoner))
      .patch(`/api/profile/person/${other.id}`)
      .send({ phone: '(256) 555-0000' });
    expect(res.status).toBe(403);
  });
});

// ─── PUT /person/:id/worship — role preferences ───────────────────────────────

describe('PUT /api/profile/person/:id/worship', () => {
  test('saves preferences and notes for yourself', async () => {
    const res = await request(buildApp(MEMBER))
      .put(`/api/profile/person/${DAD.id}/worship`)
      .send({ preferences: { 'Song Leader': 'preferred', Usher: 'willing' }, notes: 'Away in July' });
    expect(res.status).toBe(200);
    expect(res.body.person.worship.preferences).toEqual({ 'Song Leader': 'preferred', Usher: 'willing' });
    expect(res.body.person.worship.notes).toBe('Away in July');
  });

  test('saves preferences for someone else in the household', async () => {
    const res = await request(buildApp(MEMBER))
      .put(`/api/profile/person/${KID.id}/worship`)
      .send({ preferences: { Visuals: 'willing' } });
    expect(res.status).toBe(200);
    expect(res.body.person.worship.preferences).toEqual({ Visuals: 'willing' });
  });

  test('403 for another household', async () => {
    const res = await request(buildApp(MEMBER))
      .put(`/api/profile/person/${STRANGER.id}/worship`)
      .send({ preferences: { Usher: 'willing' } });
    expect(res.status).toBe(403);
  });

  test('an admin may set anybody\'s preferences', async () => {
    const res = await request(buildApp(ADMIN))
      .put(`/api/profile/person/${STRANGER.id}/worship`)
      .send({ preferences: { 'Opening Prayer': 'preferred' } });
    expect(res.status).toBe(200);
    expect(res.body.person.worship.preferences).toEqual({ 'Opening Prayer': 'preferred' });
  });

  test('replaces the previous set rather than merging', async () => {
    await request(buildApp(MEMBER))
      .put(`/api/profile/person/${DAD.id}/worship`)
      .send({ preferences: { 'Song Leader': 'preferred', Usher: 'willing' } });
    const res = await request(buildApp(MEMBER))
      .put(`/api/profile/person/${DAD.id}/worship`)
      .send({ preferences: { Usher: 'unavailable' } });
    expect(res.body.person.worship.preferences).toEqual({ Usher: 'unavailable' });
  });

  test('a null level clears that role', async () => {
    await request(buildApp(MEMBER))
      .put(`/api/profile/person/${DAD.id}/worship`)
      .send({ preferences: { Usher: 'willing' } });
    const res = await request(buildApp(MEMBER))
      .put(`/api/profile/person/${DAD.id}/worship`)
      .send({ preferences: { Usher: null } });
    expect(res.body.person.worship.preferences).toEqual({});
  });

  test('400 for an unknown role, writing nothing', async () => {
    await request(buildApp(MEMBER))
      .put(`/api/profile/person/${DAD.id}/worship`)
      .send({ preferences: { Usher: 'willing' } });
    const res = await request(buildApp(MEMBER))
      .put(`/api/profile/person/${DAD.id}/worship`)
      .send({ preferences: { 'Chief Bottle Washer': 'preferred' } });
    expect(res.status).toBe(400);
    // The earlier preference must survive a rejected write.
    expect(db.prepare('SELECT level FROM worship_preferences WHERE directory_id=?').get(DAD.id).level).toBe('willing');
  });

  test('400 for an unknown level', async () => {
    const res = await request(buildApp(MEMBER))
      .put(`/api/profile/person/${DAD.id}/worship`)
      .send({ preferences: { Usher: 'maybe' } });
    expect(res.status).toBe(400);
  });

  test('400 when preferences is missing or not an object', async () => {
    for (const body of [{}, { preferences: 'Usher' }, { preferences: ['Usher'] }]) {
      const res = await request(buildApp(MEMBER))
        .put(`/api/profile/person/${DAD.id}/worship`)
        .send(body);
      expect(res.status).toBe(400);
    }
  });

  test('leaves notes untouched when they are not supplied', async () => {
    await request(buildApp(MEMBER))
      .put(`/api/profile/person/${DAD.id}/worship`)
      .send({ preferences: {}, notes: 'Away in July' });
    const res = await request(buildApp(MEMBER))
      .put(`/api/profile/person/${DAD.id}/worship`)
      .send({ preferences: { Usher: 'willing' } });
    expect(res.body.person.worship.notes).toBe('Away in July');
  });
});

// ─── GET /person/:id ──────────────────────────────────────────────────────────

describe('GET /api/profile/person/:id', () => {
  test('a member may read their own household', async () => {
    const res = await request(buildApp(MEMBER)).get(`/api/profile/person/${KID.id}`);
    expect(res.status).toBe(200);
    expect(res.body.person.name).toBe('Sam Harris');
  });

  test('403 for another household', async () => {
    const res = await request(buildApp(MEMBER)).get(`/api/profile/person/${STRANGER.id}`);
    expect(res.status).toBe(403);
  });
});
