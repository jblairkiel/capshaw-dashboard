jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const db     = require('../db');
const mailer = require('../mail/mailer');
const groups = require('../lib/churchGroups');
const notify = require('../mail/notify');

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
  for (const t of ['mail_outbox', 'mail_group_members', 'mail_groups', 'church_group_members', 'church_groups',
                   'workflow_participants', 'workflow_events', 'workflow_tasks', 'workflow_instances',
                   'job_assignments', 'visitors', 'users', 'directory']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
  process.env = { ...ORIGINAL_ENV };
  delete process.env.SMTP_HOST;
  delete process.env.MAIL_REDIRECT_TO;
  process.env.NODE_ENV = 'test';
  mailer.resetTransport();
});

afterAll(() => { process.env = ORIGINAL_ENV; });

// Every generated email used to end with a fake breadcrumb like
// "capshaw.jblairkiel.com → My Info → Workflows & Inbox" — text nobody could
// click. These check the real thing: a URL the app reads back on load to land
// a reader on the exact page, and where it makes sense, the exact thing.

describe('email links land on the right page', () => {
  test('a task assignment links straight to that workflow in the inbox', () => {
    const person = addPerson('Ray Harris', 'ray@example.com');
    addUser('Ray Harris', 'approved', 'ray@example.com', person.id);

    notify.taskAssigned({
      instance: { id: 42, title: 'New member: Ray Harris' },
      definition: { title: 'New Member', steps: { greet: { title: 'Say hello' } } },
      task: { id: 1, step_id: 'greet', assignee_role: 'approved' },
    });

    const [row] = outbox();
    expect(row.body).toContain('http://localhost:5173/?page=inbox&workflow=42');
  });

  test('a workflow finishing links to that same workflow', () => {
    const creator = addUser('Jo Admin', 'admin', 'jo@example.com');

    notify.workflowCompleted({
      instance: { id: 7, title: 'New member: Ray Harris', created_by: creator.id },
      definition: { title: 'New Member', outcomes: { approved: { label: 'Approved' } } },
      outcomeId: 'approved',
      actorName: 'Jo Admin',
    });

    const [row] = outbox();
    expect(row.body).toContain('http://localhost:5173/?page=inbox&workflow=7');
  });

  test('a published schedule links to the assignments page', () => {
    addPerson('Ray Harris', 'ray@example.com');

    notify.schedulePublished({
      draft: { month: 'March 2026', rows: [{ name: 'Ray Harris', date: '2026-03-01', service: 'AM', job: 'Usher' }] },
      instanceId: 5,
    });

    const [row] = outbox();
    expect(row.body).toContain('http://localhost:5173/?page=assignments');
  });

  test('the monthly report links to the assignments page', () => {
    addUser('Ray Harris', 'approved', 'ray@example.com');
    db.prepare('UPDATE users SET wants_monthly_report = 1').run();

    notify.monthlyReport({
      draft: { month: 'March 2026', rows: [{ date: '2026-03-01', service: 'AM', job: 'Usher', name: 'Ray Harris' }] },
      instanceId: 5,
    });

    const [row] = outbox();
    expect(row.body).toContain('http://localhost:5173/?page=assignments');
  });

  test('a changed group meeting links to that group and that meeting', () => {
    const group = groups.createGroup({ name: 'North Harvest' }).group;
    const event = { id: 99, title: 'Small group', date: '2026-03-01' };

    notify.groupEventChanged({
      group,
      event,
      attendees: [{ email: 'jo@example.com', name: 'Jo' }],
      what: 'Moved half an hour later.',
    });

    const [row] = outbox();
    expect(row.body).toContain(`http://localhost:5173/?page=groups&group=${group.id}&event=99`);
  });

  test('a published group meeting links to that group and that meeting', () => {
    const leader = addPerson('Ray Harris', 'ray@example.com');
    const group = groups.createGroup({ name: 'North Harvest' }).group;
    groups.addMember(group.id, { directoryId: leader.id, role: 'leader' });

    const event = { id: 12, title: 'Small group', date: '2026-03-01' };
    notify.groupEventPublished({ group, event });

    const [row] = outbox();
    expect(row.body).toContain(`http://localhost:5173/?page=groups&group=${group.id}&event=12`);
  });

  test('a cancelled group meeting links to that group and that meeting', () => {
    const leader = addPerson('Ray Harris', 'ray@example.com');
    const group = groups.createGroup({ name: 'North Harvest' }).group;
    groups.addMember(group.id, { directoryId: leader.id, role: 'leader' });

    const event = { id: 13, title: 'Small group', date: '2026-03-01' };
    notify.groupEventCancelled({ group, event });

    const [row] = outbox();
    expect(row.body).toContain(`http://localhost:5173/?page=groups&group=${group.id}&event=13`);
  });
});
