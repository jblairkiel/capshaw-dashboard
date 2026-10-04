// Dates as the forms handle them. Every date box on the site is the same
// picker (components/DateInput.jsx), which always speaks ISO — "2026-06-07".
// What a record saves stays what it has always saved, though: guest visits are
// MM/DD/YY because the pages that sort them read that, and serving slots keep
// "June 2026" and "June 7". These convert between the two, so a picker can sit
// on any of them without the stored data changing shape.

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const pad = n => String(n).padStart(2, '0');

function monthIndex(word) {
  const w = String(word || '').toLowerCase().replace(/\.$/, '');
  if (w.length < 3) return -1;
  return MONTH_NAMES.findIndex(m => m.toLowerCase().startsWith(w));
}

function iso(year, month, day) {
  const y = year < 100 ? 2000 + year : year;
  if (!(month >= 0 && month <= 11) || !(day >= 1 && day <= 31)) return '';
  const d = new Date(Date.UTC(y, month, day));
  if (d.getUTCMonth() !== month) return '';
  return `${y}-${pad(month + 1)}-${pad(day)}`;
}

// Whatever a record holds — "2026-06-07", "6/7/26", "06/07/2026",
// "Jun 7, 2026", "7 June 2026" — as ISO, or '' when it is not a full date.
export function toIso(value) {
  const s = String(value ?? '').trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return iso(+m[1], +m[2] - 1, +m[3]);
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})$/))) return iso(+m[3], +m[1] - 1, +m[2]);
  if ((m = s.match(/^([A-Za-z]{3,9}\.?)\s+(\d{1,2}),?\s+(\d{4})$/))) return iso(+m[3], monthIndex(m[1]), +m[2]);
  if ((m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9}\.?),?\s+(\d{4})$/))) return iso(+m[3], monthIndex(m[2]), +m[1]);
  return '';
}

// ISO back into the shape a record keeps.
//   'iso' — 2026-06-07
//   'mdy' — 06/07/26, the guest tracker's and the old site's own shape
export function fromIso(value, format = 'iso') {
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  if (format === 'mdy') return `${m[2]}/${m[3]}/${m[1].slice(2)}`;
  return value;
}

// ─── Months, and the serving schedule's "June 2026" + "June 7" ───────────────

// "June 2026" from ISO.
export function monthLabelOf(isoDate) {
  const m = String(isoDate || '').match(/^(\d{4})-(\d{2})-\d{2}$/);
  return m ? `${MONTH_NAMES[+m[2] - 1]} ${m[1]}` : '';
}

// "June 7" from ISO.
export function monthDayOf(isoDate) {
  const m = String(isoDate || '').match(/^\d{4}-(\d{2})-(\d{2})$/);
  return m ? `${MONTH_NAMES[+m[1] - 1]} ${+m[2]}` : '';
}

// { year, month } from "June 2026", or null.
export function parseMonth(label) {
  const m = String(label || '').trim().match(/^([A-Za-z]+\.?)\s+(\d{4})$/);
  if (!m) return null;
  const month = monthIndex(m[1]);
  return month < 0 ? null : { year: +m[2], month };
}

// ISO from a month label and a day label ("June 2026", "June 7" or "Jun 7"),
// or '' when the two do not make a date.
export function isoFromMonthDay(monthLabel, dayLabel) {
  const month = parseMonth(monthLabel);
  const m = String(dayLabel || '').trim().match(/^([A-Za-z]+\.?)\s+(\d{1,2})$/);
  if (!month || !m) return '';
  const index = monthIndex(m[1]);
  if (index < 0) return '';
  // A slot near the turn of the year can sit in the next month's roster.
  const year = index < month.month - 6 ? month.year + 1 : index > month.month + 6 ? month.year - 1 : month.year;
  return iso(year, index, +m[2]);
}
