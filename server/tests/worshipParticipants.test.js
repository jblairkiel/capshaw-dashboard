// Who the worship jobs are rostered among. By default a man who is a baptized
// member; anybody else only when the schedule keeper says so for that one
// person, and nobody whose membership has not been recorded.
jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const request = require('supertest');
const express = require('express');
const db      = require('../db');
const servingRouter = require('../routes/serving');
const profileRouter = require('../routes/profile');
const participation = require('../lib/participation');
const { participatesByDefault, isWorshipParticipant, participationReason } = require('../lib/people');

function buildApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/serving', servingRouter);
  return app;
}

function addPerson(name, { gender = 'male', membership = '', override = '' } = {}) {
  const { lastInsertRowid: id } = db.prepare(
    'INSERT INTO directory (name, gender, membership, worship_participant) VALUES (?, ?, ?, ?)'
  ).run(name, gender, membership, override);
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

const prefer = (person, role, level = 'willing') =>
  db.prepare('INSERT OR REPLACE INTO worship_preferences (directory_id, role, level) VALUES (?, ?, ?)').run(person.id, role, level);
const JOBS = ['Song Leader', 'Opening Prayer', 'Closing Prayer'];

let KEEPER, MEMBER;

beforeEach(() => {
  for (const t of ['action_log', 'job_assignments', 'service_jobs', 'worship_preferences', 'worship_profile', 'job_blackouts', 'user_areas', 'users', 'directory']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
  KEEPER = addUser('Cora', 'approved', null, ['serving-schedule']);
  MEMBER = addUser('Mel',  'approved');
});

// ─── The rule ─────────────────────────────────────────────────────────────────

describe('the default', () => {
  const cases = [
    // gender,  membership,   override, participates, reason
    ['male',   'member',     '',    true,  'Baptized member'],
    ['male',   '',           '',    false, 'Not rostered yet: membership not recorded'],
    ['male',   'not-member', '',    false, 'Not rostered: not a baptized member'],
    ['female', 'member',     '',    false, 'Not rostered: the worship jobs go to men'],
    ['',       'member',     '',    false, 'Not rostered yet: gender not recorded'],
    ['male',   'member',     'no',  false, 'Left off by the schedule keeper'],
    ['male',   '',           'yes', true,  'Rostered by the schedule keeper'],
  ];

  test.each(cases)('gender %p, membership %p, override %p → %p', (gender, membership, override, participates, reason) => {
    const person = { gender, membership, worship_participant: override };
    expect(isWorshipParticipant(person)).toBe(participates);
    expect(participationReason(person)).toBe(reason);
  });

  test('only a baptized man is a participant by default, whatever the override', () => {
    expect(participatesByDefault({ gender: 'Male', membership: 'Member' })).toBe(true);
    expect(participatesByDefault({ gender: 'male', membership: '', worship_participant: 'yes' })).toBe(false);
    expect(participatesByDefault({})).toBe(false);
    expect(participatesByDefault(null)).toBe(false);
  });

  test('a new directory entry starts with nothing recorded, so it is not a participant', () => {
    const { lastInsertRowid: id } = db.prepare("INSERT INTO directory (name, gender) VALUES ('New Man', 'male')").run();
    const row = db.prepare('SELECT * FROM directory WHERE id = ?').get(id);
    expect(row.membership).toBe('');
    expect(row.worship_participant).toBe('');
    expect(isWorshipParticipant(row)).toBe(false);
  });
});

// ─── Building a month ─────────────────────────────────────────────────────────

describe('building a month fills slots only from participants', () => {
  test('the unrecorded, the non-member, the woman and the man left off are never put in', async () => {
    const people = [
      addPerson('Al Baptized', { membership: 'member' }),
      addPerson('Bo Unrecorded'),
      addPerson('Cy Visitor', { membership: 'not-member' }),
      addPerson('Di Member', { gender: 'female', membership: 'member' }),
      addPerson('Ed Leftoff', { membership: 'member', override: 'no' }),
      addPerson('Fe Rostered', { override: 'yes' }),
    ];
    for (const p of people) for (const job of JOBS) prefer(p, job, 'preferred');

    const res = await request(buildApp(KEEPER)).post('/api/serving/months').send({ month: 'June 2026', services: ['Wednesday'] });
    expect(res.status).toBe(200);
    const names = new Set(db.prepare("SELECT name FROM job_assignments WHERE month = 'June 2026' AND name <> ''").all().map(r => r.name));
    expect([...names].sort()).toEqual(['Al Baptized', 'Fe Rostered']);

    const slot = db.prepare("SELECT id FROM job_assignments WHERE month = 'June 2026' LIMIT 1").get();
    const picker = await request(buildApp(KEEPER)).get(`/api/serving/assignments/${slot.id}/candidates`);
    expect(picker.body.candidates.map(c => c.name).sort()).toEqual(['Al Baptized', 'Fe Rostered']);
  });
});

// ─── What the keeper sees and records ─────────────────────────────────────────

describe('the Service Roster', () => {
  test('lists every man, saying who is not rostered and why, and counts only participants', () => {
    const al = addPerson('Al Baptized', { membership: 'member' });
    const bo = addPerson('Bo Unrecorded');
    addPerson('Di Member', { gender: 'female', membership: 'member' });
    prefer(al, 'Song Leader', 'preferred');
    prefer(bo, 'Song Leader', 'preferred');

    const p = participation.preferences({ weeks: 4, today: '2026-06-30' });
    expect(p.men.map(m => [m.name, m.participates, m.reason, m.membership])).toEqual([
      ['Al Baptized', true, 'Baptized member', 'member'],
      ['Bo Unrecorded', false, 'Not rostered yet: membership not recorded', ''],
    ]);
    expect(p.summary).toEqual({ men: 1, said: 1, unsaid: 0, notRostered: 1 });
    expect(p.coverage.find(c => c.role === 'Song Leader')).toMatchObject({ glad: 1, unsaid: 0 });
  });

  test('the member list carries each person\'s participation', async () => {
    const al = addPerson('Al Baptized', { membership: 'member' });
    const res = await request(buildApp(KEEPER)).get('/api/serving/members');
    const row = res.body.members.find(m => m.id === al.id);
    expect(row.participation).toEqual({ membership: 'member', override: '', participates: true, byDefault: true, reason: 'Baptized member' });
    expect(row).not.toHaveProperty('membership');
    expect(res.body.memberships).toEqual(['member', 'not-member']);
    expect(res.body.overrides).toEqual(['yes', 'no']);
  });

  test('the keeper records a man as a baptized member, and he is rostered from then on', async () => {
    const bo = addPerson('Bo Unrecorded');
    const res = await request(buildApp(KEEPER)).put(`/api/serving/members/${bo.id}/participation`).send({ membership: 'member' });
    expect(res.status).toBe(200);
    expect(res.body.member.participation).toMatchObject({ membership: 'member', participates: true });
    expect(db.prepare('SELECT membership FROM directory WHERE id = ?').get(bo.id).membership).toBe('member');
    expect(db.prepare("SELECT summary FROM action_log WHERE entity = 'worship participation'").get().summary)
      .toBe('Recorded Bo Unrecorded as a baptized member for the worship jobs');
  });

  test('the keeper can roster or leave off one person, and set him back to the default', async () => {
    const al = addPerson('Al Baptized', { membership: 'member' });
    const app = buildApp(KEEPER);
    expect((await request(app).put(`/api/serving/members/${al.id}/participation`).send({ override: 'no' })).body.member.participation)
      .toMatchObject({ override: 'no', participates: false, byDefault: true });
    expect((await request(app).put(`/api/serving/members/${al.id}/participation`).send({ override: '' })).body.member.participation)
      .toMatchObject({ override: '', participates: true });
  });

  test('the keeper ticks several men and marks them baptized members at once', async () => {
    const bo = addPerson('Bo Unrecorded');
    const cy = addPerson('Cy Visitor', { membership: 'not-member' });
    const al = addPerson('Al Baptized', { membership: 'member' });
    const res = await request(buildApp(KEEPER)).put('/api/serving/members/participation')
      .send({ ids: [bo.id, cy.id, al.id, bo.id], membership: 'member' });

    expect(res.status).toBe(200);
    expect(res.body.changed).toBe(2);
    expect(res.body.members.map(m => [m.name, m.participation.participates])).toEqual([
      ['Bo Unrecorded', true], ['Cy Visitor', true], ['Al Baptized', true],
    ]);
    expect(db.prepare("SELECT COUNT(*) n FROM directory WHERE membership = 'member'").get().n).toBe(3);
    const log = db.prepare("SELECT summary FROM action_log WHERE entity = 'worship participation'").all();
    expect(log).toEqual([{ summary: 'Recorded 2 people as a baptized member for the worship jobs: Bo Unrecorded, Cy Visitor' }]);
  });

  test('marking several at once leaves an override alone, and refuses what it cannot do', async () => {
    const ed = addPerson('Ed Leftoff', { override: 'no' });
    const app = buildApp(KEEPER);
    const ok = await request(app).put('/api/serving/members/participation').send({ ids: [ed.id], membership: 'member' });
    expect(ok.body.members[0].participation).toMatchObject({ membership: 'member', override: 'no', participates: false });

    expect((await request(app).put('/api/serving/members/participation').send({ ids: [], membership: 'member' })).status).toBe(400);
    expect((await request(app).put('/api/serving/members/participation').send({ ids: [ed.id] })).status).toBe(400);
    expect((await request(app).put('/api/serving/members/participation').send({ ids: [ed.id], membership: 'baptized' })).status).toBe(400);
    expect((await request(app).put('/api/serving/members/participation').send({ ids: [ed.id, 99999], membership: '' })).status).toBe(404);
    expect(db.prepare('SELECT membership FROM directory WHERE id = ?').get(ed.id).membership).toBe('member');
    expect((await request(buildApp(MEMBER)).put('/api/serving/members/participation').send({ ids: [ed.id], membership: '' })).status).toBe(403);
  });

  test('refuses a value it does not know, and anybody who does not keep the schedule', async () => {
    const al = addPerson('Al Baptized');
    expect((await request(buildApp(KEEPER)).put(`/api/serving/members/${al.id}/participation`).send({ membership: 'baptized' })).status).toBe(400);
    expect((await request(buildApp(KEEPER)).put(`/api/serving/members/${al.id}/participation`).send({ override: 'maybe' })).status).toBe(400);
    expect((await request(buildApp(MEMBER)).put(`/api/serving/members/${al.id}/participation`).send({ membership: 'member' })).status).toBe(403);
    expect((await request(buildApp(KEEPER)).put('/api/serving/members/99999/participation').send({ membership: 'member' })).status).toBe(404);
    expect(db.prepare('SELECT membership FROM directory WHERE id = ?').get(al.id).membership).toBe('');
  });
});

// ─── Kept with the roster ─────────────────────────────────────────────────────

describe('membership stays with the schedule keeper', () => {
  test('My Household does not show it', async () => {
    const al = addPerson('Al Baptized', { membership: 'member', override: 'yes' });
    const user = addUser('Al', 'approved', al.id);
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = user; next(); });
    app.use('/api/profile', profileRouter);
    const res = await request(app).get('/api/profile/me');
    expect(res.status).toBe(200);
    expect(res.body.person.name).toBe('Al Baptized');
    expect(res.body.person).not.toHaveProperty('membership');
    expect(res.body.person).not.toHaveProperty('worship_participant');
  });
});
