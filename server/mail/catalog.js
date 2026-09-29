// Every kind of email the site sends, in one list: what it is, who gets it,
// what sends it, and what it says (from the same compose functions the real
// sender uses, filled with sample details). The Emails page is built from
// this, and server/tests/emailCatalog.test.js fails if a sender writes an
// outbox `context` that no entry here claims — so a new email cannot arrive
// without somebody deciding where it belongs.
//
// Each message in the outbox is tied back to its entry by its `context`,
// which every sender already writes (e.g. 'group-event:12:cancelled').

const notify = require('./notify');
const accounts = require('./accounts');
const newsletter = require('./newsletter');

const CATEGORIES = [
  { id: 'notifications', label: 'Notifications', description: 'Messages to one person about their own account or something waiting on them.' },
  { id: 'bulletin',      label: 'Bulletin',      description: 'The weekly newsletter, sent to a mailing list.' },
  { id: 'groups',        label: 'Groups',        description: 'Church group meetings: posted, called off, or changed.' },
  { id: 'reports',       label: 'Reports',       description: 'Schedules and summaries sent out on a regular rhythm.' },
];

// Made-up details for previews. Nothing here is anybody real.
const SAMPLE = {
  user: { id: 7, name: 'Sample Member', email: 'sample.member@example.invalid' },
  instance: { id: 42, title: 'Follow up with Sample Guest', created_by: 7 },
  followUp: {
    title: 'Guest Follow-Up',
    steps: { reach: { title: 'Reach out', instruction: 'Get in touch, then say how you reached them.' } },
    outcomes: { reached: { label: 'Reached' } },
  },
  draft: {
    month: 'November 2026',
    rows: [
      { date: 'November 1', service: 'Sunday Worship', job: 'Song Leader', name: 'Sample Member' },
      { date: 'November 1', service: 'Sunday Worship', job: 'Opening Prayer', name: 'Another Member' },
      { date: 'November 4', service: 'Wednesday', job: 'Song Leader', name: '' },
    ],
    unfilled: [{ date: 'November 4', job: 'Song Leader' }],
  },
  group: { id: 3, key: 'sample-group', name: 'Sample Group' },
  event: {
    id: 12, title: 'Fellowship meal', date: '2026-10-02', time: '18:30', location: 'The fellowship hall',
    hostName: 'Sample Member', description: 'Bring a dish to share.', rsvpEnabled: true, signupEnabled: true, signupTitle: 'What to bring',
  },
  bulletin: {
    sunday: '2026-10-04', masthead: 'Capshaw Church of Christ', sundayLabel: 'Sunday, October 4, 2026',
    reminders: ['Fellowship meal Sunday evening after services', 'Ladies Bible class meets Tuesday at 10:00'],
  },
};

const EMAILS = [
  // ── Notifications ──────────────────────────────────────────────────────────
  {
    id: 'account-confirm', category: 'notifications',
    name: 'Confirm your email address',
    audience: 'The person registering',
    trigger: 'Somebody signs up with an email address and password.',
    like: ['account:verify'],
    preview: () => accounts.compose.confirmAddress({ name: SAMPLE.user.name, token: 'sample-token' }),
  },
  {
    id: 'account-duplicate', category: 'notifications',
    name: 'You already have an account',
    audience: 'The owner of an address that is already registered',
    trigger: 'Somebody tries to register with an address that already has an account.',
    like: ['account:duplicate'],
    preview: () => accounts.compose.addressAlreadyRegistered({ name: SAMPLE.user.name, provider: 'local' }),
  },
  {
    id: 'account-awaiting', category: 'notifications',
    name: 'Waiting for approval',
    audience: 'Every admin with an address on file',
    trigger: 'A new account confirms its email address.',
    like: ['account:%:awaiting-approval'],
    preview: () => accounts.compose.awaitingApproval({ user: SAMPLE.user }),
  },
  {
    id: 'account-approved', category: 'notifications',
    name: 'Your account is ready',
    audience: 'The person whose account was approved',
    trigger: 'An admin approves a waiting account.',
    like: ['account:%:approved'],
    preview: () => accounts.compose.approved({ user: SAMPLE.user, personName: SAMPLE.user.name }),
  },
  {
    id: 'workflow-task', category: 'notifications',
    name: 'Action needed',
    audience: 'Whoever the step is assigned to, or everyone who looks after that area',
    trigger: 'A workflow reaches a step that needs somebody — a guest follow-up, say.',
    like: ['workflow:%:task:%'],
    preview: () => notify.compose.taskAssigned({ instance: SAMPLE.instance, definition: SAMPLE.followUp, task: { id: 1, step_id: 'reach' } }),
  },
  {
    id: 'workflow-done', category: 'notifications',
    name: 'Workflow finished',
    audience: 'Whoever started it, plus any mailing list the workflow names',
    trigger: 'A workflow reaches its outcome.',
    like: ['workflow:%:completed'],
    preview: () => notify.compose.workflowCompleted({ instance: SAMPLE.instance, definition: SAMPLE.followUp, outcomeId: 'reached', actorName: SAMPLE.user.name }),
  },

  // ── Bulletin ───────────────────────────────────────────────────────────────
  {
    id: 'newsletter', category: 'bulletin',
    name: 'Weekly newsletter',
    audience: 'The mailing list it is sent to',
    trigger: 'Somebody presses Email newsletter on the Weekly Bulletin page. The PDF is attached.',
    like: ['bulletin:%'],
    preview: () => newsletter.compose.newsletter({ bulletin: SAMPLE.bulletin, listName: 'Announcements' }),
  },

  // ── Groups ─────────────────────────────────────────────────────────────────
  {
    id: 'group-posted', category: 'groups',
    name: 'Meeting posted',
    audience: "The group's mailing list",
    trigger: 'A group leader posts a meeting.',
    like: ['group-event:%:published'],
    preview: () => notify.compose.groupEventPublished({ group: SAMPLE.group, event: SAMPLE.event }),
  },
  {
    id: 'group-cancelled', category: 'groups',
    name: 'Meeting cancelled',
    audience: "The group's mailing list",
    trigger: 'A group leader calls a meeting off.',
    like: ['group-event:%:cancelled'],
    preview: () => notify.compose.groupEventCancelled({ group: SAMPLE.group, event: SAMPLE.event }),
  },
  {
    id: 'group-changed', category: 'groups',
    name: 'Meeting changed',
    audience: 'Only the people who said they are coming',
    trigger: "A group leader changes a posted meeting's time or place.",
    like: ['group-event:%:changed'],
    preview: () => notify.compose.groupEventChanged({ group: SAMPLE.group, event: SAMPLE.event, what: 'Now starts at 6:30.' }),
  },

  // ── Reports ────────────────────────────────────────────────────────────────
  {
    id: 'serving-assignments', category: 'reports',
    name: 'Your serving jobs for the month',
    audience: 'Each person with a turn that month',
    trigger: 'The Monthly Worship Schedule is published.',
    like: ['workflow:%:schedule'],
    preview: () => notify.compose.servingAssignments({ draft: SAMPLE.draft, mine: SAMPLE.draft.rows.slice(0, 1) }),
  },
  {
    id: 'monthly-schedule', category: 'reports',
    name: 'Monthly worship schedule',
    audience: 'Everyone who has not turned off "Monthly schedule summary"',
    trigger: 'The Monthly Worship Schedule is published.',
    like: ['workflow:%:monthly-report'],
    preview: () => notify.compose.monthlyReport({ draft: SAMPLE.draft }),
  },
];

// SQL LIKE → a regular expression, for matching a context in code.
const toRegex = like => new RegExp(`^${like.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.')}$`);
for (const email of EMAILS) email.matchers = email.like.map(toRegex);

function emailFor(context) {
  return EMAILS.find(e => e.matchers.some(m => m.test(context || ''))) || null;
}

module.exports = { CATEGORIES, EMAILS, emailFor };
