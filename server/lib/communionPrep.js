// ─── Communion preparation ────────────────────────────────────────────────────
//
// One sign-up list a year: who prepares the Lord's Supper in each month.
// Whoever holds `communion-prep` starts the year's list; after that any member
// can put their own name against an open month (and take it off again), and
// the keeper can write anybody in or clear any month. The person down for a
// month is emailed a week before it starts (mail/communionPrep.js).

const db = require('../db');

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
// How far ahead a list can be started.
const YEARS_AHEAD = 2;

const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const nameKey = s => clean(s, 200).toLowerCase();

// "2026-10" style comparisons: is (year, month) already under way or past?
function monthStarted(year, month, today) {
  const [ty, tm] = today.split('-').map(Number);
  return year < ty || (year === ty && month <= tm);
}

function years() {
  return db.prepare('SELECT year FROM communion_prep_years ORDER BY year').all().map(r => r.year);
}

function hasYear(year) {
  return !!db.prepare('SELECT 1 FROM communion_prep_years WHERE year = ?').get(year);
}

// The directory entry a typed name belongs to, if exactly one matches.
function directoryFor(name) {
  const rows = db.prepare('SELECT id, name FROM directory WHERE lower(trim(name)) = ?').all(nameKey(name));
  return rows.length === 1 ? rows[0] : null;
}

// Somebody's address for the reminder: their directory entry's, else an
// account linked to that entry, else — for a name with no directory entry —
// the account that signed up, when it signed itself up.
function emailFor(signup) {
  if (signup.directory_id) {
    const row = db.prepare(`
      SELECT COALESCE(NULLIF(d.email, ''),
        (SELECT u.email FROM users u WHERE u.directory_id = d.id AND u.email <> '' LIMIT 1), '') AS email
        FROM directory d WHERE d.id = ?
    `).get(signup.directory_id);
    if (row?.email) return row.email;
  }
  const by = signup.signed_by ? db.prepare('SELECT name, email FROM users WHERE id = ?').get(signup.signed_by) : null;
  return by && nameKey(by.name) === nameKey(signup.name) ? by.email || '' : '';
}

// Whether a month's sign-up is this person's own: their directory entry, or —
// for a name with no entry — one they put down for themselves.
function isMine(row, user) {
  if (!row || !user) return false;
  if (user.directory_id && row.directory_id === user.directory_id) return true;
  return !row.directory_id && row.signed_by === user.id && nameKey(row.name) === nameKey(user.name);
}

function shape(row, { user, today }) {
  if (!row) return null;
  const self = isMine(row, user);
  return {
    id: row.id, year: row.year, month: row.month, name: row.name,
    directoryId: row.directory_id,
    mine: self,
    hasEmail: !!emailFor(row),
    reminded: !!row.reminded_at,
    started: monthStarted(row.year, row.month, today),
  };
}

// The twelve months of a year's list, each with whoever is down for it.
function listFor(year, { user, today }) {
  if (!hasYear(year)) return null;
  const rows = new Map(db.prepare('SELECT * FROM communion_prep_signups WHERE year = ?').all(year).map(r => [r.month, r]));
  return MONTHS.map((label, i) => {
    const month = i + 1;
    return { month, label, started: monthStarted(year, month, today), signup: shape(rows.get(month), { user, today }) };
  });
}

function createYear(year, user, today) {
  const y = Number(year);
  const thisYear = Number(today.slice(0, 4));
  if (!Number.isInteger(y) || y < thisYear || y > thisYear + YEARS_AHEAD) {
    return { error: `Start a list for ${thisYear} to ${thisYear + YEARS_AHEAD}` };
  }
  if (hasYear(y)) return { error: `The ${y} list has already been started` };
  db.prepare('INSERT INTO communion_prep_years (year, created_by, created_by_name) VALUES (?, ?, ?)').run(y, user?.id ?? null, user?.name || '');
  return { year: y };
}

function signupRow(year, month) {
  return db.prepare('SELECT * FROM communion_prep_signups WHERE year = ? AND month = ?').get(year, month);
}

// Reads a year and month off a request, or says what is wrong with them.
function readMonth(year, month, today, { allowStarted = false } = {}) {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(m) || m < 1 || m > 12) return { error: 'No such month' };
  if (!hasYear(y)) return { error: `There is no list for ${year} yet` };
  if (!allowStarted && monthStarted(y, m, today)) return { error: `${MONTHS[m - 1]} ${y} has already begun` };
  return { year: y, month: m };
}

// A member putting their own name down.
function signUp(user, { year, month }, today) {
  const at = readMonth(year, month, today);
  if (at.error) return at;
  const person = user?.directory_id ? db.prepare('SELECT id, name FROM directory WHERE id = ?').get(user.directory_id) : null;
  const name = person?.name || clean(user?.name, 100);
  if (!name) return { error: 'Your account has no name to sign up with' };
  if (signupRow(at.year, at.month)) return { error: `Somebody is already down for ${MONTHS[at.month - 1]}`, status: 409 };
  db.prepare('INSERT INTO communion_prep_signups (year, month, name, directory_id, signed_by) VALUES (?, ?, ?, ?, ?)')
    .run(at.year, at.month, name, person?.id ?? null, user.id);
  return { signup: signupRow(at.year, at.month) };
}

// A member taking their own name back off a month that has not begun.
function withdraw(user, { year, month }, today) {
  const at = readMonth(year, month, today);
  if (at.error) return at;
  const row = signupRow(at.year, at.month);
  if (!row) return { error: 'Nobody is down for that month', status: 404 };
  if (!isMine(row, user)) return { error: 'You can only take your own name off', status: 403 };
  db.prepare('DELETE FROM communion_prep_signups WHERE id = ?').run(row.id);
  return { before: row };
}

// The keeper writing a name against a month, or clearing it ('' clears).
function setMonth(user, { year, month, name }, today) {
  const at = readMonth(year, month, today, { allowStarted: true });
  if (at.error) return at;
  const before = signupRow(at.year, at.month) || null;
  const wanted = clean(name, 100);
  if (!wanted) {
    if (before) db.prepare('DELETE FROM communion_prep_signups WHERE id = ?').run(before.id);
    return { before, signup: null };
  }
  const person = directoryFor(wanted);
  const finalName = person?.name || wanted;
  if (before) {
    if (nameKey(before.name) === nameKey(finalName)) return { before, signup: before };
    // A different person: their reminder has not gone yet.
    db.prepare('UPDATE communion_prep_signups SET name = ?, directory_id = ?, signed_by = ?, signed_at = datetime(\'now\'), reminded_at = NULL WHERE id = ?')
      .run(finalName, person?.id ?? null, user?.id ?? null, before.id);
  } else {
    db.prepare('INSERT INTO communion_prep_signups (year, month, name, directory_id, signed_by) VALUES (?, ?, ?, ?, ?)')
      .run(at.year, at.month, finalName, person?.id ?? null, user?.id ?? null);
  }
  return { before, signup: signupRow(at.year, at.month) };
}

module.exports = {
  MONTHS, YEARS_AHEAD, years, hasYear, listFor, createYear, signUp, withdraw, setMonth,
  emailFor, monthStarted, signupRow, isMine,
};
