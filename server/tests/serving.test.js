// A slot on the serving schedule gets a name in it two ways only: the
// Monthly Worship Schedule workflow publishing a generated draft, or whoever
// holds serving-schedule filling or changing one by hand. These check that
// building a month, and both of those ways of filling a slot, hold — and that
// the one thing left a member may do to a slot themselves, stepping down from
// one they are down for, still works.
jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const request = require('supertest');
const express = require('express');
const db      = require('../db');
const servingRouter = require('../routes/serving');

function buildApp(user = null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/serving', servingRouter);
  return app;
}

function addPerson(name, gender = '') {
  const { lastInsertRowid: id } = db.prepare('INSERT INTO directory (name, gender) VALUES (?, ?)').run(name, gender);
  return db.prepare('SELECT * FROM directory WHERE id = ?').get(id);
}

function addUser(name, role, directoryId = null, areas = []) {
  const { lastInsertRowid: id } = db.prepare(
    'INSERT INTO users (provider, provider_id, email, name, role, directory_id) VALUES (?,?,?,?,?,?)'
  ).run('google', `${name}-id`, `${name.toLowerCase()}@example.com`, name, role, directoryId);
  const grant = db.prepare('INSERT OR IGNORE INTO user_areas (user_id, area) VALUES (?, ?)');
  for (const area of areas) grant.run(id, area);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function slotsIn(month) {
  return db.prepare('SELECT * FROM job_assignments WHERE month = ? ORDER BY id').all(month);
}

let KEEPER, MAN, OTHER_MAN, WOMAN, UNLINKED, man, otherMan, woman;

beforeEach(() => {
  for (const t of ['action_log', 'job_assignments', 'worship_preferences', 'worship_profile', 'user_areas', 'users', 'directory']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }

  man      = addPerson('Joe Carter', 'male');
  otherMan = addPerson('Ned Poole',  'male');
  woman    = addPerson('Ruth Poole', 'female');

  KEEPER    = addUser('Cora', 'approved', null,        ['serving-schedule']);
  MAN       = addUser('Joe',  'approved', man.id);
  OTHER_MAN = addUser('Ned',  'approved', otherMan.id);
  WOMAN     = addUser('Ruth', 'approved', woman.id);
  UNLINKED  = addUser('Sam',  'approved', null);
});

// ─── Building a month ─────────────────────────────────────────────────────────

describe('laying out next month', () => {
  test('creates an empty slot for every job each service needs', async () => {
    const res = await request(buildApp(KEEPER))
      .post('/api/serving/months')
      .send({ month: 'June 2026', services: ['Sunday Worship'] });

    expect(res.status).toBe(200);
    expect(res.body.month).toBe('June 2026');
    expect(res.body.created).toBeGreaterThan(0);

    const slots = slotsIn('June 2026');
    expect(slots.every(s => s.name === '')).toBe(true);
    expect(new Set(slots.map(s => s.job))).toContain('Song Leader');
    // June 2026 has four Sundays: the 7th, 14th, 21st and 28th.
    expect([...new Set(slots.map(s => s.date))]).toEqual(['June 7', 'June 14', 'June 21', 'June 28']);
  });

  test('running it twice does not double the month up', async () => {
    const app = buildApp(KEEPER);
    await request(app).post('/api/serving/months').send({ month: 'June 2026', services: ['Sunday Worship'] });
    const before = slotsIn('June 2026').length;

    const again = await request(app).post('/api/serving/months').send({ month: 'June 2026', services: ['Sunday Worship'] });
    expect(again.body.created).toBe(0);
    expect(slotsIn('June 2026')).toHaveLength(before);
  });

  test('a month nobody can read is refused, and writes nothing', async () => {
    const res = await request(buildApp(KEEPER)).post('/api/serving/months').send({ month: 'Junetember' });
    expect(res.status).toBe(400);
    expect(db.prepare('SELECT COUNT(*) n FROM job_assignments').get().n).toBe(0);
  });

  test('a member who does not look after the schedule cannot build one', async () => {
    const res = await request(buildApp(MAN)).post('/api/serving/months').send({ month: 'June 2026' });
    expect(res.status).toBe(403);
    expect(db.prepare('SELECT COUNT(*) n FROM job_assignments').get().n).toBe(0);
  });
});

// ─── Filling a slot — the roster role's to do ──────────────────────────────────

describe('filling a slot by hand', () => {
  test('there is no self sign-up any more — the route is gone', async () => {
    await request(buildApp(KEEPER)).post('/api/serving/months').send({ month: 'June 2026', services: ['Sunday Worship'] });
    const slot = slotsIn('June 2026').find(s => s.job === 'Song Leader');

    const res = await request(buildApp(MAN)).post(`/api/serving/assignments/${slot.id}/signup`);
    expect(res.status).toBe(404);
    expect(db.prepare('SELECT name FROM job_assignments WHERE id = ?').get(slot.id).name).toBe('');
  });

  test('the schedule keeper can put a name in an empty slot', async () => {
    await request(buildApp(KEEPER)).post('/api/serving/months').send({ month: 'June 2026', services: ['Sunday Worship'] });
    const slot = slotsIn('June 2026').find(s => s.job === 'Song Leader');

    const res = await request(buildApp(KEEPER))
      .patch(`/api/serving/assignments/${slot.id}`)
      .send({ name: 'Joe Carter' });

    expect(res.status).toBe(200);
    expect(res.body.assignment.name).toBe('Joe Carter');
  });

  test('a member cannot put a name in an empty slot by editing it directly either', async () => {
    await request(buildApp(KEEPER)).post('/api/serving/months').send({ month: 'June 2026', services: ['Sunday Worship'] });
    const slot = slotsIn('June 2026').find(s => s.job === 'Song Leader');

    const res = await request(buildApp(MAN))
      .patch(`/api/serving/assignments/${slot.id}`)
      .send({ name: 'Joe Carter' });

    expect(res.status).toBe(403);
    expect(db.prepare('SELECT name FROM job_assignments WHERE id = ?').get(slot.id).name).toBe('');
  });
});

// ─── Taking your own name off ──────────────────────────────────────────────────

describe('taking your own name off a slot', () => {
  let slot;

  beforeEach(async () => {
    await request(buildApp(KEEPER)).post('/api/serving/months').send({ month: 'June 2026', services: ['Sunday Worship'] });
    slot = slotsIn('June 2026').find(s => s.job === 'Song Leader');
    // Down for it the way a generated or hand-filled slot would be — nobody
    // signs themselves up any more.
    db.prepare('UPDATE job_assignments SET name = ? WHERE id = ?').run('Joe Carter', slot.id);
  });

  test('you may step back down from your own slot', async () => {
    const res = await request(buildApp(MAN)).delete(`/api/serving/assignments/${slot.id}/signup`);
    expect(res.status).toBe(200);
    expect(db.prepare('SELECT name FROM job_assignments WHERE id = ?').get(slot.id).name).toBe('');
  });

  test('you may not take somebody else off, but the schedule keeper may', async () => {
    const refused = await request(buildApp(OTHER_MAN)).delete(`/api/serving/assignments/${slot.id}/signup`);
    expect(refused.status).toBe(403);
    expect(db.prepare('SELECT name FROM job_assignments WHERE id = ?').get(slot.id).name).toBe('Joe Carter');

    const cleared = await request(buildApp(KEEPER)).delete(`/api/serving/assignments/${slot.id}/signup`);
    expect(cleared.status).toBe(200);
  });

  test('an account with no directory entry cannot claim a slot is theirs', async () => {
    const res = await request(buildApp(UNLINKED)).delete(`/api/serving/assignments/${slot.id}/signup`);
    expect(res.status).toBe(403);
    expect(db.prepare('SELECT name FROM job_assignments WHERE id = ?').get(slot.id).name).toBe('Joe Carter');
  });

  test('stepping down is recorded in the action history by name', async () => {
    await request(buildApp(MAN)).delete(`/api/serving/assignments/${slot.id}/signup`);

    const entry = db.prepare('SELECT * FROM action_log ORDER BY id DESC').get();
    expect(entry).toMatchObject({ area: 'serving-schedule', user_id: MAN.id });
    expect(entry.summary).toMatch(/Joe Carter stepped down from Song Leader/);
  });
});

// ─── The service roster ───────────────────────────────────────────────────────
// What each man will volunteer for. He can say it himself on his profile; the
// schedule keeper can write down what he said in the foyer.

describe('recording what somebody will serve', () => {
  function prefer(directoryId, role, level) {
    db.prepare('INSERT INTO worship_preferences (directory_id, role, level) VALUES (?, ?, ?)')
      .run(directoryId, role, level);
  }

  function levelsFor(directoryId) {
    return Object.fromEntries(
      db.prepare('SELECT role, level FROM worship_preferences WHERE directory_id = ? ORDER BY role').all(directoryId)
        .map(r => [r.role, r.level])
    );
  }

  test('only the schedule keeper may see the roster', async () => {
    const res = await request(buildApp(MAN)).get('/api/serving/members');
    expect(res.status).toBe(403);
  });

  test('the roster lists everyone with what they said', async () => {
    prefer(man.id, 'Song Leader', 'preferred');
    prefer(man.id, 'Usher', 'unavailable');
    db.prepare('INSERT INTO worship_profile (directory_id, notes) VALUES (?, ?)').run(man.id, 'Away in June');

    const res = await request(buildApp(KEEPER)).get('/api/serving/members');
    expect(res.status).toBe(200);

    const joe = res.body.members.find(m => m.name === 'Joe Carter');
    expect(joe.preferences).toEqual({ 'Song Leader': 'preferred', Usher: 'unavailable' });
    expect(joe.notes).toBe('Away in June');

    // Somebody who has said nothing reads as nothing, not as a refusal.
    expect(res.body.members.find(m => m.name === 'Ned Poole').preferences).toEqual({});
    expect(res.body.levels).toEqual(['preferred', 'willing', 'unavailable']);
  });

  test('the schedule keeper can write down what a man said', async () => {
    const res = await request(buildApp(KEEPER))
      .put(`/api/serving/members/${man.id}/preferences`)
      .send({ preferences: { 'Song Leader': 'preferred', Communion: 'willing' }, notes: 'Told me after services' });

    expect(res.status).toBe(200);
    expect(res.body.member.preferences).toEqual({ 'Song Leader': 'preferred', Communion: 'willing' });
    expect(res.body.member.notes).toBe('Told me after services');
    expect(levelsFor(man.id)).toEqual({ 'Song Leader': 'preferred', Communion: 'willing' });
  });

  test('what is sent replaces what was there, and a cleared role goes', async () => {
    prefer(man.id, 'Song Leader', 'preferred');
    prefer(man.id, 'Usher', 'willing');

    const res = await request(buildApp(KEEPER))
      .put(`/api/serving/members/${man.id}/preferences`)
      .send({ preferences: { 'Song Leader': 'willing', Usher: null } });

    expect(res.status).toBe(200);
    expect(levelsFor(man.id)).toEqual({ 'Song Leader': 'willing' });
  });

  test('a note is left alone by a save that does not mention it', async () => {
    db.prepare('INSERT INTO worship_profile (directory_id, notes) VALUES (?, ?)').run(man.id, 'Works most Wednesdays');

    const res = await request(buildApp(KEEPER))
      .put(`/api/serving/members/${man.id}/preferences`)
      .send({ preferences: { Usher: 'willing' } });

    expect(res.status).toBe(200);
    expect(res.body.member.notes).toBe('Works most Wednesdays');
  });

  test('a role or a level nobody has heard of is refused, and writes nothing', async () => {
    prefer(man.id, 'Song Leader', 'preferred');

    const badRole = await request(buildApp(KEEPER))
      .put(`/api/serving/members/${man.id}/preferences`)
      .send({ preferences: { 'Bell Ringer': 'willing' } });
    expect(badRole.status).toBe(400);
    expect(badRole.body.error).toMatch(/Bell Ringer/);

    const badLevel = await request(buildApp(KEEPER))
      .put(`/api/serving/members/${man.id}/preferences`)
      .send({ preferences: { Usher: 'maybe' } });
    expect(badLevel.status).toBe(400);

    // Neither attempt left half a set behind.
    expect(levelsFor(man.id)).toEqual({ 'Song Leader': 'preferred' });
  });

  test('a member cannot record preferences for somebody else from here', async () => {
    const res = await request(buildApp(MAN))
      .put(`/api/serving/members/${otherMan.id}/preferences`)
      .send({ preferences: { Usher: 'willing' } });

    expect(res.status).toBe(403);
    expect(db.prepare('SELECT COUNT(*) n FROM worship_preferences').get().n).toBe(0);
  });

  test('somebody who is not in the directory at all is a 404', async () => {
    const res = await request(buildApp(KEEPER))
      .put('/api/serving/members/9999/preferences')
      .send({ preferences: {} });
    expect(res.status).toBe(404);
  });

  test('the history says what changed, and who wrote it down', async () => {
    prefer(man.id, 'Usher', 'willing');

    await request(buildApp(KEEPER))
      .put(`/api/serving/members/${man.id}/preferences`)
      .send({ preferences: { Usher: 'unavailable', 'Song Leader': 'preferred' } });

    const entry = db.prepare('SELECT * FROM action_log ORDER BY id DESC').get();
    expect(entry).toMatchObject({ area: 'serving-schedule', user_id: KEEPER.id, entity: 'worship preferences' });
    expect(entry.summary).toMatch(/Joe Carter/);
    expect(entry.summary).toMatch(/Song Leader: no preference → preferred/);
    expect(entry.summary).toMatch(/Usher: willing → unavailable/);
  });
});

// ─── What the page is told ────────────────────────────────────────────────────

describe('GET /api/serving', () => {
  test('tells each person what they may do with the month', async () => {
    await request(buildApp(KEEPER)).post('/api/serving/months').send({ month: 'June 2026', services: ['Sunday Worship'] });

    const keeper = await request(buildApp(KEEPER)).get('/api/serving');
    expect(keeper.body.canManage).toBe(true);
    expect(keeper.body.month).toBe('June 2026');
    expect(keeper.body.assignments.length).toBeGreaterThan(0);

    const member = await request(buildApp(MAN)).get('/api/serving');
    expect(member.body.canManage).toBe(false);
    expect(member.body.me).toMatchObject({ name: 'Joe Carter' });
    // There is nothing left for a member to sign up for, so the page is not
    // told anything about eligibility any more.
    expect(member.body.me.jobs).toBeUndefined();
    expect(member.body.me.canSignUp).toBeUndefined();
  });
});
