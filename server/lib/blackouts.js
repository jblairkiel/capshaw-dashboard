// Time away from the serving jobs.
//
// Somebody blocks out the days they will not be here — a holiday, a hospital
// stay, a month with the grandchildren — and the schedule stops offering them
// to those days. Both ends of a range are inclusive, and a single day away is a
// range whose ends are the same date.
//
// Dates are held as YYYY-MM-DD, which sorts and compares as a plain string, so
// "is this day inside that range" is a string comparison rather than arithmetic
// that has to worry about time zones. The roster writes its dates the way a
// bulletin does — "June 7" under a month called "June 2026" — so `dateOf` is
// the one place the two ways of writing a day are reconciled.
const db = require('../db');
const { MONTHS, parseMonth } = require('../workflows/scheduling');

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

// A date somebody could actually be away on: the right shape, and a day that
// exists. "2026-02-30" passes the pattern and is still nobody's holiday.
function isDate(value) {
  const match = ISO_DATE.exec(String(value || '').trim());
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * Read a range off a request body.
 *
 * `endsOn` left out means a single day, which is how most of these are
 * entered — one Sunday away rather than a fortnight.
 *
 * Returns `{ error }` for the caller to answer with, or the range to store.
 */
function readRange(body) {
  const startsOn = String(body?.startsOn || '').trim();
  const endsOn   = String(body?.endsOn || '').trim() || startsOn;
  const reason   = String(body?.reason || '').trim();

  if (!startsOn) return { error: 'A first day away is required' };
  if (!isDate(startsOn)) return { error: `"${startsOn}" is not a date I understand — try 2026-06-07` };
  if (!isDate(endsOn))   return { error: `"${endsOn}" is not a date I understand — try 2026-06-21` };
  if (endsOn < startsOn) return { error: 'The last day away cannot come before the first' };

  return { range: { startsOn, endsOn, reason } };
}

// ─── Reading them ─────────────────────────────────────────────────────────────

const SELECT = `
  SELECT b.id, b.directory_id AS directoryId, b.starts_on AS startsOn, b.ends_on AS endsOn,
         b.reason, d.name
    FROM job_blackouts b
    JOIN directory d ON d.id = b.directory_id
`;

function forPerson(directoryId) {
  if (!directoryId) return [];
  return db.prepare(`${SELECT} WHERE b.directory_id = ? ORDER BY b.starts_on ASC, b.ends_on ASC`).all(directoryId);
}

function all() {
  return db.prepare(`${SELECT} ORDER BY b.starts_on ASC, d.name ASC`).all();
}

function get(id) {
  return db.prepare(`${SELECT} WHERE b.id = ?`).get(id) || null;
}

// Everybody's at once, keyed by directory id, for the schedule builder and for
// a page that lists the whole congregation rather than asking person by person.
function byPerson() {
  const map = new Map();
  for (const range of all()) {
    if (!map.has(range.directoryId)) map.set(range.directoryId, []);
    map.get(range.directoryId).push(range);
  }
  return map;
}

// ─── Writing them ─────────────────────────────────────────────────────────────

function add(directoryId, { startsOn, endsOn, reason }) {
  const { lastInsertRowid: id } = db
    .prepare('INSERT INTO job_blackouts (directory_id, starts_on, ends_on, reason) VALUES (?, ?, ?, ?)')
    .run(directoryId, startsOn, endsOn, reason || '');
  return get(id);
}

function remove(id) {
  db.prepare('DELETE FROM job_blackouts WHERE id = ?').run(id);
}

// ─── Is this day blocked out? ─────────────────────────────────────────────────

function covers(range, isoDate) {
  return !!isoDate && range.startsOn <= isoDate && isoDate <= range.endsOn;
}

// The range keeping somebody off a given day, or null. The range is returned
// rather than a yes/no so the answer can say which days away are in the way.
function awayOn(ranges, isoDate) {
  return (ranges || []).find(range => covers(range, isoDate)) || null;
}

function personAwayOn(directoryId, isoDate) {
  if (!directoryId || !isoDate) return null;
  return db.prepare(
    'SELECT id, directory_id AS directoryId, starts_on AS startsOn, ends_on AS endsOn, reason' +
    '  FROM job_blackouts WHERE directory_id = ? AND starts_on <= ? AND ends_on >= ? ORDER BY starts_on LIMIT 1'
  ).get(directoryId, isoDate, isoDate) || null;
}

// The same question for a name off the roster rather than a directory id,
// because a slot holds the name somebody was written down as.
function nameAwayOn(name, isoDate) {
  const wanted = String(name || '').trim();
  if (!wanted || !isoDate) return null;
  return db.prepare(
    'SELECT b.id, b.directory_id AS directoryId, b.starts_on AS startsOn, b.ends_on AS endsOn, b.reason, d.name' +
    '  FROM job_blackouts b JOIN directory d ON d.id = b.directory_id' +
    ' WHERE lower(trim(d.name)) = lower(?) AND b.starts_on <= ? AND b.ends_on >= ?' +
    ' ORDER BY b.starts_on LIMIT 1'
  ).get(wanted, isoDate, isoDate) || null;
}

// ─── The two ways a day gets written down ─────────────────────────────────────
//
// A slot says "June 7" and belongs to a month called "June 2026"; a range says
// "2026-06-07". This turns the first into the second. A slot with no date of
// its own — the monthly visual preparation is the one that behaves this way —
// belongs to no particular day, so nobody can be away for it.

function dateOf(monthLabel, dateLabel) {
  const date = String(dateLabel || '').trim();
  if (!date) return null;
  if (isDate(date)) return date;

  const parsed = parseMonth(monthLabel);
  if (!parsed) return null;

  const match = /^([A-Za-z]+)\s+(\d{1,2})$/.exec(date);
  if (!match) return null;

  const monthIndex = MONTHS.findIndex(m => m.toLowerCase() === match[1].toLowerCase());
  if (monthIndex < 0) return null;

  const day = Number(match[2]);
  const iso = `${parsed.year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return isDate(iso) ? iso : null;
}

// "June 7, 2026", or "June 7 – June 21, 2026" — how a range reads in a sentence
// about why somebody cannot be scheduled.
function describe({ startsOn, endsOn }) {
  const say = iso => {
    const [year, month, day] = String(iso).split('-').map(Number);
    return { text: `${MONTHS[month - 1]} ${day}`, year };
  };

  const from = say(startsOn);
  const to   = say(endsOn);

  if (startsOn === endsOn) return `${from.text}, ${from.year}`;
  if (from.year === to.year) return `${from.text} – ${to.text}, ${to.year}`;
  return `${from.text}, ${from.year} – ${to.text}, ${to.year}`;
}

module.exports = {
  isDate, readRange,
  forPerson, all, get, byPerson,
  add, remove,
  covers, awayOn, personAwayOn, nameAwayOn,
  dateOf, describe,
};
