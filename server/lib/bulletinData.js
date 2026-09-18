// ─── What the newsletter can fill in by itself ────────────────────────────────
//
// Roughly half of the weekly newsletter is already somewhere in the portal:
// the reminders are the announcement board, last week's numbers are the
// attendance records, and the elders, deacons and distribution groups are
// pages somebody already keeps up to date. This module gathers that half for
// one week. The other half — the prayer lists, the offering, the quote — has
// no table behind it and is typed each week; server/lib/bulletinIssue.js looks
// after that part and merges the two.
//
// The difficulty here is that the tables do not agree on what a date is. Four
// formats reach this file:
//
//   attendance.date          'MM/DD/YY'               (scraped)
//   job_assignments          month 'June 2025' + date 'June 7'   (scraped)
//   anniversaries            month_num + day, no year (recurring)
//   announcements.event_date ISO, from a date input
//
// Rather than migrate tables other pages read happily, every query normalises
// to ISO on the way out. A row whose date cannot be read is dropped rather than
// guessed at: a newsletter missing one reminder is a smaller mistake than one
// announcing last month's events as this week's.
const db     = require('../db');
const config = require('./bulletinConfig');

const MONTHS = [
  'january', 'february', 'march',     'april',   'may',      'june',
  'july',    'august',   'september', 'october', 'november', 'december',
];

// ─── Dates ────────────────────────────────────────────────────────────────────

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

function isIso(s) {
  return ISO.test(String(s || '').trim());
}

// 'MM/DD/YY' → 'YYYY-MM-DD'. The scraped tables are all this century, and the
// source only ever gives two digits, so 25 is 2025 the same way songTracker
// reads it.
function isoFromSlashed(value) {
  const m = String(value || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return null;
  const [, mm, dd, yy] = m;
  const year = yy.length === 4 ? Number(yy) : 2000 + Number(yy);
  return `${year}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

function monthIndex(name) {
  const key = String(name || '').trim().toLowerCase().replace(/\.$/, '');
  if (!key) return -1;
  return MONTHS.findIndex(m => m === key || m.startsWith(key));
}

// A job assignment carries its year on the sheet's heading ('June 2025') and
// its day on the row ('June 7'), so neither half is a date by itself.
function isoFromMonthDay(monthLabel, dateLabel) {
  const heading = String(monthLabel || '').trim().match(/^([A-Za-z]+)\s+(\d{4})$/);
  const row     = String(dateLabel  || '').trim().match(/^([A-Za-z]+)\.?\s+(\d{1,2})$/);
  if (!heading || !row) return null;

  const year = Number(heading[2]);
  // The row's own month is the one to trust — a sheet headed 'June 2025' can
  // carry a July 5 row for the week that straddles the two.
  const mi = monthIndex(row[1]);
  if (mi < 0) return null;

  const day = Number(row[2]);
  if (!(day >= 1 && day <= 31)) return null;

  // A December sheet listing a January row belongs to the next year.
  const headingMonth = monthIndex(heading[1]);
  const wrapped = headingMonth === 11 && mi === 0 ? year + 1 : year;

  return `${wrapped}-${String(mi + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Whatever a row happens to store, as ISO — or null when it is unreadable.
function toIsoDate(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  if (isIso(s)) return s;
  return isoFromSlashed(s);
}

// Dates are compared, never arithmetic'd, as UTC: constructing them at local
// midnight would shift a Sunday into a Saturday for anybody west of UTC, and
// getting the Sunday right is the whole job.
function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// The Sunday a date belongs to: itself when it is one, the one just past
// otherwise. A newsletter prepared on Wednesday is still that Sunday's.
function sundayOf(iso) {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return addDays(iso, -day);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function withinWeek(iso, start, end) {
  return !!iso && iso >= start && iso <= end;
}

// 'May 3, 2026' — the masthead's date, and the one used beside a reminder.
const LONG_MONTHS = MONTHS.map(m => m[0].toUpperCase() + m.slice(1));

function longDate(iso) {
  const m = String(iso || '').match(ISO);
  if (!m) return '';
  return `${LONG_MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

function shortDate(iso) {
  const m = String(iso || '').match(ISO);
  if (!m) return '';
  return `${LONG_MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
}

// ─── The sections the database can answer ─────────────────────────────────────

// "Reminders" is the announcement board seen as one list: the dated events
// coming up, and the standing notices that have no date. Dated first and in
// date order, because that is the half that expires.
function reminders(start, horizonDays = config.reminderHorizonDays) {
  const end = addDays(start, horizonDays);

  const dated = db.prepare(`
    SELECT title, body, event_date, event_time, location
    FROM   announcements
    WHERE  active = 1 AND event_date IS NOT NULL AND trim(event_date) <> ''
    ORDER  BY event_date ASC
  `).all()
    .map(r => ({ ...r, event_date: toIsoDate(r.event_date) }))
    .filter(r => withinWeek(r.event_date, start, end))
    .map(r => ({
      text: [
        r.title,
        shortDate(r.event_date),
        r.event_time ? `at ${r.event_time}` : '',
        r.location   ? `at ${r.location}`   : '',
      ].filter(Boolean).join(' '),
      date: r.event_date,
    }));

  const standing = db.prepare(`
    SELECT title, body, event_time, location
    FROM   announcements
    WHERE  active = 1 AND (event_date IS NULL OR trim(event_date) = '')
    ORDER  BY CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, created_at DESC
  `).all()
    .map(r => ({
      text: [
        r.title,
        r.event_time ? `at ${r.event_time}` : '',
        r.location   ? `at ${r.location}`   : '',
      ].filter(Boolean).join(' '),
      date: null,
    }));

  return [...dated, ...standing];
}

// Last Sunday's numbers, which is what the newsletter reports — this Sunday's
// are not counted yet when it goes out.
//
// The draft prints one Sunday figure and one Wednesday figure, but the
// attendance table records a row per service ('Sunday AM Worship', 'Sunday
// Bible Study', 'Wednesday Bible Study'). Sunday morning worship is the number
// meant by "Sunday attendance"; where it is missing, the best-attended Sunday
// service stands in rather than leaving the line blank.
function attendanceFor(sunday) {
  const week = addDays(sunday, 6);
  const rows = db.prepare('SELECT date, service, count FROM attendance ORDER BY date DESC LIMIT 1000')
    .all()
    .map(r => ({ ...r, date: toIsoDate(r.date) }))
    .filter(r => withinWeek(r.date, sunday, week));

  const on = re => rows.filter(r => re.test(String(r.service || '')));
  const best = list => list.slice().sort((a, b) => b.count - a.count)[0] || null;

  const sundayRows = on(/sunday/i);
  const worship    = sundayRows.find(r => /worship/i.test(r.service) && /\bAM\b/i.test(r.service));

  return {
    all:       rows,
    sunday:    worship || best(sundayRows),
    wednesday: best(on(/wednesday/i)),
  };
}

// Birthdays and anniversaries recur, so these rows carry no year — the week is
// matched on month and day alone. A week that crosses a month boundary is why
// this walks the seven days rather than comparing a range.
//
// The source keeps both kinds in one table with no column saying which, while
// the newsletter prints them under separate headings. They are told apart by
// how the names read: a wedding anniversary names a couple ('John & Sarah
// Miller') and usually its count of years ('– 15 yrs'), where a birthday names
// one person. The rule is a guess, but a legible one, and a misfiled entry is
// a line under the wrong heading rather than a line lost.
function looksLikeAnniversary(names) {
  const s = String(names || '');
  return /\s(?:&|and)\s/i.test(s) || /\b\d+\s*(?:yr|year)s?\b/i.test(s);
}

function anniversariesInWeek(start) {
  const wanted = new Map();
  for (let i = 0; i < 7; i++) {
    const iso = addDays(start, i);
    // Group 1 of ISO is the year — the recurrence is keyed on month and day
    // alone, so it is deliberately skipped here.
    const [, , mm, dd] = iso.match(ISO);
    wanted.set(`${Number(mm)}-${Number(dd)}`, iso);
  }

  const rows = db.prepare('SELECT month, date, names, month_num, day FROM anniversaries')
    .all()
    .map(r => ({
      names: r.names,
      date:  wanted.get(`${Number(r.month_num)}-${Number(r.day)}`) || null,
    }))
    .filter(r => r.date)
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    anniversaries: rows.filter(r =>  looksLikeAnniversary(r.names)),
    birthdays:     rows.filter(r => !looksLikeAnniversary(r.names)),
  };
}

// Elders and deacons with what each looks after. The newsletter prints an
// elder's telephone number and a deacon's responsibilities, which is exactly
// the difference between the two tables — only elders carry contact columns.
function leadership(table, dutiesTable, key, withPhone = false) {
  const columns = withPhone ? 'id, name, phone' : 'id, name';
  const people  = db.prepare(`SELECT ${columns} FROM "${table}" ORDER BY name ASC`).all();
  const duties  = db.prepare(`SELECT "${key}" AS person_id, duty FROM "${dutiesTable}" ORDER BY position ASC, id ASC`).all();
  return people.map(p => ({
    name:   p.name,
    phone:  withPhone ? (p.phone || '') : '',
    duties: duties.filter(d => d.person_id === p.id).map(d => d.duty),
  }));
}

// ─── The duty roster ──────────────────────────────────────────────────────────
//
// Two weeks side by side, as the printed roster shows them: this Sunday and
// next, and the Wednesday that follows each. Every configured job gets a row
// whether or not anybody is against it — a blank is how a gap gets noticed —
// and a job somebody added to the schedule without it being configured is
// listed after the known ones rather than dropped.
//
// job_assignments is the scraped monthly sheet, so its dates need the heading
// and the row read together; see isoFromMonthDay above.
function rosterSlots(dates) {
  const wanted = new Set(dates);
  return db.prepare("SELECT month, date, service, job, name FROM job_assignments WHERE month <> '' ORDER BY id ASC")
    .all()
    .map(r => ({ ...r, isoDate: isoFromMonthDay(r.month, r.date) }))
    .filter(r => r.isoDate && wanted.has(r.isoDate));
}

function rosterSection(slots, dates, configured) {
  // Configured order first, then anything else the schedule happens to carry.
  const extra = [...new Set(slots.map(s => s.job).filter(j => j && !configured.includes(j)))].sort();
  const jobs  = [...configured, ...extra];

  return {
    dates,
    jobs: jobs.map(job => ({
      job,
      // One cell per week. Several people can hold one job in a week (the
      // communion assists are a list), so the names are joined rather than
      // the first one winning.
      names: dates.map(date =>
        slots
          .filter(s => s.job === job && s.isoDate === date && String(s.name || '').trim())
          .map(s => s.name.trim())
          .join(', ')
      ),
    })),
  };
}

function dutyRoster(sunday) {
  const sundays    = [sunday, addDays(sunday, 7)];
  const wednesdays = sundays.map(d => addDays(d, 3));

  const slots = rosterSlots([...sundays, ...wednesdays]);

  // The schedule names its services 'AM' and 'PM' rather than by weekday, so
  // which block a slot belongs to is decided by its date first and its name
  // only as a fallback.
  const isWed = s => wednesdays.includes(s.isoDate) || /wednesday/i.test(String(s.service || ''));

  // The printed roster has a morning block and a Wednesday block and no
  // evening one. Without this an evening slot would land in the morning cell
  // and be joined onto the name already there — two different people reading
  // as one pair, which is worse than not printing the evening at all.
  const isEvening = s => /\bPM\b|evening/i.test(String(s.service || ''));

  return {
    sunday:    rosterSection(slots.filter(s => !isWed(s) && !isEvening(s)), sundays,    config.dutyJobs.sunday),
    wednesday: rosterSection(slots.filter(isWed), wednesdays, config.dutyJobs.wednesday),
  };
}

// A distribution group's address: the key with its hyphen dropped, at the
// congregation's domain — 'group-1' is group1@…, which is what the printed
// table has always said.
function addressFor(key) {
  return `${String(key).replace(/-/g, '')}@${config.mailDomain}`;
}

// The fellowship groups, in the order the portal lists them. Their leaders are
// not recorded anywhere, so the leader is left for the compose screen to add.
function groups() {
  return db.prepare("SELECT key, name FROM mail_groups WHERE key LIKE 'group-%' ORDER BY sort_order ASC, key ASC")
    .all()
    .map(g => ({ key: g.key, name: g.name, email: addressFor(g.key) }));
}

// The "Key Email Contacts" table. Driven by the config's list so the newsletter
// advertises the addresses it means to, not every list the app can send to.
function emailContacts() {
  const byKey = new Map(
    db.prepare('SELECT key, name FROM mail_groups').all().map(g => [g.key, g.name])
  );
  return config.contactGroups
    .filter(key => byKey.has(key))
    .map(key => ({
      key,
      label: config.contactLabels[key] || byKey.get(key),
      email: addressFor(key),
    }));
}

// ─── What the renderers are handed ────────────────────────────────────────────

function gather({ sunday } = {}) {
  const requested = toIsoDate(sunday) || today();
  const start     = sundayOf(requested);
  const previous  = addDays(start, -7);
  const dates     = anniversariesInWeek(start);

  return {
    sunday:         start,
    sundayLabel:    longDate(start),
    week:           { start, end: addDays(start, 6) },
    previousSunday: previous,

    reminders:     reminders(start),
    anniversaries: dates.anniversaries,
    birthdays:     dates.birthdays,

    // Reported a week behind, because that is the week the numbers are in for.
    lastWeek: {
      sunday:     previous,
      attendance: attendanceFor(previous),
    },

    dutyRoster:    dutyRoster(start),
    elders:        leadership('elders',  'elder_duties',  'elder_id', true),
    deacons:       leadership('deacons', 'deacon_duties', 'deacon_id'),
    groups:        groups(),
    emailContacts: emailContacts(),
  };
}

module.exports = {
  gather,
  dutyRoster,
  // Exported for the tests, and because the date reading is the part most
  // likely to need adjusting when another table changes format.
  toIsoDate,
  isoFromSlashed,
  isoFromMonthDay,
  looksLikeAnniversary,
  sundayOf,
  addDays,
  longDate,
  shortDate,
};
