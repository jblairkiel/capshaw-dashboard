// ─── Rotation email ───────────────────────────────────────────────────────────
//
// Three messages, each an email and a notification in the portal:
//
//   · Next up. When a rotation moves on — somebody takes a turn, or is sent to
//     the back — whoever is now next up is told, so they can get ready.
//     Reordering the queue tells nobody, since that is usually somebody setting
//     it up; a coordinator can tell the person next up at any time with "Let
//     them know". The rotation remembers who it last told
//     (notified_directory_id), so one wait means one email.
//   · Given a turn. A coordinator gives somebody a turn dated today or later:
//     they are told what and when straight away.
//   · Reminder. A week before a dated turn, on a timer (tick). Each is claimed
//     on the turn (reminded_at) before it is sent, so a restart never sends it
//     twice. A turn given inside that week is claimed when it is given — the
//     "given a turn" message already said when.

const db = require('../db');
const mailer = require('./mailer');
const { link } = require('./notify');
const notifications = require('../lib/notifications');
const rotations = require('../lib/rotations');
// Read through the module, so a test can say what day it is.
const recordKeeping = require('../lib/recordKeeping');
const churchToday = now => recordKeeping.churchToday(now);

// How many days before a turn its reminder goes out.
const REMINDER_DAYS = 7;

function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function longDate(iso) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

const firstName = name => String(name || '').split(/\s+/)[0] || 'Hello';

function whoToAsk(coordinators) {
  return coordinators.length
    ? `If you can no longer do it, please let ${coordinators.map(c => c.name).join(' or ')} know as soon as you can.`
    : 'If you can no longer do it, please let whoever keeps the rotation know as soon as you can.';
}

const compose = {};

compose.nextUp = ({ name, rotation, coordinators = [] }) => {
  const greeting = String(name || '').split(/\s+/)[0] || 'Hello';
  const whoToAsk = coordinators.length
    ? `${coordinators.map(c => c.name).join(' or ')} will be in touch about when. If you cannot do it this time, please let them know.`
    : 'If you cannot do it this time, please let whoever keeps the rotation know.';
  return {
    subject: `You are next up: ${rotation.name}`,
    body: [
      `${greeting},`,
      '',
      `You are next up on the "${rotation.name}" rotation.`,
      ...(rotation.description ? ['', rotation.description] : []),
      '',
      whoToAsk,
      '',
      'See the rotation, and who comes after you, here:',
      link('rotations', { rotation: rotation.id }),
      '',
      'You are getting this because your name is on this rotation.',
    ].join('\n'),
  };
};

compose.turnGiven = ({ name, rotation, turn, coordinators = [] }) => ({
  subject: `${rotation.name}: you are down for ${longDate(turn.date)}`,
  body: [
    `${firstName(name)},`,
    '',
    `You have been given the next turn on the "${rotation.name}" rotation, on ${longDate(turn.date)}.`,
    ...(turn.note ? ['', `Note: ${turn.note}`] : []),
    ...(rotation.description ? ['', rotation.description] : []),
    '',
    whoToAsk(coordinators),
    '',
    turn.date > addDays(churchToday(), REMINDER_DAYS)
      ? 'We will send you a reminder a week before. The rotation is here:'
      : 'The rotation is here:',
    link('rotations', { rotation: rotation.id }),
    '',
    'You are getting this because your name is on this rotation.',
  ].join('\n'),
});

compose.turnReminder = ({ name, rotation, turn, coordinators = [] }) => ({
  subject: `Reminder: ${rotation.name} on ${longDate(turn.date)}`,
  body: [
    `${firstName(name)},`,
    '',
    `This is a reminder that your turn on the "${rotation.name}" rotation is on ${longDate(turn.date)}.`,
    ...(turn.note ? ['', `Note: ${turn.note}`] : []),
    '',
    whoToAsk(coordinators),
    '',
    'The rotation is here:',
    link('rotations', { rotation: rotation.id }),
    '',
    'You are getting this because your name is on this rotation.',
  ].join('\n'),
});

// Email (if there is an address) and the bell (if there is an account). Says
// which it managed.
function deliver({ person, compose: message, context, kind, rotation, actor = null }) {
  const email = rotations.emailFor(person.directoryId);
  if (email) mailer.send({ to: [{ email, name: person.name }], ...message, context });
  const accounts = notifications.accountsForDirectory([person.directoryId]);
  const written = notifications.notify({
    users: accounts, kind, title: message.subject, body: rotation.description || '',
    subjectType: 'rotation', subjectId: rotation.id, actor,
  });
  return { emailed: !!email, notified: written > 0 };
}

const coordinatorNames = rotationId => rotations.coordinatorsOf(rotationId).map(c => ({ name: c.name }));

// A turn has just been given. Somebody given a turn dated today or later is
// told what and when; a turn written down after the fact (no date, or a past
// one) tells nobody. Nobody is told about a turn they gave themselves.
function tellTurnGiven(turn, { actor = null, now = new Date() } = {}) {
  try {
    const today = churchToday(now);
    if (!turn?.date || turn.date < today || !turn.directory_id) return null;
    const rotation = rotations.rotationRow(turn.rotation_id);
    if (!rotation) return null;
    // Inside the reminder window this is the reminder too.
    if (turn.date <= addDays(today, REMINDER_DAYS)) {
      db.prepare("UPDATE rotation_turns SET reminded_at = datetime('now') WHERE id = ? AND reminded_at IS NULL").run(turn.id);
    }
    if (actor?.directory_id && actor.directory_id === turn.directory_id) return null;
    const person = { directoryId: turn.directory_id, name: turn.name };
    const sent = deliver({
      person, rotation, actor, kind: 'rotation-turn-given',
      compose: compose.turnGiven({ name: person.name, rotation, turn, coordinators: coordinatorNames(rotation.id) }),
      context: `rotation:${rotation.id}:turn:${turn.id}:given`,
    });
    return { ...person, ...sent };
  } catch (err) {
    console.error('[rotations] could not tell somebody about their turn:', err.message);
    return null;
  }
}

// The turns whose reminder is due today: dated within the week ahead, on a
// rotation still in use, and nobody reminded yet.
function due(today) {
  return db.prepare(`
    SELECT t.* FROM rotation_turns t JOIN rotations r ON r.id = t.rotation_id
     WHERE r.active = 1 AND t.reminded_at IS NULL AND t.directory_id IS NOT NULL
       AND t.date IS NOT NULL AND t.date > ? AND t.date <= ?
  `).all(today, addDays(today, REMINDER_DAYS));
}

// Called on a timer. Returns what it sent.
function tick(now = new Date()) {
  const today = churchToday(now);
  const sent = [];
  for (const turn of due(today)) {
    const person = { directoryId: turn.directory_id, name: turn.name };
    // Nobody to tell yet: try again next tick, in case an address is added.
    if (!rotations.emailFor(person.directoryId) && !notifications.accountsForDirectory([person.directoryId]).length) continue;
    const claimed = db.prepare("UPDATE rotation_turns SET reminded_at = datetime('now') WHERE id = ? AND reminded_at IS NULL").run(turn.id).changes;
    if (!claimed) continue;
    const rotation = rotations.rotationRow(turn.rotation_id);
    deliver({
      person, rotation, kind: 'rotation-turn-reminder',
      compose: compose.turnReminder({ name: person.name, rotation, turn, coordinators: coordinatorNames(rotation.id) }),
      context: `rotation:${rotation.id}:turn:${turn.id}:reminder`,
    });
    sent.push({ name: person.name, rotation: rotation.name, date: turn.date });
  }
  return sent;
}

// Tells whoever is next up, if they have not been told already (or regardless,
// with `force`). Returns who was told, or null. Never the reason a change
// fails: anything that goes wrong here is logged and dropped.
function tellNextUp(rotationId, { actor = null, force = false } = {}) {
  try {
    const due = rotations.whoToTell(rotationId, { force });
    if (!due) return null;
    const { rotation, person } = due;
    rotations.markTold(rotation.id, person.directoryId);

    const sent = deliver({
      person, rotation, actor, kind: 'rotation-next-up',
      compose: compose.nextUp({ name: person.name, rotation, coordinators: coordinatorNames(rotation.id) }),
      context: `rotation:${rotation.id}:next-up`,
    });
    return { ...person, ...sent };
  } catch (err) {
    console.error('[rotations] could not tell whoever is next:', err.message);
    return null;
  }
}

module.exports = { compose, tellNextUp, tellTurnGiven, tick, due, REMINDER_DAYS };
