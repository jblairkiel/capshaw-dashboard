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
const recordsReminder = require('./records');
const leaderReminders = require('./worshipReminders');
const communionPrep = require('./communionPrep');
const signupMail = require('./signups');
const rotationMail = require('./rotations');
const notices = require('./notices');

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
  plan: {
    id: 9, date: '2026-10-04', service: 'Sunday AM Worship', leader: 'Sample Member',
    submittedByName: 'Sample Member', notes: 'Ending with the song we sang at the gospel meeting.',
    items: [
      { partName: 'Song', song: { title: 'How Great Thou Art', hymnal: 'Songs of Faith and Praise', number: '12' }, person: '', detail: '' },
      { partName: 'Opening prayer', song: null, person: 'Another Member', detail: '' },
      { partName: 'Scripture reading', song: null, person: 'Another Member', detail: 'Psalm 23' },
      { partName: 'Sermon', song: null, person: 'Sample Preacher', detail: 'The Good Shepherd' },
      { partName: 'Invitation song', song: { title: 'Just As I Am', hymnal: 'Songs of Faith and Praise', number: '915' }, person: '', detail: '' },
    ],
  },
  records: {
    from: '2026-09-20', through: '2026-09-27', earlier: 2,
    items: [
      { check: 'songs', date: '2026-09-23', service: 'Wednesday Bible Study' },
      { check: 'guests', date: '2026-09-27', service: 'Sunday AM Worship' },
      { check: 'contribution', date: '2026-09-27', service: '' },
      { check: 'head-count', date: '2026-09-27', service: 'Sample Group: Fellowship meal' },
    ],
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
    id: 'account-add-email', category: 'notifications',
    name: 'Confirm an added email address',
    audience: 'Somebody whose Google or Facebook sign-in came without an email address',
    trigger: 'They add an address on the waiting page.',
    like: ['account:add-email'],
    preview: () => accounts.compose.confirmAddedAddress({ name: SAMPLE.user.name, token: 'sample-token', via: 'facebook' }),
  },
  {
    id: 'account-add-email-in-use', category: 'notifications',
    name: 'Address already has an account',
    audience: 'The owner of an address somebody tried to add to another account',
    trigger: 'Somebody adds an address on the waiting page that already belongs to an account.',
    like: ['account:add-email-in-use'],
    preview: () => accounts.compose.addressAlreadyInUse({ name: SAMPLE.user.name, provider: 'google', via: 'facebook' }),
  },
  {
    id: 'account-reset', category: 'notifications',
    name: 'Choose a new password',
    audience: 'The person who asked to reset their password',
    trigger: 'Somebody chooses "Forgot your password?" on the sign-in page for an account with a password.',
    like: ['account:reset'],
    preview: () => accounts.compose.resetPassword({ name: SAMPLE.user.name, token: 'sample-token' }),
  },
  {
    id: 'account-reset-no-password', category: 'notifications',
    name: 'No password to reset',
    audience: 'The owner of a Google or Facebook account who asked to reset a password',
    trigger: 'Somebody chooses "Forgot your password?" for an address that signs in with Google or Facebook.',
    like: ['account:reset-no-password'],
    preview: () => accounts.compose.noPasswordToReset({ name: SAMPLE.user.name, provider: 'google' }),
  },
  {
    id: 'account-awaiting', category: 'notifications',
    name: 'Waiting for approval',
    audience: 'Every admin with an address on file',
    trigger: 'A new account confirms its email address, or somebody new signs in with Google or Facebook.',
    like: ['account:%:awaiting-approval'],
    preview: () => accounts.compose.awaitingApproval({ user: SAMPLE.user }),
  },
  {
    id: 'account-link-awaiting', category: 'notifications',
    name: 'Confirm a second sign-in',
    audience: 'Every admin with an address on file',
    trigger: 'Somebody signs in with Google or Facebook for the first time, using an address an account already has.',
    like: ['account:%:link-awaiting-approval'],
    preview: () => accounts.compose.linkAwaitingApproval({ account: { ...SAMPLE.user, provider: 'local' }, provider: 'google', email: SAMPLE.user.email }),
  },
  {
    id: 'account-link-requested', category: 'notifications',
    name: 'Somebody signed in with your address',
    audience: 'The person whose account has that address',
    trigger: 'The same sign-in, at the same moment the admins are asked to confirm it.',
    like: ['account:%:link-requested'],
    preview: () => accounts.compose.linkRequested({ name: SAMPLE.user.name, provider: 'google' }),
  },
  {
    id: 'account-link-approved', category: 'notifications',
    name: 'You can now sign in another way',
    audience: 'The person whose account the sign-in was joined to',
    trigger: 'An admin approves joining a Google or Facebook sign-in to an existing account.',
    like: ['account:%:link-approved'],
    preview: () => accounts.compose.linkApproved({ name: SAMPLE.user.name, provider: 'google' }),
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

  {
    id: 'worship-plan-submitted', category: 'notifications',
    name: 'Service submitted',
    audience: 'Whoever looks after the worship order (the admins, if nobody does)',
    trigger: 'A song leader submits a service on the Upcoming Service page.',
    like: ['worship-plan:%:submitted'],
    preview: () => notify.compose.worshipPlanSubmitted({ plan: SAMPLE.plan }),
  },

  {
    id: 'song-leader-reminder', category: 'notifications',
    name: 'You are leading singing',
    audience: 'The song leader on the Serving Schedule for that service',
    trigger: 'Four days (96 hours) before each service, and a final reminder the day before (24 hours). It says whether the service has been submitted yet, and links straight to it.',
    like: ['worship-reminder:%'],
    preview: () => leaderReminders.compose.songLeaderReminder({
      kind: 'first', date: SAMPLE.plan.date, service: SAMPLE.plan.service, time: '09:50', leader: SAMPLE.user.name,
      plan: null, requests: [{ song: { title: 'Just As I Am' }, forDate: '' }],
    }),
  },

  {
    id: 'communion-prep-reminder', category: 'notifications',
    name: 'You are preparing communion',
    audience: 'Whoever is down on the communion preparation list for that month',
    trigger: 'A week before the month they signed up for — or as soon as they are put down, if that is less than a week before it begins.',
    like: ['communion-prep:%:reminder'],
    preview: () => communionPrep.compose.reminder({ name: SAMPLE.user.name, year: 2026, month: 11 }),
  },
  {
    id: 'rotation-next-up', category: 'notifications',
    name: 'You are next up on a rotation',
    audience: 'Whoever is now next up on a rotation (teaching a class, hosting a shower…)',
    trigger: 'The rotation moves on — somebody takes a turn or is sent to the back — or a coordinator chooses "Let them know".',
    like: ['rotation:%:next-up'],
    preview: () => rotationMail.compose.nextUp({
      name: SAMPLE.user.name,
      rotation: { id: 1, name: 'Ladies\' class teachers', description: 'Teaching the Wednesday evening ladies\' class for a quarter.' },
      coordinators: [{ name: 'Ruth Hale' }],
    }),
  },
  {
    id: 'rotation-turn-given', category: 'notifications',
    name: 'You have been given a turn',
    audience: 'Whoever a coordinator gives a turn on a rotation',
    trigger: 'A coordinator gives somebody a turn dated today or later (not one written down after the fact).',
    like: ['rotation:%:turn:%:given'],
    preview: () => rotationMail.compose.turnGiven({
      name: SAMPLE.user.name,
      rotation: { id: 1, name: 'Baby shower hosts', description: 'Hosting the next baby shower in the fellowship hall.' },
      turn: { date: '2026-11-08', note: 'For the Hale family, 2pm' },
      coordinators: [{ name: 'Ruth Hale' }],
    }),
  },
  {
    id: 'rotation-turn-reminder', category: 'notifications',
    name: 'Your turn is coming up',
    audience: 'Whoever has a dated turn on a rotation',
    trigger: 'A week before the turn. A turn given less than a week ahead gets no separate reminder: the "given a turn" email says when.',
    like: ['rotation:%:turn:%:reminder'],
    preview: () => rotationMail.compose.turnReminder({
      name: SAMPLE.user.name,
      rotation: { id: 1, name: 'Ladies\' class teachers', description: '' },
      turn: { date: '2026-11-04', note: 'Lesson 4 of the quarter' },
      coordinators: [{ name: 'Ruth Hale' }],
    }),
  },

  // ── Telling the people a change concerns (mail/notices.js) ─────────────────
  {
    id: 'notice-serving', category: 'notifications',
    name: 'Put on, taken off or moved on the serving schedule',
    audience: 'Whoever the schedule keeper puts on a slot, takes off it, or whose slot moves',
    trigger: 'The schedule keeper changes a slot still to come by hand. (The month itself is announced when it is published.)',
    like: ['notice:serving:%'],
    preview: () => notices.compose.notice({
      name: SAMPLE.user.name, subject: 'You are down for Lead Singing: Oct 19, Sunday AM',
      lines: ['Kay Webb has put you down for Lead Singing on Oct 19, Sunday AM.', 'If you cannot do it, choose "Ask to be replaced" on the slot so whoever keeps the schedule can find somebody.'],
      page: 'service-roster', params: { tab: 'scheduled' }, why: 'your name is on the serving schedule',
    }),
  },
  {
    id: 'notice-communion-prep', category: 'notifications',
    name: 'Communion preparation changed',
    audience: 'Whoever the keeper puts down for a month or takes off it — and the keeper, when somebody takes their own name off',
    trigger: 'The keeper changes who prepares a month that has not ended, or a member takes their name off one.',
    like: ['notice:communion-prep:%'],
    preview: () => notices.compose.notice({
      name: SAMPLE.user.name, subject: 'You are down to prepare communion in November 2026',
      lines: ['Kay Webb has put you down to prepare the Lord\'s Supper in November 2026. You will get a reminder a week before the month begins.'],
      page: 'communion-prep', params: { year: 2026 }, why: 'your name is on the communion preparation list',
    }),
  },
  {
    id: 'notice-signup', category: 'notifications',
    name: 'A sign-up you are on changed',
    audience: 'Whoever is put on or taken off a sign-up by somebody else, or whose date moves or list is deleted — and whoever made the list, when somebody takes their own name off',
    trigger: 'Any of those happens to a date still to come.',
    like: ['notice:signup:%'],
    preview: () => notices.compose.notice({
      name: SAMPLE.user.name, subject: 'You are down for “Desserts” on “Fellowship meal”',
      lines: ['Kay Webb has put you down for “Desserts” on “Fellowship meal”, 2026-11-01 at 17:00.', 'If you cannot do it, please let them know, or take your name off on the sign-up.'],
      page: 'signups', params: { list: 1 }, why: 'your name is on the sign-up “Fellowship meal”',
    }),
  },
  {
    id: 'notice-rotation', category: 'notifications',
    name: 'Taken off a rotation, or a turn cancelled',
    audience: 'Whoever a coordinator takes off a rotation, or whose turn still to come is cancelled',
    trigger: 'A coordinator makes one of those changes.',
    like: ['notice:rotation:%'],
    preview: () => notices.compose.notice({
      name: SAMPLE.user.name, subject: 'Your turn on "Baby shower hosts" on 2026-11-08 is off',
      lines: ['Ruth Hale has cancelled your turn on the "Baby shower hosts" rotation on 2026-11-08. You are back at the front of the line, so your turn will come round again next.'],
      page: 'rotations', params: { rotation: 1 }, why: 'your name is on the "Baby shower hosts" rotation',
    }),
  },
  {
    id: 'notice-areas', category: 'notifications',
    name: 'What you look after changed',
    audience: 'A member an admin gives an area to, or takes one from',
    trigger: 'An admin changes somebody\'s areas on Members & Access.',
    like: ['notice:areas:%'],
    preview: () => notices.compose.notice({
      name: SAMPLE.user.name, subject: 'You now look after Rotations on the member portal',
      lines: ['Ada Admin has asked you to look after:', '', '  • Rotations (Rotations) — Start a rotation for anything the church takes in turns, appoint who coordinates each one, and retire or delete them.', '',
        'You will see the buttons for it on those pages (and under Church Office, where it has a page there). How It Works explains each one.'],
      page: 'how-it-works', params: {}, why: 'an admin changed what you look after on the member portal',
    }),
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
  {
    id: 'notice-group', category: 'groups',
    name: 'Taken off a group, or it stopped meeting',
    audience: 'Whoever is taken off a group\'s roll; the whole roll when a group is retired or deleted; whoever a leader takes off bringing something',
    trigger: 'A leader or the group manager makes one of those changes.',
    like: ['notice:group:%'],
    preview: () => notices.compose.notice({
      name: SAMPLE.user.name, subject: 'You are no longer in North Harvest',
      lines: ['Kay Webb has taken you off North Harvest\'s roll, so you will not hear about its meetings any more.', 'If that is a mistake, please let them know.'],
      page: 'groups', params: { group: 3 }, why: 'you were on North Harvest\'s roll',
    }),
  },

  {
    id: 'signup-email', category: 'groups',
    name: 'About a sign-up list',
    audience: 'Everyone signed up for a list, or (sent by the sign-up manager) a whole distribution group',
    trigger: 'Whoever made a sign-up list writes about it from the list. Their own words come first, then the list as it stands — when, what for, what is still needed — and its link.',
    like: ['signup:%:email'],
    preview: () => signupMail.compose.signupEmail({
      list: {
        id: 5, title: 'Fellowship meal', description: 'After morning worship, in the fellowship hall.', allowFree: true, freeLabel: 'Something else to share',
        items: [{ id: 1, label: 'Main dish', needed: 4 }, { id: 2, label: 'Dessert', needed: 3 }],
        dates: [{ id: 1, date: '2026-11-15', time: '12:00', note: '', past: false, free: [],
          items: [{ itemId: 1, taken: 3, needed: 4, full: false }, { itemId: 2, taken: 3, needed: 3, full: true }] }],
      },
      message: 'We still need one more main dish — can you help?', from: SAMPLE.user.name,
    }),
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
  {
    id: 'records-reminder', category: 'reports',
    name: 'Records to fill in',
    audience: "Whoever looks after songs, guests or the contribution, and each group's leaders for their meetings' head counts — each hears only about their own — plus whoever holds Reports & Record Keeping",
    trigger: 'Monday morning, when the Record Keeping report shows something from the last eight days is not on file. Also sent from that page on request.',
    like: ['records-reminder:%'],
    preview: () => recordsReminder.compose.recordsReminder(SAMPLE.records),
  },
];

// SQL LIKE → a regular expression, for matching a context in code.
const toRegex = like => new RegExp(`^${like.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.')}$`);
for (const email of EMAILS) email.matchers = email.like.map(toRegex);

function emailFor(context) {
  return EMAILS.find(e => e.matchers.some(m => m.test(context || ''))) || null;
}

module.exports = { CATEGORIES, EMAILS, emailFor };
