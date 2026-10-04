import { toIso, fromIso, MONTH_NAMES, parseMonth } from '../lib/dates';

// The one date box the site uses. It is the browser's own picker — a calendar
// on a computer, the date wheel on a phone — so every date is chosen the same
// way and reads the same way, rather than each form asking for its own typed
// format.
//
// `value` may be any date a record holds ("2026-06-07", "06/07/26",
// "Jun 7, 2026"); `onChange` hands back the picked date in `format`
// (lib/dates.js), so a form keeps saving what it always saved. A value the
// picker cannot read is shown beneath it, so an old entry is never silently
// blanked — picking a date replaces it.

export const FIELD_CLASS = 'mt-1 block w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-church-gold';

export default function DateInput({ value, onChange, format = 'iso', className = FIELD_CLASS, ...props }) {
  const raw = String(value ?? '').trim();
  const picked = toIso(raw);
  return (
    <>
      <input
        type="date"
        value={picked}
        onChange={e => onChange(e.target.value ? fromIso(e.target.value, format) : '')}
        className={className}
        {...props}
      />
      {raw && !picked && (
        <span className="block text-xs text-amber-700 mt-1">Saved as &ldquo;{raw}&rdquo; — pick a date to replace it.</span>
      )}
    </>
  );
}

// A month and a year, as "June 2026" — for what belongs to a whole month (a
// serving roster). Two lists rather than the browser's month box, which half
// the browsers in use do not have.
export function MonthInput({ value, onChange, label = 'Month', className = '', required, disabled }) {
  const now = new Date().getFullYear();
  const current = parseMonth(value);
  const years = [];
  for (let y = now - 5; y <= now + 2; y++) years.push(y);
  if (current && !years.includes(current.year)) {
    years.push(current.year);
    years.sort((a, b) => a - b);
  }

  const set = (month, year) => onChange(month >= 0 && year ? `${MONTH_NAMES[month]} ${year}` : '');
  const select = 'border border-gray-200 rounded-lg px-2 py-2 text-sm bg-white focus:outline-none focus:border-church-gold';

  return (
    <span className={`mt-1 flex gap-2 ${className}`}>
      <select aria-label={`${label}: month`} value={current ? current.month : ''} required={required} disabled={disabled}
        onChange={e => set(Number(e.target.value), current?.year || now)} className={`${select} flex-1 min-w-0`}>
        <option value="" disabled>Month</option>
        {MONTH_NAMES.map((m, i) => <option key={m} value={i}>{m}</option>)}
      </select>
      <select aria-label={`${label}: year`} value={current ? current.year : ''} required={required} disabled={disabled}
        onChange={e => set(current ? current.month : new Date().getMonth(), Number(e.target.value))} className={select}>
        <option value="" disabled>Year</option>
        {years.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
      {value && !current && (
        <span className="self-center text-xs text-amber-700">Saved as &ldquo;{value}&rdquo;</span>
      )}
    </span>
  );
}
