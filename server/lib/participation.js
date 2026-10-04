// Worship participation: who actually served in the worship jobs, and what that
// adds up to over the weeks.
//
// The serving schedule (job_assignments) says who is down for each job. Once a
// service has happened, whoever keeps the schedule checks it: the man down for
// a job served, somebody else stepped in, or nobody did it. That check is
// worship_participation, keyed by the slot's day, service and job (see
// server/schema.js for why not by row id).
//
// Most weeks will never be checked, so the analysis does not throw them away:
// a past slot with a name in it and no check is counted as served as
// scheduled, and said to be so ("as scheduled, not checked"). Asking for
// checked services only leaves those out.

const db = require('../db');
const { dateOf } = require('./blackouts');
const { churchToday, addDays } = require('./recordKeeping');
const { WORSHIP_ROLES } = require('./people');
const worship = require('./worship');

const OUTCOMES = ['served', 'substitute', 'missed'];

const clean = s => String(s ?? '').trim().replace(/\s+/g, ' ');
const keyOf = name => clean(name).toLowerCase();

// ─── The schedule, as slots with days ─────────────────────────────────────────

// Every slot on the schedule with an ISO date, in schedule order. `position`
// tells two of the same job in one service apart (0 for the first).
function scheduledSlots() {
  const seen = new Map();
  const slots = [];
  for (const row of db.prepare('SELECT id, month, date, service, job, name FROM job_assignments ORDER BY id').all()) {
    const date = dateOf(row.month, row.date);
    if (!date || !clean(row.job)) continue;
    const k = `${date}|${row.service}|${row.job}`;
    const position = seen.get(k) ?? 0;
    seen.set(k, position + 1);
    slots.push({ date, service: row.service, job: row.job, position, scheduled: clean(row.name) });
  }
  return slots;
}

function checksBetween(from, to) {
  return new Map(
    db.prepare('SELECT * FROM worship_participation WHERE date BETWEEN ? AND ?').all(from, to)
      .map(c => [`${c.date}|${c.service}|${c.job}|${c.position}`, c]),
  );
}

const slotKey = s => `${s.date}|${s.service}|${s.job}|${s.position}`;

function withChecks(slots, checks) {
  return slots.map(s => {
    const c = checks.get(slotKey(s));
    return c
      ? { ...s, check: { outcome: c.outcome, servedName: c.served_name, note: c.note, scheduledThen: c.scheduled_name, by: c.user_name, at: c.updated_at } }
      : { ...s, check: null };
  });
}

// ─── Directory people ─────────────────────────────────────────────────────────

// Name → directory entry, where a name on the schedule is somebody in the
// directory. Two people sharing a name match neither.
function directoryByName() {
  const map = new Map();
  for (const p of db.prepare("SELECT id, name, gender FROM directory WHERE trim(name) <> ''").all()) {
    const k = keyOf(p.name);
    map.set(k, map.has(k) ? null : p);
  }
  return map;
}

// Who can be picked as having served: the men in the directory and anybody
// the schedule has ever named, in name order.
function servers() {
  const byKey = new Map();
  for (const p of db.prepare("SELECT id, name FROM directory WHERE gender = 'male' AND trim(name) <> ''").all()) {
    byKey.set(keyOf(p.name), { name: clean(p.name), personId: p.id });
  }
  const dir = directoryByName();
  for (const { name } of db.prepare("SELECT DISTINCT name FROM job_assignments WHERE trim(name) <> ''").all()) {
    const k = keyOf(name);
    if (!byKey.has(k)) byKey.set(k, { name: clean(name), personId: dir.get(k)?.id ?? null });
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ─── Recording ────────────────────────────────────────────────────────────────

// The services that have happened in the window, newest first, with how many
// of their slots have been checked.
function services({ weeks = 13, today = churchToday() } = {}) {
  const from = addDays(today, -7 * Math.min(104, Math.max(1, Number(weeks) || 13)));
  const slots = withChecks(scheduledSlots().filter(s => s.date >= from && s.date <= today), checksBetween(from, today));
  const byService = new Map();
  for (const s of slots) {
    const k = `${s.date}|${s.service}`;
    if (!byService.has(k)) byService.set(k, { date: s.date, service: s.service, slots: 0, checked: 0, unfilled: 0 });
    const row = byService.get(k);
    row.slots++;
    if (s.check) row.checked++;
    if (!s.scheduled && !s.check) row.unfilled++;
  }
  return [...byService.values()].sort((a, b) => b.date.localeCompare(a.date) || a.service.localeCompare(b.service));
}

function service({ date, service: name }) {
  const slots = scheduledSlots().filter(s => s.date === date && s.service === name);
  if (!slots.length) return { error: 'There is no such service on the schedule' };
  return { date, service: name, slots: withChecks(slots, checksBetween(date, date)) };
}

function findSlot({ date, service: name, job, position = 0 }) {
  return scheduledSlots().find(s => s.date === date && s.service === name && s.job === job && s.position === Number(position)) || null;
}

// One check: what happened to one slot. outcome null takes the check back off.
function record({ date, service: name, job, position = 0, outcome, servedName = '', note = '' }, user, { today = churchToday() } = {}) {
  const slot = findSlot({ date, service: name, job, position });
  if (!slot) return { error: 'That slot is not on the schedule' };
  if (slot.date > today) return { error: 'That service has not happened yet' };

  if (outcome === null || outcome === undefined || outcome === '') {
    db.prepare('DELETE FROM worship_participation WHERE date = ? AND service = ? AND job = ? AND position = ?')
      .run(slot.date, slot.service, slot.job, slot.position);
    return { check: null, slot };
  }
  if (!OUTCOMES.includes(outcome)) return { error: 'Served, somebody else, or nobody' };

  let served = '';
  if (outcome === 'substitute') {
    served = clean(servedName).slice(0, 80);
    if (!served) return { error: 'Say who served instead' };
    if (keyOf(served) === keyOf(slot.scheduled)) return { error: 'That is who was scheduled; mark it served instead' };
  }
  if (outcome === 'served' && !slot.scheduled) return { error: 'Nobody was scheduled for that; say who did it' };

  db.prepare(`
    INSERT INTO worship_participation (date, service, job, position, scheduled_name, outcome, served_name, note, user_id, user_name, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT (date, service, job, position) DO UPDATE SET
      scheduled_name = excluded.scheduled_name, outcome = excluded.outcome, served_name = excluded.served_name,
      note = excluded.note, user_id = excluded.user_id, user_name = excluded.user_name, updated_at = excluded.updated_at
  `).run(slot.date, slot.service, slot.job, slot.position, slot.scheduled, outcome, served,
    clean(note).slice(0, 300), user?.id ?? null, user?.name || '');
  return { check: { outcome, servedName: served }, slot };
}

// "It went as scheduled": every filled slot not yet checked is marked served.
const recordAllServed = db.transaction(({ date, service: name }, user, { today = churchToday() } = {}) => {
  const found = service({ date, service: name });
  if (found.error) return found;
  if (date > today) return { error: 'That service has not happened yet' };
  let count = 0;
  for (const s of found.slots) {
    if (s.check || !s.scheduled) continue;
    record({ ...s, outcome: 'served' }, user, { today });
    count++;
  }
  return { count };
});

// ─── Analysis ─────────────────────────────────────────────────────────────────

function windowFor({ weeks = 26, today = churchToday() } = {}) {
  const n = Math.min(104, Math.max(1, Number.parseInt(weeks, 10) || 26));
  return { weeks: n, from: addDays(today, -7 * n + 1), to: today };
}

// What one slot comes to: who (if anybody) served it, and how we know.
//   served     — checked: the man scheduled did it
//   substitute — checked: somebody else did it; the man scheduled did not
//   missed     — checked: nobody did it
//   assumed    — not checked, but somebody was down for it
//   unfilled   — not checked, and nobody was down for it
function resolve(slot) {
  const c = slot.check;
  if (c?.outcome === 'served') return { kind: 'served', server: c.scheduledThen || slot.scheduled, scheduled: c.scheduledThen || slot.scheduled };
  if (c?.outcome === 'substitute') return { kind: 'substitute', server: c.servedName, scheduled: c.scheduledThen || slot.scheduled };
  if (c?.outcome === 'missed') return { kind: 'missed', server: null, scheduled: c.scheduledThen || slot.scheduled };
  if (slot.scheduled) return { kind: 'assumed', server: slot.scheduled, scheduled: slot.scheduled };
  return { kind: 'unfilled', server: null, scheduled: '' };
}

function slotsIn(win, { role = '', checkedOnly = false } = {}) {
  return withChecks(scheduledSlots().filter(s => s.date >= win.from && s.date <= win.to && (!role || s.job === role)), checksBetween(win.from, win.to))
    .map(s => ({ ...s, ...resolve(s) }))
    .filter(s => !checkedOnly || s.check);
}

function analysis(options = {}) {
  const win = windowFor(options);
  const slots = slotsIn(win, options);
  const dir = directoryByName();
  const roles = [...new Set([...WORSHIP_ROLES.filter(r => slots.some(s => s.job === r)), ...slots.map(s => s.job)])];

  const people = new Map();
  const personFor = name => {
    const k = keyOf(name);
    if (!people.has(k)) {
      const p = dir.get(k);
      people.set(k, { key: k, name: clean(p?.name || name), personId: p?.id ?? null, served: 0, confirmed: 0, assumed: 0, steppedIn: 0, replaced: 0, missed: 0, scheduled: 0, byRole: {}, lastServed: null });
    }
    return people.get(k);
  };

  const summary = { services: new Set(), slots: slots.length, served: 0, confirmed: 0, assumed: 0, substitutes: 0, missed: 0, unfilled: 0, checkedServices: new Set() };
  const byRole = new Map(roles.map(r => [r, { role: r, slots: 0, served: 0, people: new Map() }]));

  for (const s of slots) {
    summary.services.add(`${s.date}|${s.service}`);
    if (s.check) summary.checkedServices.add(`${s.date}|${s.service}`);
    const role = byRole.get(s.job);
    role.slots++;

    if (s.scheduled) {
      const sch = personFor(s.scheduled);
      sch.scheduled++;
      if (s.kind === 'substitute') sch.replaced++;
      if (s.kind === 'missed') sch.missed++;
    }
    if (s.kind === 'missed') summary.missed++;
    if (s.kind === 'unfilled') summary.unfilled++;
    if (!s.server) continue;

    const p = personFor(s.server);
    p.served++;
    p.byRole[s.job] = (p.byRole[s.job] || 0) + 1;
    if (s.kind === 'assumed') { p.assumed++; summary.assumed++; } else { p.confirmed++; summary.confirmed++; }
    if (s.kind === 'substitute') { p.steppedIn++; summary.substitutes++; }
    if (!p.lastServed || s.date > p.lastServed) p.lastServed = s.date;
    summary.served++;
    role.served++;
    role.people.set(p.key, (role.people.get(p.key) || 0) + 1);
  }

  // Men who said they would do a job and have not done it in the window: the
  // people to ask before leaning on the same few again.
  const prefs = worship.allPreferences();
  const men = db.prepare("SELECT id, name FROM directory WHERE gender = 'male' AND trim(name) <> ''").all();
  const unused = [];
  for (const m of men) {
    const said = prefs.get(m.id) || {};
    const p = people.get(keyOf(m.name));
    const roleList = Object.entries(said)
      .filter(([r, level]) => (level === 'preferred' || level === 'willing') && (!options.role || r === options.role) && !(p?.byRole[r]))
      .map(([r, level]) => ({ role: r, level }));
    if (roleList.length) unused.push({ personId: m.id, name: clean(m.name), roles: roleList, servedAtAll: p?.served || 0 });
  }
  unused.sort((a, b) => a.servedAtAll - b.servedAtAll || a.name.localeCompare(b.name));

  const list = [...people.values()].filter(p => p.served || p.scheduled)
    .sort((a, b) => b.served - a.served || a.name.localeCompare(b.name));

  return {
    ...win,
    role: options.role || '',
    checkedOnly: !!options.checkedOnly,
    roles,
    summary: {
      services: summary.services.size,
      checkedServices: summary.checkedServices.size,
      slots: summary.slots,
      served: summary.served,
      confirmed: summary.confirmed,
      assumed: summary.assumed,
      substitutes: summary.substitutes,
      missed: summary.missed,
      unfilled: summary.unfilled,
      people: list.filter(p => p.served).length,
    },
    byRole: [...byRole.values()].map(r => {
      const counts = [...r.people.values()].sort((a, b) => b - a);
      return { role: r.role, slots: r.slots, served: r.served, people: counts.length, topShare: r.served ? Math.round((counts[0] / r.served) * 100) : null };
    }),
    people: list,
    unused,
  };
}

// One man's record in the window: every slot he was down for or served in.
function person({ name, personId }, options = {}) {
  let wanted = clean(name);
  if (!wanted && personId) wanted = clean(db.prepare('SELECT name FROM directory WHERE id = ?').get(Number(personId))?.name);
  if (!wanted) return { error: 'No such person' };
  const k = keyOf(wanted);
  const win = windowFor(options);
  const history = slotsIn(win, options)
    .filter(s => keyOf(s.scheduled) === k || keyOf(s.server) === k)
    .map(s => ({
      date: s.date, service: s.service, job: s.job,
      kind: keyOf(s.server) === k ? (s.kind === 'substitute' ? 'stepped-in' : s.kind) : (s.kind === 'substitute' ? 'replaced' : s.kind),
      other: s.kind === 'substitute' ? (keyOf(s.server) === k ? s.scheduled : s.server) : '',
      note: s.check?.note || '',
    }))
    .sort((a, b) => b.date.localeCompare(a.date) || a.service.localeCompare(b.service));
  const all = analysis(options);
  const p = all.people.find(x => x.key === k) || { key: k, name: wanted, personId: directoryByName().get(k)?.id ?? null, served: 0, confirmed: 0, assumed: 0, steppedIn: 0, replaced: 0, missed: 0, scheduled: 0, byRole: {}, lastServed: null };
  const prefs = p.personId ? (worship.allPreferences().get(p.personId) || {}) : {};
  return { ...win, person: p, preferences: prefs, history, roles: all.roles };
}

module.exports = { OUTCOMES, scheduledSlots, servers, services, service, record, recordAllServed, analysis, person };
