// ─── Raising and reading notifications ────────────────────────────────────────
//
// Everything the site does that a person might want to know about comes
// through emit(). It does three things, in this order:
//
//   1. works out who the event concerns
//   2. writes an inbox row for each of them who wants one
//   3. queues an email for each of them who wants one now, and marks the rest
//      for their next digest
//
// The inbox is the record; email is one way of being told about it. That is
// why a person can turn every email off and still have a complete inbox, and
// why nothing is ever emailed that is not also in the inbox.

const db = require('../db');
const mailer = require('../mail/mailer');
const { getType, SUBJECT_TABS } = require('./types');
const preferences = require('./preferences');

const SITE_URL = process.env.NODE_ENV === 'production'
  ? 'https://capshaw.jblairkiel.com'
  : 'http://localhost:5173';

// ─── Who an event concerns ────────────────────────────────────────────────────

const MEMBER_ROLES = ['approved', 'worship-coordinator', 'admin'];

// Used when the caller does not name recipients: the audience declared on the
// type. 'targeted' types always name their own people, so they resolve to
// nobody here rather than quietly mailing the congregation.
function audienceFor(type) {
  if (type.audience === 'everyone') return db.prepare('SELECT * FROM users').all();
  if (type.audience === 'members') {
    return db.prepare(`SELECT * FROM users WHERE role IN (${MEMBER_ROLES.map(() => '?').join(',')})`).all(...MEMBER_ROLES);
  }
  if (type.audience === 'admins') return db.prepare("SELECT * FROM users WHERE role = 'admin'").all();
  return [];
}

function userById(id) {
  return id ? db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null : null;
}

// ─── Raising one ──────────────────────────────────────────────────────────────

const insertNotification = db.prepare(`
  INSERT INTO notifications
    (user_id, type, category, title, body, subject_type, subject_id, actor_user_id, actor_name, email_state)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

// title / body are what the person reads, in the inbox and in the email alike.
// `users` names the recipients for a targeted type; anything in `extraEmails`
// is a plain address with no account behind it (a distribution group), so it
// is emailed and has no inbox row.
function emit({
  type: typeId,
  title,
  body = '',
  subjectType = '',
  subjectId = null,
  actor = null,
  users = null,
  extraEmails = [],
  context = '',
  includeActor = false,
}) {
  const type = getType(typeId);
  if (!type) {
    console.error(`[notifications] unknown type "${typeId}" — nothing raised`);
    return { notified: [], queued: [], skipped: [] };
  }

  const recipients = dedupeUsers(users || audienceFor(type));
  const notified = [];
  const queued = [];
  const skipped = [];

  for (const user of recipients) {
    // Nobody is told about their own doing: the point of the inbox is what
    // other people did. A few things are records rather than news — the
    // outcome of a workflow reaches everyone it involved, whoever closed it —
    // and those pass includeActor.
    if (actor && user.id === actor.id && !includeActor) continue;

    const wanted = preferences.effective(user, typeId);
    if (!wanted) { skipped.push({ userId: user.id, reason: 'not-applicable' }); continue; }

    const emailMode = emailModeFor(user, wanted.email);
    if (!wanted.inApp && emailMode === 'off') { skipped.push({ userId: user.id, reason: 'opted-out' }); continue; }

    const emailState = emailMode === 'immediate' ? 'sent' : emailMode === 'digest' ? 'digest' : 'none';
    const { lastInsertRowid: id } = insertNotification.run(
      user.id, type.id, type.category, String(title).slice(0, 300), body,
      subjectType, subjectId, actor?.id ?? null, actor?.name || '', emailState
    );
    notified.push(id);

    if (emailMode === 'immediate') {
      queued.push(...mailer.enqueue({
        to: [{ email: user.email, name: user.name }],
        subject: title,
        body: emailBody({ body, subjectType, typeId }),
        context: context || `notification:${id}`,
      }));
    }
  }

  // Addresses with no account behind them cannot have preferences, so a
  // distribution group is written to as the group intends.
  if (extraEmails.length) {
    queued.push(...mailer.enqueue({
      to: extraEmails,
      subject: title,
      body: emailBody({ body, subjectType, typeId }),
      context: context || `notification:${typeId}`,
    }));
  }

  return { notified, queued, skipped };
}

function dedupeUsers(users) {
  const seen = new Set();
  return (users || []).filter(user => {
    if (!user?.id || seen.has(user.id)) return false;
    seen.add(user.id);
    return true;
  });
}

// The master switch beats every per-type choice, and somebody with no address
// on file can only be told in the app.
function emailModeFor(user, mode) {
  if (mode === 'off') return 'off';
  if (!user.email || !mailer.validAddress(user.email)) return 'off';
  if (user.email_enabled === 0) return 'off';
  return mode;
}

function emailBody({ body, subjectType, typeId }) {
  return [
    body,
    '',
    `See it on the dashboard: ${SITE_URL}${whereToLook(subjectType)}`,
    '',
    `You are getting this because of your "${getType(typeId)?.label || typeId}" setting.`,
    'Change what the site emails you under My Info → Notifications.',
  ].filter(part => part !== undefined).join('\n');
}

function whereToLook(subjectType) {
  const tab = SUBJECT_TABS[subjectType];
  return tab ? ` → ${tab}` : '';
}

// ─── Reading the inbox ────────────────────────────────────────────────────────

function inbox(user, { category = '', type = '', unread = false, limit = 50, before = null } = {}) {
  if (!user) return [];

  const clauses = ['user_id = ?'];
  const params = [user.id];
  if (category) { clauses.push('category = ?'); params.push(category); }
  if (type)     { clauses.push('type = ?');     params.push(type); }
  if (unread)   { clauses.push('read_at IS NULL'); }
  if (before)   { clauses.push('id < ?'); params.push(before); }

  const rows = db.prepare(`
    SELECT * FROM notifications
    WHERE ${clauses.join(' AND ')}
    ORDER BY id DESC
    LIMIT ?
  `).all(...params, Math.min(Math.max(Number(limit) || 50, 1), 200));

  return rows.map(present);
}

function present(row) {
  const type = getType(row.type);
  return {
    id:          row.id,
    type:        row.type,
    typeLabel:   type?.label || row.type,
    category:    row.category,
    title:       row.title,
    body:        row.body,
    subjectType: row.subject_type,
    subjectId:   row.subject_id,
    tab:         SUBJECT_TABS[row.subject_type] || '',
    actor:       row.actor_name,
    read:        !!row.read_at,
    createdAt:   row.created_at,
  };
}

// Unread counts per category and per type: what the inbox tabs and the header
// badge are drawn from.
function summary(user) {
  if (!user) return { unread: 0, categories: {}, types: {} };

  const rows = db.prepare(`
    SELECT category, type, COUNT(*) AS total, SUM(read_at IS NULL) AS unread
    FROM notifications WHERE user_id = ?
    GROUP BY category, type
  `).all(user.id);

  const categories = {};
  const types = {};
  let unread = 0;

  for (const row of rows) {
    const cat = categories[row.category] || (categories[row.category] = { total: 0, unread: 0 });
    cat.total  += row.total;
    cat.unread += row.unread;
    types[row.type] = { total: row.total, unread: row.unread };
    unread += row.unread;
  }

  return { unread, categories, types };
}

// ids — mark those; category — mark that drawer; neither — mark everything.
function markRead(user, { ids = null, category = '', read = true } = {}) {
  if (!user) return { changed: 0 };
  const value = read ? "datetime('now')" : 'NULL';

  if (Array.isArray(ids) && ids.length) {
    const clean = ids.map(Number).filter(Number.isInteger);
    if (!clean.length) return { changed: 0 };
    const result = db.prepare(
      `UPDATE notifications SET read_at = ${value} WHERE user_id = ? AND id IN (${clean.map(() => '?').join(',')})`
    ).run(user.id, ...clean);
    return { changed: result.changes };
  }

  const result = category
    ? db.prepare(`UPDATE notifications SET read_at = ${value} WHERE user_id = ? AND category = ?`).run(user.id, category)
    : db.prepare(`UPDATE notifications SET read_at = ${value} WHERE user_id = ?`).run(user.id);
  return { changed: result.changes };
}

module.exports = { emit, inbox, summary, markRead, audienceFor, userById, SITE_URL };
