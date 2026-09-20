// ─── Notifications ────────────────────────────────────────────────────────────
//
// What one person has to be told about, inside the portal itself.
//
// The site could already send email, and still does — but email is a copy that
// leaves. A notification is the thing itself: it is unread until the person
// opens it, it says which page it is about so the bell can go there, and it
// survives a mail server being down, because it is written when the change is
// saved and has nothing to do with delivery.
//
// Writing one is a side effect of a change that has already succeeded. Like
// the action history, it must never be the reason a save fails: everything
// here reports its own trouble to the console and returns empty.

const db = require('../db');

// What a notification can be about. The kind is stored so a reader can be
// filtered or styled by it later; nothing branches on it here.
const KINDS = {
  'group-event-published': 'A meeting was posted for a group you are in',
  'group-event-updated':   'A meeting you are going to has changed',
  'group-event-cancelled': 'A meeting you were going to is off',
  'group-event-rsvp':      'Somebody answered your invitation',
  'group-event-signup':    'Somebody signed up to bring something',
  'group-event-comment':   'A reply on a meeting',
  'announcement-comment':  'A reply on a church event',
  'group-membership':      'You were added to a church group',
};

const KIND_IDS = Object.keys(KINDS);

// Where each kind of subject is read, so the bell can open what it mentions.
const PAGE_FOR_SUBJECT = {
  'group-event':  'groups',
  'church-group': 'groups',
  'announcement': 'announcements',
};

function pageForSubject(subjectType) {
  return PAGE_FOR_SUBJECT[subjectType] || '';
}

/**
 * Tell some people about something.
 *
 * @param {object} entry
 * @param {Array<number|{id:number}>} entry.users  accounts to tell
 * @param {string} entry.kind        one of KINDS
 * @param {string} entry.title       one line, readable on its own
 * @param {string} [entry.body]
 * @param {string} [entry.subjectType]  'group-event' | 'announcement' | …
 * @param {number} [entry.subjectId]
 * @param {string} [entry.page]      tab id to open; defaults from subjectType
 * @param {object} [entry.actor]     whoever caused it — never notified about
 *                                   their own doing
 * @returns {number} how many were written
 */
function notify({ users = [], kind, title, body = '', subjectType = '', subjectId = null, page, actor = null } = {}) {
  try {
    if (!title) return 0;

    const actorId = actor?.id ?? null;
    const ids = [...new Set(
      users
        .map(u => (typeof u === 'object' ? u?.id : u))
        .map(Number)
        .filter(id => Number.isInteger(id) && id > 0)
        // Nobody needs telling about what they just did themselves.
        .filter(id => id !== actorId)
    )];
    if (!ids.length) return 0;

    const insert = db.prepare(`
      INSERT INTO notifications
        (user_id, kind, title, body, subject_type, subject_id, page, actor_id, actor_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const write = db.transaction(() => {
      for (const id of ids) {
        insert.run(
          id,
          KIND_IDS.includes(kind) ? kind : 'group-event-comment',
          title,
          body,
          subjectType,
          subjectId,
          page ?? pageForSubject(subjectType),
          actorId,
          actor?.name || '',
        );
      }
    });
    write();

    return ids.length;
  } catch (err) {
    console.error('[notifications] could not write:', err.message);
    return 0;
  }
}

// ─── Reading ──────────────────────────────────────────────────────────────────

function listFor(userId, { limit = 50, unreadOnly = false } = {}) {
  if (!userId) return [];
  try {
    const rows = db.prepare(`
      SELECT id, kind, title, body, subject_type, subject_id, page, actor_name, read_at, created_at
        FROM notifications
       WHERE user_id = ? ${unreadOnly ? 'AND read_at IS NULL' : ''}
       ORDER BY id DESC
       LIMIT ?
    `).all(userId, Math.min(Number(limit) || 50, 200));

    return rows.map(row => ({
      id:          row.id,
      kind:        row.kind,
      title:       row.title,
      body:        row.body,
      subjectType: row.subject_type,
      subjectId:   row.subject_id,
      page:        row.page,
      actorName:   row.actor_name,
      read:        !!row.read_at,
      createdAt:   row.created_at,
    }));
  } catch (err) {
    console.error('[notifications] could not read:', err.message);
    return [];
  }
}

function unreadCount(userId) {
  if (!userId) return 0;
  try {
    return db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(userId).n;
  } catch (err) {
    console.error('[notifications] could not count:', err.message);
    return 0;
  }
}

// Only ever your own: the id comes from the request, so the account it belongs
// to is part of the WHERE rather than something checked beforehand.
function markRead(userId, ids = []) {
  if (!userId) return 0;
  const wanted = ids.map(Number).filter(Number.isInteger);
  if (!wanted.length) return 0;

  const mark = db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE id = ? AND user_id = ? AND read_at IS NULL");
  const run  = db.transaction(() => wanted.reduce((n, id) => n + mark.run(id, userId).changes, 0));
  return run();
}

function markAllRead(userId) {
  if (!userId) return 0;
  return db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL")
    .run(userId).changes;
}

// ─── Finding who to tell ──────────────────────────────────────────────────────

// The accounts behind a set of directory people. Somebody in the directory
// with no sign-in yet simply is not reachable this way — they get the group's
// email instead, which is why both go out.
function accountsForDirectory(directoryIds = []) {
  const ids = [...new Set(directoryIds.map(Number).filter(Boolean))];
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  return db.prepare(`
    SELECT id, name, email, directory_id FROM users
     WHERE directory_id IN (${placeholders}) AND role <> 'pending'
  `).all(...ids);
}

module.exports = {
  KINDS, KIND_IDS, pageForSubject,
  notify, listFor, unreadCount, markRead, markAllRead, accountsForDirectory,
};
