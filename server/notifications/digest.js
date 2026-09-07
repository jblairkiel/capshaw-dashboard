// ─── The digest ───────────────────────────────────────────────────────────────
//
// Anything a person asked to have "saved for my digest" sits in their inbox
// with email_state = 'digest' until this runs. It gathers what has piled up
// into one email, grouped by category so it reads the way the inbox looks,
// and marks the rows sent so nothing goes twice.
//
// The sweep is safe to call as often as you like: a person is only due when
// their chosen hour has come round and they have not already had one today
// (or this week, if they chose weekly).

const db = require('../db');
const mailer = require('../mail/mailer');
const { CATEGORIES } = require('./types');
const { accountSettings } = require('./preferences');
const { SITE_URL } = require('./index');

const CATEGORY_LABEL = new Map(CATEGORIES.map(c => [c.id, c.label]));

// A digest is due when the clock has reached the hour they asked for, on the
// right day, and they have not already had one today. "Today" rather than a
// count of hours, so an evening digest followed by a morning one is still one
// a day; a weekly digest is limited to its weekday, which is one a week.
function isDue(user, now) {
  const { digest } = accountSettings(user);
  if (now.getHours() < digest.hour) return false;
  if (digest.frequency === 'weekly' && now.getDay() !== digest.weekday) return false;
  if (!user.last_digest_at) return true;

  // Stored in UTC, as SQLite writes it; compared as local days, as people
  // experience them.
  const last = new Date(`${user.last_digest_at.replace(' ', 'T')}Z`);
  if (Number.isNaN(last.getTime())) return true;
  return day(last) !== day(now);
}

function day(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function waiting(userId) {
  return db.prepare(`
    SELECT * FROM notifications
    WHERE user_id = ? AND email_state = 'digest'
    ORDER BY category ASC, id ASC
  `).all(userId);
}

function compose(rows) {
  const byCategory = new Map();
  for (const row of rows) {
    if (!byCategory.has(row.category)) byCategory.set(row.category, []);
    byCategory.get(row.category).push(row);
  }

  const sections = [...byCategory.entries()].flatMap(([category, items]) => [
    `${CATEGORY_LABEL.get(category) || category} (${items.length})`,
    ...items.flatMap(item => [
      `  • ${item.title}`,
      ...(item.body ? [indent(item.body)] : []),
    ]),
    '',
  ]);

  return [
    `Here is what happened on the dashboard since your last digest (${rows.length} item${rows.length === 1 ? '' : 's'}).`,
    '',
    ...sections,
    `Open the dashboard: ${SITE_URL}`,
    '',
    'This is a digest because of your notification settings.',
    'Change how often it comes, or turn it off, under My Info → Notifications.',
  ].join('\n');
}

function indent(text) {
  return String(text).split('\n').map(line => `      ${line}`).join('\n');
}

// Queues the digests that are due. Returns what it did, so a test — or an
// admin screen — can see it without a mail server being involved.
function sweep({ now = new Date() } = {}) {
  const candidates = db.prepare(`
    SELECT DISTINCT u.* FROM users u
    JOIN notifications n ON n.user_id = u.id AND n.email_state = 'digest'
    WHERE u.email_enabled = 1 AND u.email IS NOT NULL AND trim(u.email) <> ''
  `).all();

  const sent = [];
  for (const user of candidates) {
    if (!isDue(user, now)) continue;

    const rows = waiting(user.id);
    if (!rows.length) continue;

    mailer.enqueue({
      to: [{ email: user.email, name: user.name }],
      subject: `Capshaw dashboard digest — ${rows.length} update${rows.length === 1 ? '' : 's'}`,
      body: compose(rows),
      context: `digest:${user.id}`,
    });

    markSent(user.id, rows.map(r => r.id), now);
    sent.push({ userId: user.id, items: rows.length });
  }

  return { sent, users: sent.length };
}

// The sweep's own clock is what is recorded, not the database's, so a caller
// driving it with a given time — a test, or a catch-up run — leaves a record
// that agrees with what it decided.
const markSent = db.transaction((userId, ids, now) => {
  const update = db.prepare("UPDATE notifications SET email_state = 'sent' WHERE id = ?");
  for (const id of ids) update.run(id);
  db.prepare('UPDATE users SET last_digest_at = ? WHERE id = ?')
    .run(now.toISOString().slice(0, 19).replace('T', ' '), userId);
});

// Queue what is due, then try to send it. Kept apart from sweep() so a test
// can queue without touching the network.
async function run(options) {
  const result = sweep(options);
  if (result.users) await mailer.drainOutbox().catch(err => console.error('[mail] drain failed:', err.message));
  return result;
}

module.exports = { sweep, run, isDue, compose };
