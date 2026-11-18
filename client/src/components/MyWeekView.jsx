import { useEffect, useState } from 'react';

// My Week: the first page a member lands on. Everything they have said yes to,
// or been put down for, over today and the next thirteen days — read from
// /api/my-week, which gathers it off the pages it lives on. Each row opens the
// page it came from, where it can be changed.

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const atNoon = iso => new Date(`${iso}T12:00:00Z`);
function addDays(iso, n) {
  const d = atNoon(iso);
  if (Number.isNaN(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function dayHeading(iso, today) {
  const d = atNoon(iso);
  const label = `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  if (iso === today) return `Today · ${label}`;
  if (iso === addDays(today, 1)) return `Tomorrow · ${label}`;
  return label;
}

// "17:00" → "5:00 PM"; anything else is shown as it was written.
function timeLabel(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!m) return value || '';
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

const KIND = {
  job:      { label: 'Serving',   tone: 'bg-church-navy text-white' },
  signup:   { label: 'Sign-up',   tone: 'bg-emerald-100 text-emerald-800' },
  meeting:  { label: 'Group',     tone: 'bg-sky-100 text-sky-800' },
  rotation: { label: 'Rotation',  tone: 'bg-amber-100 text-amber-800' },
};

const RSVP = {
  yes:        { text: 'You said you are coming', tone: 'text-emerald-700' },
  maybe:      { text: 'You said maybe',          tone: 'text-amber-700' },
  unanswered: { text: 'They are waiting on your answer', tone: 'text-red-700 font-medium' },
};

function describe(item) {
  switch (item.kind) {
    case 'job':
      return {
        title: item.job,
        detail: item.service,
        note: item.replacementAsked ? 'You have asked for somebody to take this one' : '',
        open: { page: 'assignments' },
        action: 'Service Roster',
      };
    case 'signup':
      return {
        title: item.title,
        detail: [item.item, timeLabel(item.time), item.note && `“${item.note}”`].filter(Boolean).join(' · '),
        open: { page: 'signups', list: item.listId },
        action: 'Sign-Ups',
      };
    case 'meeting':
      return {
        title: item.title,
        detail: [item.group, timeLabel(item.time), item.location].filter(Boolean).join(' · '),
        rsvp: item.rsvp && RSVP[item.rsvp],
        extra: [
          item.guests ? `Bringing ${item.guests} guest${item.guests === 1 ? '' : 's'}` : '',
          item.bringing?.length ? `You're bringing ${item.bringing.join(', ')}` : '',
        ].filter(Boolean).join(' · '),
        open: { page: 'groups' },
        action: item.rsvp === 'unanswered' ? 'Answer' : 'Church Groups',
      };
    case 'rotation':
      return {
        title: `Your turn: ${item.title}`,
        detail: item.note,
        open: { page: 'rotations', rotation: item.rotationId },
        action: 'Rotations',
      };
    default:
      return { title: item.title || '', open: null };
  }
}

function Item({ item, onOpen }) {
  const kind = KIND[item.kind] || { label: item.kind, tone: 'bg-gray-100 text-gray-700' };
  const d = describe(item);
  return (
    // Phones stack the label, the details and the link, so the details keep the
    // full width; from 640px they sit in a row.
    <li className="flex flex-col sm:flex-row sm:items-start gap-1.5 sm:gap-3 py-3 first:pt-0 last:pb-0">
      <span className={`self-start shrink-0 sm:mt-0.5 text-[11px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded-full sm:w-20 text-center ${kind.tone}`}>
        {kind.label}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-church-navy leading-snug">{d.title}</p>
        {d.detail && <p className="text-sm text-gray-600">{d.detail}</p>}
        {d.rsvp && <p className={`text-sm ${d.rsvp.tone}`}>{d.rsvp.text}</p>}
        {d.extra && <p className="text-sm text-gray-600">{d.extra}</p>}
        {d.note && <p className="text-sm text-amber-700">{d.note}</p>}
      </div>
      {d.open && (
        <button
          onClick={() => onOpen?.(d.open)}
          className="self-start shrink-0 text-sm text-church-gold hover:underline whitespace-nowrap"
        >
          {d.action} →
        </button>
      )}
    </li>
  );
}

function Week({ title, days, today, onOpen }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">{title}</h2>
      {days.length === 0 ? (
        <div className="card py-6 text-center text-sm text-gray-500">Nothing on your list.</div>
      ) : days.map(([date, items]) => (
        <div key={date} className="card">
          <h3 className="font-semibold text-church-navy mb-3">{dayHeading(date, today)}</h3>
          <ul className="divide-y divide-gray-100">
            {items.map(item => <Item key={`${item.kind}-${item.id}`} item={item} onOpen={onOpen} />)}
          </ul>
        </div>
      ))}
    </section>
  );
}

export default function MyWeekView({ onOpen }) {
  const [week, setWeek] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/my-week', { credentials: 'include' })
      .then(r => r.json())
      .then(j => (j.success
        ? setWeek({ ...j, items: j.items || [], nextUp: j.nextUp || [] })
        : setError(j.error || 'Could not load your week')))
      .catch(() => setError('Could not load your week'));
  }, []);

  if (error) return <div className="card text-sm text-red-700">{error}</div>;
  if (!week) {
    return (
      <div className="py-16 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-church-gold mx-auto" />
      </div>
    );
  }

  const byDay = new Map();
  for (const item of week.items) {
    if (!byDay.has(item.date)) byDay.set(item.date, []);
    byDay.get(item.date).push(item);
  }
  const days = [...byDay.entries()];
  const split = addDays(week.from, 7);
  const thisWeek = days.filter(([d]) => d < split);
  const nextWeek = days.filter(([d]) => d >= split);
  const waiting = week.items.filter(i => i.rsvp === 'unanswered').length;
  const firstName = String(week.name || '').split(/\s+/)[0];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-church-navy">{firstName ? `${firstName}'s week` : 'My week'}</h1>
        <p className="text-sm text-gray-600 mt-1">
          {week.items.length === 0
            ? 'Nothing on your list for the next two weeks.'
            : `${week.items.length} thing${week.items.length === 1 ? '' : 's'} over the next two weeks`}
          {waiting > 0 && <span className="text-red-700 font-medium"> · {waiting} waiting on your answer</span>}
        </p>
      </header>

      {!week.linked && (
        <div className="card border-amber-200 bg-amber-50 text-sm text-amber-900">
          Your sign-in is not linked to your entry in the church directory yet, so your serving jobs, groups and
          rotations cannot be shown here. Ask an admin to link it on Members &amp; Access.
        </div>
      )}

      {week.nextUp.length > 0 && (
        <div className="card border-amber-200 bg-amber-50">
          <p className="text-sm text-amber-900">
            You are next up for{' '}
            {week.nextUp.map((r, i) => (
              <span key={r.rotationId}>
                {i > 0 && (i === week.nextUp.length - 1 ? ' and ' : ', ')}
                <button onClick={() => onOpen?.({ page: 'rotations', rotation: r.rotationId })} className="font-semibold underline">
                  {r.title}
                </button>
              </span>
            ))}
            . The coordinator will be in touch about a date.
          </p>
        </div>
      )}

      <Week title="This week" days={thisWeek} today={week.from} onOpen={onOpen} />
      <Week title="Next week" days={nextWeek} today={week.from} onOpen={onOpen} />

      <p className="text-xs text-gray-500">
        Something missing? Serving jobs are matched by the name on the Service Roster, so a job written under a
        different spelling of your name will not show here.
      </p>
    </div>
  );
}
