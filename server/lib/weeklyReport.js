// ─── The weekly reports' numbers ──────────────────────────────────────────────
//
// One reading of the congregation's records for a week (Sunday to Saturday)
// and for the year so far (1 January to that Saturday). Both weekly reports —
// the summary and the analytical — and the Reports tab on the Record Keeping
// page are drawn from this, so the email and the page can never disagree.
//
// Everything is read from the tables that already keep it: attendance counts,
// the weekly contribution, the guest book, the member roll call, the song
// tracker, group meetings, the serving schedule, guest follow-ups, sign-ups,
// and the Bible class games. Nothing is stored for the report itself.

const db = require('../db');
const { addDays, sundayOf, churchToday } = require('./recordKeeping');
const { parseAnyDate } = require('./contributions');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const lower = s => String(s || '').trim().toLowerCase();
const round1 = n => Math.round(n * 10) / 10;
const avg = list => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);
const monthOf = iso => Number(iso.slice(5, 7)) - 1;

// The week a report is for: the Sunday-to-Saturday week holding `date`.
function weekOf(date) {
  const start = sundayOf(date);
  return { start, end: addDays(start, 6) };
}

// The most recent week that has ended by `today` — or this week, on its Saturday.
function lastWeek(today = churchToday()) {
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  return weekOf(weekday === 6 ? today : addDays(sundayOf(today), -1));
}

// ─── Reading the records ──────────────────────────────────────────────────────

// Rows with their dates made ISO (the guest book writes 06/03/26), kept to a window.
function dated(rows, from, to, field = 'date') {
  return rows
    .map(r => ({ ...r, iso: parseAnyDate(r[field]) }))
    .filter(r => r.iso && r.iso >= from && r.iso <= to);
}

// The services in the church's own order, so every table and chart lists
// them the same way.
function serviceOrder() {
  const order = new Map(db.prepare('SELECT name FROM service_types ORDER BY sort_order, name').all()
    .map((s, i) => [lower(s.name), i]));
  return (a, b) => (order.get(lower(a)) ?? 99) - (order.get(lower(b)) ?? 99) || a.localeCompare(b);
}

function attendanceIn(from, to) {
  return dated(db.prepare('SELECT date, service, count FROM attendance WHERE count > 0').all(), from, to);
}

function givingIn(from, to) {
  return dated(db.prepare('SELECT date, amount FROM contributions').all(), from, to);
}

function visitsIn(from, to) {
  return dated(db.prepare(`
    SELECT vv.date, vv.service, v.id AS visitor_id, v.name, v.invited_by, v.city, v.state
      FROM visitor_visits vv JOIN visitors v ON v.id = vv.visitor_id
  `).all(), from, to);
}

// Each guest's first visit ever, to tell a first-time guest from a returning one.
function firstVisits() {
  const first = new Map();
  for (const r of db.prepare('SELECT visitor_id, date FROM visitor_visits').all()) {
    const iso = parseAnyDate(r.date);
    if (iso && (!first.has(r.visitor_id) || iso < first.get(r.visitor_id))) first.set(r.visitor_id, iso);
  }
  return first;
}

function marksIn(from, to) {
  return db.prepare(`
    SELECT m.person_id, m.date, m.service, s.counts_present AS present, d.name
      FROM member_attendance m
      JOIN attendance_statuses s ON s.id = m.status_id
      JOIN directory d ON d.id = m.person_id
     WHERE m.date BETWEEN ? AND ?
     ORDER BY m.date, m.service
  `).all(from, to);
}

function songServicesIn(from, to) {
  const services = dated(db.prepare('SELECT id, date, service, leader FROM song_services').all(), from, to);
  const songsOf = db.prepare(`
    SELECT s.title FROM service_songs x JOIN songs s ON s.id = x.song_id WHERE x.service_id = ? ORDER BY x.position
  `);
  return services.map(s => ({ ...s, songs: songsOf.all(s.id).map(r => r.title) })).filter(s => s.songs.length);
}

function meetingsIn(from, to) {
  return db.prepare(`
    SELECT e.id, e.title, e.event_date AS date, e.event_time AS time, e.head_count, g.name AS grp,
           (SELECT COUNT(*) FROM group_event_rsvps r WHERE r.event_id = e.id AND r.response = 'yes') AS rsvp_yes,
           (SELECT COALESCE(SUM(r.guests), 0) FROM group_event_rsvps r WHERE r.event_id = e.id AND r.response = 'yes') AS rsvp_guests
      FROM group_events e JOIN church_groups g ON g.id = e.group_id
     WHERE e.status = 'published' AND e.event_date BETWEEN ? AND ?
     ORDER BY e.event_date, e.event_time
  `).all(from, to);
}

// The serving schedule writes a day as "April 6", with the year on its month
// ("April 2026").
function servingIn(from, to) {
  const rows = db.prepare("SELECT month, date, service, job, name FROM job_assignments WHERE trim(coalesce(date, '')) <> ''").all()
    .map(r => ({ ...r, when: `${r.date}, ${String(r.month || '').trim().split(/\s+/).pop()}` }));
  return dated(rows, from, to, 'when');
}

function followUpsIn(from, to) {
  return db.prepare(`
    SELECT id, status, outcome, created_at, completed_at FROM workflow_instances
     WHERE definition_id = 'visitor-follow-up' AND (date(created_at) BETWEEN ? AND ? OR date(completed_at) BETWEEN ? AND ?)
  `).all(from, to, from, to);
}

// ─── Attendance ───────────────────────────────────────────────────────────────

// Weekly totals per service across a stretch of weeks, for trends and averages.
function weeklyAttendance(fromSunday, toSaturday) {
  const weeks = new Map();
  for (let s = fromSunday; s <= toSaturday; s = addDays(s, 7)) weeks.set(s, {});
  for (const r of attendanceIn(fromSunday, toSaturday)) {
    const w = weeks.get(sundayOf(r.iso));
    if (w) w[r.service] = (w[r.service] || 0) + r.count;
  }
  return [...weeks.entries()].map(([start, byService]) => ({ start, byService }));
}

// ─── The week ─────────────────────────────────────────────────────────────────

function weekReport({ start, end }) {
  const byService = serviceOrder();
  const prior4 = weeklyAttendance(addDays(start, -28), addDays(start, -1));
  const lastYear = weekOf(addDays(start, -364));

  // Attendance, per service, against the four weeks before and the same week a year ago.
  const rows = attendanceIn(start, end);
  const lastYearRows = attendanceIn(lastYear.start, lastYear.end);
  const services = [...new Set([...rows.map(r => r.service)])].sort(byService).map(service => {
    const count = rows.filter(r => r.service === service).reduce((n, r) => n + r.count, 0);
    const before = prior4.map(w => w.byService[service]).filter(n => n > 0);
    const ly = lastYearRows.filter(r => r.service === service).reduce((n, r) => n + r.count, 0);
    return { service, count, avg4: before.length ? round1(avg(before)) : null, lastYear: ly || null };
  });
  // The headline is the best-attended service of the week, normally Sunday morning.
  const headline = [...services].sort((a, b) => b.count - a.count)[0] || null;

  // Giving.
  const gifts = givingIn(start, end);
  const priorGifts = givingIn(addDays(start, -28), addDays(start, -1));
  const giving = {
    amount: gifts.length ? gifts.reduce((n, g) => n + g.amount, 0) : null,
    avg4: priorGifts.length ? Math.round(avg(priorGifts.map(g => g.amount)) * 100) / 100 : null,
  };

  // Guests.
  const first = firstVisits();
  const visits = visitsIn(start, end).sort((a, b) => a.iso.localeCompare(b.iso));
  const guestList = visits.map(v => ({
    name: v.name, date: v.iso, service: v.service, invitedBy: v.invited_by || '',
    place: [v.city, v.state].filter(Boolean).join(', '),
    firstTime: first.get(v.visitor_id) === v.iso,
  }));
  const guests = {
    visits: guestList.length,
    firstTime: guestList.filter(g => g.firstTime).length,
    returning: guestList.filter(g => !g.firstTime).length,
    list: guestList,
  };

  // The member roll call: who was there, and who has been missing for a while.
  const marks = marksIn(start, end);
  const rolls = new Map();
  for (const m of marks) {
    const key = `${m.date}|${m.service}`;
    if (!rolls.has(key)) rolls.set(key, { date: m.date, service: m.service, present: 0, marked: 0 });
    const r = rolls.get(key);
    r.marked++; if (m.present) r.present++;
  }
  const rollList = [...rolls.values()].sort((a, b) => a.date.localeCompare(b.date) || byService(a.service, b.service));
  const history = marksIn(addDays(start, -7 * 26), end);
  const byPerson = new Map();
  for (const m of history) {
    if (!byPerson.has(m.person_id)) byPerson.set(m.person_id, { name: m.name, marks: [] });
    byPerson.get(m.person_id).marks.push(m);
  }
  const missing = [];
  for (const { name, marks: list } of byPerson.values()) {
    let n = 0;
    for (let i = list.length - 1; i >= 0 && !list[i].present; i--) n++;
    const lastHere = [...list].reverse().find(m => m.present)?.date || null;
    if (n >= 3) missing.push({ name, missed: n, lastPresent: lastHere });
  }
  missing.sort((a, b) => b.missed - a.missed || a.name.localeCompare(b.name));
  const present = rollList.reduce((n, r) => n + r.present, 0);
  const marked = rollList.reduce((n, r) => n + r.marked, 0);
  const roll = { rolls: rollList, rate: marked ? round1((present / marked) * 100) : null, missing };

  // Songs sung.
  const songs = songServicesIn(start, end).sort((a, b) => a.iso.localeCompare(b.iso));

  // Group meetings.
  const meetings = meetingsIn(start, end).map(m => ({
    group: m.grp, title: m.title, date: m.date, time: m.time || '',
    headCount: m.head_count, rsvpYes: m.rsvp_yes + m.rsvp_guests,
  }));

  // The serving schedule: every job this week, and those nobody has.
  const jobs = servingIn(start, end);
  const open = jobs.filter(j => !String(j.name || '').trim())
    .map(j => ({ date: j.iso, service: j.service, job: j.job }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const serving = { jobs: jobs.length, filled: jobs.length - open.length, open, people: new Set(jobs.map(j => lower(j.name)).filter(Boolean)).size };

  // Guest follow-ups started or finished this week.
  const fus = followUpsIn(start, end);
  const inWeek = iso => iso && iso.slice(0, 10) >= start && iso.slice(0, 10) <= end;
  const followUps = {
    started: fus.filter(f => inWeek(f.created_at)).length,
    reached: fus.filter(f => inWeek(f.completed_at) && f.outcome !== 'no-contact').length,
    unreached: fus.filter(f => inWeek(f.completed_at) && f.outcome === 'no-contact').length,
    open: db.prepare("SELECT COUNT(*) n FROM workflow_instances WHERE definition_id = 'visitor-follow-up' AND status = 'active'").get().n,
  };

  // Bible class and sign-ups: what members did themselves.
  const engagement = {
    quizGames: db.prepare('SELECT COUNT(*) n FROM bible_quiz_games WHERE finished_at IS NOT NULL AND date(finished_at) BETWEEN ? AND ?').get(start, end).n,
    quizPlayers: db.prepare('SELECT COUNT(DISTINCT user_id) n FROM bible_quiz_games WHERE finished_at IS NOT NULL AND date(finished_at) BETWEEN ? AND ?').get(start, end).n,
    versesScored: db.prepare('SELECT COUNT(*) n FROM memory_scores WHERE scored_on BETWEEN ? AND ?').get(start, end).n,
    signups: db.prepare('SELECT COUNT(*) n FROM signup_entries WHERE date(created_at) BETWEEN ? AND ?').get(start, end).n,
  };

  // The week a day at a time, for the strip across the top of the summary.
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(start, i);
    return {
      date, weekday: WEEKDAYS[i],
      attendance: rows.filter(r => r.iso === date).sort((a, b) => byService(a.service, b.service))
        .map(r => ({ service: r.service, count: r.count })),
      guests: guestList.filter(g => g.date === date).length,
      meetings: meetings.filter(m => m.date === date).map(m => m.title),
    };
  });

  return {
    start, end,
    attendance: { services, headline, total: services.reduce((n, s) => n + s.count, 0) },
    giving, guests, roll, songs, meetings, serving, followUps, engagement, days,
  };
}

// ─── The year so far ──────────────────────────────────────────────────────────

function yearReport({ end }) {
  const year = Number(end.slice(0, 4));
  const start = `${year}-01-01`;
  const byService = serviceOrder();
  const firstSunday = sundayOf(start) < start ? addDays(sundayOf(start), 7) : sundayOf(start);

  // Attendance: each week, each service, and how the year compares with last.
  const weeks = weeklyAttendance(firstSunday, end);
  const serviceNames = [...new Set(weeks.flatMap(w => Object.keys(w.byService)))].sort(byService);
  const perService = serviceNames.map(service => {
    const counts = weeks.map(w => w.byService[service]).filter(n => n > 0);
    return {
      service,
      average: counts.length ? round1(avg(counts)) : null,
      high: counts.length ? Math.max(...counts) : null,
      low: counts.length ? Math.min(...counts) : null,
      services: counts.length,
    };
  });
  const lastYearEnd = addDays(end, -364);
  const lastYearRows = attendanceIn(`${year - 1}-01-01`, lastYearEnd);
  const lastYearAvg = {};
  for (const service of serviceNames) {
    const byWeek = new Map();
    for (const r of lastYearRows.filter(x => x.service === service)) byWeek.set(sundayOf(r.iso), (byWeek.get(sundayOf(r.iso)) || 0) + r.count);
    lastYearAvg[service] = byWeek.size ? round1(avg([...byWeek.values()])) : null;
  }
  perService.forEach(s => { s.lastYear = lastYearAvg[s.service]; });

  // Giving: running total through the year, and against last year to the same date.
  const gifts = givingIn(start, end).sort((a, b) => a.iso.localeCompare(b.iso));
  const lastYearGifts = givingIn(`${year - 1}-01-01`, lastYearEnd);
  const byMonthGiving = Array(12).fill(0);
  for (const g of gifts) byMonthGiving[monthOf(g.iso)] += g.amount;
  let running = 0;
  const givingWeeks = weeks.map(w => {
    const amount = gifts.filter(g => sundayOf(g.iso) === w.start).reduce((n, g) => n + g.amount, 0);
    running += amount;
    return { start: w.start, amount, running: Math.round(running * 100) / 100 };
  });
  const giving = {
    total: Math.round(gifts.reduce((n, g) => n + g.amount, 0) * 100) / 100,
    weeks: givingWeeks,
    average: gifts.length ? Math.round(avg(gifts.map(g => g.amount)) * 100) / 100 : null,
    lastYearToDate: lastYearGifts.length ? Math.round(lastYearGifts.reduce((n, g) => n + g.amount, 0) * 100) / 100 : null,
    byMonth: byMonthGiving.slice(0, monthOf(end) + 1).map((amount, i) => ({ month: MONTHS[i], amount: Math.round(amount * 100) / 100 })),
  };

  // Guests by month, first-time against returning.
  const first = firstVisits();
  const visits = visitsIn(start, end);
  const guestMonths = Array.from({ length: monthOf(end) + 1 }, (_, i) => ({ month: MONTHS[i], firstTime: 0, returning: 0 }));
  for (const v of visits) {
    const m = guestMonths[monthOf(v.iso)];
    if (first.get(v.visitor_id) === v.iso) m.firstTime++; else m.returning++;
  }
  const uniqueGuests = new Set(visits.map(v => v.visitor_id)).size;
  const cameBack = [...new Set(visits.map(v => v.visitor_id))]
    .filter(id => visits.filter(v => v.visitor_id === id).length > 1).length;
  const guests = {
    visits: visits.length, unique: uniqueGuests,
    firstTime: visits.filter(v => first.get(v.visitor_id) === v.iso).length,
    cameBack, returnRate: uniqueGuests ? round1((cameBack / uniqueGuests) * 100) : null,
    byMonth: guestMonths,
  };

  // The roll call, month by month.
  const marks = marksIn(start, end);
  const rollMonths = Array.from({ length: monthOf(end) + 1 }, (_, i) => ({ month: MONTHS[i], present: 0, marked: 0 }));
  for (const m of marks) { const r = rollMonths[monthOf(m.date)]; r.marked++; if (m.present) r.present++; }
  const roll = {
    byMonth: rollMonths.map(r => ({ month: r.month, rate: r.marked ? round1((r.present / r.marked) * 100) : null })),
    rate: marks.length ? round1((marks.filter(m => m.present).length / marks.length) * 100) : null,
  };

  // Songs: the most sung, and how many different.
  const songServices = songServicesIn(start, end);
  const tally = new Map();
  for (const s of songServices) for (const t of s.songs) tally.set(t, (tally.get(t) || 0) + 1);
  const songs = {
    services: songServices.length,
    distinct: tally.size,
    top: [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10)
      .map(([title, count]) => ({ title, count })),
  };

  // Group meetings, by group.
  const meetings = meetingsIn(start, end);
  const groupTally = new Map();
  for (const m of meetings) {
    if (!groupTally.has(m.grp)) groupTally.set(m.grp, { group: m.grp, meetings: 0, people: 0 });
    const g = groupTally.get(m.grp);
    g.meetings++; g.people += m.head_count || 0;
  }
  const groups = {
    meetings: meetings.length,
    people: meetings.reduce((n, m) => n + (m.head_count || 0), 0),
    byGroup: [...groupTally.values()].sort((a, b) => b.meetings - a.meetings || a.group.localeCompare(b.group)),
  };

  // Serving: how many jobs were filled, and how many men shared them.
  const jobs = servingIn(start, end);
  const servedBy = new Map();
  for (const j of jobs) if (String(j.name || '').trim()) servedBy.set(lower(j.name), (servedBy.get(lower(j.name)) || 0) + 1);
  const serving = {
    jobs: jobs.length,
    filled: [...servedBy.values()].reduce((a, b) => a + b, 0),
    people: servedBy.size,
    fillRate: jobs.length ? round1(([...servedBy.values()].reduce((a, b) => a + b, 0) / jobs.length) * 100) : null,
  };

  // Follow-ups finished this year, and how many reached the guest.
  const fus = db.prepare(`
    SELECT outcome FROM workflow_instances
     WHERE definition_id = 'visitor-follow-up' AND status = 'completed' AND date(completed_at) BETWEEN ? AND ?
  `).all(start, end);
  const followUps = {
    finished: fus.length,
    reached: fus.filter(f => f.outcome !== 'no-contact').length,
  };
  followUps.rate = fus.length ? round1((followUps.reached / fus.length) * 100) : null;

  const engagement = {
    quizGames: db.prepare('SELECT COUNT(*) n FROM bible_quiz_games WHERE finished_at IS NOT NULL AND date(finished_at) BETWEEN ? AND ?').get(start, end).n,
    quizPlayers: db.prepare('SELECT COUNT(DISTINCT user_id) n FROM bible_quiz_games WHERE finished_at IS NOT NULL AND date(finished_at) BETWEEN ? AND ?').get(start, end).n,
    versesScored: db.prepare('SELECT COUNT(*) n FROM memory_scores WHERE scored_on BETWEEN ? AND ?').get(start, end).n,
    signups: db.prepare('SELECT COUNT(*) n FROM signup_entries WHERE date(created_at) BETWEEN ? AND ?').get(start, end).n,
  };

  return {
    start, end, year,
    attendance: { services: perService, weeks, serviceNames },
    giving, guests, roll, songs, groups, serving, followUps, engagement,
  };
}

// Both halves, for the week holding `date` (by default the week just ended).
function build({ date } = {}) {
  const week = date ? weekOf(date) : lastWeek();
  return { week: weekReport(week), year: yearReport(week) };
}

module.exports = { build, weekOf, lastWeek, weekReport, yearReport, MONTHS };
