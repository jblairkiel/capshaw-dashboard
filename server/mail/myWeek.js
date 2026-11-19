// ─── "Your week", by email ────────────────────────────────────────────────────
//
// Each Sunday morning every member with an account gets their own My Week page
// (lib/myWeek.js) by email: what they are serving, signed up for, going to, or
// taking a turn at this week, the week after in brief, and any group meeting
// still waiting on their answer. Each line names the page it lives on, and the
// email links to My Week, where everything can be changed.
//
// Nobody is sent an empty email: a member with nothing in the next two weeks
// and no rotation they are next up on is skipped that week.
//
// Everyone is opted in, like the monthly schedule summary. A member turns it
// off under My Household & Preferences (users.wants_weekly_email), and the
// foot of every email says where.
//
// Test mode. While mail is redirected (mail/mailer.js), this would otherwise
// put one email per member into the one test inbox every Sunday. So until the
// site sends for real it goes only to the people let through to their own
// address on Admin → Email Delivery; everybody else is skipped, not redirected.
// The Emails page shows what it looks like.
//
// Each email is claimed in my_week_emails, per account per Sunday, before it is
// built, so ticking every few minutes, a restart, or two servers never sends a
// second copy. A server that is down all Sunday morning sends nothing that
// week: Monday's email about "this week" would already be a day stale.

const db = require('../db');
const mailer = require('./mailer');
const delivery = require('./delivery');
const { link } = require('./notify');
const { weekFor } = require('../lib/myWeek');
const { churchToday, addDays } = require('../lib/recordKeeping');

// Sunday, from 7:00 AM church time, until the end of the day.
const SEND_WEEKDAY = 0;
const SEND_FROM_MINUTE = 7 * 60;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const atNoon = iso => new Date(`${iso}T12:00:00Z`);
const dayLabel = iso => { const d = atNoon(iso); return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`; };
const shortDay = iso => { const d = atNoon(iso); return `${WEEKDAYS[d.getUTCDay()].slice(0, 3)} ${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCDate()}`; };
const range = (from, to) => {
  const a = atNoon(from), b = atNoon(to);
  return a.getUTCMonth() === b.getUTCMonth()
    ? `${MONTHS[a.getUTCMonth()]} ${a.getUTCDate()}–${b.getUTCDate()}`
    : `${MONTHS[a.getUTCMonth()]} ${a.getUTCDate()} – ${MONTHS[b.getUTCMonth()]} ${b.getUTCDate()}`;
};

// "17:00" → "5:00 PM"; anything else as it was written.
function timeLabel(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!m) return value || '';
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

const RSVP = {
  yes: 'You said you are coming',
  maybe: 'You said maybe',
  unanswered: 'They are waiting on your answer',
};

// One item as the email shows it — the same wording as the My Week page
// (client/src/components/MyWeekView.jsx).
function describe(item) {
  switch (item.kind) {
    case 'job':
      return {
        kind: 'Serving', title: item.job, detail: item.service,
        notes: item.replacementAsked ? ['You have asked for somebody to take this one'] : [],
      };
    case 'signup':
      return {
        kind: 'Sign-up', title: item.title,
        detail: [item.item, timeLabel(item.time), item.note && `“${item.note}”`].filter(Boolean).join(' · '),
        notes: [],
      };
    case 'meeting':
      return {
        kind: 'Group', title: item.title,
        detail: [item.group, timeLabel(item.time), item.location].filter(Boolean).join(' · '),
        notes: [
          item.rsvp && RSVP[item.rsvp],
          item.guests ? `Bringing ${item.guests} guest${item.guests === 1 ? '' : 's'}` : '',
          item.bringing?.length ? `You're bringing ${item.bringing.join(', ')}` : '',
        ].filter(Boolean),
        waiting: item.rsvp === 'unanswered',
      };
    case 'rotation':
      return { kind: 'Rotation', title: `Your turn: ${item.title}`, detail: item.note || '', notes: [] };
    default:
      return { kind: '', title: item.title || '', detail: '', notes: [] };
  }
}

// Worth sending: anything dated in the fortnight, or a rotation they are next up on.
const hasAnything = week => week.items.length > 0 || week.nextUp.length > 0;

const esc = mailer.escapeHtml;
const compose = {};

compose.myWeek = ({ week }) => {
  const split = addDays(week.from, 7);
  const thisWeek = week.items.filter(i => i.date < split);
  const later = week.items.filter(i => i.date >= split);
  const waiting = week.items.filter(i => i.rsvp === 'unanswered').length;
  const first = String(week.name || '').split(/[\s,]+/).filter(Boolean)[0] || '';
  const weekEnd = addDays(week.from, 6);
  const page = link('my-week');
  const prefs = link('profile');

  const byDay = new Map();
  for (const item of thisWeek) {
    if (!byDay.has(item.date)) byDay.set(item.date, []);
    byDay.get(item.date).push(item);
  }

  const count = n => `${n} thing${n === 1 ? '' : 's'}`;
  const subject = thisWeek.length
    ? `Your week: ${count(thisWeek.length)}, ${range(week.from, weekEnd)}`
    : `Your week: ${range(week.from, weekEnd)}`;
  const why = 'You are getting this because you have an account on the Capshaw member portal.';
  const stop = 'To stop it, turn off "Your week, every Sunday" under My Household & Preferences';

  const body = [
    first ? `${first},` : 'Hello,',
    '',
    thisWeek.length
      ? `Here is what you are down for this week, ${range(week.from, weekEnd)}.`
      : `Nothing is on your list for this week, ${range(week.from, weekEnd)}.`,
    waiting ? `${waiting === 1 ? 'One group is' : `${waiting} groups are`} waiting on your answer.` : '',
    '',
    ...[...byDay.entries()].flatMap(([date, items]) => [
      dayLabel(date),
      ...items.flatMap(item => {
        const d = describe(item);
        return [
          `  • ${d.kind}: ${d.title}${d.detail ? ` — ${d.detail}` : ''}`,
          ...d.notes.map(n => `    ${n}`),
        ];
      }),
      '',
    ]),
    ...(later.length ? [
      'The week after',
      ...later.map(item => `  • ${shortDay(item.date)} · ${describe(item).title}`),
      '',
    ] : []),
    ...(week.nextUp.length ? [
      `You are next up for ${week.nextUp.map(r => r.title).join(', ')}.`,
      '',
    ] : []),
    `See it all, and change anything, on My Week: ${page}`,
    '',
    why,
    `${stop}: ${prefs}`,
  ].join('\n').replace(/\n{3,}/g, '\n\n');

  const chip = {
    Serving: 'background:#1a2744;color:#ffffff',
    'Sign-up': 'background:#d1fae5;color:#065f46',
    Group: 'background:#e0f2fe;color:#075985',
    Rotation: 'background:#fef3c7;color:#92400e',
  };
  const itemHtml = item => {
    const d = describe(item);
    return `<tr>
      <td style="padding:6px 10px 6px 0;vertical-align:top;width:76px"><span style="display:inline-block;${chip[d.kind] || 'background:#f3f4f6;color:#374151'};font-size:10px;font-weight:bold;letter-spacing:.04em;text-transform:uppercase;padding:2px 8px;border-radius:999px">${esc(d.kind)}</span></td>
      <td style="padding:6px 0;vertical-align:top">
        <div style="font-weight:bold;color:#1a2744">${esc(d.title)}</div>
        ${d.detail ? `<div style="color:#4b5563;font-size:14px">${esc(d.detail)}</div>` : ''}
        ${d.notes.map(n => `<div style="font-size:14px;color:${n === RSVP.unanswered ? '#b91c1c;font-weight:bold' : n === RSVP.yes ? '#047857' : '#b45309'}">${esc(n)}</div>`).join('')}
      </td>
    </tr>`;
  };
  const days = [...byDay.entries()].map(([date, items]) => `
  <div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px;margin:0 0 10px">
    <div style="font-weight:bold;color:#1a2744;margin:0 0 4px">${esc(dayLabel(date))}</div>
    <table style="border-collapse:collapse;width:100%">${items.map(itemHtml).join('')}</table>
  </div>`).join('');

  const html = `<div style="font-family:Helvetica,Arial,sans-serif;color:#1f2937;max-width:560px;line-height:1.45">
  <p style="margin:0 0 4px;color:#c9a84c;font-size:11px;font-weight:bold;letter-spacing:.04em">CAPSHAW CHURCH OF CHRIST</p>
  <h2 style="margin:0 0 2px;color:#1a2744;font-size:20px">${esc(first ? `${first}'s week` : 'Your week')}</h2>
  <p style="margin:0 0 16px;color:#6b7280;font-size:14px">${esc(range(week.from, weekEnd))}${thisWeek.length ? ` · ${esc(count(thisWeek.length))}` : ''}${waiting ? ` · <span style="color:#b91c1c;font-weight:bold">${waiting} waiting on your answer</span>` : ''}</p>
  ${thisWeek.length ? days : '<p style="margin:0 0 12px;color:#4b5563">Nothing is on your list for this week.</p>'}
  ${later.length ? `<p style="margin:16px 0 4px;color:#6b7280;font-size:12px;font-weight:bold;letter-spacing:.04em;text-transform:uppercase">The week after</p>
  <ul style="margin:0 0 12px;padding-left:18px;color:#374151;font-size:14px">${later.map(item => `<li>${esc(shortDay(item.date))} · ${esc(describe(item).title)}</li>`).join('')}</ul>` : ''}
  ${week.nextUp.length ? `<p style="margin:12px 0;padding:8px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;color:#92400e;font-size:14px">You are next up for <strong>${week.nextUp.map(r => esc(r.title)).join('</strong>, <strong>')}</strong>.</p>` : ''}
  <p style="margin:16px 0 24px"><a href="${esc(page)}" style="display:inline-block;background:#1a2744;color:#ffffff;padding:8px 16px;border-radius:6px;text-decoration:none;font-size:14px">Open My Week</a></p>
  <p style="color:#9ca3af;font-size:12px;margin:0">${esc(why)} ${esc(stop)}: <a href="${esc(prefs)}" style="color:#9ca3af">${esc(prefs)}</a></p>
</div>`;

  return { subject, body, html };
};

// ─── Sending ──────────────────────────────────────────────────────────────────

// Church time, now: the date, the day of the week and the minute of the day.
function churchNow(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
  }).formatToParts(now).map(p => [p.type, p.value]));
  const today = churchToday(now);
  return { today, weekday: atNoon(today).getUTCDay(), minute: Number(parts.hour) * 60 + Number(parts.minute) };
}

// Approved members and admins with an address who have not turned it off.
function readers() {
  return db.prepare(`
    SELECT * FROM users
     WHERE role IN ('approved', 'admin') AND wants_weekly_email = 1
       AND email IS NOT NULL AND trim(email) <> ''
     ORDER BY id
  `).all();
}

// Whether this address would reach its owner today. Always, once the site
// sends for real; in test mode only if let through on Email Delivery.
function reachable(email, rules) {
  if (!mailer.config().redirectTo) return true;
  return delivery.decide(email, rules).deliver;
}

// Builds and queues one member's email for the fortnight from `from`.
// Returns the queued rows ([] when there was nothing to say).
function sendTo(user, { from }) {
  const week = weekFor(user, { from });
  if (!hasAnything(week)) return { week, queued: [] };
  const queued = mailer.send({
    to: [{ email: user.email, name: user.name }],
    ...compose.myWeek({ week }),
    context: `my-week:${user.id}:${from}`,
  });
  return { week, queued };
}

// Called on a timer. On Sunday from 7 AM church time, sends each member their
// week once. Returns who it went to.
function tick(now = new Date()) {
  const { today, weekday, minute } = churchNow(now);
  if (weekday !== SEND_WEEKDAY || minute < SEND_FROM_MINUTE) return [];

  const rules = delivery.rules();
  const claim = db.prepare('INSERT OR IGNORE INTO my_week_emails (user_id, week_of) VALUES (?, ?)');
  const counted = db.prepare('UPDATE my_week_emails SET items = ? WHERE user_id = ? AND week_of = ?');
  const sent = [];

  for (const user of readers()) {
    // Skipped, not claimed: if they are let through later on Sunday, they get it then.
    if (!reachable(user.email, rules)) continue;
    if (!claim.run(user.id, today).changes) continue;
    const { week, queued } = sendTo(user, { from: today });
    counted.run(queued.length ? week.items.length + week.nextUp.length : 0, user.id, today);
    if (queued.length) sent.push({ userId: user.id, name: user.name, items: week.items.length });
  }
  return sent;
}

module.exports = { compose, tick, sendTo, readers, reachable, describe, hasAnything, churchNow, SEND_WEEKDAY, SEND_FROM_MINUTE };
