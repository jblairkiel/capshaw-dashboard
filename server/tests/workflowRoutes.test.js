jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const request = require('supertest');
const express = require('express');
const db      = require('../db');
const router  = require('../routes/workflows');

function buildApp(user = null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/workflows', router);
  return app;
}

let ADMIN, MEMBER, OTHER, PENDING, RAY, ORPHAN, VISITOR;

function addUser(name, role, directoryId = null) {
  const { lastInsertRowid: id } = db.prepare(
    'INSERT INTO users (provider, provider_id, email, name, role, directory_id) VALUES (?,?,?,?,?,?)'
  ).run('google', `${name}-id`, `${name}@example.com`, name, role, directoryId);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

// The stock request these tests walk through. It is aimed at somebody in the
// directory with no login of their own, so the first task falls to the admin
// queue rather than to one named person.
function followUpData() {
  return { visitorId: String(VISITOR.id), assigneePersonId: String(ORPHAN.id), notes: 'Sat at the back' };
}

async function startFollowUp(user = MEMBER) {
  const res = await request(buildApp(user))
    .post('/api/workflows')
    .send({ definitionId: 'visitor-follow-up', data: followUpData() });
  return res.body.id;
}

beforeEach(() => {
  for (const t of ['workflow_participants', 'workflow_events', 'workflow_tasks', 'workflow_instances',
                   'visitors', 'users', 'directory']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }

  const { lastInsertRowid: rayId } = db.prepare('INSERT INTO directory (name) VALUES (?)').run('Ray Harris');
  RAY = db.prepare('SELECT * FROM directory WHERE id = ?').get(rayId);

  const { lastInsertRowid: orphanId } = db.prepare('INSERT INTO directory (name) VALUES (?)').run('Unlinked Person');
  ORPHAN = db.prepare('SELECT * FROM directory WHERE id = ?').get(orphanId);

  const { lastInsertRowid: visitorId } = db.prepare('INSERT INTO visitors (name) VALUES (?)').run('Sam Visitor');
  VISITOR = db.prepare('SELECT * FROM visitors WHERE id = ?').get(visitorId);

  ADMIN   = addUser('Ada', 'admin');
  MEMBER  = addUser('Ray', 'approved', RAY.id);
  OTHER   = addUser('Jo',  'approved');
  PENDING = addUser('Pat', 'pending');
});

// ─── Auth ─────────────────────────────────────────────────────────────────────

describe('authentication', () => {
  test('every workflow route needs a signed-in user', async () => {
    const app = buildApp(null);
    for (const [method, path] of [['get', '/api/workflows'], ['get', '/api/workflows/inbox'],
                                  ['get', '/api/workflows/definitions'], ['post', '/api/workflows']]) {
      const res = await request(app)[method](path);
      expect(res.status).toBe(401);
    }
  });
});

// ─── Definitions ──────────────────────────────────────────────────────────────

describe('GET /api/workflows/definitions', () => {
  test('lists what a member may start, each with a chart', async () => {
    const res = await request(buildApp(MEMBER)).get('/api/workflows/definitions');
    expect(res.status).toBe(200);
    expect(res.body.definitions.map(d => d.id).sort())
      .toEqual(['visitor-follow-up']);

    const followUp = res.body.definitions.find(d => d.id === 'visitor-follow-up');
    expect(followUp.chart.nodes.length).toBeGreaterThan(0);
    expect(followUp.chart.edges.length).toBeGreaterThan(0);
  });

  // startRole on Monthly Worship Schedule is an area ('serving-schedule'), not
  // a role rung — this definitions list has to check it the same way engine.js
  // does (holds(), not hasRole()) or an area-gated workflow never appears for
  // anybody, admins included, since an area id is never a rung on the ladder.
  test('an admin sees a workflow gated by an area, not just one gated by a role', async () => {
    const res = await request(buildApp(ADMIN)).get('/api/workflows/definitions');
    expect(res.body.definitions.map(d => d.id).sort())
      .toEqual(['visitor-follow-up', 'worship-schedule']);
  });

  test('a member who does not hold the area does not see that workflow', async () => {
    const res = await request(buildApp(MEMBER)).get('/api/workflows/definitions');
    expect(res.body.definitions.map(d => d.id)).not.toContain('worship-schedule');
  });

  test('resolves dynamic options for a workflow field against live data', async () => {
    const res = await request(buildApp(MEMBER)).get('/api/workflows/definitions');
    const followUp = res.body.definitions.find(d => d.id === 'visitor-follow-up');
    const guest = followUp.fields.find(f => f.key === 'visitorId');

    expect(guest.options).toEqual([{ value: String(VISITOR.id), label: 'Sam Visitor' }]);
  });
});

// ─── Starting ─────────────────────────────────────────────────────────────────

describe('POST /api/workflows', () => {
  test('a member can start one', async () => {
    const res = await request(buildApp(MEMBER))
      .post('/api/workflows')
      .send({ definitionId: 'visitor-follow-up', data: followUpData() });
    expect(res.status).toBe(200);
    expect(res.body.id).toEqual(expect.any(Number));
  });

  test('a pending user is refused', async () => {
    const res = await request(buildApp(PENDING))
      .post('/api/workflows')
      .send({ definitionId: 'visitor-follow-up', data: followUpData() });
    expect(res.status).toBe(403);
  });

  test('a workflow a member may not start is refused as well', async () => {
    const res = await request(buildApp(MEMBER))
      .post('/api/workflows')
      .send({ definitionId: 'worship-schedule', data: { month: 'June 2026', services: 'Sunday Worship' } });
    expect(res.status).toBe(403);
  });

  test('a bad payload is a 400, not a crash', async () => {
    const res = await request(buildApp(MEMBER)).post('/api/workflows').send({ definitionId: 'visitor-follow-up' });
    expect(res.status).toBe(400);
  });
});

// ─── Listing ──────────────────────────────────────────────────────────────────

describe('GET /api/workflows', () => {
  test('mine shows what I am involved in, not what I am not', async () => {
    const mine = await startFollowUp(MEMBER);
    await startFollowUp(OTHER);

    const res = await request(buildApp(MEMBER)).get('/api/workflows');
    expect(res.body.instances.map(i => i.id)).toEqual([mine]);
  });

  test('scope=all is refused for a member', async () => {
    await startFollowUp(MEMBER);
    const res = await request(buildApp(OTHER)).get('/api/workflows?scope=all');
    expect(res.status).toBe(403);
  });

  test('scope=all shows an admin everything', async () => {
    const a = await startFollowUp(MEMBER);
    const b = await startFollowUp(OTHER);
    const res = await request(buildApp(ADMIN)).get('/api/workflows?scope=all');
    expect(res.body.instances.map(i => i.id).sort()).toEqual([a, b].sort());
  });

  test('completed workflows are filtered out by default and found with status=completed', async () => {
    const id = await startFollowUp(MEMBER);
    const detail = await request(buildApp(ADMIN)).get(`/api/workflows/${id}`);
    // Reaching the guest is the end of it — there is no step afterwards asking
    // whether the contact happened.
    await request(buildApp(ADMIN))
      .post(`/api/workflows/tasks/${detail.body.myTask.id}`)
      .send({ action: 'emailed' });

    const active = await request(buildApp(MEMBER)).get('/api/workflows');
    expect(active.body.instances.map(i => i.id)).not.toContain(id);

    const done = await request(buildApp(MEMBER)).get('/api/workflows?status=completed');
    expect(done.body.instances.map(i => i.id)).toContain(id);
  });
});

// ─── Detail ───────────────────────────────────────────────────────────────────

describe('GET /api/workflows/:id', () => {
  test('a participant sees the instance, its chart and its history', async () => {
    const id = await startFollowUp(MEMBER);
    const res = await request(buildApp(MEMBER)).get(`/api/workflows/${id}`);

    expect(res.status).toBe(200);
    expect(res.body.instance.title).toBe('Follow up with Sam Visitor');
    expect(res.body.definition.nodes.length).toBeGreaterThan(0);
    expect(res.body.events.map(e => e.action)).toEqual(['started']);
    expect(res.body.instance.fields.find(f => f.key === 'notes').value).toBe('Sat at the back');
  });

  test('an uninvolved member gets a 403', async () => {
    const id = await startFollowUp(MEMBER);
    const res = await request(buildApp(OTHER)).get(`/api/workflows/${id}`);
    expect(res.status).toBe(403);
  });

  test('a missing workflow is a 404, a bad id a 400', async () => {
    expect((await request(buildApp(ADMIN)).get('/api/workflows/9999')).status).toBe(404);
    expect((await request(buildApp(ADMIN)).get('/api/workflows/abc')).status).toBe(400);
  });
});

// ─── Acting ───────────────────────────────────────────────────────────────────

describe('POST /api/workflows/tasks/:taskId', () => {
  async function inboxTask(user) {
    const res = await request(buildApp(user)).get('/api/workflows/inbox');
    return res.body.tasks[0];
  }

  test('an admin actions the task from their inbox and gets the updated instance back', async () => {
    const id = await startFollowUp(MEMBER);
    const task = await inboxTask(ADMIN);
    expect(task.instanceId).toBe(id);

    const res = await request(buildApp(ADMIN))
      .post(`/api/workflows/tasks/${task.id ?? task.taskId}`)
      .send({ action: 'no-answer' });

    expect(res.status).toBe(200);
    expect(res.body.instance.stepId).toBe('try-again');
  });

  test('somebody the task is not aimed at is refused', async () => {
    await startFollowUp(MEMBER);
    const task = await inboxTask(ADMIN);
    const res = await request(buildApp(OTHER))
      .post(`/api/workflows/tasks/${task.taskId}`)
      .send({ action: 'emailed' });
    expect(res.status).toBe(403);
  });

  test('an action needing a note is refused without one', async () => {
    await startFollowUp(MEMBER);
    const task = await inboxTask(ADMIN);
    const res = await request(buildApp(ADMIN))
      .post(`/api/workflows/tasks/${task.taskId}`)
      .send({ action: 'decline' });
    expect(res.status).toBe(400);
  });

  test('a reassigned follow-up runs end to end and writes back to the guest', async () => {
    const id = await startFollowUp(ADMIN);

    const first = await inboxTask(ADMIN);
    await request(buildApp(ADMIN))
      .post(`/api/workflows/tasks/${first.taskId}`)
      .send({ action: 'decline', note: 'Out of town' });

    const second = await inboxTask(ADMIN);
    const res = await request(buildApp(ADMIN))
      .post(`/api/workflows/tasks/${second.taskId}`)
      .send({ action: 'phoned' });

    expect(res.body.instance.status).toBe('completed');
    expect(res.body.instance.outcomeLabel).toMatch(/contacted/i);
    expect(db.prepare('SELECT last_contact_method FROM visitors WHERE id = ?').get(VISITOR.id).last_contact_method).toBe('phone');
    expect(res.body.instance.id).toBe(id);
  });
});
