// ─── Reminding whoever prepares communion ─────────────────────────────────────
//
// A week before the month somebody signed up to prepare the Lord's Supper,
// they are emailed a reminder. Someone who signs up inside that week (or is
// written in by the keeper) is reminded on the next tick, so long as the month
// has not begun. Each reminder is claimed on the sign-up row (reminded_at)
// before it is sent, so a restart or a second server never sends it twice;
// changing the name on a month clears the claim, so the new person is told.

const db = require('../db');
const mailer = require('./mailer');
const { link } = require('./notify');
const prep = require('../lib/communionPrep');
const { churchToday } = require('../lib/recordKeeping');

const DAYS_BEFORE = 7;

function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const firstOf = (year, month) => `${year}-${String(month).padStart(2, '0')}-01`;

const compose = {};

compose.reminder = ({ name, year, month }) => {
  const when = `${prep.MONTHS[month - 1]} ${year}`;
  const greeting = String(name || '').split(/\s+/)[0] || 'Hello';
  return {
    subject: `Reminder: you are preparing communion in ${when}`,
    body: [
      `${greeting},`,
      '',
      `This is a reminder that you are signed up to prepare the Lord's Supper in ${when}, which begins a week from now.`,
      '',
      'If you can no longer do it, please let whoever keeps the communion preparation list know as soon as you can, or take your name off here:',
      link('communion-prep', { year }),
      '',
      'You are getting this because your name is on the communion preparation sign-up list.',
    ].join('\n'),
  };
};

// The sign-ups whose reminder is due today: the month begins within the week
// and has not begun yet, and nobody has been reminded.
function due(today) {
  return db.prepare('SELECT * FROM communion_prep_signups WHERE reminded_at IS NULL').all().filter(s => {
    const first = firstOf(s.year, s.month);
    return today < first && today >= addDays(first, -DAYS_BEFORE);
  });
}

// Called on a timer. Returns what it sent.
function tick(now = new Date()) {
  const today = churchToday(now);
  const sent = [];
  for (const signup of due(today)) {
    const email = prep.emailFor(signup);
    // Nobody to write to yet: try again next tick, in case an address is added.
    if (!email) continue;
    const claimed = db.prepare("UPDATE communion_prep_signups SET reminded_at = datetime('now') WHERE id = ? AND reminded_at IS NULL").run(signup.id).changes;
    if (!claimed) continue;
    const queued = mailer.send({
      to: [{ email, name: signup.name }],
      ...compose.reminder(signup),
      context: `communion-prep:${signup.year}-${signup.month}:reminder`,
    });
    if (queued.length) sent.push({ name: signup.name, year: signup.year, month: signup.month });
  }
  return sent;
}

module.exports = { compose, tick, due, DAYS_BEFORE };
