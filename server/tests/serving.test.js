// The serving schedule has two audiences: whoever builds it, and the men who
// sign themselves up for what is left. These check that the line between them
// holds from both sides.
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

function allow(directoryId, ...jobs) {
  const ins = db.prepare('INSERT OR IGNORE INTO job_eligibility (directory_id, job) VALUES (?, ?)');
  for (const job of jobs) ins.run(directoryId, job);
}

function slotsIn(month) {
  return db.prepare('SELECT * FROM job_assignments WHERE month = ? ORDER BY id').all(month);
}

let KEEPER, MAN, OTHER_MAN, WOMAN, UNLINKED, man, otherMan, woman;

beforeEach(() => {
  for (const t of ['action_log', 'job_eligibility', 'job_assignments', 'user_areas', 'users', 'directory']) {
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

// ─── Signing up ───────────────────────────────────────────────────────────────

describe('signing up for a job', () => {
  let slot;

  beforeEach(async () => {
    await request(buildApp(KEEPER)).post('/api/serving/months').send({ month: 'June 2026', services: ['Sunday Worship'] });
    slot = slotsIn('June 2026').find(s => s.job === 'Song Leader');
  });

  test('a man who has been signed off for the job may take an empty slot', async () => {
    allow(man.id, 'Song Leader');
    const res = await request(buildApp(MAN)).post(`/api/serving/assignments/${slot.id}/signup`);
    expect(res.status).toBe(200);
    expect(res.body.assignment.name).toBe('Joe Carter');
  });

  test('a man who has not been signed off for that job may not', async () => {
    allow(man.id, 'Usher');
    const res = await request(buildApp(MAN)).post(`/api/serving/assignments/${slot.id}/signup`);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/signed off/i);
  });

  test('worship jobs are the men\'s, so a woman is told so rather than refused blankly', async () => {
    allow(woman.id, 'Song Leader');
    const res = await request(buildApp(WOMAN)).post(`/api/serving/assignments/${slot.id}/signup`);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/men of the congregation/i);
  });

  test('an account with no directory entry is told to get one linked', async () => {
    const res = await request(buildApp(UNLINKED)).post(`/api/serving/assignments/${slot.id}/signup`);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/directory/i);
  });

  test('a slot somebody already has cannot be taken from under them', async () => {
    allow(man.id, 'Song Leader');
    allow(otherMan.id, 'Song Leader');
    await request(buildApp(MAN)).post(`/api/serving/assignments/${slot.id}/signup`);

    const res = await request(buildApp(OTHER_MAN)).post(`/api/serving/assignments/${slot.id}/signup`);
    expect(res.status).toBe(409);
    expect(db.prepare('SELECT name FROM job_assignments WHERE id = ?').get(slot.id).name).toBe('Joe Carter');
  });

  test('you may step back down from your own slot', async () => {
    allow(man.id, 'Song Leader');
    await request(buildApp(MAN)).post(`/api/serving/assignments/${slot.id}/signup`);

    const res = await request(buildApp(MAN)).delete(`/api/serving/assignments/${slot.id}/signup`);
    expect(res.status).toBe(200);
    expect(db.prepare('SELECT name FROM job_assignments WHERE id = ?').get(slot.id).name).toBe('');
  });

  test('you may not take somebody else off, but the schedule keeper may', async () => {
    allow(man.id, 'Song Leader');
    await request(buildApp(MAN)).post(`/api/serving/assignments/${slot.id}/signup`);

    const refused = await request(buildApp(OTHER_MAN)).delete(`/api/serving/assignments/${slot.id}/signup`);
    expect(refused.status).toBe(403);
    expect(db.prepare('SELECT name FROM job_assignments WHERE id = ?').get(slot.id).name).toBe('Joe Carter');

    const cleared = await request(buildApp(KEEPER)).delete(`/api/serving/assignments/${slot.id}/signup`);
    expect(cleared.status).toBe(200);
  });

  test('a sign-up is recorded in the action history by name', async () => {
    allow(man.id, 'Song Leader');
    await request(buildApp(MAN)).post(`/api/serving/assignments/${slot.id}/signup`);

    const entry = db.prepare('SELECT * FROM action_log ORDER BY id DESC').get();
    expect(entry).toMatchObject({ area: 'serving-schedule', user_id: MAN.id });
    expect(entry.summary).toMatch(/Joe Carter signed up for Song Leader/);
  });
});

// ─── The page behind the area ─────────────────────────────────────────────────

describe('managing who may sign up for what', () => {
  test('lists every member with their jobs, for the area only', async () => {
    allow(man.id, 'Song Leader', 'Usher');

    const refused = await request(buildApp(MAN)).get('/api/serving/members');
    expect(refused.status).toBe(403);

    const res = await request(buildApp(KEEPER)).get('/api/serving/members');
    expect(res.status).toBe(200);
    expect(res.body.members.find(m => m.name === 'Joe Carter').jobs.sort()).toEqual(['Song Leader', 'Usher']);
    expect(res.body.members.find(m => m.name === 'Ruth Poole').jobs).toEqual([]);
    expect(res.body.jobs).toContain('Communion');
  });

  test('setting somebody\'s jobs replaces what they had', async () => {
    allow(man.id, 'Song Leader', 'Usher');
    const res = await request(buildApp(KEEPER))
      .put(`/api/serving/members/${man.id}/jobs`)
      .send({ jobs: ['Communion'] });

    expect(res.status).toBe(200);
    expect(res.body.member.jobs).toEqual(['Communion']);
  });

  test('a job nobody has heard of is refused, and changes nothing', async () => {
    allow(man.id, 'Song Leader');
    const res = await request(buildApp(KEEPER))
      .put(`/api/serving/members/${man.id}/jobs`)
      .send({ jobs: ['Bell Ringer'] });

    expect(res.status).toBe(400);
    expect(db.prepare('SELECT job FROM job_eligibility WHERE directory_id = ?').all(man.id))
      .toEqual([{ job: 'Song Leader' }]);
  });

  test('a member may not hand themselves a job', async () => {
    const res = await request(buildApp(MAN))
      .put(`/api/serving/members/${man.id}/jobs`)
      .send({ jobs: ['Song Leader'] });
    expect(res.status).toBe(403);
    expect(db.prepare('SELECT COUNT(*) n FROM job_eligibility').get().n).toBe(0);
  });
});

// ─── What the page is told ────────────────────────────────────────────────────

describe('GET /api/serving', () => {
  test('tells each person what they may do with the month', async () => {
    await request(buildApp(KEEPER)).post('/api/serving/months').send({ month: 'June 2026', services: ['Sunday Worship'] });
    allow(man.id, 'Song Leader');

    const keeper = await request(buildApp(KEEPER)).get('/api/serving');
    expect(keeper.body.canManage).toBe(true);
    expect(keeper.body.month).toBe('June 2026');
    expect(keeper.body.assignments.length).toBeGreaterThan(0);

    const member = await request(buildApp(MAN)).get('/api/serving');
    expect(member.body.canManage).toBe(false);
    expect(member.body.me).toMatchObject({ name: 'Joe Carter', canSignUp: true, jobs: ['Song Leader'] });

    const she = await request(buildApp(WOMAN)).get('/api/serving');
    expect(she.body.me.canSignUp).toBe(false);
  });
});
