// ─── How It Works ─────────────────────────────────────────────────────────────
//
// The portal's own documentation, written for the people using it rather than
// the people building it. My Church → How It Works renders it, and the same
// sections make the PDF (server/lib/howItWorksPdf.js), so the two can never
// say different things.
//
// It lives on the server so the admin sections never leave it for anybody
// else: GET /api/how-it-works sends only what the asker may read.
//
// Most of it is written by hand, so keep it current by hand. When a PR adds or
// renames an area, adds a page, or adds a flow that writes data or sends mail,
// it touches the matching section here in the same PR. Three things fill
// themselves in and need nothing: the list of areas (server/lib/areas.js), the
// list of emails (server/mail/catalog.js), and the two workflow flowcharts
// (server/workflows/definitions/).
//
// A section is { id, title, audience, blocks }. audience is 'everyone' or
// 'admins'. A block is one of:
//   { p: 'text' }                   a paragraph; **bold** works inside it
//   { list: ['…'] }                  bullet points
//   { steps: ['…'] }                 numbered steps
//   { note: 'text' }                 a highlighted aside
//   { table: { head, rows } }        a small table
//   { chart: { title, start, nodes, edges } }   a hand-drawn flowchart
//   { workflow: 'visitor-follow-up' }            a live workflow's flowchart
//   { areas: true }                  every area, from server/lib/areas.js
//   { emails: true }                 every email the site sends, from the catalog
//
// A chart label is wrapped onto at most two lines of about 22 characters and
// anything past that is dropped (client/src/components/WorkflowChart.jsx);
// server/tests/howItWorks.test.js fails on a label that would not fit.

const { AREAS } = require('./areas');
const { listDefinitions } = require('../workflows/definitions');
const engine = require('../workflows/engine');

const flow = (title, labels, { outcome = 'good' } = {}) => ({
  title,
  start: 's0',
  nodes: labels.map((label, i) => ({
    id: `s${i}`,
    kind: i === labels.length - 1 ? 'outcome' : 'step',
    ...(i === labels.length - 1 ? { tone: outcome } : {}),
    label,
  })),
  edges: labels.slice(1).map((_, i) => ({ from: `s${i}`, to: `s${i + 1}` })),
});

const SECTIONS = [
  // ── For everyone ──────────────────────────────────────────────────────────
  {
    id: 'getting-started', title: 'Getting started', audience: 'everyone',
    blocks: [
      { p: 'The member portal is a private website for the Capshaw church family. Everything in it is behind sign-in: nobody outside the congregation can see the directory, the schedule or anything else here.' },
      { p: 'You can sign in with **Google**, **Facebook**, or an **email address and a password**. A new account has to be approved by the church office before it can see anything. If you registered with an email address, you will first get an email asking you to confirm it. Forgotten your password? Choose **Forgot your password?** on the sign-in page and we will email you a link to choose a new one; it works once, for an hour.' },
      { chart: flow('Getting an account', ['You sign up', 'You confirm your email', 'The office approves you', 'You can sign in']) },
      { p: 'The menu across the top groups the pages: **Worship**, **Our Church Family**, **Grow** and **My Church**. Whoever looks after part of the site also gets **Church Office**, with the pages for what they look after, and admins get **Admin** as well. On a phone, the same menu opens from the button at the top of the screen. Every page works on a phone; there is nothing to install.' },
      { list: [
        '**My Church → My Household & Preferences** — keep your own details current (and your household\'s), and say which worship jobs you are glad to do, willing to do, or would rather not.',
        '**My Church → My Inbox** — anything waiting on you, such as a guest to follow up with, in one list.',
        'The **bell** at the top — what has happened that you have not seen yet: a meeting posted in your group, a reply, a request you made being answered. Choosing one takes you to it.',
      ] },
    ],
  },
  {
    id: 'who-can-do-what', title: 'Who can do what', audience: 'everyone',
    blocks: [
      { p: 'Every page can be read by everyone signed in. What differs is who may change things. Each part of the site has its own **area**, and holding an area adds the Add, Edit and Delete buttons to that one part of the site and nothing else. Admins hold every area; everyone else holds only what has been given to them.' },
      { chart: { title: 'How permissions work', start: 'grant', nodes: [
        { id: 'grant', kind: 'step', label: 'An admin grants you an area' },
        { id: 'hold', kind: 'step', label: 'You hold that area' },
        { id: 'buttons', kind: 'step', label: 'Its Add/Edit buttons appear' },
        { id: 'logged', kind: 'outcome', tone: 'good', label: 'Recorded in Action History' },
      ], edges: [{ from: 'grant', to: 'hold' }, { from: 'hold', to: 'buttons' }, { from: 'buttons', to: 'logged' }] } },
      { areas: true },
      { p: 'Every change anybody makes is recorded: who made it, when, and what it was before.' },
    ],
  },
  {
    id: 'upcoming-service', title: 'Upcoming Service', audience: 'everyone',
    blocks: [
      { p: '**Worship → Upcoming Service** is Sunday\'s worship on one page, with a tab for each part of it:' },
      { table: { head: ['Tab', 'What it is'], rows: [
        ['Order of Worship', 'The services coming up, each as its song leader submitted it, and the printed order of service'],
        ['Submit a Service', 'Where the song leader lays out the whole service'],
        ['Song Tracker', 'Every service\'s songs, who led them, and which songs we sing most'],
        ['Song Requests', 'Ask for a song, and see what others have asked for'],
        ['Service Parts', 'For the worship organizer: what a service is made of'],
      ] } },
      { p: '**Submitting a service.** The song leader on the Serving Schedule for a service fills it in part by part — the songs, who prays, the scripture reading, the sermon title. It starts in the usual order for that service, with the names the Serving Schedule already has filled in (a part linked to a schedule job on Service Parts, or one with the same name — the sermon takes the Speaker); any part can be changed, moved, added or taken out. Beside each part is a box for a note — the verses to sing or read, or anything else the organizer should know about it. Songs members have asked for are listed beside it, one click from going in.' },
      { chart: flow('A service, start to finish', ['The song leader submits it', 'The organizer is emailed', 'The organizer confirms it', 'Its songs are recorded']) },
      { p: 'Until it is confirmed, the song leader can keep changing it. Once confirmed, only the worship organizer can change it — and the song tracker follows any change.' },
      { p: '**Reminders.** The song leader is emailed four days (96 hours) before the service they are leading and again the day before (24 hours). The email says whether the service has been submitted yet and links straight to it.' },
      { p: '**Adding a song.** If a song is not in the list, anyone can add it — from the **+ Add a song** button at the top of the page, or by typing its name in any song search and choosing **Add … as a new song**. It can be chosen everywhere straight away.' },
    ],
  },
  {
    id: 'song-requests', title: 'Asking for a song', audience: 'everyone',
    blocks: [
      { p: 'On **Upcoming Service → Song Requests**, choose a song, optionally a Sunday, and say why if you like. The song leaders see open requests beside the service they are planning.' },
      { chart: flow('A song request', ['You ask for a song', 'A service includes it', 'You are told it is planned', 'It is sung']) },
      { p: 'You can withdraw your own request while it is waiting. Whoever keeps the songs can mark a request sung or decline it.' },
    ],
  },
  {
    id: 'serving-schedule', title: 'The Serving Schedule', audience: 'everyone',
    blocks: [
      { p: '**Our Church Family → Service Roster**, on its **Scheduled** tab, shows who leads singing, prays, reads scripture and serves the Lord\'s Supper at each service. The month is shown a card per service, and every service has its own link — **Copy link** on its card — that opens the schedule straight on it, the same as each service\'s link on Submit a Service. A month is filled from what everyone has said on **My Household & Preferences** — glad to, willing, or would rather not — and the days people are away.' },
      { chart: { title: 'What feeds the roster', start: 'prefs', nodes: [
        { id: 'prefs', kind: 'step', label: 'Everyone sets their preferences' },
        { id: 'away', kind: 'step', label: 'Everyone marks their time away' },
        { id: 'build', kind: 'step', label: 'The schedule keeper chooses Build a month' },
        { id: 'month', kind: 'outcome', tone: 'neutral', label: 'A filled-in month to adjust by hand' },
      ], edges: [{ from: 'prefs', to: 'build' }, { from: 'away', to: 'build' }, { from: 'build', to: 'month' }] } },
      { p: '**Building a month.** The schedule keeper chooses **Build a month**, the month, and the services to lay out. Every service gets a slot for each job it needs, and the slots are filled from the men who are glad or willing to do that job — never one who is away that day or already serving at that service — with the turns spread out and chance deciding the rest, so building twice gives two different, equally fair months. Building again only adds what is missing and fills what is still open; a name already there is never moved. Open slots are highlighted and counted.' },
      { p: '**Changing a name.** The schedule keeper clicks any name (or an open slot) to change it. The men who fit best come first — free that day and glad or willing — each with how many turns he already has that month; **Show everyone** lists the rest and why each is not a fit, and any name can be typed in. Nobody is emailed while the month is being worked on: **Email everyone their jobs** sends each man his jobs for the month, and the whole month to the congregation, when it is ready.' },
      { p: '**Your jobs.** At the top of the Scheduled tab, **Your jobs this month** lists everything you are down for this month — and next month, once it is built — whichever month the schedule below is showing. Each one says whether you have already asked to be replaced, and **Show** takes you to that service.' },
      { p: '**Time away.** The **My time away** button on the Scheduled tab blocks out days you will not be here — a holiday, a hospital stay. Nobody will be scheduled on those days. Each man keeps his own; the schedule keeper can do it for him by opening his name on the **Preferences** tab.' },
      { workflow: 'serving-replacement', intro: '**Asking to be replaced.** If you cannot do a job you are down for, choose **Ask to be replaced** beside it and say why if you like. Whoever keeps the schedule is emailed, told on their bell, and finds it in **My Inbox**; your name stays on until they have sorted it out, so a gap is never left that nobody knows about. They put someone else in, leave the slot open, or — if you have talked — keep you on, and you are told which. In **My Inbox** the request suggests who could take it — men free that day who are glad or willing to do the job, fewest turns first — and choosing one settles it. A slot waiting on a replacement is marked on the schedule, and the schedule keeper sees every open request at the top of the Scheduled tab, with a history of every request and how it ended. Admins are only asked when nobody else keeps the schedule, but they can see the history.' },
      { p: '**The jobs each service needs.** The schedule keeper chooses them with **Setup → Jobs for each service** — Sunday morning, Sunday evening, Wednesday, and each special service. Building a month lays out those jobs; a month already built keeps its slots, and **Setup → Add a single job** adds a one-off.' },
      { p: '**Special services.** A gospel meeting, a singing — anything that is not every week — is added by the schedule keeper with **Setup → Add a special service**: which service, the first and last night, and the jobs it needs each night. It then shows on **Upcoming Service** like any other, its song leader is reminded, and its parts are filled from the names put against it. The services to choose from are the church\'s own list of services; a kind not on it yet — a youth rally, a lectureship — the schedule keeper adds right there with **A kind of service not on the list**. Bible classes are never offered, since nobody is rostered for them.' },
    ],
  },
  {
    id: 'worship-participation', title: 'The Service Roster', audience: 'everyone',
    blocks: [
      { p: 'Whoever keeps the serving schedule (and admins) sees two more tabs on the **Service Roster**, **Preferences** and **Analysis**; nobody else does. Opening a man\'s name on **Preferences** is where the schedule keeper writes down what he will do and the days he is away, when he says so in the foyer rather than on **My Household & Preferences**. Both tabs show worship participation. Nothing has to be entered for those: the serving schedule, as it was last left, is taken to be what happened. When somebody swaps or drops out, change the schedule and the record follows.' },
      { p: 'The **Analysis** tab shows, for the last few months: who is carrying the load and in which jobs, how many different men have done each job, the jobs never filled, and the men who said they would do a job and have not been used for it. Choose a man to see his own record, what he is down for next, and what he said beside what he has done.' },
      { p: 'The **Preferences** tab lists every man against every job, with what he has said (glad to, willing, rather not, or nothing yet) and how often he has served it. Above it, how each job is covered; a job with fewer than three men glad or willing is marked thin. Men set their own on **My Household & Preferences**; the schedule keeper can record them for him by opening his name.' },
    ],
  },
  {
    id: 'guests', title: 'Guests and following up', audience: 'everyone',
    blocks: [
      { p: '**Our Church Family → Guests** lists everyone who has visited, each visit, who invited them, and whether anybody has been in touch yet. The **All follow-ups** tab arranges them by where that stands: nobody has reached out, someone is on it, reached, or never reached. **Follow Up**, at the top of the page, is where a follow-up is started or worked through.' },
      { workflow: 'visitor-follow-up', intro: 'The **Follow up** button on a guest asks somebody to get in touch. Whoever is asked sees it in **My Inbox**, with the guest\'s phone number and email. Phoning or emailing them closes it; no answer brings it round for another try.' },
    ],
  },
  {
    id: 'church-groups', title: 'Church Groups', audience: 'everyone',
    blocks: [
      { p: '**Our Church Family → Church Groups** has each small group: who is in it, who leads it, and its meetings. The groups you are in are at the top.' },
      { chart: flow('A group meeting', ['The leader posts it', 'The group is emailed', 'Members say if coming', 'Leader records who came']) },
      { list: [
        'Say whether you are coming, and how many you are bringing, on the meeting itself. You can sign up to bring something from its list, and reply underneath.',
        'Leaders can write down an answer for a member who does not use the portal.',
        'If a meeting is called off, the group is told. If its time or place changes, the people who said they were coming are told.',
        'After a meeting, the leader writes down how many came. That is what the church\'s record keeping checks for.',
      ] },
    ],
  },
  {
    id: 'newsletter', title: 'The weekly newsletter', audience: 'everyone',
    blocks: [
      { p: 'Whoever looks after the newsletter writes it on **Church Office → Weekly Newsletter**. Most of it fills itself in from the rest of the portal:' },
      { list: [
        'Reminders and coming events, from the announcement board',
        'Last week\'s attendance, and the offering from Contributions',
        'The duty roster, from the Serving Schedule',
        'Birthdays and anniversaries, the elders and deacons, and each group\'s contact',
      ] },
      { p: 'Only the prayer lists and a few notes are typed each week. It is exported as a Word document or a PDF, and can be emailed to a mailing list with the PDF attached.' },
    ],
  },
  {
    id: 'announcements', title: 'Announcements, calendar and the foyer screen', audience: 'everyone',
    blocks: [
      { p: '**Worship → Announcements** and **Grow → Church Calendar** share their events, so nothing is typed twice. Anyone can reply under an announcement.' },
      { p: '**Fullscreen Display** on the Announcements page turns the current announcements into a slideshow for the screen in the foyer.' },
    ],
  },
  {
    id: 'giving-attendance', title: 'Attendance and contributions', audience: 'everyone',
    blocks: [
      { p: '**Our Church Family → Attendance** and **Contributions** show the counts and weekly totals, with trends over time.' },
      { note: 'Contributions are one total per week. Nobody\'s individual giving is recorded anywhere in the portal. Only the counters (and admins) can enter a week\'s total.' },
    ],
  },
  {
    id: 'member-attendance', title: 'Member attendance', audience: 'everyone',
    blocks: [
      { p: '**Church Office → Member Attendance** is for whoever holds the Member Attendance area (and admins); nobody else can see who was at a service. Pick the date and the service, then go down the roll: everybody in the directory, by surname, with their photo.' },
      { steps: [
        'Tap a photo or name to step through the statuses — Present, Sick, Out of town, Absent, then back to not marked — or tap the status you want under the name.',
        'Use the letters down the side of the screen to jump through the alphabet.',
        'When only the absent are left, **Mark everyone left as** marks the rest at once.',
      ] },
      { p: 'Every tap is saved as it is made. **Statuses** changes the list: add one, rename it, choose its colour and whether it counts as present. A status somebody has been marked with is retired rather than removed.' },
      { p: 'The **Analytics** tab shows the whole congregation for a number of weeks — the rolls taken, how many were present, each roll by status, and who has not been here lately. Choose a member from the dropdown to see just them.' },
      { p: '**Import from Excel** brings in the weekly attendance sheets: one sheet per date, with the date at the top, the colour legend under it ("Green = Present"), and each person\'s name coloured for how they were marked. Choose every week\'s file at once. The import reads each sheet\'s date (or the date in its file name, or one you type), suggests a status for each colour from the legend — a name left uncoloured as Absent — and asks about any name the directory does not know, once however many sheets it is on. A legend colour with no status to match (such as Work) can be added as one there and then. A sheet with a row per member and a column per date can be imported too.' },
      { note: 'Somebody already marked for a date keeps their mark unless you tick to let the spreadsheet win, so importing the same sheets twice changes nothing.' },
      { note: 'Somebody left unmarked on a roll is counted as not marked, never as absent.' },
    ],
  },
  {
    id: 'other-pages', title: 'Everything else', audience: 'everyone',
    blocks: [
      { table: { head: ['Page', 'What it is'], rows: [
        ['Grow → Member Match', 'A game for learning names and faces from the directory photos'],
        ['Grow → Bible Class', 'Class questions and lesson planning'],
        ['Our Church Family → Birthdays & Anniversaries', 'Whose are coming up, from the church website'],
        ['Our Church Family → Elders & Deacons', 'Who they are and what each looks after'],
        ['Our Church Family → Livestreams', 'The church\'s YouTube channel, newest first'],
      ] } },
    ],
  },
  {
    id: 'emails', title: 'Emails the portal sends', audience: 'everyone',
    blocks: [
      { p: 'The portal only emails you for a reason. These are all of them:' },
      { emails: true },
    ],
  },
  {
    id: 'report-a-problem', title: 'Reporting a problem', audience: 'everyone',
    blocks: [
      { p: '**Report a problem**, at the bottom of every page, goes to every admin. Say what happened and how much it is in your way; a screenshot helps. The page you were on is sent with it automatically. You hear back through your bell when its status changes.' },
      { chart: { title: 'Reporting a problem', start: 'report', nodes: [
        { id: 'report', kind: 'step', label: 'Anyone reports a problem' },
        { id: 'notify', kind: 'step', label: 'Every admin is told' },
        { id: 'work', kind: 'step', label: 'An admin updates it' },
        { id: 'back', kind: 'outcome', tone: 'good', label: 'You are told it changed' },
      ], edges: [{ from: 'report', to: 'notify' }, { from: 'notify', to: 'work' }, { from: 'work', to: 'back' }] } },
    ],
  },

  // ── For admins ────────────────────────────────────────────────────────────
  {
    id: 'admin-accounts', title: 'Accounts and access', audience: 'admins',
    blocks: [
      { p: '**Admin → Members & Access** is where new accounts wait. Approving one lets them in and links them to their directory entry. From the same page, give each person only the areas they look after — the songs, the guests, the counters\' contributions — rather than making them an admin.' },
      { steps: [
        'Open the waiting account and check it is somebody you know.',
        'Approve it, and match it to the right directory entry.',
        'Grant the areas they look after, if any.',
      ] },
      { p: '**View as.** An admin sees every button, so "the Add button is missing for me" is hard to answer from an admin account. **View as** on a member\'s row shows the portal exactly as they see it. It is not read-only: anything you change while viewing is really changed, and the Action History records both of you. A banner stays at the top until you stop.' },
      { note: 'Only an admin can use View as, and never on another admin.' },
    ],
  },
  {
    id: 'admin-record-keeping', title: 'Record Keeping', audience: 'admins',
    blocks: [
      { p: '**Church Office → Record Keeping** (for admins, and anyone given Reports & Record Keeping) checks, week by week, that the records are being kept:' },
      { list: [
        '**Songs** and **guests** for every tracked service — Sunday morning and Wednesday evening every week; Sunday evening and gospel meetings in the weeks they are held',
        '**The roll call** of members at each of those services, from the first roll anybody took',
        '**The contribution** each Sunday',
        '**How many came** to each group meeting',
      ] },
      { p: 'A gap links to the page that fills it. When there was genuinely nothing to record — no guests, or the service did not happen — mark it so, and it stops being reported. Which services are tracked, and on which day, is under **Which services are tracked**.' },
      { chart: flow('The Monday reminder', ['Monday, 9:00 AM', 'Report finds gaps', 'Each keeper is emailed', 'They fill the gaps']) },
      { p: 'Each person hears only about what they look after; whoever holds Reports & Record Keeping hears about all of it. Nothing is sent when nothing is missing. **Send reminder now** sends it straight away.' },
    ],
  },
  {
    id: 'admin-worship', title: 'Running Upcoming Service', audience: 'admins',
    blocks: [
      { p: 'Whoever holds **Worship Organizer** is emailed when a service is submitted, and confirms it from the email\'s link or from Order of Worship. The **Service Parts** tab keeps:' },
      { list: [
        '**The parts** — what each collects (a song, a person, a detail such as the passage) and which Serving Schedule job already names the person',
        '**The usual order** — the default order every service starts from, and any service that runs differently (Wednesday) can have its own. **Use this order for every service** puts them all back on the default',
        '**Service times** — when each service starts; the song leader\'s 96- and 24-hour reminders count back from these',
      ] },
      { p: 'Whoever holds **Song Tracker** tidies the song list from **Song Tracker → Library**: correct a title or number, or merge a duplicate into the song it repeats. Old history can still be brought in from capshawchurch.org with **Import**; nothing is sent back to that site.' },
    ],
  },
  {
    id: 'admin-emails', title: 'Email and the outbox', audience: 'admins',
    blocks: [
      { p: '**Church Office → Emails** lists every kind of email the site sends, in four tabs (Notifications, Bulletin, Groups, Reports), with how many went in the last 30 days, a preview of each, and every message sent — searchable, and each can be opened.' },
      { p: 'Every email is queued first and sent from the queue, so a mail server being down never loses one; the queue is retried every five minutes, and **Send waiting mail now** tries at once.' },
      { note: 'While the server is in test mode (MAIL_REDIRECT_TO is set), every email goes to that one address instead of its real recipient, and the Emails page says so at the top.' },
      { p: '**Admin → Email Delivery** lets some of it through while test mode is on. Turn on a role (Admins, or an area such as Song Tracker) and everyone given it gets their own email; add a person by name or address to let just them through, or to keep them redirected while their role is on — a person\'s own setting beats any role. **Everyone** at the top sends every email to the person it is for, bar anybody kept redirected by name; turning it off goes back to the roles and people as they were. The page lists exactly who is getting their own email and why. Nothing turned on means every email comes to the redirect address. Mail about a person\'s own account — confirming their address, telling them they are approved, a link to choose a new password — always goes to that person, test mode or not, since a link sent to anybody else is no use.' },
      { p: '**Church Office → Email Groups** decides who is on each mailing list. A church group\'s list follows its roll.' },
    ],
  },
  {
    id: 'admin-timers', title: 'What runs on its own', audience: 'admins',
    blocks: [
      { table: { head: ['When', 'What happens'], rows: [
        ['Every 5 minutes', 'Waiting email is sent'],
        ['Every 4 hours, and Refresh', 'The directory and other records are read from capshawchurch.org'],
        ['Monday, 9:00 AM', 'The missing-records reminder, if anything is missing'],
        ['96 and 24 hours before a service', 'The song leader\'s reminders'],
      ] } },
      { p: 'Each timed email is written down before it is sent, so restarting the server never sends one twice.' },
    ],
  },
  {
    id: 'admin-history', title: 'Action History, Church Records and Bug Reports', audience: 'admins',
    blocks: [
      { p: '**Admin → Action History** is every change anybody has made, with who, when, and the before and after. Filter it by area, by what happened, by who, or search it.' },
      { p: '**Admin → Church Records** edits any table directly, and its **Sample Data** tab fills the site with made-up records to look at — and takes exactly those back out again, touching nothing real. If something real has come to use a sample record — a sample song picked for a real service, say — that one record is kept and listed, and removing the batch again takes it once nothing uses it.' },
      { note: 'Church Records edits records directly. Prefer the page a record belongs to, where the checks are.' },
      { p: '**Admin → Bug Reports** is every problem reported, with the page it happened on and any screenshot. Move each through open, in progress, resolved or won\'t fix; the person who reported it is told.' },
    ],
  },
];

// ─── What a reader gets ───────────────────────────────────────────────────────

function isAdmin(user) {
  return user?.role === 'admin';
}

function areaRows() {
  return AREAS.map(a => [a.label, a.page, a.description]);
}

function emailRows() {
  // Required here rather than at the top: the catalog pulls in the mail
  // senders, which a test of this module may not want loaded until asked.
  const { CATEGORIES, EMAILS } = require('../mail/catalog');
  const label = new Map(CATEGORIES.map(c => [c.id, c.label]));
  return EMAILS.map(e => [e.name, e.audience, e.trigger, label.get(e.category) || '']);
}

function workflowChart(id) {
  const def = listDefinitions().find(d => d.id === id);
  return def ? engine.describe(def) : null;
}

// Blocks with everything dynamic filled in, ready to draw.
function resolve(block) {
  if (block.areas) return { table: { head: ['Area', 'Page', 'Who holds it can'], rows: areaRows() } };
  if (block.emails) return { table: { head: ['Email', 'Who gets it', 'When', 'Kind'], rows: emailRows() } };
  if (block.workflow) {
    const chart = workflowChart(block.workflow);
    return chart ? { workflow: block.workflow, intro: block.intro, chart } : { p: block.intro || '' };
  }
  return block;
}

function sectionsFor(user) {
  const admin = isAdmin(user);
  return SECTIONS
    .filter(s => s.audience === 'everyone' || admin)
    .map(s => ({ ...s, blocks: s.blocks.map(resolve) }));
}

module.exports = { SECTIONS, sectionsFor, isAdmin };
