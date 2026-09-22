import { useState, useMemo } from 'react';
import { describeRange } from '../lib/timeAway';

// ─── Who is away, laid out as a month ─────────────────────────────────────────
//
// The schedule keeper's view over everybody's time away at once: a grid like
// the church calendar, but built from job_blackouts rather than announcements,
// so a range that spans a fortnight shows on every day it covers rather than
// only the day it starts.
//
// Navigates on its own — the days somebody is away rarely line up with the
// month the roster happens to be showing — but opens on that month, since it
// is the most useful place to start looking.

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function toKey(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function monthLabel(year, month) {
  return new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function todayKey() {
  const now = new Date();
  return toKey(now.getFullYear(), now.getMonth(), now.getDate());
}

// Weeks of the month, padded with the blank leading/trailing days a grid needs.
function buildWeeks(year, month) {
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth  = new Date(year, month + 1, 0).getDate();

  const cells = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export default function BlackoutCalendar({ blackouts = [], initialMonth }) {
  // Lazy initial state, so a parent re-render (the schedule reloading, say)
  // never yanks the calendar back to wherever it started.
  const [year, setYear]   = useState(() => initialMonth?.year ?? new Date().getFullYear());
  const [month, setMonth] = useState(() => initialMonth?.month ?? new Date().getMonth());

  const weeks = useMemo(() => buildWeeks(year, month), [year, month]);
  const today = todayKey();

  function shift(by) {
    const next = new Date(year, month + by, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth());
  }

  function goToday() {
    const now = new Date();
    setYear(now.getFullYear());
    setMonth(now.getMonth());
  }

  // Who is away on each day of the visible month. Worked out once per month
  // shown, rather than filtering the whole list again for every cell — a
  // range covering three weeks would otherwise be scanned three weeks over.
  const awayByDay = useMemo(() => {
    const map = new Map();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      const key   = toKey(year, month, day);
      const away  = blackouts.filter(b => b.startsOn <= key && key <= b.endsOn);
      if (away.length) map.set(key, away);
    }
    return map;
  }, [blackouts, year, month]);

  const awayThisMonth = useMemo(
    () => new Set([...awayByDay.values()].flat().map(b => b.id)).size,
    [awayByDay],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h4 className="text-sm font-semibold text-church-navy">{monthLabel(year, month)}</h4>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => shift(-1)}
            aria-label="Previous month"
            className="px-2 py-1 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={goToday}
            className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => shift(1)}
            aria-label="Next month"
            className="px-2 py-1 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm"
          >
            ›
          </button>
        </div>
      </div>

      <p className="text-xs text-gray-500">
        {awayThisMonth === 0
          ? 'Nobody has blocked out a day this month.'
          : `${awayThisMonth} ${awayThisMonth === 1 ? 'person' : 'people'} away at some point this month.`}
      </p>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="grid grid-cols-7 border-b border-gray-100 bg-gray-50/60">
          {WEEKDAYS.map(d => (
            <div key={d} className="px-1.5 py-1.5 text-xs font-medium text-gray-500 text-center">{d}</div>
          ))}
        </div>

        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 border-b border-gray-100 last:border-b-0">
            {week.map((day, di) => {
              if (day === null) {
                return <div key={di} className="min-h-20 bg-gray-50/40 border-r border-gray-100 last:border-r-0" />;
              }

              const key     = toKey(year, month, day);
              const away    = awayByDay.get(key) || [];
              const isToday = key === today;
              const shown   = away.slice(0, 3);
              const hidden  = away.length - shown.length;

              return (
                <div
                  key={di}
                  className={`min-h-20 p-1 border-r border-gray-100 last:border-r-0 align-top ${isToday ? 'bg-church-gold/10' : ''}`}
                >
                  <span className={`text-xs ${isToday ? 'font-bold text-church-navy' : 'text-gray-400'}`}>{day}</span>
                  <div className="mt-0.5 space-y-0.5">
                    {shown.map(b => (
                      <span
                        key={b.id}
                        title={`${b.name} · ${describeRange(b)}${b.reason ? ` · ${b.reason}` : ''}`}
                        className="block text-[11px] leading-tight px-1 py-0.5 rounded bg-amber-100 text-amber-800 truncate"
                      >
                        {b.name}
                      </span>
                    ))}
                    {hidden > 0 && (
                      <span className="block text-[11px] text-gray-400">+{hidden} more</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
