jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const db            = require('../db');
const notifications = require('../notifications');
const preferences   = require('../notifications/preferences');
const digest        = require('../notifications/digest');

function addUser(name, email, columns = {}) {
  const { lastInsertRowid: id } = db.prepare(
    'INSERT INTO users (provider, provider_id, email, name, role) VALUES (?,?,?,?,?)'
  ).run('google', `${name}-id`, email, name, 'approved');
  const entries = Object.entries(columns);
  if (entries.length) {
    db.prepare(`UPDATE users SET ${entries.map(([c]) => `${c} = ?`).join(', ')} WHERE id = ?`)
      .run(...entries.map(([, v]) => v), id);
  }
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function outbox() {
  return db.prepare('SELECT * FROM mail_outbox ORDER BY id').all();
}

function waiting(user) {
  return db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND email_state = 'digest'")
    .get(user.id).n;
}

// A Wednesday, mid-afternoon: past a 7am digest hour, and not the Monday a
// weekly digest is set to.
const WEDNESDAY_3PM = new Date('2026-05-06T15:00:00');

let RAY;

beforeEach(() => {
  for (const t of ['notifications', 'notification_preferences', 'mail_outbox', 'users']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
  RAY = addUser('Ray Harris', 'ray@example.com');
});

describe('what the digest gathers', () => {
  test('everything saved for it goes out in one email, grouped by category', () => {
    notifications.emit({ type: 'announcement.posted', title: 'Potluck Sunday', body: 'Bring a dish' });
    notifications.emit({ type: 'event.posted',        title: 'Work day' });
    expect(waiting(RAY)).toBe(2);

    const result = digest.sweep({ now: WEDNESDAY_3PM });

    expect(result.sent).toEqual([{ userId: RAY.id, items: 2 }]);
    const messages = outbox();
    expect(messages).toHaveLength(1);
    expect(messages[0].subject).toContain('2 updates');
    expect(messages[0].body).toContain('Announcements (1)');
    expect(messages[0].body).toContain('Calendar events (1)');
    expect(messages[0].body).toContain('Bring a dish');
  });

  test('what has gone out is not gathered a second time', () => {
    notifications.emit({ type: 'announcement.posted', title: 'Potluck Sunday' });
    digest.sweep({ now: WEDNESDAY_3PM });

    expect(waiting(RAY)).toBe(0);
    expect(db.prepare('SELECT email_state FROM notifications WHERE user_id = ?').get(RAY.id).email_state).toBe('sent');

    // A day later, with nothing new, there is nothing to send.
    expect(digest.sweep({ now: new Date('2026-05-07T15:00:00') }).users).toBe(0);
    expect(outbox()).toHaveLength(1);
  });

  test('the digest leaves the inbox unread — it is a copy, not a receipt', () => {
    notifications.emit({ type: 'announcement.posted', title: 'Potluck Sunday' });
    digest.sweep({ now: WEDNESDAY_3PM });

    expect(notifications.summary(RAY).unread).toBe(1);
  });

  test('immediate and no-email notifications are never gathered into it', () => {
    notifications.emit({ type: 'announcement.urgent',  title: 'Burst pipe' });
    notifications.emit({ type: 'announcement.updated', title: 'Potluck moved' });

    expect(digest.sweep({ now: WEDNESDAY_3PM }).users).toBe(0);
    // The urgent one went straight out; the edit was inbox-only.
    expect(outbox().map(m => m.subject)).toEqual(['Burst pipe']);
  });
});

describe('when the digest is due', () => {
  test('not before the hour they asked for', () => {
    notifications.emit({ type: 'announcement.posted', title: 'Potluck' });

    expect(digest.sweep({ now: new Date('2026-05-06T06:00:00') }).users).toBe(0);
    expect(digest.sweep({ now: new Date('2026-05-06T07:30:00') }).users).toBe(1);
  });

  test('a weekly digest waits for its day', () => {
    preferences.save(RAY, { digest: { frequency: 'weekly', weekday: 1 } });
    notifications.emit({ type: 'announcement.posted', title: 'Potluck' });

    expect(digest.sweep({ now: WEDNESDAY_3PM }).users).toBe(0);                        // Wednesday
    expect(digest.sweep({ now: new Date('2026-05-11T09:00:00') }).users).toBe(1);      // the Monday
  });

  test('a second one does not follow hours after the first', () => {
    notifications.emit({ type: 'announcement.posted', title: 'Potluck' });
    digest.sweep({ now: WEDNESDAY_3PM });
    notifications.emit({ type: 'event.posted', title: 'Work day' });

    expect(digest.sweep({ now: new Date('2026-05-06T20:00:00') }).users).toBe(0);
    expect(digest.sweep({ now: new Date('2026-05-07T09:00:00') }).users).toBe(1);
  });

  test('somebody who has turned email off entirely gets none', () => {
    preferences.save(RAY, { emailEnabled: false });
    notifications.emit({ type: 'announcement.posted', title: 'Potluck' });

    expect(digest.sweep({ now: WEDNESDAY_3PM }).users).toBe(0);
  });

  test('each person is sent theirs on their own schedule', () => {
    const jo = addUser('Jo Harris', 'jo@example.com', { digest_hour: 20 });
    notifications.emit({ type: 'announcement.posted', title: 'Potluck' });

    const morning = digest.sweep({ now: new Date('2026-05-06T09:00:00') });
    expect(morning.sent.map(s => s.userId)).toEqual([RAY.id]);

    const evening = digest.sweep({ now: new Date('2026-05-06T21:00:00') });
    expect(evening.sent.map(s => s.userId)).toEqual([jo.id]);
  });
});
