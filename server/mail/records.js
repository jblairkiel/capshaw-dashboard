// The weekly records reminder: what the Record Keeping report shows as not
// yet on file, sent to whoever looks after each record.
//
// It covers the eight days up to yesterday — sent on a Monday, that is the
// whole of last week and the Sunday just gone — and mentions, without
// listing, any older gaps. Each person hears only about what they look after:
// the song tracker hears about songs, the guest book about guests, the
// counters about the contribution. Whoever holds Reports & Record Keeping
// hears about all of it. A record nobody looks after goes to the admins, so
// a gap is never mailed to nobody. When nothing is missing, nothing is sent.

const db = require('../db');
const mailer = require('./mailer');
const { link } = require('./notify');
const records = require('../lib/recordKeeping');

const JOB = 'records-reminder';
// Monday, at this hour church time — late enough for Sunday's records to have
// been typed in the evening, early enough to be in the morning's email.
const SEND_DAY  = 1;
const SEND_HOUR = 9;

const DAY_FMT = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
const dayLabel = iso => DAY_FMT.format(new Date(`${iso}T12:00:00Z`));

// Everything missing, one item per gap, from the report as of `through`.
function gaps(through) {
  const report = records.report({ weeks: 8, today: through });
  const items = [];
  let earlier = 0;

  report.weeks.forEach((week, i) => {
    const found = [];
    for (const row of week.rows) {
      for (const [check, cell] of Object.entries(row.cells)) {
        if (cell.status === 'missing') found.push({ check, date: row.date, service: row.service });
      }
    }
    if (week.contribution?.status === 'missing') found.push({ check: 'contribution', date: week.contribution.date, service: '' });
    // This week and last are listed; anything older is only counted.
    if (i < 2) items.push(...found); else earlier += found.length;
  });

  items.sort((a, b) => a.date.localeCompare(b.date) || a.service.localeCompare(b.service));
  return { items, earlier, from: report.weeks[1]?.start ?? report.weeks[0].start, through };
}

const compose = {};

compose.recordsReminder = ({ items, earlier = 0, from, through }) => {
  const byCheck = records.CHECKS
    .map(check => ({ check, items: items.filter(i => i.check === check.id) }))
    .filter(g => g.items.length);

  return {
    subject: `Records to fill in: ${items.length} from ${dayLabel(from)} to ${dayLabel(through)}`,
    body: [
      `These are not on file yet for ${dayLabel(from)} to ${dayLabel(through)}:`,
      '',
      ...byCheck.flatMap(({ check, items: list }) => [
        `${check.label}:`,
        ...list.map(i => `  • ${dayLabel(i.date)}${i.service ? ` — ${i.service}` : ''}`),
        '',
      ]),
      ...(earlier ? [`There ${earlier === 1 ? 'is 1 more gap' : `are ${earlier} more gaps`} from earlier weeks on the report.`, ''] : []),
      'If there was nothing to record — no guests, or no service — mark it on the Record Keeping page and it will stop being reported:',
      link('record-keeping'),
      '',
      'You are getting this because you look after these records.',
    ].join('\n'),
  };
};

function holdersOf(area) {
  return db.prepare(`
    SELECT u.id, u.name, u.email FROM users u
      JOIN user_areas a ON a.user_id = u.id
     WHERE a.area = ? AND u.role = 'approved' AND u.email IS NOT NULL AND u.email <> ''
  `).all(area);
}

function admins() {
  return db.prepare("SELECT id, name, email FROM users WHERE role = 'admin' AND email IS NOT NULL AND email <> ''").all();
}

// Who hears about which records: email → { person, checks }.
function recipients(checkIds) {
  const out = new Map();
  const give = (person, ids) => {
    const key = person.email.trim().toLowerCase();
    if (!out.has(key)) out.set(key, { person, checks: new Set() });
    ids.forEach(id => out.get(key).checks.add(id));
  };

  const overseers = holdersOf('records');
  overseers.forEach(p => give(p, checkIds));

  for (const id of checkIds) {
    const check = records.CHECKS.find(c => c.id === id);
    const holders = holdersOf(check.area);
    holders.forEach(p => give(p, [id]));
    if (!holders.length && !overseers.length) admins().forEach(p => give(p, [id]));
  }
  return [...out.values()];
}

// Sends the reminder for everything missing up to `through` (yesterday, by
// default). Returns who got what; nothing is queued when nothing is missing.
function sendReminder({ today = records.churchToday() } = {}) {
  const through = records.addDays(today, -1);
  const found = gaps(through);
  if (!found.items.length) return { missing: 0, earlier: found.earlier, sent: [] };

  const checkIds = [...new Set(found.items.map(i => i.check))];
  const sent = [];
  for (const { person, checks } of recipients(checkIds)) {
    const mine = found.items.filter(i => checks.has(i.check));
    if (!mine.length) continue;
    const queued = mailer.send({
      to: [{ email: person.email, name: person.name }],
      ...compose.recordsReminder({ ...found, items: mine }),
      context: `records-reminder:${today}`,
    });
    if (queued.length) sent.push({ name: person.name, email: person.email, items: mine.length });
  }
  return { missing: found.items.length, earlier: found.earlier, sent };
}

// ─── The Monday run ───────────────────────────────────────────────────────────

function churchHour(now) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hourCycle: 'h23' }).format(now));
}

// Called on a timer. Sends once per week, on the first tick at or after
// Monday 9:00 church time; a server that was down on Monday sends when it
// comes back, later that week.
function tick(now = new Date()) {
  const today = records.churchToday(now);
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  if (weekday < SEND_DAY || (weekday === SEND_DAY && churchHour(now) < SEND_HOUR)) return null;

  const key = records.sundayOf(today);
  const last = db.prepare('SELECT last_key FROM scheduled_jobs WHERE name = ?').get(JOB);
  if (last?.last_key === key) return null;

  // Claimed before sending, so a second process ticking at the same moment
  // finds it taken rather than sending a second copy.
  const claimed = db.prepare(`
    INSERT INTO scheduled_jobs (name, last_key, last_run_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(name) DO UPDATE SET last_key = excluded.last_key, last_run_at = excluded.last_run_at
     WHERE scheduled_jobs.last_key <> excluded.last_key
  `).run(JOB, key);
  if (!claimed.changes) return null;

  return sendReminder({ today });
}

function lastRun() {
  return db.prepare('SELECT last_key, last_run_at FROM scheduled_jobs WHERE name = ?').get(JOB) || null;
}

module.exports = { compose, gaps, recipients, sendReminder, tick, lastRun, SEND_DAY, SEND_HOUR };
