// ─── Comments on announcements and calendar events ────────────────────────────
//
// Both kinds of subject are rows in `announcements` — the type column tells an
// announcement from a calendar event — so one comments table serves both, and
// the subject_type is carried through to the notification so the inbox can
// group an event's conversation apart from an announcement's.
//
// Threads are one level deep on purpose: a reply to a reply is attached to the
// comment that started the branch rather than nesting forever.

const db = require('../db');
const notifications = require('../notifications');

const SUBJECT_TYPES = ['announcement', 'event'];
const MAX_BODY = 4000;

// ─── Subjects ─────────────────────────────────────────────────────────────────

// A subject only exists if the row is there *and* is of the kind asked for, so
// /event/12 cannot be used to comment on announcement 12.
function subject(subjectType, subjectId) {
  if (!SUBJECT_TYPES.includes(subjectType)) return null;
  const id = Number(subjectId);
  if (!Number.isInteger(id) || id <= 0) return null;

  const row = db.prepare('SELECT * FROM announcements WHERE id = ? AND type = ?').get(id, subjectType);
  return row || null;
}

function subjectLabel(row) {
  return row.type === 'event' ? `the event “${row.title}”` : `“${row.title}”`;
}

// ─── Reading ──────────────────────────────────────────────────────────────────

function list(subjectType, subjectId, viewer) {
  const rows = db.prepare(`
    SELECT c.*, u.name AS author_name, u.photo AS author_photo, u.role AS author_role
    FROM comments c
    JOIN users u ON u.id = c.user_id
    WHERE c.subject_type = ? AND c.subject_id = ?
    ORDER BY c.id ASC
  `).all(subjectType, Number(subjectId));

  return rows.map(row => present(row, viewer));
}

function present(row, viewer) {
  const deleted = !!row.deleted_at;
  const mine = !!viewer && viewer.id === row.user_id;

  return {
    id:        row.id,
    parentId:  row.parent_id,
    body:      deleted ? '' : row.body,
    deleted,
    author:    { id: row.user_id, name: row.author_name, photo: row.author_photo || '' },
    createdAt: row.created_at,
    editedAt:  row.edited_at,
    // An author may fix their own wording; an admin may take anything down,
    // which is the only moderation this needs.
    canEdit:   !deleted && mine,
    canDelete: !deleted && (mine || viewer?.role === 'admin'),
  };
}

function countsFor(subjectType, ids) {
  if (!ids.length) return {};
  const rows = db.prepare(`
    SELECT subject_id, COUNT(*) AS total
    FROM comments
    WHERE subject_type = ? AND deleted_at IS NULL AND subject_id IN (${ids.map(() => '?').join(',')})
    GROUP BY subject_id
  `).all(subjectType, ...ids);
  return Object.fromEntries(rows.map(r => [r.subject_id, r.total]));
}

// ─── Following a thread ───────────────────────────────────────────────────────

function subscriptionState(subjectType, subjectId, userId) {
  const row = db.prepare(`
    SELECT state FROM comment_subscriptions
    WHERE subject_type = ? AND subject_id = ? AND user_id = ?
  `).get(subjectType, Number(subjectId), userId);
  return row?.state || 'none';
}

function setSubscription(subjectType, subjectId, userId, state) {
  if (!['on', 'off'].includes(state)) return { error: 'Subscription state must be "on" or "off"' };
  db.prepare(`
    INSERT INTO comment_subscriptions (subject_type, subject_id, user_id, state)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(subject_type, subject_id, user_id) DO UPDATE SET state = excluded.state
  `).run(subjectType, Number(subjectId), userId, state);
  return { state };
}

// Commenting is how you come to follow a thread — but never re-subscribes
// somebody who deliberately muted it.
function followByCommenting(subjectType, subjectId, userId) {
  if (subscriptionState(subjectType, subjectId, userId) !== 'none') return;
  setSubscription(subjectType, subjectId, userId, 'on');
}

function followers(subjectType, subjectId) {
  return db.prepare(`
    SELECT u.* FROM comment_subscriptions s
    JOIN users u ON u.id = s.user_id
    WHERE s.subject_type = ? AND s.subject_id = ? AND s.state = 'on'
  `).all(subjectType, Number(subjectId));
}

function muted(subjectType, subjectId) {
  const rows = db.prepare(`
    SELECT user_id FROM comment_subscriptions
    WHERE subject_type = ? AND subject_id = ? AND state = 'off'
  `).all(subjectType, Number(subjectId));
  return new Set(rows.map(r => r.user_id));
}

// ─── Mentions ─────────────────────────────────────────────────────────────────

// "@Ray Harris, can you open up?" tells Ray. Matching is done against the
// names of accounts rather than by parsing the text into words, so a name with
// a space in it — which is most of them — works.
function mentionedUsers(body) {
  if (!body.includes('@')) return [];
  const haystack = body.toLowerCase();
  return db.prepare('SELECT * FROM users').all()
    .filter(user => user.name && haystack.includes(`@${user.name.toLowerCase()}`));
}

// ─── Writing ──────────────────────────────────────────────────────────────────

function add({ subjectType, subjectId, user, body, parentId = null }) {
  const row = subject(subjectType, subjectId);
  if (!row) return { error: 'There is nothing here to comment on', status: 404 };

  const text = String(body ?? '').trim();
  if (!text) return { error: 'A comment cannot be empty', status: 400 };
  if (text.length > MAX_BODY) return { error: `A comment cannot be longer than ${MAX_BODY} characters`, status: 400 };

  // A reply attaches to the comment that started the branch, so a thread is
  // always at most one level deep.
  let parent = null;
  if (parentId) {
    parent = db.prepare('SELECT * FROM comments WHERE id = ?').get(Number(parentId));
    if (!parent || parent.subject_type !== subjectType || parent.subject_id !== row.id) {
      return { error: 'That comment is not on this item', status: 400 };
    }
    if (parent.parent_id) parent = db.prepare('SELECT * FROM comments WHERE id = ?').get(parent.parent_id);
  }

  const { lastInsertRowid: id } = db.prepare(`
    INSERT INTO comments (subject_type, subject_id, parent_id, user_id, body)
    VALUES (?, ?, ?, ?, ?)
  `).run(subjectType, row.id, parent?.id ?? null, user.id, text);

  followByCommenting(subjectType, row.id, user.id);
  announce({ comment: db.prepare('SELECT * FROM comments WHERE id = ?').get(id), subjectRow: row, parent, user, text });

  return { comment: present(db.prepare(`
    SELECT c.*, u.name AS author_name, u.photo AS author_photo, u.role AS author_role
    FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?
  `).get(id), user) };
}

// Who hears about a new comment, in order of how directly it concerns them.
// Each person is told once, by the most specific reason that applies.
function announce({ comment, subjectRow, parent, user, text }) {
  const subjectType = subjectRow.type;
  const told = new Set([user.id]);
  const excerpt = text.length > 200 ? `${text.slice(0, 200)}…` : text;
  const common = {
    subjectType,
    subjectId: subjectRow.id,
    actor: user,
    context: `comment:${comment.id}`,
  };

  const isMuted = muted(subjectType, subjectRow.id);

  // 1. The person being replied to.
  if (parent && parent.user_id !== user.id && !isMuted.has(parent.user_id)) {
    const author = notifications.userById(parent.user_id);
    if (author) {
      told.add(author.id);
      notifications.emit({
        ...common,
        type: 'comment.reply',
        users: [author],
        title: `${user.name} replied to your comment on ${subjectLabel(subjectRow)}`,
        body: excerpt,
      });
    }
  }

  // 2. Anyone named in the comment.
  const mentioned = mentionedUsers(text).filter(u => !told.has(u.id) && !isMuted.has(u.id));
  if (mentioned.length) {
    mentioned.forEach(u => told.add(u.id));
    notifications.emit({
      ...common,
      type: 'comment.mention',
      users: mentioned,
      title: `${user.name} mentioned you on ${subjectLabel(subjectRow)}`,
      body: excerpt,
    });
  }

  // 3. Everyone else following the thread. Admins are included whether or not
  //    they have commented — they are the ones who post these items and are
  //    answerable for what is said under them — and can mute any single
  //    thread, or the whole type, like anybody else.
  const watchers = [
    ...followers(subjectType, subjectRow.id),
    ...db.prepare("SELECT * FROM users WHERE role = 'admin'").all(),
  ].filter(u => !told.has(u.id) && !isMuted.has(u.id));

  if (watchers.length) {
    notifications.emit({
      ...common,
      type: 'comment.posted',
      users: watchers,
      title: `${user.name} commented on ${subjectLabel(subjectRow)}`,
      body: excerpt,
    });
  }
}

function edit({ id, user, body }) {
  const row = db.prepare('SELECT * FROM comments WHERE id = ?').get(Number(id));
  if (!row || row.deleted_at) return { error: 'Comment not found', status: 404 };
  if (row.user_id !== user.id) return { error: 'You can only edit your own comments', status: 403 };

  const text = String(body ?? '').trim();
  if (!text) return { error: 'A comment cannot be empty', status: 400 };
  if (text.length > MAX_BODY) return { error: `A comment cannot be longer than ${MAX_BODY} characters`, status: 400 };

  db.prepare("UPDATE comments SET body = ?, edited_at = datetime('now') WHERE id = ?").run(text, row.id);
  return { comment: present(db.prepare(`
    SELECT c.*, u.name AS author_name, u.photo AS author_photo, u.role AS author_role
    FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?
  `).get(row.id), user) };
}

// Soft, so replies underneath a removed comment still make sense.
function remove({ id, user }) {
  const row = db.prepare('SELECT * FROM comments WHERE id = ?').get(Number(id));
  if (!row || row.deleted_at) return { error: 'Comment not found', status: 404 };
  if (row.user_id !== user.id && user.role !== 'admin') {
    return { error: 'You can only delete your own comments', status: 403 };
  }

  db.prepare("UPDATE comments SET deleted_at = datetime('now'), body = '' WHERE id = ?").run(row.id);
  return { id: row.id };
}

module.exports = {
  SUBJECT_TYPES, MAX_BODY,
  subject, subjectLabel, list, countsFor, add, edit, remove,
  subscriptionState, setSubscription, followers, mentionedUsers,
};
