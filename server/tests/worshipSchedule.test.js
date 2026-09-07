jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const db     = require('../db');
const engine = require('../workflows/engine');
const { getDefinition } = require('../workflows/definitions');

function outbox() {
  return db.prepare('SELECT * FROM mail_outbox ORDER BY id').all();
}

function addPerson(name, email = '') {
  const { lastInsertRowid: id } = db.prepare('INSERT INTO directory (name, email) VALUES (?, ?)').run(name, email);
  return id;
}

function addUser(name, role, email, directoryId = null, wantsReport = 1) {
  const { lastInsertRowid: id } = db.prepare(`
    INSERT INTO users (provider, provider_id, email, name, role, directory_id, wants_monthly_report)
    VALUES (?,?,?,?,?,?,?)
  `).run('google', `${name}-id`, email, name, role, directoryId, wantsReport);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function setPreference(directoryId, role, level) {
  db.prepare('INSERT INTO worship_preferences (directory_id, role, level) VALUES (?,?,?)')
    .run(directoryId, role, level);
}

function pendingTask(instanceId) {
  return db.prepare("SELECT * FROM workflow_tasks WHERE instance_id = ? AND status = 'pending'").get(instanceId);
}

const JUNE = { month: 'June 2026', services: 'Sunday Worship' };

const VOLUNTEERS = [
  ['Ray Harris', 'ray@example.com'],
  ['Sam Nolan',  'sam@example.com'],
  ['Tom Reed',   'tom@example.com'],
  ['Bill Shaw',  'bill@example.com'],
  ['Joe Carter', 'joe@example.com'],
  ['Ned Poole',  'ned@example.com'],
];

const WORSHIP_JOBS = ['Song Leader', 'Opening Prayer', 'Scripture Reading', 'Communion', 'Closing Prayer', 'Usher'];

let COORDINATOR, ADMIN, MEMBER, people;

beforeEach(() => {
  for (const t of ['mail_outbox', 'mail_group_members', 'workflow_participants', 'workflow_events',
                   'workflow_tasks', 'workflow_instances', 'worship_preferences', 'job_assignments',
                   'visitors', 'users', 'directory']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }

  people = Object.fromEntries(VOLUNTEERS.map(([name, email]) => [name, addPerson(name, email)]));

  COORDINATOR = addUser('Cora', 'worship-coordinator', 'cora@example.com');
  ADMIN       = addUser('Ada',  'admin',    'ada@example.com');
  MEMBER      = addUser('Mel',  'approved', 'mel@example.com');

  // Everyone is willing to do anything, so a full month can be built.
  for (const id of Object.values(people)) {
    for (const role of WORSHIP_JOBS) setPreference(id, role, 'willing');
  }
});

// ─── Who may run it ───────────────────────────────────────────────────────────

describe('who can start a worship schedule', () => {
  test('the worship coordinator can', () => {
    expect(engine.start({ definitionId: 'worship-schedule', data: JUNE, user: COORDINATOR }).id)
      .toEqual(expect.any(Number));
  });

  test('an admin can, since they outrank the coordinator', () => {
    expect(engine.start({ definitionId: 'worship-schedule', data: JUNE, user: ADMIN }).id)
      .toEqual(expect.any(Number));
  });

  test('an ordinary member cannot', () => {
    expect(engine.start({ definitionId: 'worship-schedule', data: JUNE, user: MEMBER }))
      .toMatchObject({ status: 403 });
    expect(db.prepare('SELECT COUNT(*) n FROM workflow_instances').get().n).toBe(0);
  });

  test('the review task waits on the coordinator, not on admins generally', () => {
    const { id } = engine.start({ definitionId: 'worship-schedule', data: JUNE, user: ADMIN });
    expect(pendingTask(id).assignee_role).toBe('worship-coordinator');
  });

  test('it appears in the coordinator\'s inbox', () => {
    engine.start({ definitionId: 'worship-schedule', data: JUNE, user: COORDINATOR });
    expect(engine.inbox(COORDINATOR).map(t => t.stepId)).toEqual(['review']);
    expect(engine.inbox(MEMBER)).toHaveLength(0);
  });
});

// ─── Drafting ─────────────────────────────────────────────────────────────────

describe('the draft', () => {
  test('is built at start, from the preferences people set', () => {
    const { id } = engine.start({ definitionId: 'worship-schedule', data: JUNE, user: COORDINATOR });
    const data = JSON.parse(db.prepare('SELECT data FROM workflow_instances WHERE id=?').get(id).data);

    expect(data.draft.month).toBe('June 2026');
    expect(data.draft.rows.length).toBe(24);          // 4 Sundays × 6 jobs
    expect(data.draft.rows.every(r => VOLUNTEERS.some(([name]) => name === r.name))).toBe(true);
    expect(data.draft.unfilled).toEqual([]);
  });

  test('refuses a month it cannot read, leaving nothing behind', () => {
    const result = engine.start({
      definitionId: 'worship-schedule',
      data: { month: 'Smarch 2026', services: 'Sunday Worship' },
      user: COORDINATOR,
    });
    expect(result.status).toBe(400);
    expect(db.prepare('SELECT COUNT(*) n FROM workflow_instances').get().n).toBe(0);
  });

  test('is offered to the screen as a table', () => {
    const { id } = engine.start({ definitionId: 'worship-schedule', data: JUNE, user: COORDINATOR });
    const { instance } = engine.detail(id, COORDINATOR);

    expect(instance.preview.columns).toEqual(['Date', 'Service', 'Job', 'Name']);
    expect(instance.preview.rows).toHaveLength(24);
  });

  test('nothing is written to the roster before publishing', () => {
    engine.start({ definitionId: 'worship-schedule', data: JUNE, user: COORDINATOR });
    expect(db.prepare('SELECT COUNT(*) n FROM job_assignments').get().n).toBe(0);
  });

  test('regenerating produces a different draft and still writes nothing', () => {
    const { id } = engine.start({ definitionId: 'worship-schedule', data: JUNE, user: COORDINATOR });
    const before = JSON.parse(db.prepare('SELECT data FROM workflow_instances WHERE id=?').get(id).data);

    engine.act({ taskId: pendingTask(id).id, actionId: 'regenerate', user: COORDINATOR });

    const after = JSON.parse(db.prepare('SELECT data FROM workflow_instances WHERE id=?').get(id).data);
    expect(after.attempt).toBe(1);
    expect(after.draft.rows.map(r => r.name)).not.toEqual(before.draft.rows.map(r => r.name));
    expect(db.prepare('SELECT COUNT(*) n FROM job_assignments').get().n).toBe(0);

    // Still waiting on the coordinator, on the same step.
    expect(pendingTask(id).step_id).toBe('review');
  });
});

// ─── Publishing ───────────────────────────────────────────────────────────────

describe('publishing', () => {
  function publish() {
    const { id } = engine.start({ definitionId: 'worship-schedule', data: JUNE, user: COORDINATOR });
    const result = engine.act({ taskId: pendingTask(id).id, actionId: 'publish', user: COORDINATOR });
    return { id, result };
  }

  test('writes the month to the roster and completes', () => {
    const { id } = publish();

    const rows = db.prepare('SELECT * FROM job_assignments').all();
    expect(rows).toHaveLength(24);
    expect(rows.every(r => r.month === 'June 2026')).toBe(true);
    expect(db.prepare('SELECT status, outcome FROM workflow_instances WHERE id=?').get(id))
      .toMatchObject({ status: 'completed', outcome: 'published' });
  });

  test('replaces only its own month, leaving others alone', () => {
    db.prepare('INSERT INTO job_assignments (month, date, service, job, name) VALUES (?,?,?,?,?)')
      .run('May 2026', 'May 3', 'Sunday Worship', 'Song Leader', 'Someone Else');

    publish();

    expect(db.prepare("SELECT COUNT(*) n FROM job_assignments WHERE month='May 2026'").get().n).toBe(1);
    expect(db.prepare("SELECT COUNT(*) n FROM job_assignments WHERE month='June 2026'").get().n).toBe(24);
  });

  test('publishing twice does not double the month', () => {
    publish();
    publish();
    expect(db.prepare("SELECT COUNT(*) n FROM job_assignments WHERE month='June 2026'").get().n).toBe(24);
  });

  test('refuses when nobody could be scheduled, and writes nothing', () => {
    db.prepare('DELETE FROM worship_preferences').run();
    const { id } = engine.start({ definitionId: 'worship-schedule', data: JUNE, user: COORDINATOR });

    const result = engine.act({ taskId: pendingTask(id).id, actionId: 'publish', user: COORDINATOR });
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/Nobody could be scheduled/);
    expect(db.prepare('SELECT COUNT(*) n FROM job_assignments').get().n).toBe(0);
    expect(pendingTask(id).step_id).toBe('review');   // still open for another go
  });

  test('abandoning writes nothing and closes the workflow', () => {
    const { id } = engine.start({ definitionId: 'worship-schedule', data: JUNE, user: COORDINATOR });
    engine.act({ taskId: pendingTask(id).id, actionId: 'cancel', note: 'Doing it by hand', user: COORDINATOR });

    expect(db.prepare('SELECT COUNT(*) n FROM job_assignments').get().n).toBe(0);
    expect(db.prepare('SELECT outcome FROM workflow_instances WHERE id=?').get(id).outcome).toBe('cancelled');
  });
});

// ─── Who hears about it ───────────────────────────────────────────────────────

describe('notifications on publishing', () => {
  function publish() {
    const { id } = engine.start({ definitionId: 'worship-schedule', data: JUNE, user: COORDINATOR });
    db.prepare('DELETE FROM mail_outbox').run();      // ignore the assignment email
    engine.act({ taskId: pendingTask(id).id, actionId: 'publish', user: COORDINATOR });
    return id;
  }

  test('everyone given a turn is told what they are down for', () => {
    publish();

    const personal = outbox().filter(m => m.subject.includes('Your worship assignments'));
    expect(personal.map(m => m.intended_for).sort())
      .toEqual(VOLUNTEERS.map(([, email]) => email).sort());
    expect(personal[0].body).toContain('June');
    expect(personal[0].body).toMatch(/Song Leader|Opening Prayer|Communion|Usher/);
  });

  test('each person is told only their own turns', () => {
    publish();

    const rayMail = outbox().find(m => m.intended_for === 'ray@example.com' && m.subject.includes('Your worship'));
    for (const [name] of VOLUNTEERS.filter(([n]) => n !== 'Ray Harris')) {
      expect(rayMail.body).not.toContain(name);
    }
  });

  test('the monthly summary goes to everyone who has not opted out', () => {
    publish();

    const summary = outbox().filter(m => m.subject.includes('Worship schedule for'));
    expect(summary.map(m => m.intended_for).sort())
      .toEqual(['ada@example.com', 'cora@example.com', 'mel@example.com']);
  });

  test('somebody who opted out does not get the summary', () => {
    db.prepare('UPDATE users SET wants_monthly_report = 0 WHERE id = ?').run(MEMBER.id);
    publish();

    const summary = outbox().filter(m => m.subject.includes('Worship schedule for'));
    expect(summary.map(m => m.intended_for)).not.toContain('mel@example.com');
    expect(summary.map(m => m.intended_for).sort()).toEqual(['ada@example.com', 'cora@example.com']);
  });

  test('opting out of the summary still leaves personal assignment emails', () => {
    // Ray has an account, opted out, and is also scheduled.
    const rayUser = addUser('Ray', 'approved', 'ray@example.com', people['Ray Harris'], 0);
    expect(rayUser.wants_monthly_report).toBe(0);
    publish();

    const mine = outbox().filter(m => m.intended_for === 'ray@example.com' && m.subject.includes('Your worship'));
    expect(mine).toHaveLength(1);

    const summary = outbox().filter(m => m.subject.includes('Worship schedule for'));
    expect(summary.map(m => m.intended_for)).not.toContain('ray@example.com');
  });

  test('the summary explains how to stop receiving it', () => {
    publish();
    const summary = outbox().find(m => m.subject.includes('Worship schedule for'));
    expect(summary.body).toMatch(/turn off "Monthly schedule summary"/i);
  });

  test('somebody scheduled with no address on file is reported, not silently dropped', () => {
    const noEmail = addPerson('Quiet Person');
    db.prepare('DELETE FROM worship_preferences').run();
    setPreference(noEmail, 'Song Leader', 'preferred');

    const { id } = engine.start({ definitionId: 'worship-schedule', data: JUNE, user: COORDINATOR });
    engine.act({ taskId: pendingTask(id).id, actionId: 'publish', user: COORDINATOR });

    const data = JSON.parse(db.prepare('SELECT data FROM workflow_instances WHERE id=?').get(id).data);
    expect(data.unreachable).toEqual(['Quiet Person']);
    // The roster still got the assignment; only the email could not be sent.
    expect(db.prepare("SELECT COUNT(*) n FROM job_assignments WHERE name='Quiet Person'").get().n).toBeGreaterThan(0);
  });

  test('a refused publish sends nothing at all', () => {
    db.prepare('DELETE FROM worship_preferences').run();
    const { id } = engine.start({ definitionId: 'worship-schedule', data: JUNE, user: COORDINATOR });
    db.prepare('DELETE FROM mail_outbox').run();

    engine.act({ taskId: pendingTask(id).id, actionId: 'publish', user: COORDINATOR });
    expect(outbox()).toEqual([]);
  });
});

// ─── The definition itself ────────────────────────────────────────────────────

describe('the definition', () => {
  test('is owned by the worship coordinator', () => {
    const definition = getDefinition('worship-schedule');
    expect(definition.startRole).toBe('worship-coordinator');
    expect(definition.steps.review.assign).toEqual({ role: 'worship-coordinator' });
  });

  test('charts the regenerate loop back to the review step', () => {
    const chart = engine.describe(getDefinition('worship-schedule'));
    expect(chart.edges).toContainEqual(
      expect.objectContaining({ from: 'review', to: 'review', label: 'Try a different draft' })
    );
  });
});
