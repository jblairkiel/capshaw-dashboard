jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const request       = require('supertest');
const express       = require('express');
const db            = require('../db');
const notifications = require('../notifications');
const preferences   = require('../notifications/preferences');
const router        = require('../routes/notifications');
const announcementRouter = require('../routes/announcements');

function buildApp(user = null, mounted = router, at = '/api/notifications') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use(at, mounted);
  return app;
}

function addUser(name, role, email = null) {
  const { lastInsertRowid: id } = db.prepare(
    'INSERT INTO users (provider, provider_id, email, name, role) VALUES (?,?,?,?,?)'
  ).run('google', `${name}-id`, email, name, role);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function reload(user) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
}

function outbox() {
  return db.prepare('SELECT * FROM mail_outbox ORDER BY id').all();
}

function rowsFor(user) {
  return db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id').all(user.id);
}

let RAY, JO, ADA;

beforeEach(() => {
  for (const t of ['notifications', 'notification_preferences', 'mail_outbox', 'announcements', 'users']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
  RAY = addUser('Ray Harris', 'approved', 'ray@example.com');
  JO  = addUser('Jo Harris',  'approved', 'jo@example.com');
  ADA = addUser('Ada Admin',  'admin',    'ada@example.com');
});

// ─── Raising one ──────────────────────────────────────────────────────────────

describe('emit', () => {
  test('an immediate type lands in the inbox and in the outbox at once', () => {
    notifications.emit({ type: 'announcement.urgent', title: 'Burst pipe', body: 'No water today' });

    expect(rowsFor(RAY)[0]).toMatchObject({ type: 'announcement.urgent', category: 'announcements', email_state: 'sent' });
    expect(outbox().map(m => m.intended_for).sort())
      .toEqual(['ada@example.com', 'jo@example.com', 'ray@example.com']);
  });

  test('a digest type lands in the inbox and waits for the digest', () => {
    notifications.emit({ type: 'announcement.posted', title: 'Potluck Sunday' });

    expect(rowsFor(RAY)[0].email_state).toBe('digest');
    expect(outbox()).toEqual([]);
  });

  test('a type defaulting to no email is in the inbox only', () => {
    notifications.emit({ type: 'announcement.updated', title: 'Potluck moved' });

    expect(rowsFor(RAY)[0].email_state).toBe('none');
    expect(outbox()).toEqual([]);
  });

  test('the person who did it is not told about their own doing', () => {
    notifications.emit({ type: 'announcement.posted', title: 'Potluck', actor: ADA });
    expect(rowsFor(ADA)).toEqual([]);
    expect(rowsFor(RAY)).toHaveLength(1);
  });

  test('somebody with no address on file still gets the inbox row', () => {
    const silent = addUser('Sam Silent', 'approved');
    notifications.emit({ type: 'announcement.urgent', title: 'Burst pipe' });

    expect(rowsFor(silent)[0].email_state).toBe('none');
    expect(outbox().map(m => m.intended_for)).not.toContain(null);
  });

  test('the master email switch beats every per-type choice', () => {
    preferences.save(RAY, { emailEnabled: false });
    notifications.emit({ type: 'announcement.urgent', title: 'Burst pipe' });

    expect(rowsFor(reload(RAY))[0].email_state).toBe('none');
    expect(outbox().map(m => m.intended_for)).not.toContain('ray@example.com');
  });

  test('turning a type off entirely leaves no inbox row either', () => {
    preferences.save(RAY, { types: { 'announcement.posted': { inApp: false, email: 'off' } } });
    notifications.emit({ type: 'announcement.posted', title: 'Potluck' });

    expect(rowsFor(reload(RAY))).toEqual([]);
    expect(rowsFor(JO)).toHaveLength(1);
  });

  test('an admin-only type reaches admins alone', () => {
    notifications.emit({ type: 'admin.user_pending', title: 'Somebody is waiting' });

    expect(rowsFor(ADA)).toHaveLength(1);
    expect(rowsFor(RAY)).toEqual([]);
  });

  test('a targeted type reaches only the people named', () => {
    notifications.emit({ type: 'workflow.task', title: 'Action needed', users: [JO] });

    expect(rowsFor(JO)).toHaveLength(1);
    expect(rowsFor(RAY)).toEqual([]);
  });

  test('an address with no account behind it is emailed but has no inbox row', () => {
    notifications.emit({
      type: 'workflow.completed',
      title: 'Approved: Kitchen',
      users: [],
      extraEmails: [{ email: 'elders@example.com', name: 'Elders' }],
    });

    expect(outbox().map(m => m.intended_for)).toEqual(['elders@example.com']);
    expect(db.prepare('SELECT COUNT(*) AS n FROM notifications').get().n).toBe(0);
  });

  test('an unknown type raises nothing rather than throwing', () => {
    expect(() => notifications.emit({ type: 'nonsense.type', title: 'Hi' })).not.toThrow();
    expect(db.prepare('SELECT COUNT(*) AS n FROM notifications').get().n).toBe(0);
  });

  test('the email says which setting brought it and where to change that', () => {
    notifications.emit({ type: 'announcement.urgent', title: 'Burst pipe', body: 'No water' });
    const [message] = outbox();

    expect(message.body).toContain('No water');
    expect(message.body).toContain('My Info → Notifications');
  });
});

// ─── The inbox ────────────────────────────────────────────────────────────────

describe('the inbox', () => {
  beforeEach(() => {
    notifications.emit({ type: 'announcement.posted', title: 'Potluck' });
    notifications.emit({ type: 'event.posted',        title: 'Work day' });
    notifications.emit({ type: 'comment.reply',       title: 'Jo replied', users: [RAY] });
  });

  test('is newest first and knows what has not been read', () => {
    const items = notifications.inbox(RAY);
    expect(items.map(i => i.title)).toEqual(['Jo replied', 'Work day', 'Potluck']);
    expect(items.every(i => i.read === false)).toBe(true);
  });

  test('can be narrowed to one category or one type', () => {
    expect(notifications.inbox(RAY, { category: 'events' }).map(i => i.title)).toEqual(['Work day']);
    expect(notifications.inbox(RAY, { type: 'comment.reply' }).map(i => i.title)).toEqual(['Jo replied']);
  });

  test('counts unread by category and by type', () => {
    const summary = notifications.summary(RAY);
    expect(summary.unread).toBe(3);
    expect(summary.categories.comments).toEqual({ total: 1, unread: 1 });
    expect(summary.types['event.posted']).toEqual({ total: 1, unread: 1 });
  });

  test('marking one drawer read leaves the others alone', () => {
    notifications.markRead(RAY, { category: 'comments' });

    const summary = notifications.summary(RAY);
    expect(summary.unread).toBe(2);
    expect(summary.categories.comments.unread).toBe(0);
  });

  test('marking everything read clears the count, and one can be put back', () => {
    notifications.markRead(RAY);
    expect(notifications.summary(RAY).unread).toBe(0);

    const [newest] = notifications.inbox(RAY);
    notifications.markRead(RAY, { ids: [newest.id], read: false });
    expect(notifications.summary(RAY).unread).toBe(1);
  });

  test('one person cannot mark another person’s notifications read', () => {
    const [mine] = notifications.inbox(RAY);
    notifications.markRead(JO, { ids: [mine.id] });
    expect(notifications.inbox(RAY)[0].read).toBe(false);
  });
});

// ─── The routes ───────────────────────────────────────────────────────────────

describe('the routes', () => {
  test('the inbox takes a sign-in', async () => {
    const res = await request(buildApp(null)).get('/api/notifications');
    expect(res.status).toBe(401);
  });

  test('GET / hands back the items, the counts and the drawers in one trip', async () => {
    notifications.emit({ type: 'announcement.posted', title: 'Potluck' });

    const res = await request(buildApp(RAY)).get('/api/notifications');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.summary.unread).toBe(1);
    expect(res.body.categories.find(c => c.id === 'announcements')).toMatchObject({ unread: 1, label: 'Announcements' });
  });

  test('?unread=1 hides what has been read', async () => {
    notifications.emit({ type: 'announcement.posted', title: 'Potluck' });
    notifications.markRead(RAY);

    const res = await request(buildApp(RAY)).get('/api/notifications').query({ unread: '1' });
    expect(res.body.items).toEqual([]);
  });

  test('POST /read marks what it is given and returns the new counts', async () => {
    notifications.emit({ type: 'announcement.posted', title: 'Potluck' });
    const [item] = notifications.inbox(RAY);

    const res = await request(buildApp(RAY)).post('/api/notifications/read').send({ ids: [item.id] });
    expect(res.body).toMatchObject({ changed: 1, summary: { unread: 0 } });
  });
});

// ─── Preferences ──────────────────────────────────────────────────────────────

describe('preferences', () => {
  test('a fresh account is described by the defaults, with nothing stored', async () => {
    const res = await request(buildApp(RAY)).get('/api/notifications/preferences');
    const comments = res.body.settings.categories.find(c => c.id === 'comments');
    const reply = comments.types.find(t => t.id === 'comment.reply');

    expect(reply).toMatchObject({ email: 'immediate', inApp: true, customised: false });
    expect(db.prepare('SELECT COUNT(*) AS n FROM notification_preferences').get().n).toBe(0);
  });

  test('the admin category is only offered to admins', async () => {
    const asMember = await request(buildApp(RAY)).get('/api/notifications/preferences');
    const asAdmin  = await request(buildApp(ADA)).get('/api/notifications/preferences');

    expect(asMember.body.settings.categories.map(c => c.id)).not.toContain('admin');
    expect(asAdmin.body.settings.categories.map(c => c.id)).toContain('admin');
  });

  test('one type can be changed without resending the rest', async () => {
    const res = await request(buildApp(RAY))
      .put('/api/notifications/preferences')
      .send({ types: { 'comment.posted': { email: 'off' } } });

    const comments = res.body.settings.categories.find(c => c.id === 'comments');
    expect(comments.types.find(t => t.id === 'comment.posted')).toMatchObject({ email: 'off', inApp: true });
    expect(comments.types.find(t => t.id === 'comment.reply').email).toBe('immediate');
  });

  test('the digest schedule is saved', async () => {
    const res = await request(buildApp(RAY))
      .put('/api/notifications/preferences')
      .send({ digest: { frequency: 'weekly', hour: 18, weekday: 0 } });

    expect(res.body.settings.account.digest).toEqual({ frequency: 'weekly', hour: 18, weekday: 0 });
  });

  test('an unknown type, mode, hour or frequency is refused and nothing is written', async () => {
    const bad = [
      { types: { 'no.such.type': { email: 'off' } } },
      { types: { 'comment.reply': { email: 'sometimes' } } },
      { digest: { hour: 25 } },
      { digest: { frequency: 'fortnightly' } },
    ];

    for (const payload of bad) {
      const res = await request(buildApp(RAY)).put('/api/notifications/preferences').send(payload);
      expect(res.status).toBe(400);
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM notification_preferences').get().n).toBe(0);
  });

  test('a member cannot set a preference for a type only admins can receive', async () => {
    const res = await request(buildApp(RAY))
      .put('/api/notifications/preferences')
      .send({ types: { 'admin.user_pending': { email: 'immediate' } } });

    expect(res.status).toBe(400);
  });

  test('the monthly summary agrees with the old My Info switch, both ways round', async () => {
    await request(buildApp(RAY))
      .put('/api/notifications/preferences')
      .send({ types: { 'worship.monthly_report': { email: 'off' } } });
    expect(reload(RAY).wants_monthly_report).toBe(0);

    db.prepare('UPDATE users SET wants_monthly_report = 1 WHERE id = ?').run(RAY.id);
    const res = await request(buildApp(reload(RAY))).get('/api/notifications/preferences');
    const worship = res.body.settings.categories.find(c => c.id === 'worship');
    expect(worship.types.find(t => t.id === 'worship.monthly_report').email).toBe('immediate');
  });
});

// ─── Site activity raises them ────────────────────────────────────────────────

describe('activity around the site', () => {
  function post(user, item) {
    return request(buildApp(user, announcementRouter, '/api/announcements')).post('/api/announcements').send(item);
  }

  test('a new announcement, an urgent one and a new event each raise their own type', async () => {
    await post(ADA, { type: 'announcement', title: 'Potluck' });
    await post(ADA, { type: 'announcement', title: 'Burst pipe', priority: 'urgent' });
    await post(ADA, { type: 'event', title: 'Work day', event_date: '2026-05-01' });

    expect(rowsFor(RAY).map(n => n.type))
      .toEqual(['announcement.posted', 'announcement.urgent', 'event.posted']);
  });

  test('an event carries its date and place into the notification', async () => {
    await post(ADA, { type: 'event', title: 'Work day', event_date: '2026-05-01', event_time: '8:00 AM', location: 'Fellowship Hall' });

    const [row] = rowsFor(RAY);
    expect(row.body).toContain('When: 2026-05-01 8:00 AM');
    expect(row.body).toContain('Where: Fellowship Hall');
    expect(row.subject_type).toBe('event');
  });

  test('editing an announcement is its own quieter type', async () => {
    const created = await post(ADA, { type: 'announcement', title: 'Potluck' });
    db.prepare('DELETE FROM notifications').run();

    await request(buildApp(ADA, announcementRouter, '/api/announcements'))
      .put(`/api/announcements/${created.body.item.id}`)
      .send({ type: 'announcement', title: 'Potluck moved to the 8th' });

    expect(rowsFor(RAY).map(n => n.type)).toEqual(['announcement.updated']);
  });

  test('taking an event down tells people it is cancelled', async () => {
    const created = await post(ADA, { type: 'event', title: 'Work day' });
    db.prepare('DELETE FROM notifications').run();

    await request(buildApp(ADA, announcementRouter, '/api/announcements'))
      .patch(`/api/announcements/${created.body.item.id}/toggle`);

    expect(rowsFor(RAY).map(n => n.type)).toEqual(['event.cancelled']);
  });
});
