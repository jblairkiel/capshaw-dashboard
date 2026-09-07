// Shared vocabulary for the notification screens. The catalogue itself — which
// types exist, what they are called, which category they sit in — comes from
// the server, so nothing here hard-codes a type id.

// SQLite stores timestamps as "YYYY-MM-DD HH:MM:SS" in UTC.
export function parseTimestamp(value) {
  if (!value) return null;
  const date = new Date(`${String(value).replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

const UNITS = [
  ['year',   365 * 24 * 60 * 60 * 1000],
  ['month',   30 * 24 * 60 * 60 * 1000],
  ['week',     7 * 24 * 60 * 60 * 1000],
  ['day',          24 * 60 * 60 * 1000],
  ['hour',              60 * 60 * 1000],
  ['minute',                 60 * 1000],
];

export function timeAgo(value, now = Date.now()) {
  const date = parseTimestamp(value);
  if (!date) return '';

  const elapsed = now - date.getTime();
  if (elapsed < 60 * 1000) return 'just now';

  for (const [unit, ms] of UNITS) {
    if (elapsed >= ms) {
      const count = Math.floor(elapsed / ms);
      return `${count} ${unit}${count === 1 ? '' : 's'} ago`;
    }
  }
  return 'just now';
}

export function fullTimestamp(value) {
  const date = parseTimestamp(value);
  return date ? date.toLocaleString() : '';
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function hourLabel(hour) {
  const suffix = hour < 12 ? 'am' : 'pm';
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:00 ${suffix}`;
}

// Everything the site can talk to, in one place, so a fetch failure reads the
// same wherever it happens.
export async function call(url, options = {}) {
  const res  = await fetch(url, { credentials: 'include', ...options });
  const json = await res.json().catch(() => ({}));
  if (!json.success) throw new Error(json.error || 'Something went wrong');
  return json;
}

export function jsonBody(body) {
  return { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
