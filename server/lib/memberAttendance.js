// Member attendance: who was at each service, one mark per person, and what
// the marks add up to — for the congregation as a whole and for one person.
//
// A "roll" is one service on one date. It counts as taken the moment anybody
// on it has been marked, which is what the Record Keeping report reads
// (server/lib/recordKeeping.js). Somebody left unmarked on a roll that was
// taken is "not marked", never quietly absent: the tracker may simply not
// have got to them.
//
// What a mark can say is the status list (attendance_statuses), which the
// member attendance tracker keeps. A status that has been used is retired
// rather than deleted, so a mark never points at nothing.

const db = require('../db');
const { churchToday, addDays } = require('./recordKeeping');

// The chart palette's slots, in the order they are handed out. The client
// holds the colours; the server only checks a tone is one of these.
const TONES = ['blue', 'orange', 'aqua', 'yellow', 'magenta', 'green', 'violet', 'red'];

const isIsoDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))
  && !Number.isNaN(Date.parse(`${s}T12:00:00Z`))
  && new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s;

// Sorted and lettered by surname — the last word of the name, the same rule as
// the newsletter and the directory.
const surnameOf = name => String(name || '').trim().split(/\s+/).pop() || '';

function bySurname(a, b) {
  return surnameOf(a.name).localeCompare(surnameOf(b.name), undefined, { sensitivity: 'base' })
    || String(a.name).localeCompare(String(b.name));
}

// ─── The roll ─────────────────────────────────────────────────────────────────

// Everybody in the directory, in roll order, with the letter they are filed
// under. A directory row with no name is a scrape artefact, not a person.
function people() {
  return db.prepare("SELECT id, name, photo FROM directory WHERE trim(name) <> ''").all()
    .map(p => {
      const surname = surnameOf(p.name);
      const first = surname.charAt(0).toUpperCase();
      return { id: p.id, name: p.name, surname, letter: /[A-Z]/.test(first) ? first : '#', has_photo: !!p.photo };
    })
    .sort(bySurname);
}

function photoOf(personId) {
  return db.prepare('SELECT photo FROM directory WHERE id = ?').get(personId)?.photo || '';
}

function services() {
  return db.prepare('SELECT id, name, weekday, active FROM service_types WHERE active = 1 ORDER BY sort_order, name').all();
}

function serviceNamed(name) {
  return db.prepare('SELECT name FROM service_types WHERE lower(name) = lower(?)').get(String(name || '').trim())?.name || null;
}

function roll({ date, service }) {
  if (!isIsoDate(date)) return { error: 'A date is needed, as YYYY-MM-DD' };
  const name = serviceNamed(service);
  if (!name) return { error: 'No such service' };

  const marks = {};
  for (const m of db.prepare('SELECT person_id, status_id, user_name, updated_at FROM member_attendance WHERE date = ? AND service = ?').all(date, name)) {
    marks[m.person_id] = { statusId: m.status_id, by: m.user_name, at: m.updated_at };
  }
  return { date, service: name, people: people(), marks };
}

// One tap: set somebody's mark on a roll, or take it off (statusId null).
function mark({ date, service, personId, statusId }, user) {
  if (!isIsoDate(date)) return { error: 'A date is needed, as YYYY-MM-DD' };
  const name = serviceNamed(service);
  if (!name) return { error: 'No such service' };
  const person = db.prepare('SELECT id, name FROM directory WHERE id = ?').get(Number(personId));
  if (!person) return { error: 'No such person' };

  if (statusId === null || statusId === undefined || statusId === '') {
    db.prepare('DELETE FROM member_attendance WHERE person_id = ? AND date = ? AND service = ?').run(person.id, date, name);
    return { mark: null };
  }

  const status = db.prepare('SELECT id, active FROM attendance_statuses WHERE id = ?').get(Number(statusId));
  if (!status) return { error: 'No such status' };
  if (!status.active) return { error: 'That status has been retired' };

  db.prepare(`
    INSERT INTO member_attendance (person_id, date, service, status_id, user_id, user_name, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT (person_id, date, service) DO UPDATE SET
      status_id = excluded.status_id, user_id = excluded.user_id,
      user_name = excluded.user_name, updated_at = excluded.updated_at
  `).run(person.id, date, name, status.id, user?.id ?? null, user?.name || '');
  return { mark: { statusId: status.id, by: user?.name || '' } };
}

// "Everybody else was absent": mark whoever is still unmarked on a roll.
const markRest = db.transaction(({ date, service, statusId }, user) => {
  if (!isIsoDate(date)) return { error: 'A date is needed, as YYYY-MM-DD' };
  const name = serviceNamed(service);
  if (!name) return { error: 'No such service' };
  const status = db.prepare('SELECT id, label, active FROM attendance_statuses WHERE id = ?').get(Number(statusId));
  if (!status) return { error: 'No such status' };
  if (!status.active) return { error: 'That status has been retired' };

  const marked = new Set(db.prepare('SELECT person_id FROM member_attendance WHERE date = ? AND service = ?').all(date, name).map(r => r.person_id));
  const ins = db.prepare(`
    INSERT INTO member_attendance (person_id, date, service, status_id, user_id, user_name) VALUES (?, ?, ?, ?, ?, ?)
  `);
  let count = 0;
  for (const p of people()) {
    if (marked.has(p.id)) continue;
    ins.run(p.id, date, name, status.id, user?.id ?? null, user?.name || '');
    count++;
  }
  return { count, status: status.label, service: name, date };
});

// ─── The status list ──────────────────────────────────────────────────────────

function statuses() {
  return db.prepare(`
    SELECT s.*, (SELECT COUNT(*) FROM member_attendance m WHERE m.status_id = s.id) AS uses
      FROM attendance_statuses s ORDER BY s.sort_order, s.id
  `).all();
}

const statusById = id => db.prepare('SELECT * FROM attendance_statuses WHERE id = ?').get(id);

function cleanLabel(label) {
  return String(label ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
}

function labelTaken(label, exceptId = null) {
  return !!db.prepare('SELECT id FROM attendance_statuses WHERE lower(label) = lower(?) AND id IS NOT ?').get(label, exceptId);
}

function addStatus({ label, tone, countsPresent }) {
  const name = cleanLabel(label);
  if (!name) return { error: 'A status needs a name' };
  if (labelTaken(name)) return { error: 'There is already a status with that name' };
  const used = new Set(db.prepare('SELECT tone FROM attendance_statuses WHERE active = 1').all().map(r => r.tone));
  const colour = TONES.includes(tone) ? tone : (TONES.find(t => !used.has(t)) || TONES[0]);
  const order = (db.prepare('SELECT MAX(sort_order) AS n FROM attendance_statuses').get().n ?? -1) + 1;
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO attendance_statuses (label, tone, counts_present, sort_order) VALUES (?, ?, ?, ?)
  `).run(name, colour, countsPresent ? 1 : 0, order);
  return { status: statusById(lastInsertRowid) };
}

function updateStatus(id, changes = {}) {
  const before = statusById(id);
  if (!before) return { error: 'No such status' };
  const next = { ...before };

  if (changes.label !== undefined) {
    const name = cleanLabel(changes.label);
    if (!name) return { error: 'A status needs a name' };
    if (labelTaken(name, id)) return { error: 'There is already a status with that name' };
    next.label = name;
  }
  if (changes.tone !== undefined) {
    if (!TONES.includes(changes.tone)) return { error: 'That is not one of the colours' };
    next.tone = changes.tone;
  }
  if (changes.countsPresent !== undefined) next.counts_present = changes.countsPresent ? 1 : 0;
  if (changes.active !== undefined) {
    next.active = changes.active ? 1 : 0;
    if (!next.active && !db.prepare('SELECT COUNT(*) AS n FROM attendance_statuses WHERE active = 1 AND id <> ?').get(id).n) {
      return { error: 'The roll needs at least one status' };
    }
  }
  if (changes.sortOrder !== undefined) next.sort_order = Number(changes.sortOrder) || 0;

  db.prepare('UPDATE attendance_statuses SET label = ?, tone = ?, counts_present = ?, active = ?, sort_order = ? WHERE id = ?')
    .run(next.label, next.tone, next.counts_present, next.active, next.sort_order, id);
  return { before, status: statusById(id) };
}

// Only a status nobody has been marked with can go; one that has been used is
// retired instead, so the marks under it still mean something.
function removeStatus(id) {
  const status = statusById(id);
  if (!status) return { error: 'No such status', code: 404 };
  if (db.prepare('SELECT COUNT(*) AS n FROM member_attendance WHERE status_id = ?').get(id).n) {
    return { error: 'People have been marked with this status. Retire it instead.' };
  }
  if (status.active && !db.prepare('SELECT COUNT(*) AS n FROM attendance_statuses WHERE active = 1 AND id <> ?').get(id).n) {
    return { error: 'The roll needs at least one status' };
  }
  db.prepare('DELETE FROM attendance_statuses WHERE id = ?').run(id);
  return { removed: status };
}

// ─── Analytics ────────────────────────────────────────────────────────────────

// The window the analytics read: the last `weeks` weeks up to today, and one
// service or all of them. Marks dated after today (somebody marked "out of
// town" ahead of a trip) wait until the day comes.
function windowFor({ weeks = 13, service = '', today = churchToday() } = {}) {
  const n = Math.min(104, Math.max(1, Number.parseInt(weeks, 10) || 13));
  const from = addDays(today, -7 * n + 1);
  const name = service ? serviceNamed(service) : '';
  return { from, to: today, weeks: n, service: name || '' };
}

function marksIn({ from, to, service }, personId = null) {
  const where = ['m.date BETWEEN ? AND ?'];
  const params = [from, to];
  if (service) { where.push('m.service = ?'); params.push(service); }
  if (personId !== null) { where.push('m.person_id = ?'); params.push(personId); }
  return db.prepare(`
    SELECT m.person_id, m.date, m.service, m.status_id, s.counts_present AS present
      FROM member_attendance m JOIN attendance_statuses s ON s.id = m.status_id
     WHERE ${where.join(' AND ')}
     ORDER BY m.date, m.service
  `).all(...params);
}

const rate = (present, marked) => (marked ? Math.round((present / marked) * 1000) / 10 : null);

// How many of somebody's most recent marks, newest first, were not "present".
function missedInARow(marks) {
  let n = 0;
  for (let i = marks.length - 1; i >= 0 && !marks[i].present; i--) n++;
  return n;
}

function groupAnalytics(options = {}) {
  const win = windowFor(options);
  const marks = marksIn(win);
  const everyone = people();
  const byPerson = new Map(everyone.map(p => [p.id, { ...p, marks: [] }]));

  const rolls = new Map();
  const totals = {};
  for (const m of marks) {
    const key = `${m.date}|${m.service}`;
    if (!rolls.has(key)) rolls.set(key, { date: m.date, service: m.service, counts: {}, present: 0, marked: 0 });
    const r = rolls.get(key);
    r.counts[m.status_id] = (r.counts[m.status_id] || 0) + 1;
    r.marked++;
    if (m.present) r.present++;
    totals[m.status_id] = (totals[m.status_id] || 0) + 1;
    byPerson.get(m.person_id)?.marks.push(m);
  }

  const rollList = [...rolls.values()].sort((a, b) => a.date.localeCompare(b.date) || a.service.localeCompare(b.service));
  const present = rollList.reduce((n, r) => n + r.present, 0);
  const marked = rollList.reduce((n, r) => n + r.marked, 0);

  const members = [...byPerson.values()].map(({ marks: list, ...p }) => {
    const here = list.filter(m => m.present);
    return {
      id: p.id, name: p.name, letter: p.letter, has_photo: p.has_photo,
      marked: list.length,
      present: here.length,
      rate: rate(here.length, list.length),
      lastPresent: here.length ? here[here.length - 1].date : null,
      missedInARow: missedInARow(list),
    };
  });

  return {
    ...win,
    rolls: rollList,
    totals,
    summary: {
      rolls: rollList.length,
      marked,
      present,
      rate: rate(present, marked),
      averagePresent: rollList.length ? Math.round((present / rollList.length) * 10) / 10 : null,
      people: everyone.length,
    },
    members,
  };
}

function personAnalytics(personId, options = {}) {
  const person = db.prepare('SELECT id, name, photo FROM directory WHERE id = ?').get(Number(personId));
  if (!person) return { error: 'No such person' };
  const win = windowFor(options);
  const marks = marksIn(win, person.id);

  const counts = {};
  const services = new Map();
  for (const m of marks) {
    counts[m.status_id] = (counts[m.status_id] || 0) + 1;
    if (!services.has(m.service)) services.set(m.service, { service: m.service, marked: 0, present: 0 });
    const s = services.get(m.service);
    s.marked++;
    if (m.present) s.present++;
  }
  const present = marks.filter(m => m.present).length;
  // How many rolls in the window this person was not on at all.
  const rollsInWindow = db.prepare(`
    SELECT COUNT(*) AS n FROM (SELECT DISTINCT date, service FROM member_attendance
     WHERE date BETWEEN ? AND ? ${win.service ? 'AND service = ?' : ''})
  `).get(...[win.from, win.to, ...(win.service ? [win.service] : [])]).n;

  return {
    ...win,
    person: { id: person.id, name: person.name, has_photo: !!person.photo },
    counts,
    summary: {
      marked: marks.length,
      present,
      rate: rate(present, marks.length),
      notMarked: Math.max(0, rollsInWindow - marks.length),
      missedInARow: missedInARow(marks),
      lastPresent: [...marks].reverse().find(m => m.present)?.date ?? null,
    },
    byService: [...services.values()].map(s => ({ ...s, rate: rate(s.present, s.marked) })),
    history: [...marks].reverse().map(m => ({ date: m.date, service: m.service, statusId: m.status_id })),
  };
}

module.exports = {
  TONES, surnameOf, people, photoOf, services, roll, mark, markRest,
  statuses, addStatus, updateStatus, removeStatus,
  groupAnalytics, personAnalytics,
};
