// ─── Reminding the song leader ────────────────────────────────────────────────
//
// Whoever the Serving Schedule has leading singing at a service is emailed
// twice before it: four days out (96 hours), so there is time to choose the
// songs and submit the service, and a final reminder the day before (24
// hours). Both link straight to that service on the Submit a Service tab, and
// say where it stands — not submitted, waiting for the worship organizer, or
// confirmed — so the final one is useful even when everything is done.
//
// The times are each service type's start_time (church time), which the
// worship organizer keeps on the Service Parts tab; a service with none is
// taken to start at 9:00. Each reminder is claimed in worship_reminders
// before it is sent, so a restart or a second server never sends it twice. A
// server that was down past the four-day mark sends only the final one.

const db = require('../db');
const mailer = require('./mailer');
const { link, planLines, serviceDay } = require('./notify');
const plans = require('../lib/worshipPlans');
const { churchToday } = require('../lib/recordKeeping');

const HOURS_BEFORE = { first: 96, final: 24 };
const DEFAULT_START = '09:00';
const ZONE = 'America/Chicago';

// A church-time date and time as an instant: guess it as UTC, see what the
// church's clock says at that instant, and move by the difference.
function churchInstant(date, time) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = (/^\d{1,2}:\d{2}$/.test(time) ? time : DEFAULT_START).split(':').map(Number);
  const wanted = Date.UTC(y, m - 1, d, hh, mm);
  let instant = wanted;
  for (let i = 0; i < 2; i++) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone: ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date(instant)).map(p => [p.type, p.value]));
    const shown = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
    instant += wanted - shown;
  }
  return new Date(instant);
}

function startsAt(date, service) {
  return churchInstant(date, plans.serviceType(service)?.start_time || DEFAULT_START);
}

const clock = time => {
  if (!/^\d{1,2}:\d{2}$/.test(time || '')) return '';
  const [h, m] = time.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

// The song leaders the Serving Schedule names for a service, with the address
// the directory (or their own account) has for each.
function leadersFor(date, service) {
  const { jobs } = plans.servingFor(date, service);
  const names = Object.entries(jobs).filter(([job]) => /^song\s*lead/i.test(job)).flatMap(([, n]) => n);
  const people = db.prepare(`
    SELECT d.name, COALESCE(NULLIF(d.email, ''), u.email, '') AS email
      FROM directory d LEFT JOIN users u ON u.directory_id = d.id
  `).all();
  return names.map(name => {
    const person = people.find(p => plans.nameKey(p.name) === plans.nameKey(name) && p.email);
    return { name, email: person?.email || '' };
  });
}

const compose = {};

compose.songLeaderReminder = ({ kind, date, service, time = '', leader, plan = null, requests = [] }) => {
  const when = `${serviceDay(date)}${clock(time) ? ` at ${clock(time)}` : ''}`;
  const where = link('upcoming', { tab: 'service', date, service });
  const first = leader.split(/[\s,]+/).filter(Boolean);
  const greeting = leader.includes(',') ? first[1] || leader : first[0] || leader;

  // A requested song the service already has needs no mention.
  const inService = new Set((plan?.items || []).map(i => i.song?.id).filter(Boolean));
  const asked = requests.filter(r => !inService.has(r.song.id));

  const status = !plan ? [
    'The service has not been submitted yet. Please choose the songs and fill in the order of worship here:',
    where,
  ] : plan.status === 'submitted' ? [
    'You have submitted it, and it is waiting for the worship organizer to confirm it. You can still change it here:',
    where,
    '',
    ...planLines(plan),
  ] : [
    'It has been confirmed. Here it is; the worship organizer can make any change that is still needed:',
    '',
    ...planLines(plan),
    '',
    where,
  ];

  return {
    subject: `${kind === 'final' ? 'Final reminder: ' : ''}You are leading singing — ${service}, ${serviceDay(date)}`,
    body: [
      `${greeting},`,
      '',
      `You are down on the Serving Schedule to lead singing at the ${service} on ${when}.`,
      kind === 'final' ? 'This is the last reminder before the service.' : '',
      '',
      ...status,
      ...((!plan || plan.status === 'submitted') && asked.length ? [
        '',
        'Songs members have asked for:',
        ...asked.slice(0, 5).map(r => `  • ${r.song.title}${r.forDate === date ? ' (for this service)' : ''}`),
      ] : []),
      '',
      'You are getting this because you are the song leader for this service on the Serving Schedule.',
    ].join('\n').replace(/\n{3,}/g, '\n\n'),
  };
};

// Which reminder a service is due, if any, at `now`.
function dueKind(start, now) {
  const hours = (start - now) / 3_600_000;
  if (hours <= 0) return null;
  if (hours <= HOURS_BEFORE.final) return 'final';
  if (hours <= HOURS_BEFORE.first) return 'first';
  return null;
}

// Called on a timer. Returns what it sent.
function tick(now = new Date()) {
  const today = churchToday(now);
  const sent = [];
  const requests = plans.listRequests({ statuses: ['open'] });

  for (const slot of plans.upcoming(null, { days: 6, today })) {
    const start = startsAt(slot.date, slot.service);
    const kind = dueKind(start, now);
    if (!kind) continue;
    const time = plans.serviceType(slot.service)?.start_time || '';

    for (const leader of leadersFor(slot.date, slot.service)) {
      // Nobody to write to yet: try again next tick, in case an address is added.
      if (!leader.email) continue;
      const claimed = db.prepare(`
        INSERT OR IGNORE INTO worship_reminders (date, service, kind, leader, email) VALUES (?, ?, ?, ?, ?)
      `).run(slot.date, slot.service, kind, leader.name, leader.email).changes;
      if (!claimed) continue;
      // The final reminder supersedes a first one that never went.
      if (kind === 'final') db.prepare("INSERT OR IGNORE INTO worship_reminders (date, service, kind, leader, email) VALUES (?, ?, 'first', ?, '')").run(slot.date, slot.service, leader.name);

      const queued = mailer.send({
        to: [{ email: leader.email, name: leader.name }],
        ...compose.songLeaderReminder({ kind, date: slot.date, service: slot.service, time, leader: leader.name, plan: slot.plan, requests }),
        context: `worship-reminder:${slot.date}:${kind}`,
      });
      if (queued.length) sent.push({ date: slot.date, service: slot.service, kind, leader: leader.name });
    }
  }
  return sent;
}

module.exports = { compose, tick, startsAt, churchInstant, dueKind, leadersFor, HOURS_BEFORE };
