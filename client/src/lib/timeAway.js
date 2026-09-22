// How a blocked-out range reads in a sentence.
//
// Kept beside the other client-side mirrors of what the server knows: the
// server describes ranges the same way in the action history and in the answer
// it refuses a sign-up with, so the two never read differently.

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// "June 7, 2026", or "June 7 – June 21, 2026". Split by hand rather than handed
// to Date, which would read a bare YYYY-MM-DD as UTC and show the day before it
// to anybody west of Greenwich.
export function describeRange({ startsOn, endsOn } = {}) {
  const say = iso => {
    const [year, month, day] = String(iso || '').split('-').map(Number);
    if (!year || !month || !day || month < 1 || month > 12) return null;
    return { text: `${MONTH_NAMES[month - 1]} ${day}`, year };
  };

  const from = say(startsOn);
  const to   = say(endsOn) ?? from;
  if (!from || !to) return '';

  if (startsOn === endsOn)   return `${from.text}, ${from.year}`;
  if (from.year === to.year) return `${from.text} – ${to.text}, ${to.year}`;
  return `${from.text}, ${from.year} – ${to.text}, ${to.year}`;
}

// "June 2026" → { year: 2026, month: 5 } (month is 0-indexed, for the
// calendar view to open on the same month the roster is showing). Anything
// it cannot read is left for the caller's own default.
export function parseMonthLabel(label) {
  const match = /^([A-Za-z]+)\s+(\d{4})$/.exec(String(label || '').trim());
  if (!match) return null;
  const month = MONTH_NAMES.findIndex(m => m.toLowerCase() === match[1].toLowerCase());
  if (month < 0) return null;
  return { year: Number(match[2]), month };
}
