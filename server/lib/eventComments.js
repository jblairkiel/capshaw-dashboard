// ─── Talking about an event ───────────────────────────────────────────────────
//
// One thread per event, and "event" means both kinds the portal has: a group's
// own meeting, and a dated row on the congregation's announcement board (which
// is what the church calendar shows). A comment names its subject with a pair —
// what kind of thing, and which one — so the two kinds share one table, one
// route and one piece of screen, and a third kind later needs none of them
// written again.
//
// Each kind says for itself who may read it, who may reply, and who should be
// told when somebody does. That is the only place the difference lives.

const db = require('../db');
const groups = require('./churchGroups');
const notifications = require('./notifications');
const { holdsArea } = require('./areas');

const MAX_LENGTH = 2000;

// ─── The kinds of thing that can be commented on ──────────────────────────────

const SUBJECTS = {
  'group-event': {
    page: 'groups',
    load(id) {
      return db.prepare(`
        SELECT e.id, e.title, e.group_id, e.status, e.created_by, g.name AS group_name
          FROM group_events e
          JOIN church_groups g ON g.id = e.group_id
         WHERE e.id = ?
      `).get(id) || null;
    },
    title: subject => subject.title,
    where: subject => subject.group_name,
    // A meeting nobody outside the group can see is a thread nobody outside
    // the group can read either.
    canRead: (user, subject) => groups.belongsToGroup(user, subject.group_id),
    canReply: (user, subject) => subject.status !== 'cancelled' && groups.belongsToGroup(user, subject.group_id),
    // A leader may tidy their own group's thread; so may whoever looks after
    // groups. Nobody else touches anybody else's words.
    canModerate: (user, subject) => groups.leadsGroup(user, subject.group_id),
    // Everybody already in the conversation: the leaders, whoever posted it,
    // whoever has answered the invitation, and whoever has replied before.
    audience(subject) {
      const roll = groups.membersOf(subject.group_id);
      const leaders = roll.filter(m => m.role === 'leader' || m.role === 'co-leader').map(m => m.userId);
      const answered = db.prepare('SELECT user_id FROM group_event_rsvps WHERE event_id = ?')
        .all(subject.id).map(r => r.user_id);
      const replied = db.prepare(
        "SELECT DISTINCT user_id FROM event_comments WHERE subject_type = 'group-event' AND subject_id = ? AND deleted_at IS NULL"
      ).all(subject.id).map(r => r.user_id);
      return [subject.created_by, ...leaders, ...answered, ...replied];
    },
  },

  announcement: {
    page: 'announcements',
    load(id) {
      return db.prepare('SELECT id, title, event_date, active FROM announcements WHERE id = ?').get(id) || null;
    },
    title: subject => subject.title,
    where: () => 'the church calendar',
    // The board is the whole congregation's, and the portal is already
    // members-only, so anyone signed in may read it.
    canRead: () => true,
    // Replying is a member's doing, not a visitor's: an account still waiting
    // to be confirmed can read the board and not write on it.
    canReply: user => !!user && user.role !== 'pending',
    canModerate: user => holdsArea(user, 'announcements') || holdsArea(user, 'calendar'),
    // Whoever looks after the board, plus everybody who has replied before —
    // the congregation at large is not subscribed to every event's thread.
    audience(subject) {
      const keepers = db.prepare(`
        SELECT u.id FROM users u
          JOIN user_areas a ON a.user_id = u.id
         WHERE a.area IN ('announcements', 'calendar') AND u.role <> 'pending'
      `).all().map(r => r.id);
      const replied = db.prepare(
        "SELECT DISTINCT user_id FROM event_comments WHERE subject_type = 'announcement' AND subject_id = ? AND deleted_at IS NULL"
      ).all(subject.id).map(r => r.user_id);
      return [...keepers, ...replied];
    },
  },
};

const SUBJECT_TYPES = Object.keys(SUBJECTS);

function isSubjectType(type) {
  return SUBJECT_TYPES.includes(type);
}

// Resolves the pair to the thing itself, and refuses anything that is not one
// of the kinds above — the type comes from a request, so it is matched against
// this list rather than used to build anything.
function resolve(subjectType, subjectId) {
  if (!isSubjectType(subjectType)) return { error: 'That is not something the portal keeps comments on' };
  const kind = SUBJECTS[subjectType];
  const subject = kind.load(Number(subjectId));
  if (!subject) return { error: 'That event no longer exists' };
  return { kind, subject };
}

// ─── Reading ──────────────────────────────────────────────────────────────────

// A removed comment is still in the table; what comes back in its place is a
// gap that says so, because a thread that quietly loses a message reads as
// though it never had one.
function listComments(subjectType, subjectId) {
  return db.prepare(`
    SELECT c.id, c.user_id, c.author_name, c.body, c.created_at, c.edited_at, c.deleted_at,
           u.name AS account_name, u.photo AS photo
      FROM event_comments c
      LEFT JOIN users u ON u.id = c.user_id
     WHERE c.subject_type = ? AND c.subject_id = ?
     ORDER BY c.id ASC
  `).all(subjectType, Number(subjectId)).map(row => ({
    id:        row.id,
    userId:    row.user_id,
    author:    row.author_name || row.account_name || 'Somebody',
    photo:     row.deleted_at ? null : row.photo || null,
    body:      row.deleted_at ? '' : row.body,
    deleted:   !!row.deleted_at,
    edited:    !!row.edited_at,
    createdAt: row.created_at,
  }));
}

function commentCount(subjectType, subjectId) {
  return db.prepare(
    'SELECT COUNT(*) AS n FROM event_comments WHERE subject_type = ? AND subject_id = ? AND deleted_at IS NULL'
  ).get(subjectType, Number(subjectId)).n;
}

// How many replies each of a set of events has, in one query rather than one
// per card — a list of twenty meetings should not be twenty round trips.
function commentCounts(subjectType, subjectIds = []) {
  const ids = [...new Set(subjectIds.map(Number).filter(Boolean))];
  if (!ids.length) return {};
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT subject_id, COUNT(*) AS n
      FROM event_comments
     WHERE subject_type = ? AND deleted_at IS NULL AND subject_id IN (${placeholders})
     GROUP BY subject_id
  `).all(subjectType, ...ids);
  return rows.reduce((acc, row) => ({ ...acc, [row.subject_id]: row.n }), {});
}

// ─── Writing ──────────────────────────────────────────────────────────────────

function addComment(subjectType, subjectId, user, body) {
  const found = resolve(subjectType, subjectId);
  if (found.error) return found;

  const { kind, subject } = found;
  if (!kind.canReply(user, subject)) return { error: 'You cannot reply to this one', status: 403 };

  const text = String(body || '').trim();
  if (!text) return { error: 'Write something first' };
  if (text.length > MAX_LENGTH) return { error: `Keep a comment under ${MAX_LENGTH} characters` };

  const { lastInsertRowid: id } = db.prepare(`
    INSERT INTO event_comments (subject_type, subject_id, user_id, author_name, body)
    VALUES (?, ?, ?, ?, ?)
  `).run(subjectType, subject.id, user.id, user.name || '', text);

  // Told after the comment is saved, and never as a condition of saving it.
  const audience = kind.audience(subject);
  notifications.notify({
    users:  audience,
    kind:   subjectType === 'group-event' ? 'group-event-comment' : 'announcement-comment',
    title:  `${user.name || 'Somebody'} replied on "${kind.title(subject)}"`,
    body:   text.length > 140 ? `${text.slice(0, 140)}…` : text,
    subjectType,
    subjectId: subject.id,
    page:   kind.page,
    actor:  user,
  });

  return { comment: db.prepare('SELECT * FROM event_comments WHERE id = ?').get(id), subject, kind };
}

function editComment(commentId, user, body) {
  const row = db.prepare('SELECT * FROM event_comments WHERE id = ?').get(commentId);
  if (!row || row.deleted_at) return { error: 'That comment is gone' };
  // Editing is the author's alone: a leader can remove something, but nobody
  // gets to change what somebody else said.
  if (row.user_id !== user.id) return { error: 'You can only edit what you wrote', status: 403 };

  const text = String(body || '').trim();
  if (!text) return { error: 'Write something first' };
  if (text.length > MAX_LENGTH) return { error: `Keep a comment under ${MAX_LENGTH} characters` };

  db.prepare("UPDATE event_comments SET body = ?, edited_at = datetime('now') WHERE id = ?").run(text, commentId);
  return { comment: db.prepare('SELECT * FROM event_comments WHERE id = ?').get(commentId) };
}

function deleteComment(commentId, user) {
  const row = db.prepare('SELECT * FROM event_comments WHERE id = ?').get(commentId);
  if (!row || row.deleted_at) return { error: 'That comment is gone' };

  const found = resolve(row.subject_type, row.subject_id);
  const mine  = row.user_id === user.id;
  const moderator = !found.error && found.kind.canModerate(user, found.subject);
  if (!mine && !moderator) return { error: 'That is somebody else\'s comment', status: 403 };

  db.prepare("UPDATE event_comments SET deleted_at = datetime('now') WHERE id = ?").run(commentId);
  return { ok: true, comment: row, byModerator: !mine };
}

module.exports = {
  SUBJECTS, SUBJECT_TYPES, MAX_LENGTH, isSubjectType, resolve,
  listComments, commentCount, commentCounts,
  addComment, editComment, deleteComment,
};
