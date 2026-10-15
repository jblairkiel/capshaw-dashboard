// ─── Telling somebody about a change that concerns them ───────────────────────
//
// Plenty of what happens on the portal is one person doing something another
// person is counting on, or now has to count on: the schedule keeper writing a
// man into a Sunday, a list keeper taking somebody's name off, somebody pulling
// out of a month the keeper was relying on them for. Whoever that is hears about
// it here, the same two ways as everywhere else — a notification on their bell
// (any account linked to them) and an email (their directory address, else a
// linked account's) — so it does not depend on their happening to look.
//
// Rules every caller gets for free:
//   · nobody is told about their own doing;
//   · a person is found from a directory id, an account, or — for the pages
//     that keep only a typed name — a name that matches exactly one directory
//     entry, never a guess between two;
//   · like notifications and the action history, a notice is a side effect of
//     a change that has already been saved, and never the reason it fails.
//
// Each page has its own sender below, so each has its own line on the Emails
// page (server/mail/catalog.js) and its own switch in Email Delivery.

const db = require('../db');
const mailer = require('./mailer');
const { link } = require('./notify');
const notifications = require('../lib/notifications');

const firstName = name => String(name || '').split(/\s+/)[0] || 'Hello';

// Who somebody is, from whatever the page knows about them.
function resolve({ directoryId = null, userId = null, name = '' } = {}) {
  let personId = directoryId ? Number(directoryId) : null;
  let personName = name;
  if (!personId && !userId && name) {
    const rows = db.prepare('SELECT id, name FROM directory WHERE lower(trim(name)) = lower(trim(?))').all(name);
    if (rows.length === 1) { personId = rows[0].id; personName = rows[0].name; }
  }
  if (personId && !personName) personName = db.prepare('SELECT name FROM directory WHERE id = ?').get(personId)?.name || '';

  const accounts = new Map();
  if (personId) for (const a of notifications.accountsForDirectory([personId])) accounts.set(a.id, a);
  if (userId) {
    const u = db.prepare("SELECT id, name, email, directory_id FROM users WHERE id = ? AND role <> 'pending'").get(userId);
    if (u) {
      accounts.set(u.id, u);
      if (!personId && u.directory_id) personId = u.directory_id;
      if (!personName) personName = u.name;
    }
  }

  const directoryEmail = personId
    ? (db.prepare("SELECT trim(coalesce(email, '')) AS email FROM directory WHERE id = ?").get(personId)?.email || '')
    : '';
  const accountEmail = [...accounts.values()].map(a => String(a.email || '').trim()).find(Boolean) || '';
  return { directoryId: personId, name: personName, accounts: [...accounts.keys()], email: directoryEmail || accountEmail };
}

function isActor(person, actor) {
  if (!actor) return false;
  if (person.accounts.includes(actor.id)) return true;
  return !!actor.directory_id && !!person.directoryId && actor.directory_id === person.directoryId;
}

const compose = {};

// One plain message for every kind of notice: who it is for, what happened,
// where to see it, and why they are getting it.
compose.notice = ({ name, subject, lines = [], page, params = {}, why }) => ({
  subject,
  body: [
    `${firstName(name)},`,
    '',
    ...lines,
    ...(page ? ['', link(page, params)] : []),
    '',
    `You are getting this because ${why}.`,
  ].join('\n'),
});

// Bell and email for each person. `send` is the page's own sender, so each
// keeps its own line on the Emails page. Returns, per person told, whether
// each way reached them.
function tellEach(people, { kind, subject, lines, page, params, why, subjectType = '', subjectId = null, actor = null }, send) {
  const told = [];
  const seen = new Set();
  for (const who of people) {
    try {
      const person = resolve(who);
      const key = person.directoryId ? `d${person.directoryId}` : person.accounts.length ? `u${person.accounts[0]}` : `n${person.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!person.directoryId && !person.accounts.length) continue;
      if (isActor(person, actor)) continue;

      const notified = notifications.notify({
        users: person.accounts, kind, title: subject, body: lines.join(' ').slice(0, 300),
        subjectType, subjectId, page, actor,
      }) > 0;
      if (person.email) send(compose.notice({ name: person.name, subject, lines, page, params, why }), [{ email: person.email, name: person.name }]);
      told.push({ name: person.name, directoryId: person.directoryId, emailed: !!person.email, notified });
    } catch (err) {
      console.error('[notices] could not tell somebody:', err.message);
    }
  }
  return told;
}

// ─── One sender per page ──────────────────────────────────────────────────────

const servingSchedule = (people, notice, ref) =>
  tellEach(people, notice, (message, to) => mailer.send({ to, ...message, context: `notice:serving:${ref}` }));

const communionPrep = (people, notice, ref) =>
  tellEach(people, notice, (message, to) => mailer.send({ to, ...message, context: `notice:communion-prep:${ref}` }));

const signups = (people, notice, ref) =>
  tellEach(people, notice, (message, to) => mailer.send({ to, ...message, context: `notice:signup:${ref}` }));

const churchGroups = (people, notice, ref) =>
  tellEach(people, notice, (message, to) => mailer.send({ to, ...message, context: `notice:group:${ref}` }));

const rotations = (people, notice, ref) =>
  tellEach(people, notice, (message, to) => mailer.send({ to, ...message, context: `notice:rotation:${ref}` }));

const areas = (people, notice, ref) =>
  tellEach(people, notice, (message, to) => mailer.send({ to, ...message, context: `notice:areas:${ref}` }));

// ─── The serving schedule ─────────────────────────────────────────────────────

// Whether a slot is still to come: its day, or — for a job that belongs to the
// month rather than a day — its month, has not passed. Correcting the record
// of a Sunday already gone tells nobody.
function servingSlotAhead(slot) {
  // Required here rather than at the top: both reach back into the schedule.
  const blackouts = require('../lib/blackouts');
  const { parseMonth } = require('../workflows/scheduling');
  const today = require('../lib/recordKeeping').churchToday();
  const iso = blackouts.dateOf(slot.month, slot.date);
  if (iso) return iso >= today;
  const month = parseMonth(slot.month);
  if (!month) return false;
  return `${month.year}-${String(month.monthIndex + 1).padStart(2, '0')}` >= today.slice(0, 7);
}

const slotWhen = slot => [slot.date || slot.month, slot.service].filter(Boolean).join(', ');

const servingNotice = (slot, actor) => ({
  kind: 'serving-changed', page: 'service-roster', params: { tab: 'scheduled' },
  subjectType: 'serving-slot', subjectId: slot.id, actor, why: 'your name is on the serving schedule',
});

// Somebody put on a slot that was somebody else's or nobody's.
function servingPutOn(slot, name, actor, { replacing = '' } = {}) {
  if (!name || !servingSlotAhead(slot)) return [];
  return servingSchedule([{ name }], { ...servingNotice(slot, actor),
    subject: `You are down for ${slot.job}: ${slotWhen(slot)}`,
    lines: [`${actor?.name || 'The schedule keeper'} has put you down for ${slot.job} on ${slotWhen(slot)}${replacing ? `, in place of ${replacing}` : ''}.`,
      'If you cannot do it, choose "Ask to be replaced" on the slot so whoever keeps the schedule can find somebody.'],
  }, `${slot.id}:assigned`);
}

// Whoever looks after an area — the people a member pulling out is letting
// down. Admins hold every area, but are only told when nobody else does, as
// with replacement requests on the Serving Schedule.
function keepersOf(area) {
  const holders = db.prepare(`
    SELECT u.id FROM users u JOIN user_areas a ON a.user_id = u.id
     WHERE a.area = ? AND u.role = 'approved'
  `).all(area);
  const rows = holders.length ? holders : db.prepare("SELECT id FROM users WHERE role = 'admin'").all();
  return rows.map(r => ({ userId: r.id }));
}

module.exports = { compose, resolve, keepersOf, servingSlotAhead, slotWhen, servingNotice, servingPutOn, servingSchedule, communionPrep, signups, churchGroups, rotations, areas };
