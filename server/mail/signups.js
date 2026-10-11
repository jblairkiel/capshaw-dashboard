// ─── Emails about a sign-up list ──────────────────────────────────────────────
//
// Whoever keeps a sign-up list can email about it: their own words first,
// then the details of the list as it stands — when, what it is for, and what
// is still needed — and its link, so nobody has to retype any of it. The
// list's keeper can write to the people already on it; the sign-up manager
// (or whoever looks after the email groups) can also write to a whole
// distribution group.

const { link } = require('./notify');
const mailer = require('./mailer');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function longDate(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function clock(time) {
  if (!/^\d{1,2}:\d{2}$/.test(time || '')) return '';
  const [h, m] = time.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

// The list as it stands, in plain text, for the body of an email.
function detailLines(list) {
  const lines = [list.title, ''];
  if (list.description) lines.push(list.description.trim(), '');
  const upcoming = list.dates.filter(d => !d.past);
  for (const d of upcoming.length ? upcoming : list.dates) {
    lines.push(`${longDate(d.date)}${clock(d.time) ? ` at ${clock(d.time)}` : ''}${d.note ? ` — ${d.note}` : ''}`);
    for (const slot of d.items) {
      const item = list.items.find(i => i.id === slot.itemId);
      const left = slot.needed === null ? '' : slot.full ? ' — filled' : ` — ${slot.needed - slot.taken} of ${slot.needed} still needed`;
      lines.push(`  • ${item?.label || 'Item'}${left}`);
    }
    if (list.allowFree) lines.push(`  • ${list.freeLabel || 'Anything else you would like to bring or do'}${d.free.length ? ` (${d.free.length} signed up)` : ''}`);
  }
  return lines;
}

const compose = {};

compose.signupEmail = ({ list, subject = '', message = '', from = '' }) => ({
  subject: String(subject || '').trim().slice(0, 150) || `Sign up: ${list.title}`,
  body: [
    String(message || '').trim(),
    '',
    '────────────',
    ...detailLines(list),
    '',
    `Sign up here: ${link('signups', { list: list.id })}`,
    '',
    from ? `Sent by ${from} through the church's member portal.` : 'Sent through the church\'s member portal.',
  ].join('\n').replace(/^\n+/, '').replace(/\n{3,}/g, '\n\n'),
});

// Queues the email to each recipient. Returns the rows queued.
function sendSignupEmail({ list, recipients, email }) {
  return mailer.send({ to: recipients, ...email, context: `signup:${list.id}:email` });
}

module.exports = { compose, detailLines, longDate, sendSignupEmail };
