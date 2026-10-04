// Worship participation: who has served in the worship jobs, what that adds
// up to over the weeks, and what each man has said he will do.
//
// Nothing is confirmed after the fact. The serving schedule (job_assignments),
// as it was last left, is taken to be what happened: a past slot with a name
// in it was served by that man, and a past slot with none was not filled.
// Whoever keeps the schedule changes it when somebody swaps or drops out, so
// the last version of a service is the record of it.
//
// What each man has said comes from his worship preferences (glad to, willing,
// or rather not, per job), set on My Household & Preferences or written down
// for him on the Service Roster.

const db = require('../db');
const { dateOf } = require('./blackouts');
const { churchToday, addDays } = require('./recordKeeping');
const { WORSHIP_ROLES } = require('./people');
const worship = require('./worship');

const clean = s => String(s ?? '').trim().replace(/\s+/g, ' ');
const keyOf = name => clean(name).toLowerCase();

// ─── The schedule, as slots with days ─────────────────────────────────────────

function scheduledSlots() {
  const slots = [];
  for (const row of db.prepare('SELECT month, date, service, job, name FROM job_assignments ORDER BY id').all()) {
    const date = dateOf(row.month, row.date);
    if (!date || !clean(row.job)) continue;
    slots.push({ date, service: row.service, job: row.job, name: clean(row.name) });
  }
  return slots;
}

// ─── Directory people ─────────────────────────────────────────────────────────

// Name → directory entry. Two people sharing a name match neither.
function directoryByName() {
  const map = new Map();
  for (const p of db.prepare("SELECT id, name, gender FROM directory WHERE trim(name) <> ''").all()) {
    const k = keyOf(p.name);
    map.set(k, map.has(k) ? null : p);
  }
  return map;
}

function men() {
  return db.prepare("SELECT id, name FROM directory WHERE gender = 'male' AND trim(name) <> '' ORDER BY name").all()
    .map(m => ({ id: m.id, name: clean(m.name) }));
}

// Everybody the analysis can be about: the men in the directory and anybody
// the schedule has named, in name order.
function servers() {
  const byKey = new Map(men().map(m => [keyOf(m.name), { name: m.name, personId: m.id }]));
  const dir = directoryByName();
  for (const { name } of db.prepare("SELECT DISTINCT name FROM job_assignments WHERE trim(name) <> ''").all()) {
    const k = keyOf(name);
    if (!byKey.has(k)) byKey.set(k, { name: clean(name), personId: dir.get(k)?.id ?? null });
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ─── Analysis ─────────────────────────────────────────────────────────────────

function windowFor({ weeks = 26, today = churchToday() } = {}) {
  const n = Math.min(104, Math.max(1, Number.parseInt(weeks, 10) || 26));
  return { weeks: n, from: addDays(today, -7 * n + 1), to: today };
}

function blankPerson(key, name, personId) {
  return { key, name, personId, served: 0, byRole: {}, lastServed: null, nextScheduled: null };
}

function analysis(options = {}) {
  const win = windowFor(options);
  const role = options.role || '';
  const all = scheduledSlots().filter(s => !role || s.job === role);
  const past = all.filter(s => s.date >= win.from && s.date <= win.to);
  const dir = directoryByName();
  const roles = [...new Set([...WORSHIP_ROLES.filter(r => past.some(s => s.job === r)), ...past.map(s => s.job)])];

  const people = new Map();
  const personFor = name => {
    const k = keyOf(name);
    if (!people.has(k)) {
      const p = dir.get(k);
      people.set(k, blankPerson(k, clean(p?.name || name), p?.id ?? null));
    }
    return people.get(k);
  };

  const services = new Set();
  const byRole = new Map(roles.map(r => [r, { role: r, slots: 0, served: 0, people: new Map() }]));
  let served = 0;
  for (const s of past) {
    services.add(`${s.date}|${s.service}`);
    const r = byRole.get(s.job);
    r.slots++;
    if (!s.name) continue;
    const p = personFor(s.name);
    p.served++;
    p.byRole[s.job] = (p.byRole[s.job] || 0) + 1;
    if (!p.lastServed || s.date > p.lastServed) p.lastServed = s.date;
    r.served++;
    r.people.set(p.key, (r.people.get(p.key) || 0) + 1);
    served++;
  }

  // When each man is next on the schedule, so "not served lately" can be told
  // apart from "already down for next week".
  for (const s of all) {
    if (s.date <= win.to || !s.name) continue;
    const p = people.get(keyOf(s.name));
    if (p && (!p.nextScheduled || s.date < p.nextScheduled)) p.nextScheduled = s.date;
  }

  // Men who said they would do a job and have not done it in the window.
  const prefs = worship.allPreferences();
  const unused = [];
  for (const m of men()) {
    const said = prefs.get(m.id) || {};
    const p = people.get(keyOf(m.name));
    const list = Object.entries(said)
      .filter(([r, level]) => (level === 'preferred' || level === 'willing') && (!role || r === role) && !(p?.byRole[r]))
      .map(([r, level]) => ({ role: r, level }));
    if (list.length) unused.push({ personId: m.id, name: m.name, roles: list, servedAtAll: p?.served || 0 });
  }
  unused.sort((a, b) => a.servedAtAll - b.servedAtAll || a.name.localeCompare(b.name));

  const list = [...people.values()].sort((a, b) => b.served - a.served || a.name.localeCompare(b.name));
  return {
    ...win,
    role,
    roles,
    summary: { services: services.size, slots: past.length, served, unfilled: past.length - served, people: list.length },
    byRole: [...byRole.values()].map(r => {
      const counts = [...r.people.values()].sort((a, b) => b - a);
      return { role: r.role, slots: r.slots, served: r.served, people: counts.length, topShare: r.served ? Math.round((counts[0] / r.served) * 100) : null };
    }),
    people: list,
    unused,
  };
}

// One man's record in the window, and what he has said.
function person({ name, personId }, options = {}) {
  let wanted = clean(name);
  if (!wanted && personId) wanted = clean(db.prepare('SELECT name FROM directory WHERE id = ?').get(Number(personId))?.name);
  if (!wanted) return { error: 'No such person' };
  const k = keyOf(wanted);
  const win = windowFor(options);
  const history = scheduledSlots()
    .filter(s => keyOf(s.name) === k && s.date >= win.from && (!options.role || s.job === options.role))
    .map(s => ({ date: s.date, service: s.service, job: s.job, upcoming: s.date > win.to }))
    .sort((a, b) => b.date.localeCompare(a.date) || a.service.localeCompare(b.service));
  const all = analysis(options);
  const found = all.people.find(x => x.key === k);
  const dirPerson = directoryByName().get(k);
  const p = found || blankPerson(k, clean(dirPerson?.name || wanted), dirPerson?.id ?? null);
  if (!found) p.nextScheduled = history.find(h => h.upcoming) ? history.filter(h => h.upcoming).at(-1).date : null;
  return {
    ...win,
    person: p,
    preferences: p.personId ? (worship.allPreferences().get(p.personId) || {}) : {},
    notes: p.personId ? worship.notesOf(p.personId) : '',
    history,
    roles: all.roles,
  };
}

// ─── What each man has said ───────────────────────────────────────────────────

// Every man in the directory, his answer for each job, when he last changed
// them, and how often he has served each job in the window — so what he said
// can be read beside what he has done. Plus, per job, how many are glad,
// willing or would rather not, and how many have said nothing.
function preferences(options = {}) {
  const win = windowFor(options);
  const prefs = worship.allPreferences();
  const notes = worship.allNotes();
  const updated = new Map(
    db.prepare('SELECT directory_id, MAX(updated_at) AS at FROM worship_preferences GROUP BY directory_id').all()
      .map(r => [r.directory_id, r.at]),
  );
  const served = new Map(analysis(options).people.map(p => [p.key, p]));

  const rows = men().map(m => {
    const said = prefs.get(m.id) || {};
    const p = served.get(keyOf(m.name));
    return {
      personId: m.id,
      name: m.name,
      preferences: said,
      said: Object.keys(said).length,
      updatedAt: updated.get(m.id) || null,
      notes: notes.get(m.id) || '',
      served: p?.byRole || {},
      servedTotal: p?.served || 0,
    };
  });

  const coverage = WORSHIP_ROLES.map(role => {
    const levels = rows.map(r => r.preferences[role]);
    return {
      role,
      glad: levels.filter(l => l === 'preferred').length,
      willing: levels.filter(l => l === 'willing').length,
      unavailable: levels.filter(l => l === 'unavailable').length,
      unsaid: levels.filter(l => !l).length,
    };
  });

  return {
    ...win,
    roles: WORSHIP_ROLES,
    men: rows,
    coverage,
    summary: {
      men: rows.length,
      said: rows.filter(r => r.said).length,
      unsaid: rows.filter(r => !r.said).length,
    },
  };
}

module.exports = { scheduledSlots, servers, analysis, person, preferences };
