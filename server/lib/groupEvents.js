// ─── A group's meetings ───────────────────────────────────────────────────────
//
// A meeting belongs to one group, and carries three things with it that a row
// on the announcement board does not:
//
//   · an invitation — who is coming, and how many they are bringing
//   · a sign-up list — what the leader needs covered, and who has taken it on
//   · a thread — see server/lib/eventComments.js
//
// A meeting starts as a draft: only the group's leaders see it, and nobody is
// told about it. Publishing is the moment the group hears, so it is a separate
// step rather than something a save might do by accident.

const db = require('../db');

const STATUSES = ['draft', 'published', 'cancelled'];
const RESPONSES = ['yes', 'no', 'maybe'];

function isStatus(value)   { return STATUSES.includes(value); }
function isResponse(value) { return RESPONSES.includes(value); }

// ─── Reading ──────────────────────────────────────────────────────────────────

function rowToEvent(row) {
  if (!row) return null;
  return {
    id:            row.id,
    groupId:       row.group_id,
    groupName:     row.group_name ?? '',
    groupKey:      row.group_key ?? '',
    title:         row.title,
    description:   row.description,
    date:          row.event_date,
    time:          row.event_time,
    endTime:       row.end_time,
    location:      row.location,
    hostName:      row.host_name,
    rsvpEnabled:   !!row.rsvp_enabled,
    rsvpDeadline:  row.rsvp_deadline,
    capacity:      row.capacity,
    signupEnabled: !!row.signup_enabled,
    signupTitle:   row.signup_title,
    status:        row.status,
    createdBy:     row.created_by,
    createdAt:     row.created_at,
    publishedAt:   row.published_at,
  };
}

const EVENT_SELECT = `
  SELECT e.*, g.name AS group_name, g.key AS group_key
    FROM group_events e
    JOIN church_groups g ON g.id = e.group_id
`;

function getEvent(eventId) {
  return rowToEvent(db.prepare(`${EVENT_SELECT} WHERE e.id = ?`).get(eventId));
}

// Drafts are the leaders' business until they are published, so a roll member
// asking for the group's meetings does not see them.
function eventsForGroup(groupId, { includeDrafts = false } = {}) {
  const rows = db.prepare(`
    ${EVENT_SELECT}
     WHERE e.group_id = ? ${includeDrafts ? '' : "AND e.status <> 'draft'"}
     ORDER BY CASE WHEN e.event_date = '' THEN 1 ELSE 0 END, e.event_date DESC, e.event_time DESC, e.id DESC
  `).all(groupId);
  return rows.map(rowToEvent);
}

// Everything coming up across the groups somebody is in — the "what is on for
// me" list, which is what most people open the page for.
function upcomingForGroups(groupIds = [], { from = todayKey() } = {}) {
  if (!groupIds.length) return [];
  const placeholders = groupIds.map(() => '?').join(',');
  const rows = db.prepare(`
    ${EVENT_SELECT}
     WHERE e.group_id IN (${placeholders})
       AND e.status = 'published'
       AND e.event_date >= ?
     ORDER BY e.event_date ASC, e.event_time ASC
     LIMIT 50
  `).all(...groupIds, from);
  return rows.map(rowToEvent);
}

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// ─── The invitation ───────────────────────────────────────────────────────────

function rsvpsFor(eventId) {
  return db.prepare(`
    SELECT r.id, r.user_id, r.person_name, r.response, r.guests, r.note, r.responded_at,
           u.name AS account_name
      FROM group_event_rsvps r
      LEFT JOIN users u ON u.id = r.user_id
     WHERE r.event_id = ?
     ORDER BY r.response ASC, COALESCE(NULLIF(r.person_name, ''), u.name) ASC
  `).all(eventId).map(row => ({
    id:          row.id,
    userId:      row.user_id,
    name:        row.person_name || row.account_name || 'Somebody',
    response:    row.response,
    guests:      row.guests,
    note:        row.note,
    respondedAt: row.responded_at,
  }));
}

// A head count is the yeses plus the people they are bringing — counting
// answers alone is how a room ends up short of chairs.
function rsvpSummary(eventId) {
  const rsvps = rsvpsFor(eventId);
  const yes   = rsvps.filter(r => r.response === 'yes');
  return {
    yes:     yes.length,
    no:      rsvps.filter(r => r.response === 'no').length,
    maybe:   rsvps.filter(r => r.response === 'maybe').length,
    guests:  yes.reduce((n, r) => n + (r.guests || 0), 0),
    attending: yes.length + yes.reduce((n, r) => n + (r.guests || 0), 0),
  };
}

const setRsvp = db.transaction((eventId, user, { response, guests = 0, note = '' }) => {
  if (!isResponse(response)) return { error: 'Answer yes, no or maybe' };

  const count = Math.max(0, Math.min(Number(guests) || 0, 20));
  db.prepare(`
    INSERT INTO group_event_rsvps (event_id, user_id, person_name, response, guests, note, responded_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(event_id, user_id) DO UPDATE SET
      response = excluded.response,
      guests   = excluded.guests,
      note     = excluded.note,
      responded_at = datetime('now')
  `).run(eventId, user.id, user.name || '', response, count, String(note || '').trim().slice(0, 500));

  return { ok: true };
});

function rsvpOf(eventId, userId) {
  const row = db.prepare('SELECT response, guests, note FROM group_event_rsvps WHERE event_id = ? AND user_id = ?')
    .get(eventId, userId);
  return row ? { response: row.response, guests: row.guests, note: row.note } : null;
}

// ─── The sign-up list ─────────────────────────────────────────────────────────

function signupsFor(eventId) {
  const items = db.prepare(`
    SELECT id, label, notes, needed, sort_order
      FROM group_event_signup_items
     WHERE event_id = ?
     ORDER BY sort_order ASC, id ASC
  `).all(eventId);

  const claims = db.prepare(`
    SELECT s.id, s.item_id, s.user_id, s.user_name, s.detail, s.quantity, s.claimed_at
      FROM group_event_signups s
      JOIN group_event_signup_items i ON i.id = s.item_id
     WHERE i.event_id = ?
     ORDER BY s.id ASC
  `).all(eventId);

  return items.map(item => {
    const taken = claims.filter(c => c.item_id === item.id);
    return {
      id:     item.id,
      label:  item.label,
      notes:  item.notes,
      needed: item.needed,
      // What is still wanted, so the page can say "2 more" without the caller
      // doing the arithmetic three different ways.
      claimed: taken.reduce((n, c) => n + (c.quantity || 1), 0),
      remaining: Math.max(0, item.needed - taken.reduce((n, c) => n + (c.quantity || 1), 0)),
      claims: taken.map(c => ({
        id:       c.id,
        userId:   c.user_id,
        name:     c.user_name,
        detail:   c.detail,
        quantity: c.quantity,
        claimedAt: c.claimed_at,
      })),
    };
  });
}

// The list is saved whole rather than a row at a time: a leader edits it as a
// list, and sending the list back is what keeps the screen and the table
// agreeing. Items that survive keep their id, so nobody's claim is dropped by
// an edit to the wording next to it.
const saveSignupItems = db.transaction((eventId, items = []) => {
  const existing = db.prepare('SELECT id FROM group_event_signup_items WHERE event_id = ?').all(eventId).map(r => r.id);
  const kept = new Set();

  const update = db.prepare('UPDATE group_event_signup_items SET label = ?, notes = ?, needed = ?, sort_order = ? WHERE id = ? AND event_id = ?');
  const insert = db.prepare('INSERT INTO group_event_signup_items (event_id, label, notes, needed, sort_order) VALUES (?, ?, ?, ?, ?)');
  const remove = db.prepare('DELETE FROM group_event_signup_items WHERE id = ?');

  items.forEach((item, index) => {
    const label = String(item?.label || '').trim();
    if (!label) return;
    const needed = Math.max(1, Math.min(Number(item?.needed) || 1, 99));
    const notes  = String(item?.notes || '').trim();

    if (item?.id && existing.includes(Number(item.id))) {
      update.run(label, notes, needed, index, Number(item.id), eventId);
      kept.add(Number(item.id));
    } else {
      insert.run(eventId, label, notes, needed, index);
    }
  });

  for (const id of existing) if (!kept.has(id)) remove.run(id);
  return signupsFor(eventId);
});

const claimSignup = db.transaction((itemId, user, { detail = '', quantity = 1 } = {}) => {
  const item = db.prepare('SELECT * FROM group_event_signup_items WHERE id = ?').get(itemId);
  if (!item) return { error: 'That is not on the list' };

  const already = db.prepare('SELECT id FROM group_event_signups WHERE item_id = ? AND user_id = ?').get(itemId, user.id);
  if (already) return { error: 'You have already signed up for that — change or drop it instead' };

  const taken = db.prepare('SELECT COALESCE(SUM(quantity), 0) AS n FROM group_event_signups WHERE item_id = ?').get(itemId).n;
  const wanted = Math.max(1, Math.min(Number(quantity) || 1, item.needed));
  if (taken >= item.needed) return { error: `${item.label} is already covered` };

  db.prepare('INSERT INTO group_event_signups (item_id, user_id, user_name, detail, quantity) VALUES (?, ?, ?, ?, ?)')
    .run(itemId, user.id, user.name || '', String(detail || '').trim().slice(0, 200), Math.min(wanted, item.needed - taken));

  return { ok: true, item, eventId: item.event_id };
});

// Your own claim, or — for a leader tidying up the list — anybody's.
const releaseSignup = db.transaction((claimId, user, { canManage = false } = {}) => {
  const claim = db.prepare(`
    SELECT s.*, i.event_id, i.label
      FROM group_event_signups s
      JOIN group_event_signup_items i ON i.id = s.item_id
     WHERE s.id = ?
  `).get(claimId);
  if (!claim) return { error: 'That sign-up is already gone' };
  if (claim.user_id !== user.id && !canManage) return { error: 'That is somebody else\'s sign-up' };

  db.prepare('DELETE FROM group_event_signups WHERE id = ?').run(claimId);
  return { ok: true, claim };
});

module.exports = {
  STATUSES, RESPONSES, isStatus, isResponse, todayKey,
  getEvent, eventsForGroup, upcomingForGroups, rowToEvent,
  rsvpsFor, rsvpSummary, setRsvp, rsvpOf,
  signupsFor, saveSignupItems, claimSignup, releaseSignup,
};
