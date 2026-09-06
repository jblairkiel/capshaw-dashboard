jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const request = require('supertest');
const express = require('express');
const db      = require('../db');
const router  = require('../routes/mailGroups');

function buildApp(user = null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/mail', router);
  return app;
}

const ADMIN  = { id: 1, role: 'admin' };
const MEMBER = { id: 2, role: 'approved' };

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  db.prepare('DELETE FROM mail_group_members').run();
  db.prepare('DELETE FROM mail_outbox').run();
  db.prepare('DELETE FROM directory').run();
  process.env = { ...ORIGINAL_ENV };
});

afterAll(() => { process.env = ORIGINAL_ENV; });

function addPerson(name, email = '') {
  const { lastInsertRowid: id } = db.prepare('INSERT INTO directory (name, email) VALUES (?, ?)').run(name, email);
  return id;
}

describe('access', () => {
  test('members and signed-out visitors are refused throughout', async () => {
    for (const user of [null, MEMBER]) {
      const res = await request(buildApp(user)).get('/api/mail/groups');
      expect([401, 403]).toContain(res.status);
    }
  });
});

describe('GET /api/mail/groups', () => {
  test('lists the groups with how many can actually be reached', async () => {
    const withAddress = addPerson('Ray Harris', 'ray@example.com');
    const without     = addPerson('Jo Harris');
    const elders = db.prepare("SELECT id FROM mail_groups WHERE key='elders'").get().id;
    db.prepare('INSERT INTO mail_group_members (group_id, directory_id) VALUES (?,?)').run(elders, withAddress);
    db.prepare('INSERT INTO mail_group_members (group_id, directory_id) VALUES (?,?)').run(elders, without);

    const res = await request(buildApp(ADMIN)).get('/api/mail/groups');
    expect(res.status).toBe(200);
    expect(res.body.groups).toHaveLength(11);

    const group = res.body.groups.find(g => g.key === 'elders');
    expect(group).toMatchObject({ memberCount: 2, reachable: 1 });
    expect(group.missing).toEqual(['Jo Harris']);
  });

  test('reports the test redirect so the UI can warn about it', async () => {
    const res = await request(buildApp(ADMIN)).get('/api/mail/groups');
    expect(res.body.mail).toMatchObject({ redirecting: true, redirectTo: 'jblairkiel@gmail.com' });
  });
});

describe('membership', () => {
  test('adds and removes a directory person', async () => {
    const ray = addPerson('Ray Harris', 'ray@example.com');

    const added = await request(buildApp(ADMIN))
      .post('/api/mail/groups/elders/members')
      .send({ directoryId: ray });
    expect(added.status).toBe(200);
    expect(added.body.members).toHaveLength(1);

    const memberId = added.body.members[0].id;
    const removed = await request(buildApp(ADMIN)).delete(`/api/mail/groups/elders/members/${memberId}`);
    expect(removed.status).toBe(200);
    expect(removed.body.members).toEqual([]);
  });

  test('adds a plain address', async () => {
    const res = await request(buildApp(ADMIN))
      .post('/api/mail/groups/men/members')
      .send({ email: 'visitor@example.com' });
    expect(res.body.members[0].email).toBe('visitor@example.com');
  });

  test('refuses a bad address', async () => {
    const res = await request(buildApp(ADMIN))
      .post('/api/mail/groups/men/members')
      .send({ email: 'not-an-address' });
    expect(res.status).toBe(400);
  });

  test('404s on a group that does not exist', async () => {
    const res = await request(buildApp(ADMIN)).get('/api/mail/groups/no-such-group');
    expect(res.status).toBe(404);
  });

  test('only offers directory people who have an address', async () => {
    addPerson('Ray Harris', 'ray@example.com');
    addPerson('No Address');

    const res = await request(buildApp(ADMIN)).get('/api/mail/groups/elders');
    expect(res.body.candidates.map(c => c.name)).toEqual(['Ray Harris']);
  });
});

describe('outbox', () => {
  test('shows what was queued, with counts', async () => {
    db.prepare("INSERT INTO mail_outbox (to_email, subject, status) VALUES (?,?,'pending')")
      .run('jblairkiel@gmail.com', 'Action needed: Kitchen');
    db.prepare("INSERT INTO mail_outbox (to_email, subject, status) VALUES (?,?,'sent')")
      .run('jblairkiel@gmail.com', 'Approved: Kitchen');

    const res = await request(buildApp(ADMIN)).get('/api/mail/outbox');
    expect(res.body.counts).toEqual({ pending: 1, sent: 1 });
    expect(res.body.messages).toHaveLength(2);
  });

  test('a manual send leaves messages queued when no server is configured', async () => {
    delete process.env.SMTP_HOST;
    db.prepare("INSERT INTO mail_outbox (to_email, subject) VALUES (?,?)").run('jblairkiel@gmail.com', 'Queued');

    const res = await request(buildApp(ADMIN)).post('/api/mail/outbox/send');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ sent: 0, skipped: 1 });
    expect(db.prepare('SELECT status FROM mail_outbox').get().status).toBe('pending');
  });
});
