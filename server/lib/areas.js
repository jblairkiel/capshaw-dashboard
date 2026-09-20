// ─── Areas of responsibility ──────────────────────────────────────────────────
//
// The portal used to have one ladder of roles: every rung could do everything
// the rung below it could. That made the only way to let somebody keep the song
// list up to date "make them an admin", which handed them the whole
// congregation's records at the same time.
//
// Instead, each part of the site is its own area. Holding an area means you get
// the Add/Create button on that page, and may edit and delete what is there —
// and nothing else changes. Admins hold every area implicitly; nobody else
// holds one until an admin grants it.
const db = require('../db');

const AREAS = [
  {
    id:    'worship-order',
    label: 'Worship Order',
    page:  'This Sunday',
    description: 'Upload, replace and remove the order of service for this Sunday.',
  },
  {
    id:    'songs',
    label: 'Song Tracker',
    page:  'Songs We Sing',
    description: 'Add songs, record what was sung, and keep the song of the week.',
  },
  {
    id:    'announcements',
    label: 'Announcements & Events',
    page:  'Announcements',
    description: 'Write, edit and retire announcements and events for the congregation.',
  },
  {
    id:    'serving-schedule',
    label: 'Serving Schedule',
    page:  'Serving Schedule',
    description: 'Build next month\'s worship jobs, fill or clear any slot, and decide which jobs each member may sign up for.',
  },
  {
    id:    'attendance',
    label: 'Attendance',
    page:  'Attendance',
    description: 'Record attendance counts and correct earlier ones.',
  },
  {
    id:    'visitors',
    label: 'Guest Tracker',
    page:  'Guests',
    description: 'Add guests, keep their details and comments, and record their visits.',
  },
  {
    id:    'leadership',
    label: 'Elders & Deacons',
    page:  'Elders & Deacons',
    description: 'Keep the elders and deacons, and what each of them looks after, up to date.',
  },
  {
    id:    'calendar',
    label: 'Church Calendar',
    page:  'Church Calendar',
    description: 'Add and edit dated events on the church calendar.',
  },
  {
    id:    'directory',
    label: 'Member Directory',
    page:  'Member Directory',
    description: 'Edit anybody\'s directory entry, and add people who are not in it yet.',
  },
  {
    id:    'church-groups',
    label: 'Church Groups',
    page:  'Church Groups',
    description: 'Create the congregation\'s small groups (or generate a whole set at once), retire them, and say who leads each one.',
  },
  {
    id:    'mail-groups',
    label: 'Email Groups',
    page:  'Email Groups',
    description: 'Decide who is in each distribution group, and send to them.',
  },
  {
    id:    'bulletin',
    label: 'Weekly Newsletter',
    page:  'Weekly Newsletter',
    description: 'Write each week\'s prayer lists and offering, and export the newsletter as Word or PDF.',
  },
];

const AREA_IDS = AREAS.map(a => a.id);
const AREA_SET = new Set(AREA_IDS);

function isArea(id) {
  return AREA_SET.has(id);
}

function areaLabel(id) {
  return AREAS.find(a => a.id === id)?.label ?? id;
}

// ─── Storage ──────────────────────────────────────────────────────────────────

// What one account holds. Admins are not listed in the table — their access
// comes from the role itself, so a demotion never leaves stray grants behind.
function areasFor(userId) {
  if (!userId) return [];
  try {
    return db.prepare('SELECT area FROM user_areas WHERE user_id = ? ORDER BY area').all(userId)
      .map(r => r.area)
      .filter(isArea);
  } catch (err) {
    // A grant we cannot read is no grant. Failing closed here means an
    // unreadable table refuses an edit rather than handing one out.
    console.error('[areas] could not read the areas for user', userId, '-', err.message);
    return [];
  }
}

// Replaces the whole set in one go: the admin screen sends what the account
// should hold, not a diff, so there is never a half-applied change.
const setAreas = db.transaction((userId, areas) => {
  db.prepare('DELETE FROM user_areas WHERE user_id = ?').run(userId);
  const ins = db.prepare('INSERT OR IGNORE INTO user_areas (user_id, area) VALUES (?, ?)');
  for (const area of areas) if (isArea(area)) ins.run(userId, area);
});

// Everything the account may do, admins included. Used wherever a list of
// areas is rendered rather than a single check.
function effectiveAreas(user) {
  if (!user) return [];
  if (user.role === 'admin') return [...AREA_IDS];
  if (user.role === 'pending') return [];
  return Array.isArray(user.areas) ? user.areas.filter(isArea) : areasFor(user.id);
}

// A pending account holds nothing, whatever the table says: approval is what
// turns a sign-in into a member, and a grant made before that waits for it.
function holdsArea(user, area) {
  if (!user || !isArea(area)) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'pending') return false;
  return effectiveAreas(user).includes(area);
}

module.exports = { AREAS, AREA_IDS, isArea, areaLabel, areasFor, setAreas, effectiveAreas, holdsArea };
