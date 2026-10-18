// ─── Who visited, to the congregation ─────────────────────────────────────────
//
// Once the guests at a service are recorded, whoever recorded them can let the
// congregation know who was with us, so members can put a name to a face and
// say hello next time. Each guest's name links to their own page on the
// portal, and the email ends with a link to the whole guest list.
//
// Only what helps somebody recognise and welcome a guest goes out: their name,
// whether it was their first time, who invited them and the town they are
// from. Phone numbers, addresses and email addresses stay on the portal,
// behind the sign-in, where the guest page already keeps them.

const { link } = require('./notify');
const mailer = require('./mailer');
const groups = require('./groups');

const esc = mailer.escapeHtml;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// The guest book writes dates as MM/DD/YY. Anything else is shown as typed.
function longDate(raw) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(String(raw || '').trim());
  if (!m) return String(raw || '');
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const d = new Date(Date.UTC(year, Number(m[1]) - 1, Number(m[2]), 12));
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${year}`;
}

// The congregation's list, which is where this goes unless somebody picks another.
const DEFAULT_LIST = 'announcements';

const guestLink = id => link('visitors', { guest: id });

// One line about a guest, without their name: first time or how many visits,
// who invited them, where they are from.
function aboutGuest(guest) {
  const visits = guest.visits?.length || 0;
  const place  = [guest.city, guest.state].filter(Boolean).join(', ');
  return [
    visits <= 1 ? 'First time with us' : `Visit number ${visits}`,
    guest.invited_by && `invited by ${guest.invited_by}`,
    place && `from ${place}`,
  ].filter(Boolean).join(' · ');
}

const compose = {};

compose.guestsRecorded = ({ date, service, guests, from = '' }) => {
  const when    = `${service ? `${service}, ` : ''}${longDate(date)}`;
  const count   = guests.length;
  const opening = `We were glad to have ${count === 1 ? 'a guest' : `${count} guests`} with us at ${when}.`;
  const closing = 'If you met them, a word of welcome next time goes a long way.';
  const signed  = from ? `Sent by ${from} through the church's member portal.` : 'Sent through the church\'s member portal.';
  const allLink = link('visitors');

  const body = [
    opening,
    '',
    ...guests.flatMap(g => [`• ${g.name} — ${aboutGuest(g)}`, `  ${guestLink(g.id)}`]),
    '',
    closing,
    '',
    `All our guests: ${allLink}`,
    '',
    signed,
  ].join('\n');

  const html = `<div style="font-family:Georgia,'Times New Roman',serif;color:#1f2937;max-width:560px;line-height:1.5">
  <h2 style="color:#1a2744;font-size:20px;margin:0 0 4px">Our guests</h2>
  <p style="color:#6b7280;font-size:14px;margin:0 0 16px">${esc(when)}</p>
  <p style="margin:0 0 16px">${esc(opening)}</p>
  <ul style="padding:0;margin:0 0 16px;list-style:none">
${guests.map(g => `    <li style="padding:10px 12px;margin:0 0 8px;border:1px solid #e5e7eb;border-left:3px solid #c9a84c;border-radius:6px">
      <a href="${esc(guestLink(g.id))}" style="color:#1a2744;font-weight:bold;text-decoration:none">${esc(g.name)}</a>
      <div style="color:#6b7280;font-size:13px">${esc(aboutGuest(g))}</div>
    </li>`).join('\n')}
  </ul>
  <p style="margin:0 0 16px">${esc(closing)}</p>
  <p style="margin:0 0 24px"><a href="${esc(allLink)}" style="display:inline-block;background:#1a2744;color:#ffffff;padding:8px 16px;border-radius:6px;text-decoration:none;font-family:sans-serif;font-size:14px">See all our guests</a></p>
  <p style="color:#9ca3af;font-size:12px;margin:0">${esc(signed)} Signing in to the portal is needed to open a guest's page.</p>
</div>`;

  return { subject: `Our guests — ${when}`, body, html };
};

// Queues the email to everyone on a mailing list.
function sendGuestsRecorded({ date, service, guests, listKey = DEFAULT_LIST, from = '' }) {
  const { recipients, missing, group } = groups.recipientsFor(listKey);
  if (!group) return { error: 'No such mailing list' };
  if (!recipients.length) return { error: `Nobody on the ${group.name} list has an email address on file` };

  const queued = mailer.send({
    to: recipients,
    ...compose.guestsRecorded({ date, service, guests, from }),
    context: `guests:${date}:${service || 'service'}:email`,
  });
  return { queued: queued.length, missing, list: { key: group.key, name: group.name } };
}

module.exports = { compose, sendGuestsRecorded, guestLink, longDate, DEFAULT_LIST };
