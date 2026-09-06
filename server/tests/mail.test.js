jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const db     = require('../db');
const mailer = require('../mail/mailer');
const groups = require('../mail/groups');
const notify = require('../mail/notify');
const engine = require('../workflows/engine');

function outbox() {
  return db.prepare('SELECT * FROM mail_outbox ORDER BY id').all();
}

function addPerson(name, email = '') {
  const { lastInsertRowid: id } = db.prepare('INSERT INTO directory (name, email) VALUES (?, ?)').run(name, email);
  return db.prepare('SELECT * FROM directory WHERE id = ?').get(id);
}

function addUser(name, role, email, directoryId = null) {
  const { lastInsertRowid: id } = db.prepare(
    'INSERT INTO users (provider, provider_id, email, name, role, directory_id) VALUES (?,?,?,?,?,?)'
  ).run('google', `${name}-id`, email, name, role, directoryId);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  for (const t of ['mail_outbox', 'mail_group_members', 'workflow_participants', 'workflow_events',
                   'workflow_tasks', 'workflow_instances', 'job_assignments', 'visitors', 'users', 'directory']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
  process.env = { ...ORIGINAL_ENV };
  delete process.env.SMTP_HOST;
  delete process.env.MAIL_REDIRECT_TO;
  mailer.resetTransport();
});

afterAll(() => { process.env = ORIGINAL_ENV; });

// ─── The test-account redirect ────────────────────────────────────────────────

describe('the test-account redirect', () => {
  test('is on by default, so real delivery has to be opted into', () => {
    expect(mailer.isRedirecting()).toBe(true);
    expect(mailer.config().redirectTo).toBe('jblairkiel@gmail.com');
  });

  test('sends every message to the test account, whoever it was addressed to', () => {
    mailer.enqueue({
      to: [{ email: 'ray@example.com', name: 'Ray' }, { email: 'jo@example.com', name: 'Jo' }],
      subject: 'Hello',
      body: 'Body text',
    });

    const rows = outbox();
    expect(rows).toHaveLength(2);
    expect(rows.every(r => r.to_email === 'jblairkiel@gmail.com')).toBe(true);
    expect(rows.map(r => r.intended_for).sort()).toEqual(['jo@example.com', 'ray@example.com']);
  });

  test('says in the body who it would have gone to', () => {
    mailer.enqueue({ to: { email: 'ray@example.com', name: 'Ray Harris' }, subject: 'Hi', body: 'Body text' });
    const [row] = outbox();
    expect(row.body).toContain('[TEST MODE]');
    expect(row.body).toContain('Ray Harris <ray@example.com>');
    expect(row.body).toContain('Body text');
  });

  test('delivers to the real recipient once the redirect is cleared', () => {
    process.env.MAIL_REDIRECT_TO = '';
    mailer.enqueue({ to: { email: 'ray@example.com', name: 'Ray' }, subject: 'Hi', body: 'Body' });

    const [row] = outbox();
    expect(row.to_email).toBe('ray@example.com');
    expect(row.intended_for).toBe('');
    expect(row.body).not.toContain('[TEST MODE]');
  });

  test('can be pointed at a different address', () => {
    process.env.MAIL_REDIRECT_TO = 'someone@else.test';
    mailer.enqueue({ to: { email: 'ray@example.com' }, subject: 'Hi', body: 'Body' });
    expect(outbox()[0].to_email).toBe('someone@else.test');
  });
});

// ─── Queueing ─────────────────────────────────────────────────────────────────

describe('the outbox', () => {
  test('drops anything that is not a usable address rather than queueing it', () => {
    mailer.enqueue({
      to: [{ email: 'fine@example.com' }, { email: 'not-an-address' }, { email: '' }, {}, null],
      subject: 'Hi', body: 'Body',
    });
    expect(outbox()).toHaveLength(1);
    expect(outbox()[0].intended_for).toBe('fine@example.com');
  });

  test('sends one copy to someone listed twice', () => {
    mailer.enqueue({
      to: [{ email: 'ray@example.com' }, { email: 'RAY@example.com' }],
      subject: 'Hi', body: 'Body',
    });
    expect(outbox()).toHaveLength(1);
  });

  test('leaves messages pending when no mail server is configured', async () => {
    mailer.enqueue({ to: { email: 'ray@example.com' }, subject: 'Hi', body: 'Body' });
    const result = await mailer.drainOutbox();

    expect(result).toEqual({ sent: 0, failed: 0, skipped: 1 });
    // Pending, not "sent" — nothing is quietly lost before mail is set up.
    expect(outbox()[0].status).toBe('pending');
  });

  test('records the context so a message can be traced back to its workflow', () => {
    mailer.enqueue({ to: { email: 'ray@example.com' }, subject: 'Hi', body: 'Body', context: 'workflow:12' });
    expect(outbox()[0].context).toBe('workflow:12');
  });
});

// ─── Distribution groups ──────────────────────────────────────────────────────

describe('distribution groups', () => {
  test('the eleven groups asked for are seeded', () => {
    expect(groups.listGroups().map(g => g.key)).toEqual([
      'elders', 'deacons', 'men', 'women', 'announcements',
      'group-1', 'group-2', 'group-3', 'group-4', 'group-5', 'group-6',
    ]);
  });

  test('a directory member\'s address follows the directory', () => {
    const ray = addPerson('Ray Harris', 'ray@example.com');
    const elders = groups.getGroup('elders');
    groups.addMember(elders.id, { directoryId: ray.id });

    expect(groups.recipientsFor('elders').recipients).toEqual([{ email: 'ray@example.com', name: 'Ray Harris' }]);

    // Correcting it in the directory fixes every group they are in.
    db.prepare('UPDATE directory SET email = ? WHERE id = ?').run('r.harris@example.com', ray.id);
    expect(groups.recipientsFor('elders').recipients[0].email).toBe('r.harris@example.com');
  });

  test('accepts a plain address for somebody not in the directory', () => {
    const elders = groups.getGroup('elders');
    expect(groups.addMember(elders.id, { email: 'Visiting.Elder@Example.com ' })).toEqual({ ok: true });
    expect(groups.recipientsFor('elders').recipients).toEqual([{ email: 'visiting.elder@example.com', name: '' }]);
  });

  test('refuses a malformed address and an unknown person', () => {
    const elders = groups.getGroup('elders');
    expect(groups.addMember(elders.id, { email: 'nope' }).error).toMatch(/valid email/);
    expect(groups.addMember(elders.id, { directoryId: 9999 }).error).toMatch(/not in the directory/);
    expect(groups.recipientsFor('elders').recipients).toEqual([]);
  });

  test('refuses the same person or address twice', () => {
    const ray = addPerson('Ray Harris', 'ray@example.com');
    const elders = groups.getGroup('elders');
    groups.addMember(elders.id, { directoryId: ray.id });
    expect(groups.addMember(elders.id, { directoryId: ray.id }).error).toMatch(/already/);

    groups.addMember(elders.id, { email: 'other@example.com' });
    expect(groups.addMember(elders.id, { email: 'OTHER@example.com' }).error).toMatch(/already/);
  });

  test('reports members with no address rather than pretending they were reached', () => {
    const withAddress = addPerson('Ray Harris', 'ray@example.com');
    const without     = addPerson('Jo Harris');
    const deacons = groups.getGroup('deacons');
    groups.addMember(deacons.id, { directoryId: withAddress.id });
    groups.addMember(deacons.id, { directoryId: without.id });

    const { recipients, missing } = groups.recipientsFor('deacons');
    expect(recipients.map(r => r.email)).toEqual(['ray@example.com']);
    expect(missing).toEqual(['Jo Harris']);
  });

  test('someone in two groups is only mailed once', () => {
    const ray = addPerson('Ray Harris', 'ray@example.com');
    groups.addMember(groups.getGroup('elders').id, { directoryId: ray.id });
    groups.addMember(groups.getGroup('men').id,    { directoryId: ray.id });

    mailer.enqueue({
      to: [...groups.recipientsFor('elders').recipients, ...groups.recipientsFor('men').recipients],
      subject: 'Hi', body: 'Body',
    });
    expect(outbox()).toHaveLength(1);
  });

  test('removing a member takes them off the list', () => {
    const ray = addPerson('Ray Harris', 'ray@example.com');
    const elders = groups.getGroup('elders');
    groups.addMember(elders.id, { directoryId: ray.id });

    const [member] = groups.membersOf(elders.id);
    expect(groups.removeMember(elders.id, member.id)).toEqual({ ok: true });
    expect(groups.recipientsFor('elders').recipients).toEqual([]);
  });

  test('an unknown group resolves to nobody rather than throwing', () => {
    expect(groups.recipientsFor('no-such-group')).toEqual({ recipients: [], missing: [], group: null });
  });
});

// ─── Who a task notification goes to ──────────────────────────────────────────

describe('notification recipients', () => {
  test('a task aimed at a person goes to that person alone', () => {
    const ray = addUser('Ray', 'approved', 'ray@example.com');
    addUser('Ada', 'admin', 'ada@example.com');

    expect(notify.recipientsForTask({ assignee_user_id: ray.id, assignee_role: '' }))
      .toEqual([{ email: 'ray@example.com', name: 'Ray' }]);
  });

  test('a task aimed at admins goes to the admins, not the whole congregation', () => {
    addUser('Ada', 'admin', 'ada@example.com');
    addUser('Bob', 'admin', 'bob@example.com');
    addUser('Ray', 'approved', 'ray@example.com');
    addUser('Pat', 'pending', 'pat@example.com');

    const recipients = notify.recipientsForTask({ assignee_user_id: null, assignee_role: 'admin' });
    expect(recipients.map(r => r.email).sort()).toEqual(['ada@example.com', 'bob@example.com']);
  });

  test('somebody with no address on file is skipped', () => {
    const ray = addUser('Ray', 'approved', null);
    expect(notify.recipientsForTask({ assignee_user_id: ray.id, assignee_role: '' })).toEqual([]);
  });
});

// ─── End to end through a workflow ────────────────────────────────────────────

describe('workflow notifications', () => {
  let MEMBER, ADMIN;

  beforeEach(() => {
    const ray = addPerson('Ray Harris', 'ray@example.com');
    MEMBER = addUser('Ray', 'approved', 'ray@example.com', ray.id);
    ADMIN  = addUser('Ada', 'admin', 'ada@example.com');
  });

  const REQUEST = { room: 'Kitchen', date: '2026-05-01', time: '6pm', purpose: 'Potluck' };

  function pendingTask(instanceId) {
    return db.prepare("SELECT * FROM workflow_tasks WHERE instance_id = ? AND status = 'pending'").get(instanceId);
  }

  test('starting one emails whoever the first task lands on', () => {
    engine.start({ definitionId: 'facility-use', data: REQUEST, user: MEMBER });

    const rows = outbox();
    expect(rows).toHaveLength(1);
    expect(rows[0].intended_for).toBe('ada@example.com');   // the admin queue
    expect(rows[0].subject).toContain('Kitchen — 2026-05-01');
    expect(rows[0].body).toContain('Deacon review');
  });

  test('each handover emails the next person', () => {
    const { id } = engine.start({ definitionId: 'facility-use', data: REQUEST, user: MEMBER });
    db.prepare('DELETE FROM mail_outbox').run();

    engine.act({ taskId: pendingTask(id).id, actionId: 'approve', user: ADMIN });

    const rows = outbox();
    expect(rows).toHaveLength(1);
    expect(rows[0].intended_for).toBe('ray@example.com');   // back to the requester
  });

  test('finishing tells the requester and copies the group the outcome names', () => {
    const elder = addPerson('Ann Elder', 'ann@example.com');
    groups.addMember(groups.getGroup('announcements').id, { directoryId: elder.id });

    const { id } = engine.start({ definitionId: 'facility-use', data: REQUEST, user: MEMBER });
    engine.act({ taskId: pendingTask(id).id, actionId: 'approve', user: ADMIN });
    db.prepare('DELETE FROM mail_outbox').run();

    engine.act({ taskId: pendingTask(id).id, actionId: 'confirm', user: MEMBER });

    const rows = outbox();
    expect(rows.map(r => r.intended_for).sort()).toEqual(['ann@example.com', 'ray@example.com']);
    expect(rows[0].subject).toContain('Approved');
  });

  test('an outcome that names no group only tells the requester', () => {
    const { id } = engine.start({ definitionId: 'facility-use', data: REQUEST, user: MEMBER });
    db.prepare('DELETE FROM mail_outbox').run();

    engine.act({ taskId: pendingTask(id).id, actionId: 'decline', note: 'Already booked', user: ADMIN });

    expect(outbox().map(r => r.intended_for)).toEqual(['ray@example.com']);
  });

  test('an action that fails sends nothing at all', () => {
    const duty = db.prepare('INSERT INTO job_assignments (month,date,service,job,name) VALUES (?,?,?,?,?)')
      .run('April 2025', 'April 6', 'Sunday Worship', 'Song Leader', 'Ray Harris').lastInsertRowid;

    const { id } = engine.start({
      definitionId: 'job-swap',
      data: { assignmentId: String(duty), reason: 'Away' },
      user: MEMBER,
    });
    engine.act({ taskId: pendingTask(id).id, actionId: 'found', note: 'Jo Harris', user: MEMBER });
    db.prepare('DELETE FROM job_assignments WHERE id = ?').run(duty);
    db.prepare('DELETE FROM mail_outbox').run();

    // The effect fails, so the transaction rolls back — and no mail escapes.
    const result = engine.act({ taskId: pendingTask(id).id, actionId: 'apply', user: ADMIN });
    expect(result.status).toBe(400);
    expect(outbox()).toEqual([]);
  });

  test('every workflow message carries its instance in the context', () => {
    const { id } = engine.start({ definitionId: 'facility-use', data: REQUEST, user: MEMBER });
    expect(outbox()[0].context).toContain(`workflow:${id}`);
  });
});
