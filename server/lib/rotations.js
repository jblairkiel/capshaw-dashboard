// ─── Rotations ────────────────────────────────────────────────────────────────
//
// Anything the church takes in turns — teaching the ladies' class, hosting a
// baby shower — kept as an ordered queue of people from the member directory.
//
//   · Next up is the first person in the queue who is not sitting out.
//   · Giving somebody a turn writes it down (with a date and a note, both
//     optional) and sends them to the back. It is usually the person next up,
//     but need not be: when she cannot do it this time and somebody else
//     steps in, the one who stepped in goes to the back and she keeps her place.
//   · A turn dated after today is upcoming; the rest are history. Cancelling an
//     upcoming turn puts that person back at the front.
//
// Two kinds of people run them. Whoever holds the `rotations` area starts,
// retires and deletes rotations and says who coordinates each one; a
// coordinator (a directory person, matched to an account the same way a group
// leader is) runs only their own: the queue, its order and its turns.
// Everybody signed in can see every rotation.

const db = require('../db');
const { holdsArea } = require('./areas');

const AREA = 'rotations';

const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const cleanText = (v, max) => String(v ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);

function isDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// ─── Who may do what ──────────────────────────────────────────────────────────

function managesRotations(user) {
  return !!user && user.role !== 'pending' && holdsArea(user, AREA);
}

function coordinates(user, rotationId) {
  if (managesRotations(user)) return true;
  if (!user || user.role === 'pending' || !user.directory_id) return false;
  return !!db.prepare('SELECT 1 FROM rotation_coordinators WHERE rotation_id = ? AND directory_id = ?')
    .get(rotationId, user.directory_id);
}

// ─── Reading ──────────────────────────────────────────────────────────────────

function rotationRow(id) {
  return db.prepare('SELECT * FROM rotations WHERE id = ?').get(Number(id)) || null;
}

function membersOf(rotationId) {
  return db.prepare(`
    SELECT m.directory_id, m.position, m.sitting_out, d.name
      FROM rotation_members m JOIN directory d ON d.id = m.directory_id
     WHERE m.rotation_id = ?
     ORDER BY m.position, m.id
  `).all(rotationId);
}

function coordinatorsOf(rotationId) {
  return db.prepare(`
    SELECT c.directory_id, d.name
      FROM rotation_coordinators c JOIN directory d ON d.id = c.directory_id
     WHERE c.rotation_id = ?
     ORDER BY d.name COLLATE NOCASE
  `).all(rotationId);
}

// The first person in the queue who is not sitting out.
function nextUp(rotationId) {
  return membersOf(rotationId).find(m => !m.sitting_out) || null;
}

// Somebody's address: their directory entry's, else an account linked to it.
function emailFor(directoryId) {
  if (!directoryId) return '';
  const row = db.prepare(`
    SELECT COALESCE(NULLIF(trim(d.email), ''),
      (SELECT u.email FROM users u WHERE u.directory_id = d.id AND trim(coalesce(u.email, '')) <> '' LIMIT 1), '') AS email
      FROM directory d WHERE d.id = ?
  `).get(directoryId);
  return row?.email || '';
}

function turnShape(row, today, user) {
  return {
    id: row.id,
    directoryId: row.directory_id,
    name: row.name,
    date: row.date,
    note: row.note,
    upcoming: !!row.date && row.date > today,
    mine: !!user?.directory_id && row.directory_id === user.directory_id,
  };
}

// The list of rotations, each with enough to show a card.
function list({ user, today, includeRetired = false }) {
  const rows = db.prepare(`SELECT * FROM rotations ${includeRetired ? '' : 'WHERE active = 1'} ORDER BY active DESC, name COLLATE NOCASE`).all();
  return rows.map(r => {
    const members = membersOf(r.id);
    const next = members.find(m => !m.sitting_out) || null;
    const upcoming = db.prepare(`
      SELECT * FROM rotation_turns WHERE rotation_id = ? AND date > ? ORDER BY date, id LIMIT 1
    `).get(r.id, today);
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      active: !!r.active,
      memberCount: members.length,
      nextUp: next ? { directoryId: next.directory_id, name: next.name } : null,
      nextTurn: upcoming ? turnShape(upcoming, today, user) : null,
      youAreNext: !!next && !!user?.directory_id && next.directory_id === user.directory_id,
      youAreIn: !!user?.directory_id && members.some(m => m.directory_id === user.directory_id),
      canRun: coordinates(user, r.id),
    };
  });
}

// One rotation in full: the queue in order, who coordinates it, and its turns.
function detail(id, { user, today }) {
  const r = rotationRow(id);
  if (!r) return null;
  const canRun = coordinates(user, r.id);
  const members = membersOf(r.id);
  const next = members.find(m => !m.sitting_out) || null;
  const turns = db.prepare('SELECT * FROM rotation_turns WHERE rotation_id = ?').all(r.id).map(t => turnShape(t, today, user));
  const byDate = (a, b) => (a.date || '').localeCompare(b.date || '') || a.id - b.id;
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    active: !!r.active,
    canRun,
    canManage: managesRotations(user),
    nextUp: next ? { directoryId: next.directory_id, name: next.name } : null,
    members: members.map((m, i) => ({
      directoryId: m.directory_id,
      name: m.name,
      place: i + 1,
      sittingOut: !!m.sitting_out,
      next: !!next && m.directory_id === next.directory_id,
      mine: !!user?.directory_id && m.directory_id === user.directory_id,
      // Only the people running it need to know who cannot be emailed.
      ...(canRun ? { hasEmail: !!emailFor(m.directory_id) } : {}),
    })),
    coordinators: coordinatorsOf(r.id).map(c => ({ directoryId: c.directory_id, name: c.name })),
    upcoming: turns.filter(t => t.upcoming).sort(byDate),
    history: turns.filter(t => !t.upcoming).sort((a, b) => byDate(b, a)).slice(0, 50),
  };
}

// ─── Making and keeping rotations (the area) ──────────────────────────────────

function directoryIds(values) {
  const ids = [...new Set((Array.isArray(values) ? values : []).map(Number).filter(n => Number.isInteger(n) && n > 0))];
  if (!ids.length) return { ids };
  const found = db.prepare(`SELECT id FROM directory WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids).map(r => r.id);
  if (found.length !== ids.length) return { error: 'Somebody chosen is not in the member directory' };
  return { ids };
}

function create({ name, description, coordinatorIds }, user) {
  const title = clean(name, 100);
  if (!title) return { error: 'Give the rotation a name' };
  const coords = directoryIds(coordinatorIds);
  if (coords.error) return coords;
  const id = db.transaction(() => {
    const { lastInsertRowid } = db.prepare('INSERT INTO rotations (name, description, created_by) VALUES (?, ?, ?)')
      .run(title, cleanText(description, 1000), user?.id ?? null);
    for (const d of coords.ids) db.prepare('INSERT INTO rotation_coordinators (rotation_id, directory_id) VALUES (?, ?)').run(lastInsertRowid, d);
    return Number(lastInsertRowid);
  })();
  return { rotation: rotationRow(id) };
}

// A coordinator may change the name and description; only the area retires one.
function update(id, { name, description, active }, { canManage }) {
  const before = rotationRow(id);
  if (!before) return { error: 'No such rotation', status: 404 };
  const title = name === undefined ? before.name : clean(name, 100);
  if (!title) return { error: 'Give the rotation a name' };
  const text = description === undefined ? before.description : cleanText(description, 1000);
  let isActive = before.active;
  if (active !== undefined) {
    if (!canManage) return { error: 'Only whoever looks after Rotations can retire one', status: 403 };
    isActive = active ? 1 : 0;
  }
  db.prepare('UPDATE rotations SET name = ?, description = ?, active = ? WHERE id = ?').run(title, text, isActive, before.id);
  return { before, rotation: rotationRow(before.id) };
}

function remove(id) {
  const before = rotationRow(id);
  if (!before) return { error: 'No such rotation', status: 404 };
  db.prepare('DELETE FROM rotations WHERE id = ?').run(before.id);
  return { before };
}

function setCoordinators(id, values) {
  const r = rotationRow(id);
  if (!r) return { error: 'No such rotation', status: 404 };
  const coords = directoryIds(values);
  if (coords.error) return coords;
  const before = coordinatorsOf(r.id);
  db.transaction(() => {
    db.prepare('DELETE FROM rotation_coordinators WHERE rotation_id = ?').run(r.id);
    for (const d of coords.ids) db.prepare('INSERT INTO rotation_coordinators (rotation_id, directory_id) VALUES (?, ?)').run(r.id, d);
  })();
  return { before, after: coordinatorsOf(r.id) };
}

// ─── Running one (a coordinator) ──────────────────────────────────────────────

function lastPosition(rotationId) {
  return db.prepare('SELECT COALESCE(MAX(position), 0) AS p FROM rotation_members WHERE rotation_id = ?').get(rotationId).p;
}

function firstPosition(rotationId) {
  return db.prepare('SELECT COALESCE(MIN(position), 1) AS p FROM rotation_members WHERE rotation_id = ?').get(rotationId).p;
}

function memberRow(rotationId, directoryId) {
  return db.prepare('SELECT * FROM rotation_members WHERE rotation_id = ? AND directory_id = ?').get(rotationId, Number(directoryId)) || null;
}

function nameOf(directoryId) {
  return db.prepare('SELECT name FROM directory WHERE id = ?').get(directoryId)?.name || '';
}

// New people join at the back, in the order given. Anybody already in it stays
// where they are.
function addMembers(rotationId, values) {
  const r = rotationRow(rotationId);
  if (!r) return { error: 'No such rotation', status: 404 };
  const people = directoryIds(values);
  if (people.error) return people;
  if (!people.ids.length) return { error: 'Choose somebody to add' };
  const added = [];
  db.transaction(() => {
    let position = lastPosition(r.id);
    for (const d of people.ids) {
      if (memberRow(r.id, d)) continue;
      db.prepare('INSERT INTO rotation_members (rotation_id, directory_id, position) VALUES (?, ?, ?)').run(r.id, d, ++position);
      added.push({ directoryId: d, name: nameOf(d) });
    }
  })();
  return { added };
}

function removeMember(rotationId, directoryId) {
  const row = memberRow(rotationId, directoryId);
  if (!row) return { error: 'They are not in this rotation', status: 404 };
  db.prepare('DELETE FROM rotation_members WHERE id = ?').run(row.id);
  return { removed: { directoryId: row.directory_id, name: nameOf(row.directory_id) } };
}

// The whole queue, in its new order: every person in it, each once.
function reorder(rotationId, values) {
  const r = rotationRow(rotationId);
  if (!r) return { error: 'No such rotation', status: 404 };
  const order = (Array.isArray(values) ? values : []).map(Number);
  const current = membersOf(r.id).map(m => m.directory_id);
  const same = order.length === current.length && new Set(order).size === order.length
    && order.every(d => current.includes(d));
  if (!same) return { error: 'The new order has to include everybody in the rotation, once each', status: 409 };
  db.transaction(() => {
    order.forEach((d, i) => db.prepare('UPDATE rotation_members SET position = ? WHERE rotation_id = ? AND directory_id = ?').run(i + 1, r.id, d));
  })();
  return { order };
}

function setSittingOut(rotationId, directoryId, sittingOut) {
  const row = memberRow(rotationId, directoryId);
  if (!row) return { error: 'They are not in this rotation', status: 404 };
  db.prepare('UPDATE rotation_members SET sitting_out = ? WHERE id = ?').run(sittingOut ? 1 : 0, row.id);
  return { member: { directoryId: row.directory_id, name: nameOf(row.directory_id), sittingOut: !!sittingOut } };
}

// Passing without a turn: they go to the back and nothing is written down.
function sendToBack(rotationId, directoryId) {
  const row = memberRow(rotationId, directoryId);
  if (!row) return { error: 'They are not in this rotation', status: 404 };
  db.prepare('UPDATE rotation_members SET position = ? WHERE id = ?').run(lastPosition(rotationId) + 1, row.id);
  return { member: { directoryId: row.directory_id, name: nameOf(row.directory_id) } };
}

// Somebody takes a turn (next up, unless another is named): it is written
// down, and they go to the back.
function giveTurn(rotationId, { directoryId, date, note }, user) {
  const r = rotationRow(rotationId);
  if (!r) return { error: 'No such rotation', status: 404 };
  if (!r.active) return { error: 'This rotation has been retired' };
  const who = directoryId === undefined || directoryId === null || directoryId === ''
    ? nextUp(r.id)?.directory_id
    : Number(directoryId);
  if (!who) return { error: 'There is nobody in the rotation to give a turn to' };
  const row = memberRow(r.id, who);
  if (!row) return { error: 'They are not in this rotation', status: 404 };
  const when = date ? String(date) : null;
  if (when && !isDate(when)) return { error: 'That is not a date' };
  const name = nameOf(who);
  const turnId = db.transaction(() => {
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO rotation_turns (rotation_id, directory_id, name, date, note, recorded_by) VALUES (?, ?, ?, ?, ?, ?)
    `).run(r.id, who, name, when, cleanText(note, 500), user?.id ?? null);
    db.prepare('UPDATE rotation_members SET position = ? WHERE id = ?').run(lastPosition(r.id) + 1, row.id);
    return Number(lastInsertRowid);
  })();
  return { turn: db.prepare('SELECT * FROM rotation_turns WHERE id = ?').get(turnId) };
}

// Taking a turn back off. An upcoming turn that is cancelled puts the person
// back at the front, since they never had it; an old one is only taken out of
// the history.
function removeTurn(rotationId, turnId, { requeue = false } = {}) {
  const turn = db.prepare('SELECT * FROM rotation_turns WHERE id = ? AND rotation_id = ?').get(Number(turnId), Number(rotationId));
  if (!turn) return { error: 'No such turn', status: 404 };
  db.transaction(() => {
    db.prepare('DELETE FROM rotation_turns WHERE id = ?').run(turn.id);
    const row = requeue && turn.directory_id ? memberRow(turn.rotation_id, turn.directory_id) : null;
    if (row) db.prepare('UPDATE rotation_members SET position = ? WHERE id = ?').run(firstPosition(turn.rotation_id) - 1, row.id);
  })();
  return { before: turn };
}

// ─── Telling whoever is next ──────────────────────────────────────────────────

// Who should be told they are next, now: the person next up, unless they were
// already told (and nobody has come between). `force` tells them regardless,
// for the coordinator's "Let them know" button.
function whoToTell(rotationId, { force = false } = {}) {
  const r = rotationRow(rotationId);
  if (!r || !r.active) return null;
  const next = nextUp(r.id);
  if (!next) return null;
  if (!force && r.notified_directory_id === next.directory_id) return null;
  return { rotation: r, person: { directoryId: next.directory_id, name: next.name } };
}

function markTold(rotationId, directoryId) {
  db.prepare('UPDATE rotations SET notified_directory_id = ? WHERE id = ?').run(directoryId, rotationId);
}

module.exports = {
  AREA, isDate,
  managesRotations, coordinates,
  rotationRow, list, detail, nextUp, emailFor, coordinatorsOf,
  create, update, remove, setCoordinators,
  addMembers, removeMember, reorder, setSittingOut, sendToBack, giveTurn, removeTurn,
  whoToTell, markTold,
};
