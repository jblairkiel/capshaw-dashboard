// The Record Keeping report: for each recent week, which services got their
// songs and guests on file, and whether the Sunday's contribution was.
//
// Nothing here is stored. Each check reads the page that owns the record — the
// song tracker, the guest book, the contribution counter — and a service
// counts as recorded the moment that page has something for it. The only thing
// this adds is a sign-off (record_checkoffs) for "there was nothing to record"
// or "this service did not happen", so a quiet week is not reported as a
// forgotten one.
//
// Which services are expected, and on what day, is set per service type (see
// the tracking / weekday / song_names columns in server/schema.js).

const db = require('../db');
const { parseAnyDate } = require('./contributions');

// What is checked. `scope` says what one cell is about: a service on a date,
// the Sunday as a whole, or one church group's meeting. A new kind of check is
// a new entry here with a scope of its own.
//
// A group meeting has no "nothing to record": a meeting nobody came to has a
// head count of 0, and one that did not happen is cancelled on the group page.
const CHECKS = [
  { id: 'songs',        label: 'Songs',        scope: 'service', area: 'songs',         page: 'songs',         noneLabel: 'No songs to record' },
  { id: 'guests',       label: 'Guests',       scope: 'service', area: 'visitors',      page: 'visitors',      noneLabel: 'No guests' },
  { id: 'contribution', label: 'Contribution', scope: 'sunday',  area: 'contributions', page: 'contributions', noneLabel: 'No contribution taken' },
  { id: 'head-count',   label: 'Head count',   scope: 'meeting', area: 'church-groups', page: 'groups',        noneLabel: null },
];
const CHECK_IDS = new Set([...CHECKS.filter(c => c.noneLabel).map(c => c.id), 'not-held']);
const TRACKING = ['weekly', 'when-held', ''];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ─── Dates ────────────────────────────────────────────────────────────────────

// "Today" is the church's today. On a server running in UTC a Sunday evening
// service would otherwise already be Monday.
function churchToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const weekdayOf = iso => new Date(`${iso}T12:00:00Z`).getUTCDay();
const sundayOf = iso => addDays(iso, -weekdayOf(iso));

// ─── What is on file ──────────────────────────────────────────────────────────

const lower = s => String(s || '').trim().toLowerCase();

// Every record in the window, as a set of "date|service" keys (dates made
// ISO — the guest book writes 06/03/26, everything else 2026-06-03).
function keysFrom(rows, from, to) {
  const keys = new Set();
  for (const r of rows) {
    const date = parseAnyDate(r.date);
    if (date && date >= from && date <= to) keys.add(`${date}|${lower(r.service)}`);
  }
  return keys;
}

function onFile(from, to) {
  const songs = keysFrom(db.prepare(`
    SELECT s.date, s.service FROM song_services s
     WHERE EXISTS (SELECT 1 FROM service_songs x WHERE x.service_id = s.id)
  `).all(), from, to);
  const guests = keysFrom(db.prepare('SELECT date, service FROM visitor_visits').all(), from, to);
  const attendance = keysFrom(db.prepare('SELECT date, service FROM attendance WHERE count > 0').all(), from, to);
  const contributions = new Set(
    db.prepare('SELECT date FROM contributions').all().map(r => parseAnyDate(r.date)).filter(Boolean),
  );
  const checkoffs = new Map(
    db.prepare('SELECT * FROM record_checkoffs WHERE date BETWEEN ? AND ?').all(from, to)
      .map(c => [`${c.date}|${lower(c.service)}|${c.check_id}`, c]),
  );
  return { songs, guests, attendance, contributions, checkoffs };
}

// ─── Services ─────────────────────────────────────────────────────────────────

function trackedServices() {
  return db.prepare(`
    SELECT id, name, tracking, weekday, song_names FROM service_types
     WHERE active = 1 AND tracking IN ('weekly', 'when-held')
     ORDER BY sort_order, name
  `).all().map(s => ({
    ...s,
    // The song tracker names services its own way; either name counts.
    songKeys: [s.name, ...String(s.song_names || '').split(',')].map(lower).filter(Boolean),
  }));
}

// The dates in one week a service is expected. A weekly service is expected
// on its day whatever is on file; one held only sometimes is expected only on
// a date something shows it happened.
function datesFor(service, weekStart, today, files) {
  const days = service.weekday === null || service.weekday === undefined
    ? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
    : [addDays(weekStart, service.weekday)];
  const past = days.filter(d => d <= today);
  if (service.tracking === 'weekly' && service.weekday !== null && service.weekday !== undefined) return past;

  const name = lower(service.name);
  return past.filter(d =>
    files.attendance.has(`${d}|${name}`) ||
    files.guests.has(`${d}|${name}`) ||
    service.songKeys.some(k => files.songs.has(`${d}|${k}`)));
}

function cell({ done, checkoff }) {
  if (done) return { status: 'recorded' };
  if (checkoff) return { status: 'none', checkoffId: checkoff.id, by: checkoff.user_name, note: checkoff.note };
  return { status: 'missing' };
}

// Every posted group meeting in the window. A cancelled one did not happen,
// and a draft was never called.
function meetingsIn(from, to) {
  return db.prepare(`
    SELECT e.id, e.group_id, e.title, e.event_date, e.head_count, g.name AS group_name
      FROM group_events e JOIN church_groups g ON g.id = e.group_id
     WHERE e.status = 'published' AND e.event_date BETWEEN ? AND ?
     ORDER BY e.event_date, g.sort_order, g.name, e.id
  `).all(from, to).map(e => ({
    eventId: e.id,
    groupId: e.group_id,
    group:   e.group_name,
    title:   e.title,
    date:    e.event_date,
    cell:    e.head_count === null ? { status: 'missing' } : { status: 'recorded', count: e.head_count },
  }));
}

// ─── The report ───────────────────────────────────────────────────────────────

function report({ weeks = 8, today = churchToday() } = {}) {
  const thisWeek = sundayOf(today);
  const from = addDays(thisWeek, -7 * (weeks - 1));
  const files = onFile(from, today);
  const services = trackedServices();
  const meetings = meetingsIn(from, today);
  const off = (date, service, check) => files.checkoffs.get(`${date}|${lower(service)}|${check}`) || null;

  const out = [];
  const missing = Object.fromEntries(CHECKS.map(c => [c.id, 0]));

  for (let w = 0; w < weeks; w++) {
    const start = addDays(thisWeek, -7 * w);
    const rows = [];

    for (const service of services) {
      for (const date of datesFor(service, start, today, files)) {
        const notHeld = off(date, service.name, 'not-held');
        const row = { date, service: service.name, tracking: service.tracking, cells: {} };
        if (notHeld) {
          row.notHeld = { checkoffId: notHeld.id, by: notHeld.user_name, note: notHeld.note };
        } else {
          row.cells.songs = cell({ done: service.songKeys.some(k => files.songs.has(`${date}|${k}`)), checkoff: off(date, service.name, 'songs') });
          row.cells.guests = cell({ done: files.guests.has(`${date}|${lower(service.name)}`), checkoff: off(date, service.name, 'guests') });
          for (const [id, c] of Object.entries(row.cells)) if (c.status === 'missing') missing[id]++;
        }
        rows.push(row);
      }
    }
    rows.sort((a, b) => a.date.localeCompare(b.date) || a.service.localeCompare(b.service));

    // The week's total counts whatever day it was dated — an import or a
    // Monday entry is still that Sunday's contribution.
    const counted = [...files.contributions].some(d => d >= start && d <= addDays(start, 6));
    const sunday = start <= today
      ? { date: start, ...cell({ done: counted, checkoff: off(start, '', 'contribution') }) }
      : null;
    if (sunday?.status === 'missing') missing.contribution++;

    const end = addDays(start, 6);
    const held = meetings.filter(m => m.date >= start && m.date <= end);
    missing['head-count'] += held.filter(m => m.cell.status === 'missing').length;

    out.push({ start, end, rows, contribution: sunday, meetings: held });
  }

  return {
    today,
    weeks: out,
    missing,
    totalMissing: Object.values(missing).reduce((a, b) => a + b, 0),
    checks: CHECKS.map(({ id, label, page, noneLabel, scope }) => ({ id, label, page, noneLabel, scope })),
  };
}

// ─── Sign-offs ────────────────────────────────────────────────────────────────

function isIsoDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && parseAnyDate(s) === s;
}

function addCheckoff({ date, service = '', check, note = '' }, user, { today = churchToday() } = {}) {
  if (!isIsoDate(date)) return { error: 'A date is needed, as YYYY-MM-DD' };
  if (!CHECK_IDS.has(check)) return { error: 'That is not something the report checks' };
  if (date > today) return { error: 'That date has not happened yet' };

  const scope = check === 'not-held' ? 'service' : CHECKS.find(c => c.id === check).scope;
  let name = '';
  if (scope === 'service') {
    const known = db.prepare('SELECT name FROM service_types WHERE lower(name) = lower(?)').get(String(service || ''));
    if (!known) return { error: 'No such service' };
    name = known.name;
  } else if (weekdayOf(date) !== 0) {
    return { error: 'The contribution is recorded for a Sunday' };
  }

  const existing = db.prepare('SELECT id FROM record_checkoffs WHERE date = ? AND service = ? AND check_id = ?').get(date, name, check);
  if (existing) return { error: 'That has already been marked' };

  const { lastInsertRowid } = db.prepare(`
    INSERT INTO record_checkoffs (date, service, check_id, note, user_id, user_name) VALUES (?, ?, ?, ?, ?, ?)
  `).run(date, name, check, String(note || '').trim().slice(0, 300), user?.id ?? null, user?.name || '');
  return { checkoff: db.prepare('SELECT * FROM record_checkoffs WHERE id = ?').get(lastInsertRowid) };
}

function removeCheckoff(id) {
  const row = db.prepare('SELECT * FROM record_checkoffs WHERE id = ?').get(id);
  if (!row) return { error: 'No such sign-off' };
  db.prepare('DELETE FROM record_checkoffs WHERE id = ?').run(id);
  return { removed: row };
}

// ─── Which services are tracked ───────────────────────────────────────────────

function serviceSettings() {
  const services = db.prepare(`
    SELECT id, name, active, tracking, weekday, song_names FROM service_types ORDER BY sort_order, name
  `).all();
  // What the song tracker has actually called its services, to pick from.
  const songNames = db.prepare(`
    SELECT service, COUNT(*) AS n FROM song_services GROUP BY service ORDER BY n DESC
  `).all().map(r => r.service).filter(Boolean);
  return { services, songNames, weekdays: WEEKDAYS };
}

function updateService(id, { tracking, weekday, songNames }) {
  const before = db.prepare('SELECT * FROM service_types WHERE id = ?').get(id);
  if (!before) return { error: 'No such service' };
  if (!TRACKING.includes(tracking)) return { error: 'Tracking must be every week, when held, or not tracked' };
  const day = weekday === null || weekday === '' || weekday === undefined ? null : Number(weekday);
  if (day !== null && !(Number.isInteger(day) && day >= 0 && day <= 6)) return { error: 'That is not a day of the week' };
  if (tracking === 'weekly' && day === null) return { error: 'A weekly service needs a day' };
  const names = String(songNames || '').split(',').map(s => s.trim()).filter(Boolean).join(', ').slice(0, 200);

  db.prepare('UPDATE service_types SET tracking = ?, weekday = ?, song_names = ? WHERE id = ?').run(tracking, day, names, id);
  return { before, service: db.prepare('SELECT * FROM service_types WHERE id = ?').get(id) };
}

module.exports = {
  CHECKS, WEEKDAYS, churchToday, sundayOf, addDays,
  report, addCheckoff, removeCheckoff, serviceSettings, updateService,
};
