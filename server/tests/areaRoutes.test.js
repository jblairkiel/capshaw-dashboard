// The point of areas: holding one gets you the buttons on one page, and
// changes nothing anywhere else. These tests check that from the outside, one
// area at a time, and that every change lands in the action history.
jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const request = require('supertest');
const express = require('express');
const db      = require('../db');

const recordsRouter    = require('../routes/records');
const visitorsRouter   = require('../routes/visitors');
const leadershipRouter = require('../routes/leadership');

function buildApp(user = null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/records',    recordsRouter);
  app.use('/api/visitors',   visitorsRouter);
  app.use('/api/leadership', leadershipRouter);
  return app;
}

const ADMIN      = { id: 1, role: 'admin',    name: 'Ada' };
const MEMBER     = { id: 2, role: 'approved', name: 'Mel', areas: [] };
const ATTENDANCE = { id: 3, role: 'approved', name: 'Ann', areas: ['attendance'] };
const GUESTS     = { id: 4, role: 'approved', name: 'Gus', areas: ['visitors'] };
const LEADERS    = { id: 5, role: 'approved', name: 'Lee', areas: ['leadership'] };
const PENDING    = { id: 6, role: 'pending',  name: 'Pat', areas: ['attendance'] };

// The history points at the account that made each change, so the accounts the
// requests are made as have to actually exist.
function seedAccounts() {
  const insert = db.prepare(
    'INSERT INTO users (id, provider, provider_id, email, name, role) VALUES (?,?,?,?,?,?)'
  );
  // The grants go in the table as well as on the request user: anything that
  // reaches for the account rather than the request — the workflow engine
  // deciding who may action a task — reads them from there.
  const grant = db.prepare('INSERT OR IGNORE INTO user_areas (user_id, area) VALUES (?, ?)');
  for (const u of [ADMIN, MEMBER, ATTENDANCE, GUESTS, LEADERS, PENDING]) {
    insert.run(u.id, 'google', `${u.name}-id`, `${u.name.toLowerCase()}@example.com`, u.name, u.role);
    for (const area of (u.areas || [])) grant.run(u.id, area);
  }
}

beforeEach(() => {
  for (const table of ['action_log', 'attendance', 'visitor_visits', 'visitors',
                       'workflow_events', 'workflow_tasks', 'workflow_participants', 'workflow_instances',
                       'elder_duties', 'elders', 'deacon_duties', 'deacons', 'user_areas', 'users']) {
    db.prepare(`DELETE FROM ${table}`).run();
  }
  seedAccounts();
});

function history() {
  return db.prepare('SELECT * FROM action_log ORDER BY id DESC').all();
}

// ─── One area, one page ───────────────────────────────────────────────────────

describe('/api/records', () => {
  test('anybody signed in may read; nobody signed out may', async () => {
    expect((await request(buildApp(null)).get('/api/records/attendance')).status).toBe(401);

    const res = await request(buildApp(MEMBER)).get('/api/records/attendance');
    expect(res.status).toBe(200);
    expect(res.body.canWrite).toBe(false);
  });

  test('the attendance area may add, edit and delete an attendance record', async () => {
    const created = await request(buildApp(ATTENDANCE))
      .post('/api/records/attendance')
      .send({ date: '2026-06-07', service: 'Sun AM', count: 91 });
    expect(created.status).toBe(200);
    expect(created.body.row).toMatchObject({ service: 'Sun AM', count: 91 });

    const edited = await request(buildApp(ATTENDANCE))
      .patch(`/api/records/attendance/${created.body.row.id}`)
      .send({ count: 96 });
    expect(edited.status).toBe(200);
    expect(edited.body.row.count).toBe(96);

    const removed = await request(buildApp(ATTENDANCE))
      .delete(`/api/records/attendance/${created.body.row.id}`);
    expect(removed.status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) n FROM attendance').get().n).toBe(0);
  });

  test('that same person may not touch anybody else\'s records', async () => {
    const res = await request(buildApp(ATTENDANCE))
      .post('/api/records/elders')
      .send({ name: 'Not mine to add' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Elders & Deacons/);
    expect(db.prepare('SELECT COUNT(*) n FROM elders').get().n).toBe(0);
  });

  test('a member with no areas may read but not write', async () => {
    const res = await request(buildApp(MEMBER))
      .post('/api/records/attendance')
      .send({ date: '2026-06-07', service: 'Sun AM', count: 91 });
    expect(res.status).toBe(403);
  });

  test('an account still waiting to be approved may not write, whatever it was granted', async () => {
    const res = await request(buildApp(PENDING))
      .post('/api/records/attendance')
      .send({ date: '2026-06-07', service: 'Sun AM', count: 91 });
    expect(res.status).toBe(403);
  });

  test('an admin may write every table', async () => {
    const res = await request(buildApp(ADMIN))
      .post('/api/records/attendance')
      .send({ date: '2026-06-14', service: 'Sun PM', count: 44 });
    expect(res.status).toBe(200);
  });

  test('every change is recorded, with who made it', async () => {
    const created = await request(buildApp(ATTENDANCE))
      .post('/api/records/attendance')
      .send({ date: '2026-06-07', service: 'Sun AM', count: 91 });
    await request(buildApp(ATTENDANCE))
      .patch(`/api/records/attendance/${created.body.row.id}`)
      .send({ count: 96 });
    await request(buildApp(ATTENDANCE)).delete(`/api/records/attendance/${created.body.row.id}`);

    const entries = history();
    expect(entries.map(e => e.action)).toEqual(['delete', 'update', 'create']);
    expect(entries.every(e => e.user_id === ATTENDANCE.id && e.area === 'attendance')).toBe(true);

    const edit = entries.find(e => e.action === 'update');
    expect(JSON.parse(edit.details).changes.count).toEqual({ from: 91, to: 96 });
  });

  test('a refused change is not recorded', async () => {
    await request(buildApp(MEMBER))
      .post('/api/records/attendance')
      .send({ date: '2026-06-07', service: 'Sun AM', count: 91 });
    expect(history()).toHaveLength(0);
  });
});

// ─── Guests ───────────────────────────────────────────────────────────────────

describe('/api/visitors', () => {
  test('a guest carries their name and details, not just visit dates', async () => {
    const created = await request(buildApp(GUESTS))
      .post('/api/visitors')
      .send({
        name: 'Sam Rivers', phone: '256-555-0199', email: 'sam@example.com',
        city: 'Harvest', invited_by: 'The Carters', status: 'Visited twice',
        notes: 'Asked about the Wednesday class',
        visit: { date: '06/07/26', service: 'Sun AM' },
      });
    expect(created.status).toBe(200);
    expect(created.body.visitor).toMatchObject({
      name: 'Sam Rivers', phone: '256-555-0199', invited_by: 'The Carters',
    });
    expect(created.body.visitor.visits).toHaveLength(1);

    const listed = await request(buildApp(MEMBER)).get('/api/visitors');
    expect(listed.body.visitors[0].name).toBe('Sam Rivers');
    expect(listed.body.visitors[0].notes).toBe('Asked about the Wednesday class');
    expect(listed.body.canManage).toBe(false);
  });

  test('a guest carries every follow-up they have had, and who made contact', async () => {
    // The page answers "who has been followed up, and by whom", which means
    // the workflow's own record read back rather than a second copy of it.
    const created = await request(buildApp(GUESTS)).post('/api/visitors').send({ name: 'Sam Rivers' });
    const { id } = created.body.visitor;

    const instance = db.prepare(`
      INSERT INTO workflow_instances (definition_id, title, status, outcome, data, created_by, created_at, completed_at)
      VALUES ('visitor-follow-up', 'Follow up with Sam Rivers', 'completed', 'contacted', ?, ?, '2026-09-10 09:00:00', '2026-09-13 14:02:11')
    `).run(JSON.stringify({
      visitorId: String(id), visitorName: 'Sam Rivers', assigneeName: 'Ray Harris',
      contactedBy: 'Ray Harris', contactMethod: 'phone',
    }), ADMIN.id).lastInsertRowid;

    const task = db.prepare(`
      INSERT INTO workflow_tasks (instance_id, step_id, status, action, note, completed_at, completed_by)
      VALUES (?, 'reach-out', 'done', 'phoned', 'Lovely chat', '2026-09-13 14:02:11', ?)
    `);
    task.run(instance, GUESTS.id);

    const listed = await request(buildApp(MEMBER)).get('/api/visitors');
    const [guest] = listed.body.visitors;

    expect(guest.followUp.history).toHaveLength(1);
    expect(guest.followUp.history[0]).toMatchObject({
      status: 'completed', outcome: 'contacted',
      startedBy: ADMIN.name, assignedTo: 'Ray Harris', contactedBy: 'Ray Harris', method: 'phone',
    });
    expect(guest.followUp.history[0].rounds).toEqual([
      { action: 'phoned', by: GUESTS.name, at: '2026-09-13 14:02:11', note: 'Lovely chat' },
    ]);
    expect(guest.followUp.lastDone).toMatchObject({ outcome: 'contacted', by: 'Ray Harris', method: 'phone' });
  });

  test('a follow-up still open says who is being waited on', async () => {
    const created = await request(buildApp(GUESTS)).post('/api/visitors').send({ name: 'Sam Rivers' });
    const { id } = created.body.visitor;

    db.prepare(`
      INSERT INTO workflow_instances (definition_id, title, status, step_id, data, created_by, created_at)
      VALUES ('visitor-follow-up', 'Follow up', 'active', 'reach-out', ?, ?, '2026-09-15 10:00:00')
    `).run(JSON.stringify({ visitorId: String(id), assigneeName: 'Tom Nelson' }), ADMIN.id);

    const listed = await request(buildApp(MEMBER)).get('/api/visitors');
    expect(listed.body.visitors[0].followUp.active).toMatchObject({
      step: 'reach-out', assignedTo: 'Tom Nelson', since: '2026-09-15 10:00:00',
    });
  });

  test("one guest's follow-ups never land on another", async () => {
    const one = (await request(buildApp(GUESTS)).post('/api/visitors').send({ name: 'Aaa Guest' })).body.visitor;
    const two = (await request(buildApp(GUESTS)).post('/api/visitors').send({ name: 'Bbb Guest' })).body.visitor;

    db.prepare(`
      INSERT INTO workflow_instances (definition_id, title, status, step_id, data, created_by)
      VALUES ('visitor-follow-up', 'Follow up', 'active', 'reach-out', ?, ?)
    `).run(JSON.stringify({ visitorId: String(two.id), assigneeName: 'Tom Nelson' }), ADMIN.id);

    const listed = await request(buildApp(MEMBER)).get('/api/visitors');
    const byId = Object.fromEntries(listed.body.visitors.map(v => [v.id, v]));

    expect(byId[one.id].followUp.active).toBeNull();
    expect(byId[one.id].followUp.history).toEqual([]);
    expect(byId[two.id].followUp.active).not.toBeNull();
  });

  test('only the guest area may add, edit or remove one', async () => {
    const refused = await request(buildApp(MEMBER)).post('/api/visitors').send({ name: 'Nope' });
    expect(refused.status).toBe(403);

    const created = await request(buildApp(GUESTS)).post('/api/visitors').send({ name: 'Sam Rivers' });
    const { id } = created.body.visitor;

    expect((await request(buildApp(MEMBER)).patch(`/api/visitors/${id}`).send({ city: 'Athens' })).status).toBe(403);
    expect((await request(buildApp(MEMBER)).delete(`/api/visitors/${id}`)).status).toBe(403);

    const edited = await request(buildApp(GUESTS)).patch(`/api/visitors/${id}`).send({ city: 'Athens' });
    expect(edited.body.visitor.city).toBe('Athens');
  });

  test('a guest needs a name', async () => {
    const res = await request(buildApp(GUESTS)).post('/api/visitors').send({ city: 'Harvest' });
    expect(res.status).toBe(400);
  });

  test('visits can be added and removed, and go with the guest when they are deleted', async () => {
    const created = await request(buildApp(GUESTS)).post('/api/visitors').send({ name: 'Sam Rivers' });
    const { id } = created.body.visitor;

    const visited = await request(buildApp(GUESTS))
      .post(`/api/visitors/${id}/visits`)
      .send({ date: '06/14/26', service: 'Sun AM' });
    expect(visited.body.visitor.visits).toHaveLength(1);

    const visitId = visited.body.visitor.visits[0].id;
    const removed = await request(buildApp(GUESTS)).delete(`/api/visitors/${id}/visits/${visitId}`);
    expect(removed.body.visitor.visits).toHaveLength(0);

    await request(buildApp(GUESTS)).post(`/api/visitors/${id}/visits`).send({ date: '06/21/26' });
    await request(buildApp(GUESTS)).delete(`/api/visitors/${id}`);
    expect(db.prepare('SELECT COUNT(*) n FROM visitor_visits').get().n).toBe(0);
  });

  test('the history says what was done to which guest', async () => {
    await request(buildApp(GUESTS)).post('/api/visitors').send({ name: 'Sam Rivers' });
    expect(history()[0]).toMatchObject({ area: 'visitors', action: 'create', user_name: 'Gus' });
    expect(history()[0].summary).toMatch(/Sam Rivers/);
  });
});

// ─── Elders and deacons ───────────────────────────────────────────────────────

describe('/api/leadership', () => {
  test('lists elders and deacons with what each of them looks after', async () => {
    await request(buildApp(LEADERS))
      .post('/api/leadership/elders')
      .send({ name: 'Ray Harris', phone: '256-555-0110', duties: ['Shepherding group 1', 'Benevolence'] });
    await request(buildApp(LEADERS))
      .post('/api/leadership/deacons')
      .send({ name: 'Joe Carter', duties: ['Building'] });

    const res = await request(buildApp(MEMBER)).get('/api/leadership');
    expect(res.body.elders[0]).toMatchObject({ name: 'Ray Harris', phone: '256-555-0110' });
    expect(res.body.elders[0].duties).toEqual(['Shepherding group 1', 'Benevolence']);
    expect(res.body.deacons[0].duties).toEqual(['Building']);
    expect(res.body.canManage).toBe(false);
  });

  test('editing replaces the whole list of responsibilities', async () => {
    const created = await request(buildApp(LEADERS))
      .post('/api/leadership/elders')
      .send({ name: 'Ray Harris', duties: ['One', 'Two'] });

    const edited = await request(buildApp(LEADERS))
      .patch(`/api/leadership/elders/${created.body.person.id}`)
      .send({ duties: ['Only this now'] });
    expect(edited.body.person.duties).toEqual(['Only this now']);
    expect(db.prepare('SELECT COUNT(*) n FROM elder_duties').get().n).toBe(1);
  });

  test('only the leadership area may write', async () => {
    expect((await request(buildApp(MEMBER)).post('/api/leadership/elders').send({ name: 'Nope' })).status).toBe(403);
    expect((await request(buildApp(GUESTS)).post('/api/leadership/deacons').send({ name: 'Nope' })).status).toBe(403);
    expect(db.prepare('SELECT COUNT(*) n FROM elders').get().n).toBe(0);
  });

  test('404 for a group that is neither elders nor deacons', async () => {
    const res = await request(buildApp(LEADERS)).post('/api/leadership/apostles').send({ name: 'No' });
    expect(res.status).toBe(404);
  });

  test('removing somebody takes their responsibilities with them', async () => {
    const created = await request(buildApp(LEADERS))
      .post('/api/leadership/deacons')
      .send({ name: 'Joe Carter', duties: ['Building', 'Grounds'] });
    await request(buildApp(LEADERS)).delete(`/api/leadership/deacons/${created.body.person.id}`);
    expect(db.prepare('SELECT COUNT(*) n FROM deacon_duties').get().n).toBe(0);
  });
});

// ─── Nothing a caller sends reaches the SQL ───────────────────────────────────
//
// The record screens take a table name off the URL, which is exactly the shape
// CodeQL flags. The registry is what keeps it safe: the query is built from our
// own name for the table, matched against the request rather than taken from
// it, so an unknown one is a 404 and never a statement.

describe('table names are ours, not the caller\'s', () => {
  const { tableDef } = require('../lib/recordTables');

  test('a known table comes back with the registry\'s own name', () => {
    expect(tableDef('attendance').name).toBe('attendance');
    expect(tableDef('elders').name).toBe('elders');
  });

  test('anything else is refused outright', () => {
    expect(tableDef('users')).toBeNull();
    expect(tableDef('attendance; DROP TABLE users')).toBeNull();
    expect(tableDef('')).toBeNull();
    expect(tableDef(undefined)).toBeNull();
    // Inherited properties are not tables either.
    expect(tableDef('constructor')).toBeNull();
    expect(tableDef('toString')).toBeNull();
  });

  test('a table that is not in the registry never reaches the database', async () => {
    for (const path of ['/api/records/users', '/api/records/sqlite_master']) {
      expect((await request(buildApp(ADMIN)).get(path)).status).toBe(404);
      expect((await request(buildApp(ADMIN)).post(path).send({ name: 'x' })).status).toBe(404);
    }
    // The accounts table is still there, and still has everybody in it.
    expect(db.prepare('SELECT COUNT(*) n FROM users').get().n).toBeGreaterThan(0);
  });

  test('a sort column that is not the table\'s own is ignored rather than used', async () => {
    await request(buildApp(ATTENDANCE))
      .post('/api/records/attendance')
      .send({ date: '2026-06-07', service: 'Sun AM', count: 91 });

    const res = await request(buildApp(MEMBER))
      .get('/api/records/attendance?sort=count%20DESC%3B%20DROP%20TABLE%20users&dir=asc');
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(1);
    expect(db.prepare('SELECT COUNT(*) n FROM users').get().n).toBeGreaterThan(0);
  });
});

// ─── Guests, and the follow-up that closes when somebody reaches them ─────────

describe('a guest\'s follow-up', () => {
  const engine = require('../workflows/engine');

  function addGuest(fields = {}) {
    const row = { name: 'Sam Rivers', phone: '256-555-0199', email: 'sam@example.com', ...fields };
    const keys = Object.keys(row);
    const { lastInsertRowid: id } = db.prepare(
      `INSERT INTO visitors (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`
    ).run(...keys.map(k => row[k]));
    return db.prepare('SELECT * FROM visitors WHERE id = ?').get(id);
  }

  function addPerson(name) {
    const { lastInsertRowid: id } = db.prepare('INSERT INTO directory (name) VALUES (?)').run(name);
    return db.prepare('SELECT * FROM directory WHERE id = ?').get(id);
  }

  function startFollowUp(guest, assignee, user = GUESTS) {
    return engine.start({
      definitionId: 'visitor-follow-up',
      data: { visitorId: String(guest.id), assigneePersonId: String(assignee.id), notes: '' },
      user: db.prepare('SELECT * FROM users WHERE id = ?').get(user.id),
    });
  }

  function pendingTask(instanceId) {
    return db.prepare("SELECT * FROM workflow_tasks WHERE instance_id = ? AND status = 'pending'").get(instanceId);
  }

  beforeEach(() => {
    for (const t of ['workflow_participants', 'workflow_events', 'workflow_tasks', 'workflow_instances', 'directory']) {
      db.prepare(`DELETE FROM ${t}`).run();
    }
  });

  test('carries the guest\'s number and address, so whoever is asked can act on it', () => {
    const guest  = addGuest();
    const person = addPerson('Ray Harris');
    const { id } = startFollowUp(guest, person);

    const data = JSON.parse(db.prepare('SELECT data FROM workflow_instances WHERE id = ?').get(id).data);
    expect(data).toMatchObject({
      visitorName: 'Sam Rivers', visitorPhone: '256-555-0199', visitorEmail: 'sam@example.com',
    });
  });

  test('emailing them closes it, and is written onto the guest', () => {
    const guest  = addGuest();
    const person = addPerson('Ray Harris');
    const { id } = startFollowUp(guest, person);

    const actor = db.prepare('SELECT * FROM users WHERE id = ?').get(GUESTS.id);
    engine.act({ taskId: pendingTask(id).id, actionId: 'emailed', user: actor });

    const instance = db.prepare('SELECT * FROM workflow_instances WHERE id = ?').get(id);
    expect(instance.status).toBe('completed');
    expect(instance.outcome).toBe('contacted');

    const after = db.prepare('SELECT * FROM visitors WHERE id = ?').get(guest.id);
    expect(after.last_contact_method).toBe('email');
    expect(after.last_contacted_by).toBe('Gus');
    expect(after.last_contacted_at).toBeTruthy();
    expect(after.status).toBe('Contacted');
  });

  test('phoning them does the same, and says so', () => {
    const guest  = addGuest();
    const person = addPerson('Ray Harris');
    const { id } = startFollowUp(guest, person);

    const actor = db.prepare('SELECT * FROM users WHERE id = ?').get(GUESTS.id);
    engine.act({ taskId: pendingTask(id).id, actionId: 'phoned', user: actor });

    expect(db.prepare('SELECT last_contact_method FROM visitors WHERE id = ?').get(guest.id).last_contact_method)
      .toBe('phone');
    expect(db.prepare('SELECT outcome FROM workflow_instances WHERE id = ?').get(id).outcome).toBe('contacted');
  });

  test('a follow-up status somebody typed is left alone', () => {
    const guest  = addGuest({ status: 'Moving away in June' });
    const person = addPerson('Ray Harris');
    const { id } = startFollowUp(guest, person);

    const actor = db.prepare('SELECT * FROM users WHERE id = ?').get(GUESTS.id);
    engine.act({ taskId: pendingTask(id).id, actionId: 'phoned', user: actor });

    expect(db.prepare('SELECT status FROM visitors WHERE id = ?').get(guest.id).status).toBe('Moving away in June');
  });

  test('no answer leaves the guest untouched and the follow-up open', () => {
    const guest  = addGuest();
    const person = addPerson('Ray Harris');
    const { id } = startFollowUp(guest, person);

    const actor = db.prepare('SELECT * FROM users WHERE id = ?').get(GUESTS.id);
    engine.act({ taskId: pendingTask(id).id, actionId: 'no-answer', user: actor });

    expect(db.prepare('SELECT last_contacted_at FROM visitors WHERE id = ?').get(guest.id).last_contacted_at).toBe('');
    expect(db.prepare('SELECT status FROM workflow_instances WHERE id = ?').get(id).status).toBe('active');
  });

  test('the guest list says whether one is in flight, and how it ended', async () => {
    const guest  = addGuest();
    const person = addPerson('Ray Harris');
    const { id } = startFollowUp(guest, person);

    const during = await request(buildApp(MEMBER)).get('/api/visitors');
    expect(during.body.visitors[0].followUp.active).toMatchObject({ id, step: 'reach-out' });

    const actor = db.prepare('SELECT * FROM users WHERE id = ?').get(GUESTS.id);
    engine.act({ taskId: pendingTask(id).id, actionId: 'emailed', user: actor });

    const after = await request(buildApp(MEMBER)).get('/api/visitors');
    expect(after.body.visitors[0].followUp.active).toBeNull();
    expect(after.body.visitors[0].followUp.lastDone).toMatchObject({ id, outcome: 'contacted' });
    expect(after.body.visitors[0].last_contact_method).toBe('email');
  });

  test('a guest who has been removed cannot be followed up', () => {
    const guest  = addGuest();
    const person = addPerson('Ray Harris');
    db.prepare('DELETE FROM visitors WHERE id = ?').run(guest.id);

    expect(startFollowUp(guest, person)).toMatchObject({ status: 400 });
  });
});
