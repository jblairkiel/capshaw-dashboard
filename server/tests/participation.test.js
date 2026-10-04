// Worship participation: checking who actually served each job on the serving
// schedule, what the analysis makes of it (unchecked weeks included, and said
// to be), and that only the schedule keeper and admins can see any of it.
jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const request = require('supertest');
const express = require('express');
const db      = require('../db');
const participation = require('../lib/participation');
const router  = require('../routes/participation');

const ADMIN   = { id: 1, name: 'Office Admin', role: 'admin' };
const KEEPER  = { id: 2, name: 'Schedule Keeper', role: 'approved', areas: ['serving-schedule'] };
const MEMBER  = { id: 3, name: 'Member', role: 'approved', areas: ['member-attendance'] };
const TODAY   = '2026-09-30';

function buildApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/participation', router);
  return app;
}

const slot = (date, service, job, name) =>
  db.prepare('INSERT INTO job_assignments (month, date, service, job, name) VALUES (?, ?, ?, ?, ?)').run('September 2026', date, service, job, name);
const man = (name, gender = 'male') => db.prepare('INSERT INTO directory (name, gender) VALUES (?, ?)').run(name, gender).lastInsertRowid;

let al, ben, cal;

beforeAll(() => {
  const add = db.prepare("INSERT INTO users (id, provider, provider_id, email, name, role) VALUES (?, 'local', ?, ?, ?, ?)");
  for (const u of [ADMIN, KEEPER, MEMBER]) add.run(u.id, `u${u.id}`, `u${u.id}@example.invalid`, u.name, u.role);
});

beforeEach(() => {
  for (const t of ['worship_participation', 'job_assignments', 'worship_preferences', 'directory']) db.prepare(`DELETE FROM ${t}`).run();
  al = man('Al Adams'); ben = man('Ben Brown'); cal = man('Cal Cole');
  // Two Sundays that have happened, and one still to come.
  slot('September 20', 'Sunday Worship', 'Song Leader', 'Al Adams');
  slot('September 20', 'Sunday Worship', 'Opening Prayer', 'Ben Brown');
  slot('September 20', 'Sunday Worship', 'Communion', '');
  slot('September 27', 'Sunday Worship', 'Song Leader', 'Al Adams');
  slot('September 27', 'Sunday Worship', 'Opening Prayer', 'Ben Brown');
  slot('September 27', 'Sunday Worship', 'Communion', 'Cal Cole');
  slot('October 4', 'Sunday Worship', 'Song Leader', 'Ben Brown');
});

const check = (date, job, outcome, servedName) =>
  participation.record({ date, service: 'Sunday Worship', job, position: 0, outcome, servedName }, KEEPER, { today: TODAY });

describe('who may see it', () => {
  test('nobody without the Serving Schedule area', async () => {
    for (const path of ['/services', '/analysis', '/person?name=Al%20Adams']) {
      expect((await request(buildApp(MEMBER)).get(`/api/participation${path}`)).status).toBe(403);
    }
    expect((await request(buildApp(MEMBER)).put('/api/participation/check').send({})).status).toBe(403);
  });

  test('the schedule keeper and admins', async () => {
    for (const user of [KEEPER, ADMIN]) {
      expect((await request(buildApp(user)).get('/api/participation/services')).status).toBe(200);
    }
  });
});

describe('checking a service', () => {
  test('lists the services that have happened, newest first, with how many are checked', () => {
    check('2026-09-27', 'Song Leader', 'served');
    expect(participation.services({ today: TODAY })).toEqual([
      { date: '2026-09-27', service: 'Sunday Worship', slots: 3, checked: 1, unfilled: 0 },
      { date: '2026-09-20', service: 'Sunday Worship', slots: 3, checked: 0, unfilled: 1 },
    ]);
  });

  test('served, somebody else, nobody — and taken back off', () => {
    expect(check('2026-09-27', 'Song Leader', 'served').check).toEqual({ outcome: 'served', servedName: '' });
    expect(check('2026-09-27', 'Opening Prayer', 'substitute', ' Cal  Cole ').check).toEqual({ outcome: 'substitute', servedName: 'Cal Cole' });
    expect(check('2026-09-27', 'Communion', 'missed').check.outcome).toBe('missed');

    const { slots } = participation.service({ date: '2026-09-27', service: 'Sunday Worship' });
    expect(slots.map(s => [s.job, s.check.outcome, s.check.scheduledThen, s.check.by])).toEqual([
      ['Song Leader', 'served', 'Al Adams', 'Schedule Keeper'],
      ['Opening Prayer', 'substitute', 'Ben Brown', 'Schedule Keeper'],
      ['Communion', 'missed', 'Cal Cole', 'Schedule Keeper'],
    ]);

    check('2026-09-27', 'Communion', null);
    expect(participation.service({ date: '2026-09-27', service: 'Sunday Worship' }).slots[2].check).toBeNull();
  });

  test('refuses what cannot be true', () => {
    expect(check('2026-10-04', 'Song Leader', 'served').error).toMatch(/not happened yet/);
    expect(check('2026-09-27', 'Usher', 'served').error).toMatch(/not on the schedule/);
    expect(check('2026-09-27', 'Song Leader', 'substitute', '').error).toMatch(/who served/);
    expect(check('2026-09-27', 'Song Leader', 'substitute', 'al adams').error).toMatch(/mark it served/);
    expect(check('2026-09-20', 'Communion', 'served').error).toMatch(/Nobody was scheduled/);
    expect(check('2026-09-27', 'Song Leader', 'bogus').error).toMatch(/Served, somebody else, or nobody/);
  });

  test('a check survives the schedule being re-read from the church site', () => {
    check('2026-09-27', 'Opening Prayer', 'substitute', 'Cal Cole');
    db.prepare('DELETE FROM job_assignments').run();
    slot('September 27', 'Sunday Worship', 'Opening Prayer', 'Ben Brown');
    expect(participation.service({ date: '2026-09-27', service: 'Sunday Worship' }).slots[0].check.outcome).toBe('substitute');
  });

  test('"went as scheduled" marks every filled, unchecked slot served, and is logged', async () => {
    check('2026-09-20', 'Opening Prayer', 'missed');
    const res = await request(buildApp(KEEPER)).post('/api/participation/served').send({ date: '2026-09-20', service: 'Sunday Worship' });
    // Only the song leader: the prayer was already checked, and nobody was down for communion.
    expect(res.body.count).toBe(1);
    const { slots } = participation.service({ date: '2026-09-20', service: 'Sunday Worship' });
    expect(slots.map(s => s.check?.outcome ?? null)).toEqual(['served', 'missed', null]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM action_log WHERE entity = 'worship participation'").get().n).toBe(1);
  });
});

describe('analysis', () => {
  beforeEach(() => {
    check('2026-09-27', 'Song Leader', 'served');
    check('2026-09-27', 'Opening Prayer', 'substitute', 'Cal Cole');
    check('2026-09-27', 'Communion', 'missed');
  });

  test('counts checked weeks and unchecked ones (as scheduled), and says which is which', () => {
    const a = participation.analysis({ weeks: 4, today: TODAY });
    expect(a.summary).toMatchObject({
      services: 2, checkedServices: 1, slots: 6,
      served: 4, confirmed: 2, assumed: 2, substitutes: 1, missed: 1, unfilled: 1, people: 3,
    });
    const by = Object.fromEntries(a.people.map(p => [p.name, p]));
    expect(by['Al Adams']).toMatchObject({ served: 2, confirmed: 1, assumed: 1, byRole: { 'Song Leader': 2 }, lastServed: '2026-09-27', personId: al });
    expect(by['Ben Brown']).toMatchObject({ served: 1, scheduled: 2, replaced: 1, missed: 0 });
    expect(by['Cal Cole']).toMatchObject({ served: 1, steppedIn: 1, missed: 1, byRole: { 'Opening Prayer': 1 } });
  });

  test('checked services only', () => {
    const a = participation.analysis({ weeks: 4, checkedOnly: true, today: TODAY });
    expect(a.summary).toMatchObject({ services: 1, served: 2, assumed: 0 });
  });

  test('one job only, and how concentrated it is', () => {
    const a = participation.analysis({ weeks: 4, role: 'Song Leader', today: TODAY });
    expect(a.people.map(p => p.name)).toEqual(['Al Adams']);
    expect(a.byRole).toEqual([{ role: 'Song Leader', slots: 2, served: 2, people: 1, topShare: 100 }]);
  });

  test('names the men who said they would and have not been used', () => {
    db.prepare("INSERT INTO worship_preferences (directory_id, role, level) VALUES (?, 'Song Leader', 'willing'), (?, 'Communion', 'preferred'), (?, 'Song Leader', 'unavailable')").run(ben, cal, cal);
    const a = participation.analysis({ weeks: 4, today: TODAY });
    expect(a.unused).toEqual([
      { personId: ben, name: 'Ben Brown', roles: [{ role: 'Song Leader', level: 'willing' }], servedAtAll: 1 },
      { personId: cal, name: 'Cal Cole', roles: [{ role: 'Communion', level: 'preferred' }], servedAtAll: 1 },
    ]);
  });

  test("one man's record", () => {
    const p = participation.person({ personId: ben }, { weeks: 4, today: TODAY });
    expect(p.person).toMatchObject({ name: 'Ben Brown', served: 1, replaced: 1 });
    // The window ends today: the Sunday still to come is not in it.
    expect(p.history.map(h => [h.date, h.job, h.kind, h.other])).toEqual([
      ['2026-09-27', 'Opening Prayer', 'replaced', 'Cal Cole'],
      ['2026-09-20', 'Opening Prayer', 'assumed', ''],
    ]);
    expect(participation.person({ name: 'Cal Cole' }, { weeks: 4, today: TODAY }).history.map(h => h.kind))
      .toEqual(['stepped-in', 'missed']);
  });

  test('over the API', async () => {
    const res = await request(buildApp(KEEPER)).get(`/api/participation/person?personId=${ben}&weeks=4`);
    expect(res.status).toBe(200);
    expect(res.body.person.name).toBe('Ben Brown');
    expect((await request(buildApp(KEEPER)).get('/api/participation/person?personId=9999')).status).toBe(404);
  });
});
