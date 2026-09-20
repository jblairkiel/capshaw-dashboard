// Client-side mirror of server/lib/churchGroups.js. The server is always the
// authority — these helpers only decide what to show.
//
// Two separate questions again, and they are not the same one:
//
//   the 'church-groups' area — you look after every group: you make them,
//                              generate a set of them, and appoint leaders
//   a part in one group      — leader, co-leader, host or member, which says
//                              nothing whatever about any other group

export const GROUP_ROLES = [
  {
    id: 'leader',
    label: 'Leader',
    description: 'Posts the group\'s meetings, keeps the roll, and hears every reply.',
    leads: true,
    tone: 'bg-church-gold/20 text-church-navy',
  },
  {
    id: 'co-leader',
    label: 'Co-leader',
    description: 'Everything the leader can do — for when two families share the group.',
    leads: true,
    tone: 'bg-amber-100 text-amber-800',
  },
  {
    id: 'host',
    label: 'Host',
    description: 'Named on the group\'s meetings as where it gathers.',
    leads: false,
    tone: 'bg-emerald-100 text-emerald-800',
  },
  {
    id: 'member',
    label: 'Member',
    description: 'Sees the meetings, answers the invitation, signs up and replies.',
    leads: false,
    tone: 'bg-gray-100 text-gray-600',
  },
];

export function groupRoleInfo(role) {
  return GROUP_ROLES.find(r => r.id === role)
    ?? { id: role, label: role || 'Member', description: '', leads: false, tone: 'bg-gray-100 text-gray-600' };
}

export function leadsGroup(role) {
  return !!groupRoleInfo(role).leads;
}

export const RESPONSES = [
  { id: 'yes',   label: 'Coming',     tone: 'bg-emerald-600 text-white', quiet: 'text-emerald-700' },
  { id: 'maybe', label: 'Maybe',      tone: 'bg-amber-500 text-white',   quiet: 'text-amber-700' },
  { id: 'no',    label: 'Can\'t make it', tone: 'bg-gray-500 text-white', quiet: 'text-gray-500' },
];

export function responseInfo(id) {
  return RESPONSES.find(r => r.id === id) ?? RESPONSES[0];
}

// Dates are stored as plain YYYY-MM-DD. Reading one with `new Date(str)` would
// treat it as UTC and shift the day backwards for anyone west of Greenwich, so
// midday is added before it is parsed — the same care CalendarView takes.
export function formatEventDate(value, options = { weekday: 'long', month: 'long', day: 'numeric' }) {
  if (!value) return '';
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, options);
}

// "3 days ago", for a comment or a notification. Anything older than a week
// reads better as a date.
export function timeAgo(value) {
  if (!value) return '';
  // SQLite writes 'YYYY-MM-DD HH:MM:SS' in UTC, which needs saying explicitly
  // or the browser reads it as local time and calls a fresh comment six hours old.
  const stamp = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(value) ? `${value.replace(' ', 'T')}Z` : value;
  const then = new Date(stamp);
  if (Number.isNaN(then.getTime())) return '';

  const seconds = Math.max(0, Math.round((Date.now() - then.getTime()) / 1000));
  if (seconds < 60)     return 'just now';
  if (seconds < 3600)   return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400)  return `${Math.floor(seconds / 3600)} hr ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// One place for the fetch boilerplate every group screen would otherwise
// repeat, including turning `{ success: false }` into something to catch.
export async function call(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'include',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  });
  const json = await res.json().catch(() => ({}));
  if (!json.success) throw new Error(json.error || 'Something went wrong');
  return json;
}
