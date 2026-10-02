// Member Attendance: taking the roll one tap at a time, the status list the
// tracker keeps, the analytics, and that none of it reaches anybody without
// the area.
jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const request = require('supertest');
const express = require('express');
const db      = require('../db');
const attendance = require('../lib/memberAttendance');
const router  = require('../routes/memberAttendance');

const ADMIN   = { id: 1, name: 'Office Admin', role: 'admin' };
const TRACKER = { id: 2, name: 'Roll Keeper', role: 'approved', areas: ['member-attendance'] };
const MEMBER  = { id: 3, name: 'Member', role: 'approved', areas: ['attendance'] };

const TODAY = '2026-09-30';

function buildApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/member-attendance', router);
  return app;
}

const status = label => db.prepare('SELECT id FROM attendance_statuses WHERE label = ?').get(label).id;
const addPerson = name => db.prepare('INSERT INTO directory (name) VALUES (?)').run(name).lastInsertRowid;

let ada, bob, cy;

beforeAll(() => {
  const add = db.prepare("INSERT INTO users (id, provider, provider_id, email, name, role) VALUES (?, 'local', ?, ?, ?, ?)");
  for (const u of [ADMIN, TRACKER, MEMBER]) add.run(u.id, `u${u.id}`, `u${u.id}@example.invalid`, u.name, u.role);
});

beforeEach(() => {
  db.prepare('DELETE FROM member_attendance').run();
  db.prepare('DELETE FROM directory').run();
  db.prepare("DELETE FROM attendance_statuses WHERE label NOT IN ('Present', 'Sick', 'Out of town', 'Absent')").run();
  db.prepare('UPDATE attendance_statuses SET active = 1').run();
  cy  = addPerson('Cy Zimmer');
  ada = addPerson('Ada Archer');
  bob = addPerson('Bob Baker');
  addPerson('  ');
});

describe('who may see it', () => {
  test('nobody without the area — not even somebody who keeps the head counts', async () => {
    const res = await request(buildApp(MEMBER)).get('/api/member-attendance/roll');
    expect(res.status).toBe(403);
    expect((await request(buildApp(MEMBER)).get('/api/member-attendance/analytics')).status).toBe(403);
  });

  test('the tracker and admins', async () => {
    for (const user of [TRACKER, ADMIN]) {
      expect((await request(buildApp(user)).get('/api/member-attendance/roll')).status).toBe(200);
    }
  });
});

describe('the roll', () => {
  test('starts with four statuses, Present the only one that counts as there', () => {
    expect(attendance.statuses().map(s => [s.label, s.counts_present])).toEqual([
      ['Present', 1], ['Sick', 0], ['Out of town', 0], ['Absent', 0],
    ]);
  });

  test('is everybody named in the directory, by surname, filed under a letter', async () => {
    const res = await request(buildApp(TRACKER)).get('/api/member-attendance/roll?date=2026-09-27&service=Sunday AM Worship');
    expect(res.body.people.map(p => [p.name, p.letter])).toEqual([
      ['Ada Archer', 'A'], ['Bob Baker', 'B'], ['Cy Zimmer', 'Z'],
    ]);
    expect(res.body.marks).toEqual({});
    expect(res.body.services.map(s => s.name)).toContain('Sunday AM Worship');
  });

  test('a tap is saved, changed, and taken back off', async () => {
    const app = buildApp(TRACKER);
    const at = { date: '2026-09-27', service: 'sunday am worship', personId: ada };

    await request(app).put('/api/member-attendance/roll/mark').send({ ...at, statusId: status('Present') }).expect(200);
    await request(app).put('/api/member-attendance/roll/mark').send({ ...at, statusId: status('Sick') }).expect(200);
    let roll = attendance.roll({ date: '2026-09-27', service: 'Sunday AM Worship' });
    expect(roll.service).toBe('Sunday AM Worship');
    expect(roll.marks[ada]).toMatchObject({ statusId: status('Sick'), by: 'Roll Keeper' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM member_attendance').get().n).toBe(1);

    await request(app).put('/api/member-attendance/roll/mark').send({ ...at, statusId: null }).expect(200);
    roll = attendance.roll({ date: '2026-09-27', service: 'Sunday AM Worship' });
    expect(roll.marks).toEqual({});
  });

  test('refuses a bad date, an unknown service, person or status, and a retired status', async () => {
    const app = buildApp(TRACKER);
    const ok = { date: '2026-09-27', service: 'Sunday AM Worship', personId: ada, statusId: status('Present') };
    for (const bad of [{ date: '2026-02-30' }, { service: 'Nope' }, { personId: 9999 }, { statusId: 9999 }]) {
      expect((await request(app).put('/api/member-attendance/roll/mark').send({ ...ok, ...bad })).status).toBe(400);
    }
    attendance.updateStatus(status('Sick'), { active: false });
    const res = await request(app).put('/api/member-attendance/roll/mark').send({ ...ok, statusId: status('Sick') });
    expect(res.body.error).toMatch(/retired/);
  });

  test('everyone left can be marked at once, without touching those already marked', async () => {
    const app = buildApp(TRACKER);
    attendance.mark({ date: '2026-09-27', service: 'Sunday AM Worship', personId: ada, statusId: status('Present') }, TRACKER);
    const res = await request(app).post('/api/member-attendance/roll/mark-rest')
      .send({ date: '2026-09-27', service: 'Sunday AM Worship', statusId: status('Absent') });
    expect(res.body.count).toBe(2);
    const { marks } = attendance.roll({ date: '2026-09-27', service: 'Sunday AM Worship' });
    expect(marks[ada].statusId).toBe(status('Present'));
    expect(marks[bob].statusId).toBe(status('Absent'));
    expect(marks[cy].statusId).toBe(status('Absent'));
    expect(db.prepare("SELECT COUNT(*) AS n FROM action_log WHERE entity = 'attendance roll'").get().n).toBe(1);
  });

  test('a photo that is not on file is a 404', async () => {
    expect((await request(buildApp(TRACKER)).get(`/api/member-attendance/photo/${ada}`)).status).toBe(404);
  });
});

describe('the status list', () => {
  test('the tracker adds, renames, recolours and reorders one', async () => {
    const app = buildApp(TRACKER);
    const made = await request(app).post('/api/member-attendance/statuses').send({ label: '  Homebound ' }).expect(201);
    expect(made.body.status).toMatchObject({ label: 'Homebound', counts_present: 0, active: 1 });
    expect(attendance.TONES).toContain(made.body.status.tone);

    const id = made.body.status.id;
    const res = await request(app).patch(`/api/member-attendance/statuses/${id}`).send({ label: 'Shut-in', tone: 'violet', countsPresent: true, sortOrder: 0 });
    expect(res.body.status).toMatchObject({ label: 'Shut-in', tone: 'violet', counts_present: 1, sort_order: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM action_log WHERE entity = 'attendance status'").get().n).toBeGreaterThanOrEqual(2);
  });

  test('refuses a duplicate name, a blank one and a colour that is not on the palette', async () => {
    const app = buildApp(TRACKER);
    expect((await request(app).post('/api/member-attendance/statuses').send({ label: 'present' })).status).toBe(400);
    expect((await request(app).post('/api/member-attendance/statuses').send({ label: '  ' })).status).toBe(400);
    expect((await request(app).patch(`/api/member-attendance/statuses/${status('Sick')}`).send({ tone: 'puce' })).status).toBe(400);
  });

  test('a used status is retired, not removed; an unused one can go', async () => {
    const app = buildApp(TRACKER);
    attendance.mark({ date: '2026-09-27', service: 'Sunday AM Worship', personId: ada, statusId: status('Sick') }, TRACKER);
    const refused = await request(app).delete(`/api/member-attendance/statuses/${status('Sick')}`);
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/Retire it/);

    const { status: extra } = attendance.addStatus({ label: 'Visiting' });
    await request(app).delete(`/api/member-attendance/statuses/${extra.id}`).expect(200);
    expect(attendance.statuses().some(s => s.label === 'Visiting')).toBe(false);
  });

  test('the roll always keeps at least one status', () => {
    for (const label of ['Sick', 'Out of town', 'Absent']) attendance.updateStatus(status(label), { active: false });
    expect(attendance.updateStatus(status('Present'), { active: false }).error).toMatch(/at least one/);
  });

  test('nobody without the area can change it', async () => {
    expect((await request(buildApp(MEMBER)).post('/api/member-attendance/statuses').send({ label: 'Nope' })).status).toBe(403);
  });
});

describe('analytics', () => {
  const mark = (personId, date, label, service = 'Sunday AM Worship') =>
    attendance.mark({ date, service, personId, statusId: status(label) }, TRACKER);

  beforeEach(() => {
    mark(ada, '2026-09-13', 'Present'); mark(bob, '2026-09-13', 'Present'); mark(cy, '2026-09-13', 'Present');
    mark(ada, '2026-09-20', 'Present'); mark(bob, '2026-09-20', 'Sick');    mark(cy, '2026-09-20', 'Absent');
    mark(ada, '2026-09-27', 'Present'); mark(bob, '2026-09-27', 'Out of town');
    mark(ada, '2026-09-23', 'Present', 'Wednesday Bible Study');
    // Marked ahead of a trip: not counted until the day comes.
    mark(bob, '2026-10-04', 'Out of town');
  });

  test('the whole congregation: each roll, the totals and the rate', () => {
    const a = attendance.groupAnalytics({ weeks: 4, today: TODAY });
    expect(a.rolls.map(r => [r.date, r.service, r.present, r.marked])).toEqual([
      ['2026-09-13', 'Sunday AM Worship', 3, 3],
      ['2026-09-20', 'Sunday AM Worship', 1, 3],
      ['2026-09-23', 'Wednesday Bible Study', 1, 1],
      ['2026-09-27', 'Sunday AM Worship', 1, 2],
    ]);
    expect(a.summary).toMatchObject({ rolls: 4, marked: 9, present: 6, rate: 66.7, averagePresent: 1.5, people: 3 });
    expect(a.totals[status('Out of town')]).toBe(1);
  });

  test('says who has missed their most recent services', () => {
    const a = attendance.groupAnalytics({ weeks: 4, today: TODAY });
    const by = Object.fromEntries(a.members.map(m => [m.name, m]));
    expect(by['Bob Baker']).toMatchObject({ present: 1, marked: 3, missedInARow: 2, lastPresent: '2026-09-13' });
    expect(by['Ada Archer']).toMatchObject({ rate: 100, missedInARow: 0 });
  });

  test('one service only, and a shorter window', () => {
    expect(attendance.groupAnalytics({ weeks: 4, service: 'wednesday bible study', today: TODAY }).summary.rolls).toBe(1);
    expect(attendance.groupAnalytics({ weeks: 1, today: TODAY }).rolls.map(r => r.date)).toEqual(['2026-09-27']);
  });

  test('one member', () => {
    const p = attendance.personAnalytics(cy, { weeks: 4, today: TODAY });
    expect(p.person.name).toBe('Cy Zimmer');
    expect(p.summary).toMatchObject({ marked: 2, present: 1, rate: 50, notMarked: 2, missedInARow: 1, lastPresent: '2026-09-13' });
    expect(p.history.map(h => h.date)).toEqual(['2026-09-20', '2026-09-13']);
    expect(p.byService).toEqual([{ service: 'Sunday AM Worship', marked: 2, present: 1, rate: 50 }]);
  });

  test('over the API', async () => {
    const app = buildApp(TRACKER);
    const group = await request(app).get('/api/member-attendance/analytics?weeks=4');
    expect(group.status).toBe(200);
    expect(group.body.statuses.length).toBe(4);
    const person = await request(app).get(`/api/member-attendance/analytics/person/${ada}?weeks=4`);
    expect(person.body.person.name).toBe('Ada Archer');
    expect((await request(app).get('/api/member-attendance/analytics/person/9999')).status).toBe(404);
  });
});
