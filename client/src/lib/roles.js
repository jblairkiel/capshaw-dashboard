// Client-side mirror of server/middleware/auth.js and server/lib/areas.js. The
// server is always the authority — these helpers only decide what to show.
//
// Two separate questions, deliberately kept apart:
//
//   role  — what this account is: waiting, a member, or an admin. A ladder.
//   areas — what it looks after: one part of the site each, and not a ladder.
//           Holding "Songs" gets you the Add buttons on Songs We Sing and
//           changes nothing anywhere else. Admins hold every area.

export const ROLE_RANK = {
  pending:  0,
  approved: 1,
  admin:    2,
};

export const ROLES = [
  {
    id:          'pending',
    label:       'Pending',
    badge:       'Awaiting confirmation',
    description: 'Can look around the whole portal, but cannot create or edit anything yet.',
    tone:        'bg-orange-100 text-orange-700',
  },
  {
    id:          'approved',
    label:       'Member',
    badge:       'Member',
    description: 'Bible class and lesson tools, refreshing the site, their own household\'s details and worship preferences, and signing up for serving jobs. Anything more is granted one area at a time.',
    tone:        'bg-green-100 text-green-700',
  },
  {
    id:          'admin',
    label:       'Admin',
    badge:       'Admin',
    description: 'Everything: every area below, managing who may sign in, the action history, and editing every database table directly.',
    tone:        'bg-church-gold/20 text-church-navy',
  },
];

// The areas an admin can hand out, one at a time. Kept in step with
// server/lib/areas.js — the server refuses anything it does not recognise.
export const AREAS = [
  {
    id:          'worship-order',
    label:       'Worship Order',
    page:        'This Sunday',
    description: 'Upload, replace and remove the order of service for this Sunday.',
    tone:        'bg-indigo-100 text-indigo-800',
  },
  {
    id:          'songs',
    label:       'Song Tracker',
    page:        'Songs We Sing',
    description: 'Add songs, record what was sung, and keep the song of the week.',
    tone:        'bg-sky-100 text-sky-800',
  },
  {
    id:          'announcements',
    label:       'Announcements & Events',
    page:        'Announcements',
    description: 'Write, edit and retire announcements and events for the congregation.',
    tone:        'bg-amber-100 text-amber-800',
  },
  {
    id:          'serving-schedule',
    label:       'Serving Schedule',
    page:        'Serving Schedule',
    description: 'Build next month\'s worship jobs, fill or clear any slot, and decide which jobs each member may sign up for.',
    tone:        'bg-violet-100 text-violet-800',
  },
  {
    id:          'attendance',
    label:       'Attendance',
    page:        'Attendance',
    description: 'Record attendance counts and correct earlier ones.',
    tone:        'bg-teal-100 text-teal-800',
  },
  {
    id:          'visitors',
    label:       'Guest Tracker',
    page:        'Guests',
    description: 'Add guests, keep their details and comments, and record their visits.',
    tone:        'bg-rose-100 text-rose-800',
  },
  {
    id:          'leadership',
    label:       'Elders & Deacons',
    page:        'Elders & Deacons',
    description: 'Keep the elders and deacons, and what each of them looks after, up to date.',
    tone:        'bg-blue-100 text-blue-800',
  },
  {
    id:          'calendar',
    label:       'Church Calendar',
    page:        'Church Calendar',
    description: 'Add and edit dated events on the church calendar.',
    tone:        'bg-lime-100 text-lime-800',
  },
  {
    id:          'directory',
    label:       'Member Directory',
    page:        'Member Directory',
    description: 'Edit anybody\'s directory entry, and add people who are not in it yet.',
    tone:        'bg-cyan-100 text-cyan-800',
  },
  {
    id:          'mail-groups',
    label:       'Email Groups',
    page:        'Email Groups',
    description: 'Decide who is in each distribution group, and send to them.',
    tone:        'bg-fuchsia-100 text-fuchsia-800',
  },
];

export const AREA_IDS = AREAS.map(a => a.id);

export function areaInfo(id) {
  return AREAS.find(a => a.id === id) ?? { id, label: id, description: '', tone: 'bg-gray-100 text-gray-700' };
}

export function roleInfo(role) {
  return ROLES.find(r => r.id === role) ?? ROLES[0];
}

export function hasRole(user, minRole) {
  return (ROLE_RANK[user?.role] ?? -1) >= ROLE_RANK[minRole];
}

/** Member functions: creating and editing content in the portal. */
export function hasWriteAccess(user) {
  return hasRole(user, 'approved');
}

/** Admin privileges: user roles, the action history, and direct database editing. */
export function isAdmin(user) {
  return hasRole(user, 'admin');
}

/**
 * Does this person look after one particular part of the site?
 *
 * Admins do, always. A pending account never does, whatever it was granted —
 * an area means nothing until the account can sign in properly.
 */
export function hasArea(user, area) {
  if (!user) return false;
  if (isAdmin(user)) return true;
  if (user.role === 'pending') return false;
  return Array.isArray(user.areas) && user.areas.includes(area);
}

/** For a page two areas can write, like the calendar and the announcement board. */
export function hasAnyArea(user, areas = []) {
  return areas.some(area => hasArea(user, area));
}

/** Everything this account looks after, for badges and summaries. */
export function areasOf(user) {
  if (!user) return [];
  if (isAdmin(user)) return [...AREA_IDS];
  if (user.role === 'pending') return [];
  return Array.isArray(user.areas) ? user.areas.filter(a => AREA_IDS.includes(a)) : [];
}
