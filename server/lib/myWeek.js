// ─── My week, gathered ──────────────────────────────────────────────────────────────────
//
// One person's own fortnight in one place: the serving jobs they are down for,
// the sign-ups they put their name to, the group meetings they said they are
// coming to (and the ones still waiting on an answer), what they are bringing,
// and their turns in a rotation. Everything here is read-only and already
// visible to them on its own page — this only gathers it up.
//
// A serving job is found by the person's own name on the roster, the same way
// "Your jobs" on the Service Roster finds it, and its day is read straight off
// the slot. It does not go through the service-name lookup Upcoming Service
// uses (lib/worshipPlans.js servingFor), so a roster whose service names do
// not line up with the worship services still shows somebody their jobs here.
const db      = require('../db');
const blackouts = require('./blackouts');
const rotations = require('./rotations');
const engine = require('../workflows/engine');
const { serviceRank } = require('../workflows/scheduling');
const recordKeeping = require('./recordKeeping');

// Today and the thirteen days after it: this week and next.
const DAYS = 14;

function personFor(user) {
  if (!user?.directory_id) return null;
  return db.prepare('SELECT id, name FROM directory WHERE id = ?').get(user.directory_id) || null;
}

const inRange = (iso, from, to) => !!iso && iso >= from && iso <= to;

// Serving Schedule slots with this person's name in them, in the window.
function jobsFor(person, from, to) {
  const key = String(person?.name || '').trim().toLowerCase();
  if (!key) return [];
  // Slots with a replacement request still open (routes/serving.js).
  const open = new Set(db.prepare(`
    SELECT data FROM workflow_instances WHERE definition_id = 'serving-replacement' AND status = 'active'
  `).all().map(r => Number(engine.parseData(r.data).slotId)).filter(Boolean));

  return db.prepare('SELECT id, month, date, service, job FROM job_assignments WHERE lower(trim(name)) = ?')
    .all(key)
    .map(s => ({ ...s, iso: blackouts.dateOf(s.month, s.date) }))
    .filter(s => inRange(s.iso, from, to))
    // Sunday morning's jobs before Sunday evening's on the same day.
    .sort((a, b) => a.iso.localeCompare(b.iso) || serviceRank(a.service) - serviceRank(b.service) || a.id - b.id)
    .map(s => ({
      kind: 'job', id: s.id, date: s.iso, service: s.service, job: s.job,
      replacementAsked: open.has(s.id),
    }));
}

// Sign-up list entries with their name on them, by account or directory entry.
function signupsFor(user, person, from, to) {
  return db.prepare(`
    SELECT e.id, e.note, l.id AS list_id, l.title, d.date, d.time, i.label AS item, l.free_label
      FROM signup_entries e
      JOIN signup_lists l ON l.id = e.list_id
      JOIN signup_dates d ON d.id = e.date_id
      LEFT JOIN signup_items i ON i.id = e.item_id
     WHERE (e.user_id = ? OR (? IS NOT NULL AND e.directory_id = ?))
       AND d.date BETWEEN ? AND ?
  `).all(user.id, person?.id ?? null, person?.id ?? null, from, to)
    .map(r => ({
      kind: 'signup', id: r.id, date: r.date, time: r.time, listId: r.list_id,
      title: r.title, item: r.item || r.free_label || '', note: r.note,
    }));
}

// The group meetings in the window this person is invited to: those they have
// answered, and — so nothing slips — those still asking for an answer.
function meetingsFor(user, person, from, to) {
  const groupIds = person
    ? db.prepare('SELECT group_id FROM church_group_members WHERE directory_id = ?').all(person.id).map(r => r.group_id)
    : [];
  if (!groupIds.length) return [];

  const events = db.prepare(`
    SELECT e.id, e.group_id, e.title, e.event_date, e.event_time, e.location, e.rsvp_enabled, g.name AS group_name
      FROM group_events e JOIN church_groups g ON g.id = e.group_id
     WHERE e.status = 'published' AND e.event_date BETWEEN ? AND ?
       AND e.group_id IN (${groupIds.map(() => '?').join(',')})
  `).all(from, to, ...groupIds);

  const answer = db.prepare(`
    SELECT response, guests FROM group_event_rsvps
     WHERE event_id = ? AND (user_id = ? OR (? IS NOT NULL AND directory_id = ?))
     ORDER BY responded_at DESC LIMIT 1
  `);
  const bringing = db.prepare(`
    SELECT i.label, s.detail, s.quantity FROM group_event_signups s
      JOIN group_event_signup_items i ON i.id = s.item_id
     WHERE i.event_id = ? AND (s.user_id = ? OR (? IS NOT NULL AND s.directory_id = ?))
  `);

  return events.map(e => {
    const rsvp = answer.get(e.id, user.id, person.id, person.id);
    return {
      kind: 'meeting', id: e.id, groupId: e.group_id, date: e.event_date, time: e.event_time,
      title: e.title, group: e.group_name, location: e.location,
      rsvp: rsvp ? rsvp.response : (e.rsvp_enabled ? 'unanswered' : null),
      guests: rsvp?.guests || 0,
      bringing: bringing.all(e.id, user.id, person.id, person.id)
        .map(b => b.detail ? `${b.label}: ${b.detail}` : b.label),
    };
  })
    // Somebody who said no is not going, so it is not part of their week.
    .filter(m => m.rsvp !== 'no');
}

// Turns in a rotation that fall in the window, and the rotations where this
// person is next up with no date set yet.
function rotationsFor(person, from, to) {
  if (!person) return { dated: [], nextUp: [] };
  const dated = db.prepare(`
    SELECT t.id, t.date, t.note, r.id AS rotation_id, r.name
      FROM rotation_turns t JOIN rotations r ON r.id = t.rotation_id
     WHERE t.directory_id = ? AND t.date BETWEEN ? AND ?
  `).all(person.id, from, to)
    .map(t => ({ kind: 'rotation', id: t.id, date: t.date, rotationId: t.rotation_id, title: t.name, note: t.note }));

  const nextUp = db.prepare(`
    SELECT r.id, r.name FROM rotations r JOIN rotation_members m ON m.rotation_id = r.id
     WHERE r.active = 1 AND m.directory_id = ?
  `).all(person.id)
    .filter(r => rotations.nextUp(r.id)?.directory_id === person.id)
    .map(r => ({ rotationId: r.id, title: r.name }));

  return { dated, nextUp };
}

// One person's window, starting on `from` (church today by default): their
// dated items in date order, and the rotations they are next up on. The My
// Week page and the weekly email (mail/myWeek.js) both read this.
function weekFor(user, { from = recordKeeping.churchToday(), days = DAYS } = {}) {
  const to = recordKeeping.addDays(from, days - 1);
  const person = personFor(user);
  const rota = rotationsFor(person, from, to);

  const items = [
    ...jobsFor(person, from, to),
    ...signupsFor(user, person, from, to),
    ...meetingsFor(user, person, from, to),
    ...rota.dated,
  ].sort((a, b) => a.date.localeCompare(b.date) || String(a.time || '').localeCompare(String(b.time || '')));

  return { from, to, linked: !!person, name: person?.name || user.name || '', items, nextUp: rota.nextUp };
}

module.exports = { weekFor, DAYS };
