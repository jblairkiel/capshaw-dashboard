// Worship participation: the serving schedule, as it was last left, read as
// who served; what each man has said he will do; and that only the schedule
// keeper and admins can see any of it.
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

const slot = (date, service, job, name, month = 'September 2026') =>
  db.prepare('INSERT INTO job_assignments (month, date, service, job, name) VALUES (?, ?, ?, ?, ?)').run(month, date, service, job, name);
const man = (name, gender = 'male') => db.prepare('INSERT INTO directory (name, gender) VALUES (?, ?)').run(name, gender).lastInsertRowid;
const prefer = (personId, role, level) =>
  db.prepare('INSERT INTO worship_preferences (directory_id, role, level) VALUES (?, ?, ?)').run(personId, role, level);

let al, ben, cal, dee;

beforeAll(() => {
  const add = db.prepare("INSERT INTO users (id, provider, provider_id, email, name, role) VALUES (?, 'local', ?, ?, ?, ?)");
  for (const u of [ADMIN, KEEPER, MEMBER]) add.run(u.id, `u${u.id}`, `u${u.id}@example.invalid`, u.name, u.role);
});

beforeEach(() => {
  for (const t of ['job_assignments', 'worship_preferences', 'worship_profile', 'directory']) db.prepare(`DELETE FROM ${t}`).run();
  al = man('Al Adams'); ben = man('Ben Brown'); cal = man('Cal Cole'); dee = man('Dee Dunn', 'female');
  // Two Sundays that have happened, and one still to come.
  slot('September 20', 'Sunday Worship', 'Song Leader', 'Al Adams');
  slot('September 20', 'Sunday Worship', 'Opening Prayer', 'Ben Brown');
  slot('September 20', 'Sunday Worship', 'Communion', '');
  slot('September 27', 'Sunday Worship', 'Song Leader', 'Al Adams');
  slot('September 27', 'Sunday Worship', 'Opening Prayer', 'Cal Cole');
  slot('September 27', 'Sunday Worship', 'Communion', 'Cal Cole');
  slot('October 4', 'Sunday Worship', 'Song Leader', 'Ben Brown', 'October 2026');
});

describe('who may see it', () => {
  test('nobody without the Serving Schedule area', async () => {
    for (const path of ['/analysis', '/person?name=Al%20Adams', '/preferences']) {
      expect((await request(buildApp(MEMBER)).get(`/api/participation${path}`)).status).toBe(403);
    }
  });

  test('the schedule keeper and admins', async () => {
    for (const user of [KEEPER, ADMIN]) {
      for (const path of ['/analysis', '/preferences']) {
        expect((await request(buildApp(user)).get(`/api/participation${path}`)).status).toBe(200);
      }
    }
  });

  test('nothing here changes anything: there is no way to write', async () => {
    expect((await request(buildApp(KEEPER)).put('/api/participation/check').send({})).status).toBe(404);
  });
});

describe('analysis: the schedule as last left is what happened', () => {
  test('each filled past slot counts as served; an empty one as unfilled; the future not yet', () => {
    const a = participation.analysis({ weeks: 4, today: TODAY });
    expect(a.summary).toEqual({ services: 2, slots: 6, served: 5, unfilled: 1, people: 3 });
    const by = Object.fromEntries(a.people.map(p => [p.name, p]));
    expect(by['Al Adams']).toMatchObject({ served: 2, byRole: { 'Song Leader': 2 }, lastServed: '2026-09-27', personId: al, nextScheduled: null });
    expect(by['Ben Brown']).toMatchObject({ served: 1, lastServed: '2026-09-20', nextScheduled: '2026-10-04' });
    expect(by['Cal Cole']).toMatchObject({ served: 2, byRole: { 'Opening Prayer': 1, Communion: 1 } });
  });

  test('a change to the schedule is a change to the record', () => {
    db.prepare("UPDATE job_assignments SET name = 'Ben Brown' WHERE date = 'September 27' AND job = 'Song Leader'").run();
    const by = Object.fromEntries(participation.analysis({ weeks: 4, today: TODAY }).people.map(p => [p.name, p.served]));
    expect(by).toMatchObject({ 'Al Adams': 1, 'Ben Brown': 2 });
  });

  test('one job only, and how concentrated it is', () => {
    const a = participation.analysis({ weeks: 4, role: 'Song Leader', today: TODAY });
    expect(a.people.map(p => p.name)).toEqual(['Al Adams']);
    expect(a.byRole).toEqual([{ role: 'Song Leader', slots: 2, served: 2, people: 1, topShare: 100 }]);
  });

  test('a shorter window', () => {
    expect(participation.analysis({ weeks: 1, today: TODAY }).summary.services).toBe(1);
  });

  test('names the men who said they would and have not been used', () => {
    prefer(ben, 'Song Leader', 'willing');
    prefer(cal, 'Scripture Reading', 'preferred');
    prefer(cal, 'Song Leader', 'unavailable');
    expect(participation.analysis({ weeks: 4, today: TODAY }).unused).toEqual([
      { personId: ben, name: 'Ben Brown', roles: [{ role: 'Song Leader', level: 'willing' }], servedAtAll: 1 },
      { personId: cal, name: 'Cal Cole', roles: [{ role: 'Scripture Reading', level: 'preferred' }], servedAtAll: 2 },
    ]);
  });

  test("one man's record, what he said, and what is coming up", () => {
    prefer(ben, 'Opening Prayer', 'preferred');
    const p = participation.person({ personId: ben }, { weeks: 4, today: TODAY });
    expect(p.person).toMatchObject({ name: 'Ben Brown', served: 1, nextScheduled: '2026-10-04' });
    expect(p.preferences).toEqual({ 'Opening Prayer': 'preferred' });
    expect(p.history).toEqual([
      { date: '2026-10-04', service: 'Sunday Worship', job: 'Song Leader', upcoming: true },
      { date: '2026-09-20', service: 'Sunday Worship', job: 'Opening Prayer', upcoming: false },
    ]);
  });

  test('a man who has not served yet still has a record', () => {
    const d = man('Ed Evans');
    expect(participation.person({ personId: d }, { weeks: 4, today: TODAY }).person).toMatchObject({ name: 'Ed Evans', served: 0 });
  });

  test('over the API', async () => {
    const res = await request(buildApp(KEEPER)).get(`/api/participation/person?personId=${al}&weeks=4`);
    expect(res.body.person.name).toBe('Al Adams');
    expect((await request(buildApp(KEEPER)).get('/api/participation/person?personId=9999')).status).toBe(404);
  });
});

describe('what each man has said', () => {
  beforeEach(() => {
    prefer(al, 'Song Leader', 'preferred');
    prefer(al, 'Communion', 'unavailable');
    prefer(ben, 'Song Leader', 'willing');
    prefer(dee, 'Song Leader', 'preferred'); // not a man: not on this list
    db.prepare("INSERT INTO worship_profile (directory_id, notes) VALUES (?, 'Mornings only')").run(al);
  });

  test('every man, his answers, his notes, and what he has served beside them', () => {
    const p = participation.preferences({ weeks: 4, today: TODAY });
    expect(p.men.map(m => m.name)).toEqual(['Al Adams', 'Ben Brown', 'Cal Cole']);
    expect(p.men[0]).toMatchObject({
      personId: al, said: 2, notes: 'Mornings only',
      preferences: { 'Song Leader': 'preferred', Communion: 'unavailable' },
      served: { 'Song Leader': 2 }, servedTotal: 2,
    });
    expect(p.men[0].updatedAt).toEqual(expect.any(String));
    expect(p.men[2]).toMatchObject({ said: 0, updatedAt: null, servedTotal: 2 });
  });

  test('how each job is covered, and who has said nothing', () => {
    const p = participation.preferences({ weeks: 4, today: TODAY });
    expect(p.coverage.find(c => c.role === 'Song Leader')).toEqual({ role: 'Song Leader', glad: 1, willing: 1, unavailable: 0, unsaid: 1 });
    expect(p.coverage.find(c => c.role === 'Communion')).toEqual({ role: 'Communion', glad: 0, willing: 0, unavailable: 1, unsaid: 2 });
    expect(p.summary).toEqual({ men: 3, said: 2, unsaid: 1 });
  });
});
