// ─── The catalogue of things the site can tell you about ──────────────────────
//
// Every notification the dashboard raises has a `type`. A type belongs to a
// `category`, which is the drawer of the inbox it lands in and the heading it
// sits under on the email-preferences screen. Nothing anywhere else invents a
// type string: routes and workflows emit one of these ids, so the inbox, the
// unread counts, and a person's email settings all line up by construction.
//
// Each type carries its own default, because the right default differs by
// kind: a reply to your comment is worth an email straight away, a new event
// on the calendar is worth one at the end of the day, and an edit to an
// announcement's wording is not worth one at all.

// How an email may be delivered for a type.
const EMAIL_MODES = [
  { id: 'immediate', label: 'Email me right away' },
  { id: 'digest',    label: 'Save it for my digest' },
  { id: 'off',       label: 'No email' },
];

const CATEGORIES = [
  {
    id: 'announcements',
    label: 'Announcements',
    description: 'Notices posted for the congregation.',
    icon: '📢',
  },
  {
    id: 'events',
    label: 'Calendar events',
    description: 'Events added to the church calendar, and changes to them.',
    icon: '📅',
  },
  {
    id: 'comments',
    label: 'Comments',
    description: 'Conversation on announcements and events.',
    icon: '💬',
  },
  {
    id: 'workflows',
    label: 'Workflows',
    description: 'Jobs waiting on you, and workflows you took part in finishing.',
    icon: '📋',
  },
  {
    id: 'worship',
    label: 'Worship schedule',
    description: 'The monthly roster, and the turns you are given on it.',
    icon: '🎵',
  },
  {
    id: 'admin',
    label: 'Site administration',
    description: 'Housekeeping only admins are asked about.',
    icon: '🛠️',
  },
];

// audience — who a type can reach, used to resolve recipients when the caller
//            does not name them and to explain the type on the settings screen:
//   everyone — every account, pending ones included (they can read the site)
//   members  — approved members and above
//   admins   — admins only
//   targeted — whoever the event itself concerns; the caller names them
const TYPES = [
  {
    id: 'announcement.posted',
    category: 'announcements',
    label: 'A new announcement is posted',
    audience: 'everyone',
    defaultEmail: 'digest',
  },
  {
    id: 'announcement.urgent',
    category: 'announcements',
    label: 'An announcement is marked urgent',
    description: 'Kept separate so an urgent notice can reach you even if the rest wait for a digest.',
    audience: 'everyone',
    defaultEmail: 'immediate',
  },
  {
    id: 'announcement.updated',
    category: 'announcements',
    label: 'An announcement is edited',
    audience: 'everyone',
    defaultEmail: 'off',
  },
  {
    id: 'event.posted',
    category: 'events',
    label: 'An event is added to the calendar',
    audience: 'everyone',
    defaultEmail: 'digest',
  },
  {
    id: 'event.updated',
    category: 'events',
    label: 'An event’s date, time or place changes',
    audience: 'everyone',
    defaultEmail: 'immediate',
  },
  {
    id: 'event.cancelled',
    category: 'events',
    label: 'An event is cancelled or taken down',
    audience: 'everyone',
    defaultEmail: 'immediate',
  },
  {
    id: 'comment.posted',
    category: 'comments',
    label: 'Somebody comments on a thread I am following',
    description: 'You follow a thread by commenting on it. Any thread can be muted on its own.',
    audience: 'targeted',
    defaultEmail: 'digest',
  },
  {
    id: 'comment.reply',
    category: 'comments',
    label: 'Somebody replies to my comment',
    audience: 'targeted',
    defaultEmail: 'immediate',
  },
  {
    id: 'comment.mention',
    category: 'comments',
    label: 'Somebody mentions me by name',
    description: 'Writing @Ray Harris in a comment tells Ray about it.',
    audience: 'targeted',
    defaultEmail: 'immediate',
  },
  {
    id: 'workflow.task',
    category: 'workflows',
    label: 'A workflow is waiting on me',
    audience: 'targeted',
    defaultEmail: 'immediate',
  },
  {
    id: 'workflow.completed',
    category: 'workflows',
    label: 'A workflow I am part of finishes',
    audience: 'targeted',
    defaultEmail: 'immediate',
  },
  {
    id: 'worship.assignments',
    category: 'worship',
    label: 'I am given a turn on the worship schedule',
    audience: 'targeted',
    defaultEmail: 'immediate',
  },
  {
    id: 'worship.monthly_report',
    category: 'worship',
    label: 'Monthly schedule summary',
    description: 'The whole month’s assignments, sent when a new schedule is published.',
    audience: 'everyone',
    defaultEmail: 'immediate',
  },
  {
    id: 'admin.user_pending',
    category: 'admin',
    label: 'Somebody new signs in and needs approving',
    audience: 'admins',
    minRole: 'admin',
    defaultEmail: 'immediate',
  },
  {
    id: 'admin.mail_failed',
    category: 'admin',
    label: 'The site could not deliver an email',
    audience: 'admins',
    minRole: 'admin',
    defaultEmail: 'digest',
  },
];

const BY_ID = new Map(TYPES.map(t => [t.id, t]));

function getType(id) {
  return BY_ID.get(id) || null;
}

function isEmailMode(mode) {
  return EMAIL_MODES.some(m => m.id === mode);
}

function typesInCategory(categoryId) {
  return TYPES.filter(t => t.category === categoryId);
}

// The subject a notification points at decides which screen opens it, so the
// mapping lives here beside the types rather than being guessed at in the UI.
const SUBJECT_TABS = {
  announcement: 'announcements',
  event:        'calendar',
  workflow:     'workflows',
  user:         'users',
  schedule:     'assignments',
};

module.exports = { CATEGORIES, TYPES, EMAIL_MODES, SUBJECT_TABS, getType, isEmailMode, typesInCategory };
