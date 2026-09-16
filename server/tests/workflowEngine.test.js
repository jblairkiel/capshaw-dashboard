jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const db     = require('../db');
const engine = require('../workflows/engine');
const { listDefinitions, getDefinition, validateDefinitions } = require('../workflows/definitions');

// A small cast: an admin, two members (one of them rostered), and a pending
// user who should not be able to start anything.
let ADMIN, MEMBER, OTHER, PENDING, RAY, JO, ORPHAN, ASSIGNMENT, VISITOR;

function addUser(name, role, directoryId = null) {
  const { lastInsertRowid: id } = db.prepare(
    'INSERT INTO users (provider, provider_id, email, name, role, directory_id) VALUES (?,?,?,?,?,?)'
  ).run('google', `${name}-id`, `${name}@example.com`, name, role, directoryId);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function addPerson(name) {
  const { lastInsertRowid: id } = db.prepare('INSERT INTO directory (name) VALUES (?)').run(name);
  return db.prepare('SELECT * FROM directory WHERE id = ?').get(id);
}

function pendingTasks(instanceId) {
  return db.prepare("SELECT * FROM workflow_tasks WHERE instance_id = ? AND status = 'pending'").all(instanceId);
}

function instanceRow(id) {
  return db.prepare('SELECT * FROM workflow_instances WHERE id = ?').get(id);
}

// Walks the current pending task with the given action, as the given user.
function actOn(instanceId, user, actionId, note = '') {
  const task = pendingTasks(instanceId)[0];
  return engine.act({ taskId: task.id, actionId, note, user });
}

// The stock request these tests walk through. Aimed by default at somebody in
// the directory with no login of their own, so the first task falls to the
// admin queue and any admin can move it along.
function followUp({ user = MEMBER, assignee = ORPHAN } = {}) {
  return engine.start({
    definitionId: 'visitor-follow-up',
    data: { visitorId: String(VISITOR.id), assigneePersonId: String(assignee.id), notes: '' },
    user,
  });
}

beforeEach(() => {
  for (const t of ['workflow_participants', 'workflow_events', 'workflow_tasks', 'workflow_instances',
                   'job_assignments', 'visitors', 'users', 'directory']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }

  RAY    = addPerson('Ray Harris');
  JO     = addPerson('Jo Harris');
  ORPHAN = addPerson('Unlinked Person');

  ADMIN   = addUser('Ada',  'admin');
  MEMBER  = addUser('Ray',  'approved', RAY.id);
  OTHER   = addUser('Jo',   'approved', JO.id);
  PENDING = addUser('Pat',  'pending');

  const { lastInsertRowid } = db.prepare(
    'INSERT INTO job_assignments (month, date, service, job, name) VALUES (?,?,?,?,?)'
  ).run('April 2025', 'April 6', 'Sunday Worship', 'Song Leader', 'Ray Harris');
  ASSIGNMENT = db.prepare('SELECT * FROM job_assignments WHERE id = ?').get(lastInsertRowid);

  const visitor = db.prepare('INSERT INTO visitors (name) VALUES (?)').run('Sam Visitor');
  VISITOR = db.prepare('SELECT * FROM visitors WHERE id = ?').get(visitor.lastInsertRowid);
});

// ─── Definitions ──────────────────────────────────────────────────────────────

describe('workflow definitions', () => {
  test('every declared target exists', () => {
    expect(validateDefinitions()).toEqual([]);
  });

  test('every step is reachable from the start', () => {
    for (const def of listDefinitions()) {
      const reached = new Set([def.start]);
      const queue = [def.start];
      while (queue.length) {
        const step = def.steps[queue.shift()];
        if (!step) continue;
        for (const action of step.actions) {
          const targets = typeof action.to === 'function' ? (action.possibleTo || []) : [action.to];
          for (const to of targets) {
            if (def.steps[to] && !reached.has(to)) { reached.add(to); queue.push(to); }
          }
        }
      }
      expect({ id: def.id, unreachable: Object.keys(def.steps).filter(s => !reached.has(s)) })
        .toEqual({ id: def.id, unreachable: [] });
    }
  });

  test('describe() yields a node for every step and outcome', () => {
    const chart = engine.describe(getDefinition('visitor-follow-up'));
    expect(chart.nodes.filter(n => n.kind === 'step').map(n => n.id).sort())
      .toEqual(['reach-out', 'reassign', 'try-again']);
    expect(chart.nodes.filter(n => n.kind === 'outcome').map(n => n.id).sort())
      .toEqual(['contacted', 'no-contact']);
  });
});

// ─── Starting ─────────────────────────────────────────────────────────────────

describe('starting a workflow', () => {
  test('a member can start one, and it opens at the first step', () => {
    const { id } = followUp();

    const row = instanceRow(id);
    expect(row.status).toBe('active');
    expect(row.step_id).toBe('reach-out');
    expect(row.title).toBe('Follow up with Sam Visitor');
    expect(pendingTasks(id)).toHaveLength(1);
  });

  test('a pending user is refused', () => {
    expect(followUp({ user: PENDING })).toMatchObject({ status: 403 });
    expect(db.prepare('SELECT COUNT(*) n FROM workflow_instances').get().n).toBe(0);
  });

  test('missing required fields are refused before anything is written', () => {
    const result = engine.start({
      definitionId: 'visitor-follow-up',
      data: { visitorId: String(VISITOR.id) },
      user: MEMBER,
    });
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/Who should reach out is required/);
    expect(db.prepare('SELECT COUNT(*) n FROM workflow_instances').get().n).toBe(0);
  });

  test('a value outside a select\'s options is refused', () => {
    const result = engine.start({
      definitionId: 'worship-schedule',
      data: { month: 'June 2026', services: 'Whenever we feel like it' },
      user: ADMIN,
    });
    expect(result.status).toBe(400);
    expect(db.prepare('SELECT COUNT(*) n FROM workflow_instances').get().n).toBe(0);
  });

  test('an unknown workflow is a 404', () => {
    expect(engine.start({ definitionId: 'nope', data: {}, user: MEMBER })).toMatchObject({ status: 404 });
  });

  test('onStart can refuse, leaving nothing behind', () => {
    const result = engine.start({
      definitionId: 'job-swap',
      data: { assignmentId: '9999', reason: 'Away' },
      user: MEMBER,
    });
    expect(result.status).toBe(400);
    expect(db.prepare('SELECT COUNT(*) n FROM workflow_instances').get().n).toBe(0);
  });
});

// ─── Assignment ───────────────────────────────────────────────────────────────

describe('who a task lands on', () => {
  test('a role step is offered to anyone holding that role, not one person', () => {
    // Jo was asked to reach out and cannot; reassigning is the guest area's
    // step, and belongs to whichever of them picks it up.
    const { id } = followUp({ assignee: JO });
    actOn(id, OTHER, 'decline', 'Away all month');

    const [task] = pendingTasks(id);
    expect(instanceRow(id).step_id).toBe('reassign');
    expect(task.assignee_role).toBe('visitors');
    expect(task.assignee_user_id).toBeNull();
  });

  test('a creator step lands on whoever started it', () => {
    const { id } = engine.start({
      definitionId: 'job-swap',
      data: { assignmentId: String(ASSIGNMENT.id), reason: 'Away that week' },
      user: MEMBER,
    });
    const [task] = pendingTasks(id);
    expect(task.assignee_user_id).toBe(MEMBER.id);
  });

  test('a person step lands on that person\'s linked login', () => {
    const { id } = followUp({ assignee: JO });
    const [task] = pendingTasks(id);
    expect(task.assignee_user_id).toBe(OTHER.id);
  });

  test('a person with no linked login falls back to a role, so nothing stalls', () => {
    const { id } = followUp();
    const [task] = pendingTasks(id);
    expect(task.assignee_user_id).toBeNull();
    // The guests' own area, rather than admins generally — it is their page.
    expect(task.assignee_role).toBe('visitors');
  });
});

// ─── Acting ───────────────────────────────────────────────────────────────────

describe('acting on a task', () => {
  test('an admin can action a role task, and it advances', () => {
    const { id } = followUp();
    expect(actOn(id, ADMIN, 'no-answer')).toMatchObject({ id });
    expect(instanceRow(id).step_id).toBe('try-again');
    expect(pendingTasks(id)).toHaveLength(1);
  });

  test('a member who holds nothing cannot action a task aimed at an area', () => {
    const { id } = followUp();
    expect(actOn(id, OTHER, 'emailed')).toMatchObject({ status: 403 });
    expect(instanceRow(id).step_id).toBe('reach-out');
  });

  test('the same task cannot be actioned twice', () => {
    const { id } = followUp();
    const task = pendingTasks(id)[0];
    engine.act({ taskId: task.id, actionId: 'emailed', user: ADMIN });
    expect(engine.act({ taskId: task.id, actionId: 'emailed', user: ADMIN })).toMatchObject({ status: 409 });
  });

  test('an unknown action is refused', () => {
    const { id } = followUp();
    expect(actOn(id, ADMIN, 'teleport')).toMatchObject({ status: 400 });
  });

  test('an action that requires a note is refused without one', () => {
    const { id } = followUp();
    expect(actOn(id, ADMIN, 'decline')).toMatchObject({ status: 400 });
    expect(instanceRow(id).step_id).toBe('reach-out');
  });

  test('reaching an outcome completes the instance and leaves no open task', () => {
    const { id } = followUp();
    actOn(id, ADMIN, 'no-answer');
    actOn(id, ADMIN, 'give-up', 'No number on file');

    const row = instanceRow(id);
    expect(row.status).toBe('completed');
    expect(row.outcome).toBe('no-contact');
    expect(row.step_id).toBe('');
    expect(row.completed_at).toBeTruthy();
    expect(pendingTasks(id)).toHaveLength(0);
  });

  test('every action is recorded in the audit trail with its actor', () => {
    const { id } = followUp({ assignee: JO });
    actOn(id, OTHER, 'decline', 'Away all month');
    actOn(id, ADMIN, 'phoned');

    const events = db.prepare('SELECT * FROM workflow_events WHERE instance_id = ? ORDER BY id').all(id);
    expect(events.map(e => e.action)).toEqual(['started', 'decline', 'phoned', 'completed']);
    expect(events[1].actor_user_id).toBe(OTHER.id);
    expect(events[2].actor_user_id).toBe(ADMIN.id);
  });

  test('a step can loop back on itself for another try', () => {
    const { id } = followUp({ assignee: JO });
    actOn(id, OTHER, 'no-answer');
    expect(instanceRow(id).step_id).toBe('try-again');

    actOn(id, OTHER, 'retry');
    expect(instanceRow(id).step_id).toBe('reach-out');
    expect(instanceRow(id).status).toBe('active');
  });
});

// ─── Loops and write-back ─────────────────────────────────────────────────────

describe('job swap — looping and roster write-back', () => {
  function swapRequest() {
    return engine.start({
      definitionId: 'job-swap',
      data: { assignmentId: String(ASSIGNMENT.id), reason: 'Away that week' },
      user: MEMBER,
    }).id;
  }

  test('snapshots the duty so the request stays readable', () => {
    const id = swapRequest();
    const data = JSON.parse(instanceRow(id).data);
    expect(data).toMatchObject({ dutyJob: 'Song Leader', dutyDate: 'April 6', dutyName: 'Ray Harris' });
    expect(instanceRow(id).title).toBe('Song Leader — April 6 (Ray Harris)');
  });

  test('approving writes the replacement onto the roster', () => {
    const id = swapRequest();
    actOn(id, MEMBER, 'found', 'Jo Harris');
    actOn(id, ADMIN, 'apply');

    expect(db.prepare('SELECT name FROM job_assignments WHERE id = ?').get(ASSIGNMENT.id).name).toBe('Jo Harris');
    expect(instanceRow(id).outcome).toBe('covered');
  });

  test('rejecting a replacement loops back for another, without touching the roster', () => {
    const id = swapRequest();
    actOn(id, MEMBER, 'found', 'Jo Harris');
    actOn(id, ADMIN, 'reject', 'Jo is already leading singing that day');

    expect(instanceRow(id).step_id).toBe('find-replacement');
    expect(instanceRow(id).status).toBe('active');
    expect(db.prepare('SELECT name FROM job_assignments WHERE id = ?').get(ASSIGNMENT.id).name).toBe('Ray Harris');

    // ...and the second time round it can still complete.
    actOn(id, MEMBER, 'found', 'Pat Nolan');
    actOn(id, ADMIN, 'apply');
    expect(db.prepare('SELECT name FROM job_assignments WHERE id = ?').get(ASSIGNMENT.id).name).toBe('Pat Nolan');
  });

  test('an effect that fails refuses the action and changes nothing', () => {
    const id = swapRequest();
    actOn(id, MEMBER, 'found', 'Jo Harris');

    // The duty disappears from the roster before the scheduler approves.
    db.prepare('DELETE FROM job_assignments WHERE id = ?').run(ASSIGNMENT.id);

    const result = actOn(id, ADMIN, 'apply');
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/no longer on the roster/);
    expect(instanceRow(id).step_id).toBe('approve');
    expect(pendingTasks(id)).toHaveLength(1);
  });

  test('handing it to the scheduler routes to the role step', () => {
    const id = swapRequest();
    actOn(id, MEMBER, 'need-help');
    const [task] = pendingTasks(id);
    expect(task.assignee_role).toBe('admin');
    expect(instanceRow(id).step_id).toBe('scheduler-find');
  });
});

// ─── Inbox ────────────────────────────────────────────────────────────────────

describe('inbox', () => {
  test('shows role tasks to everyone who could take them', () => {
    followUp();

    expect(engine.inbox(ADMIN)).toHaveLength(1);
    expect(engine.inbox(OTHER)).toHaveLength(0);
  });

  test('shows a personally assigned task only to that person', () => {
    engine.start({
      definitionId: 'job-swap',
      data: { assignmentId: String(ASSIGNMENT.id), reason: 'Away' },
      user: MEMBER,
    });

    expect(engine.inbox(MEMBER).map(t => t.stepId)).toEqual(['find-replacement']);
    expect(engine.inbox(OTHER)).toHaveLength(0);
  });

  test('carries the actions the step offers, so the inbox can act inline', () => {
    followUp();

    const [task] = engine.inbox(ADMIN);
    expect(task.actions.map(a => a.id)).toEqual(['emailed', 'phoned', 'no-answer', 'decline']);
    expect(task.actions.find(a => a.id === 'decline').requiresNote).toBe(true);
    expect(task.title).toBe('Follow up with Sam Visitor');
  });

  test('empties once the task is done', () => {
    const { id } = followUp();
    actOn(id, ADMIN, 'emailed');
    expect(engine.inbox(ADMIN)).toHaveLength(0);
  });
});

// ─── Visibility ───────────────────────────────────────────────────────────────

describe('who can see an instance', () => {
  test('the person who started it can see it', () => {
    const { id } = followUp();
    expect(engine.detail(id, MEMBER).instance.id).toBe(id);
  });

  test('an uninvolved member cannot', () => {
    const { id } = followUp();
    expect(engine.detail(id, OTHER)).toMatchObject({ status: 403 });
  });

  test('an admin can see anything', () => {
    const { id } = followUp();
    expect(engine.detail(id, ADMIN).instance.id).toBe(id);
  });

  test('acting on a workflow keeps it visible afterwards', () => {
    const { id } = followUp();
    actOn(id, ADMIN, 'emailed');
    // Ada is an admin anyway; check the participant row was actually written.
    const rows = db.prepare('SELECT user_id FROM workflow_participants WHERE instance_id = ?').all(id);
    expect(rows.map(r => r.user_id).sort()).toEqual([MEMBER.id, ADMIN.id].sort());
  });

  test('list(mine) shows involvement, list(all) is admin-only and shows everything', () => {
    const mine   = followUp({ user: MEMBER }).id;
    const theirs = followUp({ user: OTHER }).id;

    expect(engine.list(MEMBER, { scope: 'mine' }).map(i => i.id)).toContain(mine);
    expect(engine.list(OTHER,  { scope: 'mine' }).map(i => i.id)).not.toContain(mine);
    expect(engine.list(ADMIN,  { scope: 'all'  }).map(i => i.id).sort()).toEqual([mine, theirs].sort());
    // A member asking for 'all' is quietly treated as 'mine' by the engine;
    // the route is what refuses them outright.
    expect(engine.list(OTHER, { scope: 'all' }).map(i => i.id)).toEqual([theirs]);
  });

  test('detail exposes my actionable task, and not other people\'s', () => {
    const { id } = followUp();
    expect(engine.detail(id, ADMIN).myTask.stepId).toBe('reach-out');
    expect(engine.detail(id, MEMBER).myTask).toBeNull();
  });

  test('detail lists the steps already visited, for the chart', () => {
    const { id } = followUp();
    actOn(id, ADMIN, 'no-answer');
    expect(engine.detail(id, ADMIN).visited).toContain('reach-out');
  });
});
