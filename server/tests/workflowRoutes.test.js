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

let ADMIN, MEMBER, OTHER, PENDING, RAY, ORPHAN, ASSIGNMENT, VISITOR;

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
                   'job_assignments', 'visitors', 'users', 'directory']) {
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

  const { lastInsertRowid } = db.prepare(
    'INSERT INTO job_assignments (month, date, service, job, name) VALUES (?,?,?,?,?)'
  ).run('April 2025', 'April 6', 'Sunday Worship', 'Song Leader', 'Ray Harris');
  ASSIGNMENT = db.prepare('SELECT * FROM job_assignments WHERE id = ?').get(lastInsertRowid);
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
      .toEqual(['job-swap', 'visitor-follow-up']);

    const followUp = res.body.definitions.find(d => d.id === 'visitor-follow-up');
    expect(followUp.chart.nodes.length).toBeGreaterThan(0);
    expect(followUp.chart.edges.length).toBeGreaterThan(0);
  });

  test('resolves dynamic options against the requesting user', async () => {
    const res = await request(buildApp(MEMBER)).get('/api/workflows/definitions');
    const swap = res.body.definitions.find(d => d.id === 'job-swap');
    const duty = swap.fields.find(f => f.key === 'assignmentId');

    // Ray is rostered for exactly one duty, so that is all he is offered.
    expect(duty.options).toEqual([
      { value: String(ASSIGNMENT.id), label: 'April 6 · Sunday Worship · Song Leader' },
    ]);
  });

  test('offers a member with no roster duties an empty list rather than everyone\'s', async () => {
    const res = await request(buildApp(OTHER)).get('/api/workflows/definitions');
    const swap = res.body.definitions.find(d => d.id === 'job-swap');
    expect(swap.fields.find(f => f.key === 'assignmentId').options).toEqual([]);
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

  test('a full job swap runs end to end and updates the roster', async () => {
    const started = await request(buildApp(MEMBER))
      .post('/api/workflows')
      .send({ definitionId: 'job-swap', data: { assignmentId: String(ASSIGNMENT.id), reason: 'Away' } });
    const id = started.body.id;

    const mine = await inboxTask(MEMBER);
    await request(buildApp(MEMBER))
      .post(`/api/workflows/tasks/${mine.taskId}`)
      .send({ action: 'found', note: 'Jo Harris' });

    const scheduler = await inboxTask(ADMIN);
    const res = await request(buildApp(ADMIN))
      .post(`/api/workflows/tasks/${scheduler.taskId}`)
      .send({ action: 'apply' });

    expect(res.body.instance.status).toBe('completed');
    expect(res.body.instance.outcomeLabel).toMatch(/roster updated/i);
    expect(db.prepare('SELECT name FROM job_assignments WHERE id = ?').get(ASSIGNMENT.id).name).toBe('Jo Harris');
    expect(res.body.instance.id).toBe(id);
  });
});
