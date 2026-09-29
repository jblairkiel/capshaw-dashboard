jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const request = require('supertest');
const express = require('express');
const db      = require('../db');
const router  = require('../routes/emails');

function buildApp(user = null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/emails', router);
  return app;
}

const ADMIN   = { id: 1, role: 'admin' };
const MEMBER  = { id: 2, role: 'approved' };
const PENDING = { id: 3, role: 'pending' };

const ORIGINAL_ENV = { ...process.env };

function queue(context, { subject = 'Hello', status = 'pending', body = 'Body', to = 'ray@example.com', sentDaysAgo = null } = {}) {
  const sentAt = sentDaysAgo === null ? null : db.prepare("SELECT datetime('now', ?) AS t").get(`-${sentDaysAgo} days`).t;
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO mail_outbox (to_email, subject, body, context, status, sent_at) VALUES (?, ?, ?, ?, ?, ?)
  `).run(to, subject, body, context, status, sentAt);
  return lastInsertRowid;
}

beforeEach(() => {
  db.prepare('DELETE FROM mail_outbox').run();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.SMTP_HOST;
});

afterAll(() => { process.env = ORIGINAL_ENV; });

describe('access', () => {
  test('only admins and whoever looks after Email Groups may look', async () => {
    for (const user of [null, MEMBER, PENDING]) {
      const res = await request(buildApp(user)).get('/api/emails/catalog');
      expect([401, 403]).toContain(res.status);
    }
    expect((await request(buildApp(ADMIN)).get('/api/emails/catalog')).status).toBe(200);
  });
});

describe('the catalogue', () => {
  test('lists every email under its tab, in the order the page shows them', async () => {
    const res = await request(buildApp(ADMIN)).get('/api/emails/catalog');
    expect(res.body.categories.map(c => c.id)).toEqual(['notifications', 'bulletin', 'groups', 'reports']);
    const groups = res.body.categories.find(c => c.id === 'groups');
    expect(groups.emails.map(e => e.name)).toEqual(['Meeting posted', 'Meeting cancelled', 'Meeting changed']);
  });

  test('counts what each email has done: sent this month, waiting, failed', async () => {
    queue('group-event:5:cancelled', { status: 'sent', sentDaysAgo: 3 });
    queue('group-event:6:cancelled', { status: 'sent', sentDaysAgo: 45 });
    queue('group-event:7:cancelled', { status: 'pending' });
    queue('group-event:8:cancelled', { status: 'failed' });
    queue('group-event:8:published', { status: 'sent', sentDaysAgo: 1 });

    const res = await request(buildApp(ADMIN)).get('/api/emails/catalog');
    const cancelled = res.body.categories.find(c => c.id === 'groups').emails.find(e => e.id === 'group-cancelled');
    expect(cancelled).toMatchObject({ sent30: 1, pending: 1, failed: 1 });
    expect(cancelled.last).toBeTruthy();
  });

  test('anything that fits no entry is counted separately rather than lost', async () => {
    queue('something:new');
    const res = await request(buildApp(ADMIN)).get('/api/emails/catalog');
    expect(res.body.uncategorised).toBe(1);
  });

  test('says when mail is being redirected to the test account', async () => {
    const res = await request(buildApp(ADMIN)).get('/api/emails/catalog');
    expect(res.body.redirect).toBe('jblairkiel@gmail.com');
  });
});

describe('previews', () => {
  test('shows an email as its template writes it, with made-up details', async () => {
    const res = await request(buildApp(ADMIN)).get('/api/emails/catalog/group-cancelled/preview');
    expect(res.body.subject).toBe('Cancelled — Sample Group: Fellowship meal');
    expect(res.body.body).toContain("Sample Group's meeting is off.");
  });

  test('every entry in the catalogue can be previewed', async () => {
    const catalog = (await request(buildApp(ADMIN)).get('/api/emails/catalog')).body;
    for (const email of catalog.categories.flatMap(c => c.emails)) {
      const res = await request(buildApp(ADMIN)).get(`/api/emails/catalog/${email.id}/preview`);
      expect(res.status).toBe(200);
      expect(res.body.subject).toBeTruthy();
      expect(res.body.body.length).toBeGreaterThan(20);
    }
  });

  test('an unknown email is a 404', async () => {
    expect((await request(buildApp(ADMIN)).get('/api/emails/catalog/nope/preview')).status).toBe(404);
  });
});

describe('history', () => {
  test('filters to one tab', async () => {
    queue('account:verify', { subject: 'Confirm' });
    queue('group-event:1:published', { subject: 'Meeting' });
    queue('workflow:3:monthly-report', { subject: 'Schedule' });

    const res = await request(buildApp(ADMIN)).get('/api/emails/history?category=groups');
    expect(res.body.messages.map(m => m.subject)).toEqual(['Meeting']);
    expect(res.body.messages[0]).toMatchObject({ category: 'groups', emailId: 'group-posted', emailName: 'Meeting posted' });
  });

  test('keeps a workflow task and a workflow report on their own tabs', async () => {
    queue('workflow:3:task:9', { subject: 'Task' });
    queue('workflow:3:schedule', { subject: 'Your jobs' });

    const notes = await request(buildApp(ADMIN)).get('/api/emails/history?category=notifications');
    const reports = await request(buildApp(ADMIN)).get('/api/emails/history?category=reports');
    expect(notes.body.messages.map(m => m.subject)).toEqual(['Task']);
    expect(reports.body.messages.map(m => m.subject)).toEqual(['Your jobs']);
  });

  test('filters by one email, by status, and by search text', async () => {
    queue('group-event:1:published', { subject: 'Games night', status: 'sent', sentDaysAgo: 1 });
    queue('group-event:2:published', { subject: 'Devotional', status: 'failed' });
    queue('group-event:3:cancelled', { subject: 'Games night off', status: 'failed' });

    const one = await request(buildApp(ADMIN)).get('/api/emails/history?email=group-posted&status=failed');
    expect(one.body.messages.map(m => m.subject)).toEqual(['Devotional']);

    const search = await request(buildApp(ADMIN)).get('/api/emails/history?q=games');
    expect(search.body.messages.map(m => m.subject).sort()).toEqual(['Games night', 'Games night off']);
  });

  test('pages through a long history, newest first', async () => {
    for (let i = 0; i < 55; i++) queue('account:verify', { subject: `Message ${i}` });
    const first = await request(buildApp(ADMIN)).get('/api/emails/history');
    const second = await request(buildApp(ADMIN)).get('/api/emails/history?page=2');
    expect(first.body).toMatchObject({ total: 55, pageSize: 50 });
    expect(first.body.messages[0].subject).toBe('Message 54');
    expect(second.body.messages).toHaveLength(5);
  });

  test('rejects a tab, email or status that does not exist', async () => {
    for (const q of ['category=nope', 'email=nope', 'status=nope']) {
      expect((await request(buildApp(ADMIN)).get(`/api/emails/history?${q}`)).status).toBe(400);
    }
  });

  test('opens one message, with any sign-up confirmation link hidden', async () => {
    const id = queue('account:verify', { body: 'Open this: https://example.org/api/auth/verify-email?token=abc123secret\nThanks' });
    const res = await request(buildApp(ADMIN)).get(`/api/emails/history/${id}`);
    expect(res.body.message.body).toContain('token=[hidden]');
    expect(res.body.message.body).not.toContain('abc123secret');
    expect(res.body.message).toMatchObject({ category: 'notifications', emailId: 'account-confirm' });
  });

  test('a message that does not exist is a 404', async () => {
    expect((await request(buildApp(ADMIN)).get('/api/emails/history/999')).status).toBe(404);
  });
});

describe('sending now', () => {
  test('leaves messages waiting when no mail server is configured', async () => {
    queue('account:verify');
    const res = await request(buildApp(ADMIN)).post('/api/emails/send-now');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ sent: 0, skipped: 1 });
    expect(db.prepare('SELECT status FROM mail_outbox').get().status).toBe('pending');
  });
});
