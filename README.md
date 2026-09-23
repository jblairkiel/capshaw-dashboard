# Capshaw Member Portal

The member portal for Capshaw Church of Christ. Signed-in members see this
Sunday's service, the serving schedule, attendance, our guests, birthdays and
anniversaries, our elders and deacons, the church calendar, recent livestreams
and the Bible class tools — most of it pulled from the church website.

**The whole site is members-only.** Nothing renders and no API answers until
you have signed in; see [Signing in](#signing-in) below.

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 18, Vite, Tailwind CSS |
| Backend | Node.js, Express |
| Database | SQLite via `better-sqlite3` (question library) |
| AI | Anthropic Claude API (Bible class question generator) |
| Process manager | PM2 (production), or none — see [Running in Docker](#running-in-docker) |
| Container | One image: API, React build and database ([Dockerfile](Dockerfile)) |
| CI/CD | GitHub Actions → DigitalOcean via SSH |

---

## Local Development

### Prerequisites

- Node.js 22.12 or newer (what `package.json` requires, and what the
  toolchain needs) — or Docker, which brings its own
- An Anthropic API key (for Bible class question generation)

### Setup

```bash
# Install all dependencies (root + client)
npm run install:all

# Create your environment file
cp .env.example .env   # or create .env manually (see below)
```

**`.env`** (root of project):

```
ANTHROPIC_API_KEY=sk-ant-...
```

### Run

```bash
npm run dev
```

This starts both servers concurrently:
- **Express API** on `http://localhost:3001`
- **Vite dev server** on `http://localhost:5173` (proxies `/api` → 3001)

Open `http://localhost:5173` in your browser.

### Scraper

On first start the server will attempt to scrape the church website. It re-scrapes automatically every 4 hours. Scraped data is cached to `server/data/members.json` (gitignored). The scraper requires valid church website credentials — without them the portal tabs that depend on scraped data will be empty.

See [Scraper](#scraper-1) below for family photos and for diagnosing a section that comes back empty.

---

## Signing in

Every page and every API route is behind sign-in — there is no signed-out view
of the portal, not even the `/display` announcement board.

- **Client** — `client/src/App.jsx` resolves `/api/auth/me` before it renders
  anything. Without a user it shows `LoginPage` and nothing else; signing out
  drops straight back to it.
- **Server** — `requireSiteAuth` (in `server/middleware/auth.js`) is mounted on
  `/api` ahead of every router. Only `/api/auth/*` (the sign-in flow itself)
  and `/api/health` stay open; everything else answers `401` without a session.

A lobby screen showing `/display` therefore needs to be signed in once as a
member — the session cookie lasts seven days.

There are three ways in: Google, Facebook, and an email address with a
password. The first two are unchanged. The third is described below.

### Registering with an email address and a password

Anyone may create an account from the sign-in page, but a new account is worth
nothing on its own. Two separate things have to happen before it can sign in at
all, and neither one substitutes for the other:

1. **The person confirms their address.** Registering mails them a one-time
   link. Until they open it, `/api/auth/login` answers `403`
   (`code: email_unverified`) even with the right password.
2. **An admin approves them.** Confirming the address puts them in the church
   office's queue; until somebody approves, `/api/auth/login` answers `403`
   (`code: pending_approval`).

Because no session is ever created until both are done, an unapproved
registrant cannot read anything at all — `requireSiteAuth` needs a session
before it will serve any route.

Approving is also where the account gets a member profile; see
[Roles & Permissions](#roles--permissions).

### How the credentials are stored

`server/lib/passwords.js` holds all of it, and nothing reversible is ever
written to the database.

- **Passwords** are hashed with **scrypt** (`N=2^15, r=8, p=1`, 64-byte digest),
  a per-account 16-byte random salt, and a constant-time comparison. Roughly
  32 MB and a fraction of a second per guess: unnoticeable once, ruinous for a
  word list. The cost parameters are stored alongside the digest
  (`scrypt$N$r$p$salt$hash`) so they can be raised later without stranding the
  rows already written. scrypt ships with Node, so there is no native module to
  build and no dependency to keep patched.
- **Confirmation tokens** are 32 random bytes. The token goes in the email;
  only its SHA-256 digest is stored, so a stolen copy of the database cannot be
  used to confirm anybody's address. Tokens expire after 48 hours, work once,
  and are replaced whenever a new one is asked for.
- **Password policy** is a 10-character minimum, a 200-character maximum (so a
  stranger cannot choose how much work this server does), and a refusal of the
  obvious guesses and of a password that is only the address or name it
  protects.

Some smaller guardrails around the same routes:

- **No account enumeration.** Registering answers identically whether or not
  the address is already in use — the difference is only in which email goes
  out, which only the mailbox owner sees. A wrong password and an unknown
  address give the same `401`, and the unknown-address path spends the same
  hashing time so it is not visibly faster.
- **Per-account lockout.** Eight consecutive wrong passwords lock an account
  for 15 minutes; a correct password clears the count.
- **Per-caller rate limits** on `/register`, `/login` and
  `/resend-verification` (`server/middleware/rateLimit.js`), so nobody can make
  the server hash passwords in a loop. In-process and dependency-free — a cap
  on nuisance, with the lockout above doing the real work.
- **A fresh session id** is issued at sign-in, so a cookie handed out before
  sign-in cannot be reused after it.

The Google and Facebook paths are untouched: those providers vouch for the
address, so those accounts have nothing to confirm and no password here.

---

## Roles & Areas

Access is two separate questions, deliberately kept apart.

**What is this account?** — its `role`, which is a ladder:

| Role | Is |
|---|---|
| `pending` | Waiting on an admin. An account registered with an email address and password cannot sign in at all while it is `pending`; one that came from Google or Facebook can look around the portal but cannot create or edit anything. |
| `approved` (Member) | Bible class questions, the lesson planner, site updates, their own household's details and worship preferences, and signing up for serving jobs. |
| `admin` | Everything, including every area below, the action history, bug report triage, who may sign in, and direct editing of every database table. |

**What does this account look after?** — its *areas*, which are **not** a
ladder. Each area is the Add, Edit and Delete buttons on one part of the site;
holding one says nothing whatever about the others. Admins hold every area
implicitly, and nobody else holds one until an admin grants it.

| Area | The page it unlocks | What the holder can do |
|---|---|---|
| `worship-order` | This Sunday | Upload, replace and remove the order of service |
| `songs` | Songs We Sing | Add songs, record what was sung, keep the song of the week |
| `announcements` | Announcements | Write, edit and retire announcements and events |
| `serving-schedule` | Serving Schedule, Service Roster | Build a month of worship jobs, fill or clear any slot, and record what each man will volunteer for and the days he is away |
| `attendance` | Attendance | Record attendance counts and correct earlier ones (the list of services they pick from is an admin's — see [Service types](#service-types)) |
| `visitors` | Guests | Add guests, keep their details and comments, record their visits |
| `leadership` | Elders & Deacons | Keep the elders and deacons, and what each looks after, up to date |
| `calendar` | Church Calendar | Add and edit dated events |
| `directory` | Member Directory | Edit anybody's directory entry, and add people who are not in it yet |
| `church-groups` | Church Groups | Create the congregation's small groups (or generate a whole set at once), retire them, and appoint each group's leader |
| `mail-groups` | Email Groups | Decide who is in each distribution group, and send to them |
| `bulletin` | Weekly Newsletter | Write each week's prayer lists and offering, and export the newsletter as Word or PDF |

Everything else stays read-only for everyone signed in: the pages are all
visible to the whole church family, and only the area holder sees the buttons.

The calendar and the announcement board are the same table seen two ways, so
they overlap on purpose: `announcements` may write any row, and `calendar` may
write only rows that carry a date. A calendar editor taking the date off an
event would be posting to the announcement board, so it is refused rather than
quietly allowed.

The old `worship-coordinator` role is gone. It existed only to own the worship
roster, which is now the `serving-schedule` area; `server/schema.js` converts
anybody who held it into a member holding that area, so their access is
unchanged.

### Handing an area out

New sign-ins land on `pending`. An admin lets them in from **Church Office →
Members & Access**, with the **Approve** button in the grid or from the
person's detail panel; areas can be ticked in the same step or granted later
from the detail panel.

**Approving is one decision, not two.** Letting somebody in and saying who they
are happen together, so the approval dialog will not submit until the admin has
either paired the account with an existing member directory entry or filled in
a new one. The server enforces the same rule: an approval that carries neither
`directory_id` nor `person` is refused with `code: directory_required`, and so
is any attempt to raise a `pending` account out of `pending` by the plain role
selector. The reason is that an approved account nobody can put a name to can
read the whole congregation's information while its owner cannot keep their own
household up to date.

The dialog suggests a directory entry when exactly one matches the account's
address — always as a suggestion to check, never as an assumption. The approval
records who did it and when (`approved_by`, `approved_at`), and the person is
emailed as soon as it is done.

**The members grid.** Accounts are listed in a sortable, filterable grid. Every
column carries its own filter — free text for names, emails, directory links
and dates, a picker for role, areas and sign-in provider — and the filters
combine. Clicking a row (or its **Manage** button) opens a detail panel holding
everything you can do to that account: set its role, tick the areas it looks
after, link it to a directory entry, or remove it. The **Columns** menu chooses
which columns are shown — including **Confirmed**, which says whether an
email-and-password account has answered its confirmation email — and
remembers the choice in a cookie (`capshaw.users.columns`, a preference only —
no account data), so the grid comes back the way it was left. Columns the build
no longer has are dropped when the cookie is read, and the name column is always
shown. **On a phone the grid becomes a card each** — a nine-column table with a
filter row cannot be made readable at that width — with the same Approve and
Manage actions on every card.

### How it is enforced

`server/middleware/auth.js` carries both vocabularies:

- `requireApproved` / `requireAdmin` guard what a role is for — the member
  routes (Bible class, lesson planner, site update, profile edits), and
  `/api/admin/*`, user management and the action history.
- `requireArea('songs')` and `requireAnyArea(['announcements', 'calendar'])`
  guard a page's writes. `holdsArea(user, area)` is the check behind both;
  `holds(user, key)` answers for either vocabulary, which is what a workflow
  step uses since its `assign` may name either.

Areas live in `server/lib/areas.js` (the catalogue) and the `user_areas` table
(who holds what). Admins are never listed there — their access comes from the
role, so demoting one leaves nothing behind, and promoting a member clears
their grants for the same reason. A pending account holds nothing whatever the
table says.

The client mirrors the same vocabulary in `client/src/lib/roles.js` purely to
decide what to show — the server is always the authority, and re-checks on
every write.

Three guardrails keep an admin from locking everyone out:

- You cannot change or delete your own role.
- The last remaining admin cannot be demoted or removed.
- The account named by `ADMIN_EMAIL` is the owner; it is promoted to admin on
  every login and its role cannot be edited.

---

## Action History

Every create, edit and delete anybody makes through the portal is recorded in
the `action_log` table by the route that made it, and read back at **Church
Office → Action History** (admins only).

An entry carries who did it, which area they did it under, what kind of thing
changed, a one-line summary, and — where it makes sense — the fields that
changed with their before and after values. Opening an entry spells that out;
the list itself can be filtered by area, by what happened (added, changed,
deleted), by who did it, and by a free-text search.

Recording is a side effect of a change that has already succeeded: a write that
cannot be logged is reported to the console and otherwise ignored, so the
history can never be the reason a save fails. Nothing writes to it from the
client, and a refused change records nothing.

`server/lib/actionLog.js` is the recorder; `server/lib/recordStore.js` routes
every area-gated and admin table edit through it, so a change made from either
screen lands in the history the same way.

---

## Viewing the portal as a member

An admin cannot see what a member sees: they hold every area, so every page is
full and every button is there. "The Add button is missing for me" and "that
page is empty" are the two hardest reports to answer from an admin account.

So an admin can borrow one member's view of the site, from **Church Office →
Members & Access** (the **View as** button on a row, or inside the detail
panel). Every page then renders exactly as it does for that person, because
every request really is answered as them.

Three things make it safe to have:

- **Only an admin can start it, and only on an account that is not an admin.**
  An admin's view is not somebody else's to borrow, so it can never be used to
  take another admin's standing — and since an admin already holds everything,
  it can never grant anything they did not have.
- **The real account is never lost.** It stays in the session, it is what stops
  the impersonation, and stopping answers to it rather than to the borrowed
  account. A banner stays across the top of every page until it is stopped.
- **Everything done is recorded.** A change made while viewing as somebody is
  filed under *them* — it is their record that changed — and carries the admin
  as who was really at the keyboard. The action history shows both
  (`Ada / viewing as Mel`), and can be filtered down to just those changes.

It is not a read-only view: what you change while you are in it is really
changed, which is why the banner says so. The checks are made on every request
rather than trusted from when it started, so promoting that account to admin,
or removing it, ends the impersonation immediately.

| | |
|---|---|
| `POST /api/auth/impersonate` | `{ userId }`, admin only. Refuses another admin, yourself, and starting one from inside another |
| `DELETE /api/auth/impersonate` | Answers as the real admin; always available while one is running |
| `GET /api/auth/me` | Returns the borrowed account as `user`, and the admin as `impersonatedBy` |

---

## Serving Schedule

The serving schedule is the one page with two audiences.

**Whoever holds `serving-schedule`** can lay out a month in one go — every
service in it, with a slot for each job that service needs and nobody against
them yet — fill or clear any slot by hand, add a one-off job, and run the
Monthly Worship Schedule workflow. Running the layout twice never doubles a
month up: slots that already exist are left alone.

**Every other member** sees the roster, and that is all they can do with it —
there is no self sign-up. A slot gets a name in it two ways, and two ways
only: the Monthly Worship Schedule workflow publishing a generated draft, or
the schedule keeper filling it by hand. The one thing left that is a member's
own to change is stepping down: they may take their own name back off a slot
they are down for, however it got there. Only the schedule keeper may take
somebody else's off. Every clearing is recorded in the action history by name.

### Time away

A preference says what somebody will do; **time away** says when they will not
be here at all — a holiday, a hospital stay, a fortnight with the
grandchildren. It is a range of days, both ends included, and a single day away
is a range whose ends are the same date.

Anybody linked to the directory blocks out their own days from a **Time away**
button on the **Serving Schedule** page, which opens a dialog rather than
sitting permanently on the page — the button itself says how many days are
already blocked out. The schedule keeper can block out anybody's from
**Church Office → Service Roster**, because most people say *"we are at the
beach that fortnight"* in the foyer rather than typing it in — see that page's
**Details** dialog below. Either way the action history records who wrote it
down, so a range taken second-hand is never mistaken for one the member
entered himself.

Once days are blocked out:

| | |
|---|---|
| **The month builder** | Skips that man for the services falling inside the range, and still offers him every other Sunday — one week away never costs the whole month. A job nobody is left for is reported unfilled rather than quietly blank |
| **Signing yourself up** | Is refused for a day you have blocked out, and the answer names the range so you know which days are in the way. Clear the range and the slot is yours again |
| **The schedule keeper** | Can still write somebody into a day they are away — they may know something the range does not — but never silently: saving says so, and the roster marks the slot **away** |
| **A job with no date** | The monthly visual preparation belongs to no particular day, so nobody is ever away for it |

Time away is kept in `job_blackouts` and goes with the member if their
directory entry does. It says nothing about *why* unless somebody writes a
reason, which is shown to the schedule keeper beside the dates.

The schedule keeper can also see all of it laid out as a **calendar**, from the
"Who is away" list on the Serving Schedule page — a month grid with everybody's
name on every day their range covers, not just the day it starts. It pages
independently of the roster's own month and opens on whichever one the roster
is showing.

### Service Roster

**Church Office → Service Roster** is the page for the question that comes
before the schedule: *what will each man volunteer for?*

A man can say so himself on **My Household & Preferences** — and plenty never
will, because they say it in the foyer instead. So the schedule keeper writes
it down for him here, against the same ten roles and the same three answers
(*glad to*, *willing*, *rather not*). It is the same `worship_preferences`
rows either way; the action history records who wrote each one down and what
it changed, so a preference taken second-hand is never mistaken for one the
man typed himself.

The congregation is a grid, a row per man, summarised so the whole roster can
be scanned at once:

| | |
|---|---|
| **Who is behind each job** | Every role, with how many of the men shown are glad to do it and how many are willing. A role with nobody behind it is called out — that is the gap a schedule keeper is looking for |
| **Who to show** | Everyone, only those who have said something, or only those who have not — the last is the list to take round on a Sunday |
| **Each row** | His name, a count of what he is glad to and willing to do (or "rather not"), the days he is away, and his turns on the roster so far |
| **Details** | Opens a dialog with everything about him: the full preference editor, and his time away (block out or clear a range, the same as the Serving Schedule page's own dialog) |

What this page shows is **what somebody wants**. Whether that turns into a
slot with his name on it is the Monthly Worship Schedule workflow's to decide,
or the schedule keeper's own — there is no separate "may sign up for" list to
keep in step with it, because there is no self sign-up any more.

The Monthly Worship Schedule workflow reads these preferences when it fills a
month: it never schedules somebody who said *rather not* or who is away that
day, and among people with equally few turns it takes the one who said *glad
to* first. See [Monthly Worship Schedule](#monthly-worship-schedule).

---

## Service types

Attendance is recorded against a service, and the service is picked from a list
rather than typed afresh each time — so two records of the same service always
agree on its name, and the filters and the CSV export group the way anybody
would expect.

That list is **an admin's to keep**, not the attendance area's: every record has
to agree on it, so it is not one page's to change. Admins reach it from
**Attendance → Service types** (and, like every other table, from Church Office
→ Church Records).

| Action | What it does |
|---|---|
| Add | Offers a new service on the attendance form |
| Rename | Changes what the form offers. Attendance already recorded **keeps the name it was saved under** — nothing is rewritten behind anybody's back |
| Retire | Takes a service off the form without touching the records made under it. A retired service can be brought back |
| Reorder | Sets the order the form offers them in |

Editing a record whose service has since been renamed or retired keeps that
service selected, marked *no longer offered*, so correcting a count never
silently reassigns it to something else.

The list is seeded on first run from the services already present in the
attendance table, so an existing database keeps working with nothing to do. A
database with no attendance yet gets this congregation's usual services, which
an admin can then change.

---

## Church Groups

The smaller circles the congregation meets in through the week — fellowship
groups, care groups, whatever they are called here — with their own meetings,
invitations and conversation.

Two vocabularies meet on this page, and they are deliberately kept apart:

- **The `church-groups` area** is whoever looks after *every* group. They make
  groups, generate a whole set at once, retire one, and appoint leaders. It is
  an area on the account, granted like any other.
- **A part inside one group** — `leader`, `co-leader`, `host` or `member` — is
  a row on that group's roll, and says nothing whatever about any other group.
  Leading Group 3 gets you Group 3's buttons and changes nothing on Group 4.

| Part | Can |
|---|---|
| `leader` | Post, edit and cancel the group's meetings, keep its roll, edit its details |
| `co-leader` | The same — for when two families share a group |
| `host` | Be named on the group's meetings as where it gathers. No buttons |
| `member` | See the meetings, answer the invitation, sign up, and reply |

A leader can bring people onto their roll and name a host. Appointing a leader
is the group manager's alone, so nobody can hand their group to somebody else.

### The group and its mailing list

Every group is tied to a distribution list in `mail_groups`, and the roll is
the record: adding or removing somebody updates the list in the same
transaction, and renaming the group renames the list. So "who is in my group"
and "who gets my group's email" cannot drift apart. If a list is edited by
hand from **Email Groups**, the group manager can put it back in step with
**Sync the mailing list**; plain addresses that were never on the roll are left
alone.

The address people write *to* (`group-1@capshawchurch.org`) still has to exist
at the mail provider — see [Distribution groups](#distribution-groups). The
group stores it so the page can show it.

### Generating the set

Dividing a congregation into groups by hand means typing a dozen groups and
then dragging two hundred people into them, which is the kind of job nobody
finishes. **Church Groups → Generate the groups** asks for a number, a name to
count from (`Group 1`, `Group 2`, …) and, optionally, an email domain, and
makes them all — each with its own distribution list.

Ticking **spread the directory across them** deals everybody in the directory
out as well, under two rules that make the result usable:

- **A household stays together.** People at one address are dealt as a unit, so
  a group meeting in a living room never gets half a family. Anybody with no
  address on file is their own household rather than being lumped in with every
  other blank.
- **Nobody already in a group is moved.** Running the generator again tops the
  set up — existing keys are reported as skipped, and the rolls already made
  are untouched.

Everybody placed gets a notification saying which group they are in.

### A group's meeting

A leader posts their group's own gatherings from the group's page. A meeting
carries three things an announcement does not:

- **A draft state.** A new meeting is a draft: only the group's leaders can see
  it, and nobody has been told. **Post it to the group** is the moment the
  group hears — in the portal and by email at once — so writing one in two
  sittings never tells the group twice.
- **An invitation.** Members answer yes, no or maybe, and say how many they are
  bringing, so the head count is the answers *plus* their guests. Changing your
  mind corrects your answer instead of counting you twice. The leaders are told
  about a new answer and not about a correction.

  An answer belongs to a **person**, and only sometimes to an account. Much of
  any congregation will never sign in, and they still say whether they are
  coming — to their leader, at church, on the way out. So a leader can write an
  answer down against anybody on the roll, and the meeting shows them who is
  still to be heard from. Such an answer is marked *written down*, so a list of
  names never implies that everybody on it opened the portal. If that person
  later signs in, the answer held for them is theirs to correct, and answering
  for themselves replaces it rather than being counted twice.
- **A sign-up list** (optional). The leader lists what is needed and how many
  of it — "Dessert ×1", "Drinks ×2" — and members take items. What is still
  wanted goes down as people sign up; editing the wording of an item keeps the
  claims under it. A leader can put somebody down the same way they write an
  answer down, and what they wrote is that person's to drop once they sign in.

Cancelling a posted meeting tells the group; cancelling a draft tells nobody,
because nobody ever heard of it.

---

## Comments & Notifications

### Comments on any event

Every event in the portal carries a conversation: a group's meeting, and any
dated row on the announcement board (which is what the church calendar shows).
One table, one router and one component serve both — a comment names its
subject with a pair, `subject_type` and `subject_id`, so a third kind of event
later needs none of them written again.

Each kind decides for itself who may take part, in
`server/lib/eventComments.js`:

| Kind | Who reads it | Who replies | Who can remove somebody else's |
|---|---|---|---|
| `group-event` | The group's roll — or, for a draft, its leaders only | The same, unless the meeting is cancelled | The group's leaders, and the group manager |
| `announcement` | Anybody signed in | Any confirmed member | Whoever holds `announcements` or `calendar` |

A draft meeting's thread follows the meeting: the leaders can talk it over
before they post it, and nobody else can read it or reply, exactly as the
meeting itself is served.

You may edit your own words and nobody else's — a leader can take a comment
down, but nobody can change what somebody else said. A removed comment is kept
with `deleted_at` set and shown as a gap that says so, because a thread that
quietly loses a message reads as though it never had one.

### Notifications

The bell in the header is what has happened that somebody has not seen yet.
The site could already send email, and still does — but email is a copy that
leaves. A notification is the thing itself: unread until it is opened, carrying
the page it is about so the bell can go there, and written when the change is
saved rather than when a mail server answers.

| Kind | Who is told |
|---|---|
| `group-event-published` | Everybody on the group's roll |
| `group-event-updated` | Everybody who said they were coming |
| `group-event-cancelled` | Everybody on the roll |
| `group-event-rsvp` | The group's leaders, on a new answer |
| `group-event-signup` | The group's leaders |
| `group-event-comment` | The leaders, the poster, everybody who answered, and everybody who replied before |
| `announcement-comment` | Whoever looks after the board, and everybody already in the thread |
| `group-membership` | The person added to a group, or made its leader |
| `bug-report-new` | Every admin, when somebody files a bug report |
| `bug-report-status` | Whoever filed it, when an admin moves it through triage |

Two things it deliberately does not do: nobody is ever notified about their own
doing, and opening the panel does not mark everything read — reading a list is
not the same as dealing with what is in it. Picking one marks that one and
opens the page it is about.

Everything is scoped to the account asking. The user id comes from the session,
and the ids a request names are matched against it in the `WHERE` clause, so
there is no way to read or clear somebody else's bell.

---

## Bug Reports

**Report a problem**, at the bottom of every page, is reachable whatever
somebody is signed in as — a pending account included, since they can already
look around the whole portal and are as likely as anybody to hit something
broken. It opens a form rather than sending an email or leaving a comment
somewhere, so a report always carries the same shape and the same context.

Filing one asks for what a person actually knows — a short title, what
happened, optional steps to reproduce, how much it is in their way (*just a
little something*, *it's getting in my way*, *I can't get this done*), and
an optional screenshot. Everything else is captured from the click itself and
never typed in: which page they were on, the full URL, and their browser.

Triage is admin-only. There is no area for it — it is not one part of the
site to look after, it is the whole site, so it stays with whoever already
holds everything else. **Church Office → Bug Reports** lists every report,
filterable by status, each one opening to its full description, context and
screenshot, with a status to move it through:

| Status | Meaning |
|---|---|
| `open` | Filed, not yet looked at |
| `in_progress` | Somebody is working on it |
| `resolved` | Fixed |
| `wont_fix` | Looked at, staying as it is |

A status change tells the reporter through their own bell (see
[Notifications](#notifications) above) — carrying the new status and whatever
note the admin left, but never a link back to the triage page, since only an
admin can open it. Filing a report and changing its status both land in the
action history under `bug-reports`, the same as any other write.

Screenshots are stored content-addressed, the same approach as directory
photos (`server/lib/photoStore.js`) — but in their own directory
(`CAPSHAW_BUG_SCREENSHOT_DIR`, see [Environment Variables](#environment-variables)),
because the photo directory is pruned against the people the directory holds
pictures of, and a screenshot referenced by nothing there would not survive
the next sync.

---

## Personal Info & Worship Preferences

Every member can keep their own details current instead of asking an admin.
The **My Household** tab shows the person's directory entry, everyone else at
the same address, and each person's worship role preferences.

**Who may edit what**

| | Own entry | Own household | Anyone |
|---|---|---|---|
| `pending` | read-only | read-only | — |
| `approved` (Member) | ✅ | ✅ | — |
| Holds `directory` | ✅ | ✅ | ✅ (from **Church Office → Member Directory**) |
| `admin` | ✅ | ✅ | ✅ |

A *household* is everyone sharing a street address — the same grouping the
directory shows as a family. Someone with no address on file is a household of
one, so a blank address never pulls in strangers.

**Gender** is asked here because this congregation rosters the worship jobs
among its men. It is chosen by the person (or by the directory area on their
behalf), never guessed from a name, and "prefer not to say" is a real answer.

**Worship preferences** are per person, per role — `preferred` ("glad to"),
`willing`, or `unavailable` ("rather not") — with a free-text note for the
person building the schedule. Roles come from `server/lib/people.js` and match
the job names the scraper reads off the church website. The same rows are kept
from **Church Office → Service Roster** by whoever builds the schedule, for the
men who say it in person rather than typing it in; both screens go through
`server/lib/worship.js`, so neither can drift from the other's vocabulary.

**Linking an account to a person.** A login is matched to its directory entry
by email at sign-in, but only when exactly one entry matches — a shared family
email is never guessed at. Admins can set the link by hand from **Church
Office → Members & Access**; an existing link is never re-pointed
automatically. Until an account is linked, My Household explains that and
points the person at the church office.

**Edits survive re-scraping.** The scraper used to wipe the directory and
re-insert it every four hours. It now upserts by name, so row ids stay stable
(accounts and preferences hang off them), and any field edited by hand is
recorded in `directory.edited_fields` and skipped on future syncs. People the
website drops are removed only if they are pure scrape artifacts — never if
they were edited, linked to an account, or carry preferences.

> **Note on trust:** a member can change their own address, and doing so moves
> them into whatever household matches that address. Members are already
> trusted with congregation-wide content, so this is deliberate rather than a
> gap — but it is why the household rule keys on the *stored* address.

---

## Scraper

Data is pulled from capshawchurch.org on start-up and every four hours. Most
sections are replaced wholesale on each run; the directory is upserted (see
above) because accounts and worship preferences are keyed to its rows.

### Family photos

Photos come from the vCard export the directory sync already downloads
(`/members/directory/vcard`), so they cost no extra requests. All the common
vCard shapes are handled — `PHOTO;ENCODING=b`, `ENCODING=BASE64`, and a
vCard 4.0 `data:` URI.

Photos are written to `server/data/photos/` rather than into the database,
named by a hash of their content — so an unchanged photo is not rewritten and a
family sharing one portrait shares one file. Files nothing references are
pruned after each sync. They are served by
`GET /api/profile/person/:id/photo`, which applies the same visibility rule as
the rest of a profile: admins see anyone, members see their own household.
Only JPEG, PNG, GIF and WebP are stored (notably **not** SVG, which can carry
script).

A photo given only as a URL is counted but not downloaded — that would mean one
request per member. If the church site turns out to serve photos that way, the
Diagnose button reports how many, and downloading them is a small change.

### Diagnosing a section that looks empty

A parse that silently matches nothing looks exactly like a genuinely empty
page. **Church Office → Church Records → Scrape Status** has a **Diagnose** button on every
section: it re-fetches that page and reports the HTTP status, size, every table
it found with a preview of the first rows, and what the parser made of them.
It distinguishes:

- a login page coming back (scraper credentials rejected),
- a 404 (the feature is switched off on the church site),
- tables present but in a shape the parser does not recognise (site layout
  changed — the preview shows the new shape),
- and a page that genuinely has no data.

The same report is available directly at `GET /api/members/debug/:section`
(admin only) for `jobAssignments`, `attendance`, `sermons`, `visitors`,
`anniversaries`, `deacons` and `directory`. Besides every table on the page it
reports the page's **headings** and the **markup immediately above each
table** — the two things a parser keys on that a table dump alone cannot show.
A section whose tables look right while `parsed.count` is 0 is a question about
exactly that, and it was answerable only by guessing until the report carried
it.

### Job assignments

This table is rendered in more than one shape by the church site, so the parser
recognises a date header row, a date in the first column (blank on
continuation rows), and a standalone date row above its assignments. Rows whose
name is still blank are kept, so an unfilled slot is visible rather than
dropped.

### The visitor tracker

The tracker gives each guest a heading and then splits what it knows about them
under headings of its own — **Comments**, **Visit History** — each with a table
beneath it. Pairing every heading with the table after it therefore named each
guest after the section holding their dates, so the page listed guests called
"Visit History" and "Comments" and dropped the real names and the comments
entirely.

The tracker serves each guest as a card:

```
Pat Lane                     ← the name
Last on 09/13/26             ← a summary line
6617 Camilla Drive …         ← an address, beside an icon and no caption
(256) 777-4009               ← a phone number, likewise
Comments                     ← a section label
Just moved from Foley, AL
Visit History                ← a section label
<table of dates>
```

Only the section labels are headings, so the name has to be found some other
way. The parser tries three, taking the first that finds anybody:

1. **The last heading that is not a section label** — the shape the tracker
   documents, and the simpler *name then dates* shape.
2. **The page read in order** — a guest, then their sections — which is what
   the live card needs. Two things about that order matter, and each was a
   separate misreading first: what sits *closest* above a guest's dates is
   their comment, and the name is not the only line above them either. So text
   following a **Comments** label belongs to the guest named before it, and
   every candidate line between one guest's dates and the next's is collected
   and the one that reads like a person's name is chosen — never a line
   carrying a digit, which rules out the summary line, a date and a phone
   number. Section labels are recognised in whatever element the page writes
   them in, text *inside* a table is never a name, and the page's own furniture
   (Home, «, a page number) is ruled out.
3. **One table of everybody**, read by its column names.

The card's other values carry no captions — an icon, then the value — so each
is recognised by its own shape: an address from the map link the site wraps it
in (whose query is already *street, city, state zip*), an email from its
`mailto:`, a phone number by its digits, counting only text and never the path
data inside an icon.

The site's own furniture is ruled out four ways over, because each defence
alone lets another shape through and a menu item reads exactly like a person —
"Our Elders" is two capitalised words, the same shape as "Pat Lane":

- **Where it sits** — `<nav>`, `<footer>`, `<aside>`.
- **What it says** — a named list of the pages a church site has, plus the
  placeholder shown in place of a hidden address.
- **How a title is built** — nobody is called "Our" anything, and no surname is
  "Notes", "History" or "Directory". That rules out a site's sections without
  listing the ones this site happens to have.
- **Whether it is a link** — the menu sits above the first guest's card, so the
  two compete, and a guest's name is written in their card rather than as a
  link off to another page. A demotion rather than a refusal, so a page that
  does link a guest to their own record still reads.

Comments written as paragraphs rather than tables are read either way. Guests
that earlier readings invented are cleared up in two places: the ones named
after a section label ("Visit History", "Comments") on start-up, and on the
next scrape that reads guests properly, any name this parser would never
produce — a card's summary line, a menu link, a section of the site, the
address placeholder. That test is the parser's own, so the two cannot drift
apart.

**Kept means somebody typed something in**, which is the notes, who invited
them, their status, or a follow-up having reached them. The address, phone and
email are no longer part of that test: since the card's details started being
read from the tracker, a row can carry an address nobody ever typed, and a
misread row that picked one up was protected by it — which is how "About Us"
kept its place in the list after the parser had already stopped producing it.
A scrape that read nothing still tidies nothing.

### The tracker shows a slice, so the scrape works its controls

The page defaults to a date span and runs what is left onto further pages, so
fetching it as it arrives collects whichever guests the site felt like showing.
Both controls are read off the page rather than hard-coded, because a query
this site is not obliged to keep is not worth depending on:

- **The date span.** The dropdown's options are weighed — "All Time" beats
  "Last 5 Years" beats "Last 30 Days" — and the page is asked for again with
  the widest one, carrying the rest of the form with it. A dropdown that is not
  about dates is left alone, as is a filter submitted by POST, which cannot be
  asked for as a link and is not worth guessing at.
- **The pager.** Numbered links, a `rel="next"`, a "»". Each page's own pager
  is re-read as it arrives, so a pager that only ever shows a few numbers at a
  time is still followed to the end, and a link back to a page already fetched
  is not followed twice. A guest whose visits run across a page break is joined
  into one guest rather than replaced.

A page that will not load is a warning naming it, not a failed scrape: the
guests already read are kept, and saying some may be missing beats quietly
returning fewer than there are. `/api/members/debug/visitors` reports what the
controls resolved to, since neither is visible in a dump of the markup.

A guest's `comments`, and the address, phone and email on their card, are the
tracker's: they are replaced on every scrape that reads them, and a field the
tracker leaves blank keeps whatever was typed in here — an empty scrape is not
a correction. `notes`, `invited_by`, `status` and the follow-up history are
ours, exist nowhere on the church site, and nothing overwrites them. Comments
and notes are both shown, separately, on the guest's details.

**A page that loads but reads as nothing is now a warning.** A layout change
used to look exactly like a section that is genuinely empty: the previous rows
were kept and the scrape reported success. It now says
`visitors: the page loaded but nothing could be read from it`, which shows up
in Church Office → Church Records alongside the other scrape warnings.

---

## Workflows

Requests and approvals that need more than one person, tracked as a small state
machine per workflow. **My Church → My Inbox** shows an inbox of what is
waiting on you, the workflows you are involved in, and a flowchart of where
each one has got to.

### The engine

Definitions live in code (`server/workflows/definitions/`); only running
instances live in the database. A definition is steps, the actions each step
offers, and where each action leads:

```js
steps: {
  approve: {
    title: 'Approve',
    assign: { role: 'admin' },
    actions: [
      { id: 'apply',  label: 'Approve', to: 'done' },
      { id: 'reject', label: 'Send back', to: 'draft', requiresNote: true },
    ],
  },
}
```

`to` names the next step, or a terminal outcome, or is a function of the
instance data for conditional routing (an approval threshold, say) — declare
`possibleTo` alongside it so the flowchart can still draw both branches.

**Who gets asked.** A step's `assign` is one of `{ role }` — an area id such as
`serving-schedule`, or a rung on the role ladder, whichever the step names —
or `{ creator: true }` (whoever started it), `{ userField }`, or `{ personField }`
(a directory person, reached through their linked login). If a person has no
linked login the task falls back to the definition's `fallbackRole` rather than
stalling silently.

**Reaching the rest of the site.** An action may carry an `effect` that reads or
writes the site database — publishing the Monthly Worship Schedule writes the
draft to `job_assignments`. An effect that returns an error refuses the action
and rolls back, so a failed write never leaves the workflow half-advanced. A
workflow that touches nothing but its own data is equally fine.

**Dynamic form options.** A start field can declare `optionsFrom` and be filled
from live data, scoped to the person opening the form —
`linkedPeople` offers only directory people who actually have a login to reach.

### Who sees what

| | Inbox | Workflows they took part in | Everything |
|---|---|---|---|
| `pending` | — | read | — |
| `approved` (Member) | ✅ | ✅ | — |
| `admin` | ✅ | ✅ | ✅ |

Participation is earned by starting a workflow, being assigned a task on it, or
acting on it — and is never revoked, so the history stays readable to the people
who took part. A pending task aimed at a *role* is visible to everyone who could
pick it up, so shared queues are discoverable before anyone claims them. A
definition marked `visibility: 'restricted'` is limited to its participants even
for other roles, which is what a benevolence request would want.

### The flowchart

`client/src/lib/flowLayout.js` is a pure, dependency-free layered layout: rows
by longest path (so a step is never drawn above something that leads to it),
nodes ordered within a row to reduce crossings, and genuine loops routed through
the gap below their row and out to a lane on the right. Nodes are shaded for
where the instance is now, where it has already been, and which outcome it
reached.

### The seeded workflows

| Workflow | Shape it exercises |
|---|---|
| **Guest Follow-Up** | Started from the guest it is about, aimed at a named person, loops on "no answer", and closes the moment somebody reaches them. |
| **Monthly Worship Schedule** | Owned by the `serving-schedule` area; builds a draft from everyone's preferences and publishes it to the roster. |

Guest Follow-Up is reached from the Visitors page, behind a **Follow-ups**
button, so the guest list itself stays the guest list. The Monthly Worship
Schedule is started from **My Church → My Inbox** instead — it belongs to the
serving-schedule coordinator, not to any one page — and it is the only way a
slot on the roster is filled: preferences and time away are the only input,
there is no separate request to swap or claim a duty.

### Guest follow-ups

The guest follow-up is also started **from the guest it is about**: every guest
on the Guests page carries a **Follow up** button, which opens the same workflow
with that guest already chosen. The guest's own row then shows where it has got
to — *Follow-up in progress*, *Phoned by Ray Harris*, *Never reached* — so the
list answers "has anybody been in touch with them?" without opening anything.

The shape follows what actually happens:

1. Somebody is asked to reach out. The task carries the guest's **phone number
   and email address**, so whoever picks it up can act on it there and then;
   the guest's details panel offers the same two as `tel:` and `mailto:` links.
2. **Emailing or phoning them closes it.** There is no step afterwards asking
   whether the contact happened — pressing the button is saying that it did.
   The outcome is *Contacted*.
3. **No answer** brings it round for another try; **I cannot do this** hands it
   to whoever looks after the guests, who can reach out themselves or close it
   out as *Never reached*.

Reaching a guest writes back to their record — who, how and when — which is
what the badge on the list reads. The workflow's own history stays the record of
what happened, step by step, with who did what.

**The Guests page reads that history two ways.** The *Guests* tab is the list,
ordered by who was with us most recently — the question the page gets asked is
"who was here on Sunday", not "is Pat on here" — with a guest who has no visits
on record at the end rather than the top.

The *Follow-ups* tab is the same guests arranged by where their follow-up has
got to: **nobody has reached out**, **someone is on it**, **never reached**,
**reached**. Each card names the person — who is being waited on, or who
actually made contact and when — and opens its own follow-ups on record: every
round, what was pressed, and by whom. A count per state sits above them, so the
shape of the work is legible before any card is read, and the tab itself carries
the number nobody has reached out to yet, because that is work waiting rather
than work done.

Neither view is a lesser one. A card carries the same contact details as a list
row, the same **Follow up** button, and the same `tel:`/`mailto:` links, and
clicking it opens the same guest — details, comments, notes, visit history and
the follow-ups on record. A status colour never carries the meaning alone:
every badge says in words what it is.

A task aimed at an **area** (the guests, the serving schedule) emails the people
who hold that area. Admins hold every area implicitly but are deliberately not
mailed for each one, so an area task reaches the person who actually looks after
it; if nobody holds it yet, the admins are told rather than it waiting in a
queue nobody is watching.

### Adding a workflow

Drop a definition in `server/workflows/definitions/` and list it in that
folder's `index.js`. The inbox, the visibility rules, the API and the flowchart
all work off the definition alone. `validateDefinitions()` runs at start-up and
logs any action pointing at a step or outcome that does not exist.

---

## Livestreams

The **Livestreams** tab is the church's YouTube channel, newest first. There is
no API key: `server/lib/youtube.js` asks the channel page for its `UC…` id once,
then reads the public RSS feed YouTube publishes for every channel. The id is
kept for the life of the process and the feed for half an hour, so a page view
normally costs nothing.

If YouTube cannot be reached the page says so and still offers the channel
link — the tab never becomes an error screen. Set `YOUTUBE_CHANNEL` to point at
a different handle, or `YOUTUBE_CHANNEL_ID` to skip the lookup entirely.

---

## Weekly Newsletter

**Church Office → Weekly Newsletter** builds the congregation's newsletter for
one week and exports it as a `.docx` or a `.pdf`, laid out like the printed
one: a banner, a verse, a column of grey cards beside the prayer panel, then a
two-week duty roster with the leadership and contacts under it.

The page is in two halves, and the split is the whole idea.

**What the portal already knows** is queried live every time the newsletter is
built, so a correction on the page that owns it is a correction in the export:

| Section | Comes from |
|---|---|
| Reminders | Announcements — the dated events in the next 60 days, then the standing notices |
| Last Week's Data | Attendance — last week's Sunday morning worship and Wednesday counts |
| Anniversaries, Birthdays | Birthdays & Anniversaries |
| Duty Roster | Serving Schedule — this Sunday and next, and the Wednesday after each |
| Elders (with telephone numbers), Deacons (with their primary responsibility) | Elders & Deacons |
| Groups, Key Email Contacts | Email Groups |

**What nobody else keeps** is typed on the page and stored per week in
`bulletin_issues`: the prayer lists (Updates, Ongoing, Shut-Ins, Pregnancies,
Evangelists We Support), the verse, the offering and building totals, and who
leads each fellowship group. One entry to a line; a section left empty is left
out of the newsletter rather than printed as a bare heading.

Opening a week that has never been written offers the previous week's words to
edit rather than an empty box, and the page says so — nothing is saved until
somebody saves. Last week's collection is the one field a new week does not
inherit, since repeating it would report a number that was never counted.
Exporting saves first, so what is on the screen is what is in the file.

Reading a week is open to anybody signed in. Writing and exporting need the
`bulletin` area: an export goes out to the congregation under the church's
name, rather than being another view of records the portal already shows.

### Changing the parts that are not records

Both lists are ordered by surname, not by the name as typed — `ORDER BY name`
would open the deacons with Adam Mowrer. A deacon may look after several
things and the Elders & Deacons page lists them all; the newsletter has room
for one, so it prints the first, and takes the first of a line that packs
several together ('Treasurer & Finance / New Building'). What is left is
clipped at `deaconDutyMaxLength`.

The masthead, its banner artwork, the service times, the congregation's
evangelist, the website admins, the duty roster's job list, the reminder
window and the newsletter's palette are facts rather than records — nothing in
the portal edits them. They live in `server/lib/bulletinConfig.js`, which is
where to change the phone number or add a job to the roster. The banner itself
is `server/assets/masthead.jpg`, stored already lightened so the navy title
reads over it.

### Notes on the two files

Both renderers walk the same composed object, which is what keeps the two
files saying the same thing. The `.docx` is assembled as OOXML and zipped with
`jszip` (the same library `routes/documents.js` reads an uploaded one back
with); the `.pdf` is drawn with `pdfkit`, which is pure JavaScript and so
needs nothing added to the runtime image.

Three things about the layout are worth knowing before changing it:

- The printed newsletter positions its content in floating text boxes at fixed
  sizes. Word does not reflow between those, so a week with a longer prayer
  list would silently clip off the page. Every panel is a **table cell**
  instead, which looks the same and grows. The banner is the one thing still
  floated, because a masthead is a fixed-size decoration rather than content.

- A card's box is the **cell's** border, not its paragraphs'. Word will draw a
  box around a run of identically-bordered paragraphs, but some readers clip
  the left and right sides of a paragraph border at the cell edge, which left
  cards with a rule above and below and no sides.

- Nesting a table inside a cell makes Word re-fit the outer grid and throws the
  columns across the page, so there is none. **Neither is there a vertical
  merge**: spanning a cell down several rows is the obvious way to put one tall
  panel beside a stack of short ones, and Word renders it differently enough
  from every other reader to drop the merged cell's sides and bottom and to
  push the following page's content a page late — a newsletter with a blank
  second page. Every table is a single row, which is why page one's left column
  is one grey card divided by headings rather than three separate boxes, and
  why page two stacks the leadership across the width above the contacts.

Two quirks of the existing data also matter. The tables disagree about what a
date is — `MM/DD/YY` in the scraped attendance, `June 2025` plus `June 7`
across two columns of the job sheet, a bare month and day for the recurring
anniversaries, ISO from the announcement form — so
`server/lib/bulletinData.js` normalises everything to ISO and drops a row it
cannot read rather than guessing. And birthdays and anniversaries share one
table with no column saying which, while the newsletter prints them under
separate headings, so they are told apart by how the names read: a couple, or
a count of years, is an anniversary. The scraper rebuilds that table on every
sync, so the distinction cannot be stored on it.

---

## Email

Workflow notifications, account mail, and distribution groups. **Church Office →
Email Groups** manages who is on each list and shows what the site has recently
tried to send.

`server/mail/notify.js` turns workflow events into messages;
`server/mail/accounts.js` handles the four about accounts themselves — the
confirmation link, the note to somebody who already has an account, the "waiting
for approval" nudge to the admins, and the "your account is ready" to the person.

> **Registration needs working mail.** The confirmation link only reaches people
> once `SMTP_HOST` is set and `MAIL_REDIRECT_TO` is cleared. Until then the
> messages sit in the outbox — nothing is lost, but nobody can finish
> registering, so an admin has to read the link out of `mail_outbox` or invite
> people through Google or Facebook instead.

### Test mode is the default

While `MAIL_REDIRECT_TO` is set, **every** message is delivered to that one
address instead of its real recipient, with the intended recipient recorded on
the row and stated at the top of the body. It defaults to
`jblairkiel@gmail.com`, so real delivery has to be opted into rather than
avoided — a mistake in a workflow, a group, or a test cannot mail the
congregation. Clearing `MAIL_REDIRECT_TO` is the single explicit step that lets
this site write to real people.

| Variable | Effect |
|---|---|
| `MAIL_REDIRECT_TO` | Everything goes here instead of the real recipient. Defaults to `jblairkiel@gmail.com`. **Clear it to send for real.** |
| `SMTP_HOST` / `SMTP_PORT` | Mail server. With no host, messages queue but are not sent — nothing is lost. |
| `SMTP_USER` / `SMTP_PASS` | Credentials, if the server needs them. |
| `MAIL_FROM` | The From address. |

### The outbox

Messages are queued in `mail_outbox` and sent from there, so a slow or
unreachable mail server never blocks the request that caused it, and there is a
record of what the site tried to send. Queueing happens *inside* the database
transaction that caused it and sending happens *after* it commits — so an
action that fails and rolls back sends nothing at all. Failures are retried up
to three times, then marked failed with the error kept. A sweep every five
minutes picks up anything queued while mail was down.

### Distribution groups

Seeded with **elders, deacons, men, women, announcements** and **groups 1–6**,
each starting empty. A member is either a directory person — so their address
follows the directory, and correcting it there fixes every group they are in —
or a plain address for somebody not in the directory. Anyone with no address on
file is reported rather than silently skipped, so a gap in the directory does
not look like a delivery that worked. Somebody in three groups still receives
one copy.

> **A group is a list this site sends to, not a mailbox.** An address people can
> write *to* — `elders@capshawchurch.org` — has to be created with your mail
> provider (Google Workspace, your host's control panel), which no application
> can do for you. Once such an alias exists you can also just add it to the
> relevant group here as a plain address.

### What gets sent

- **A task lands on you** — the person named, or everyone holding the role the
  task is waiting on. Role mail goes only to people holding *exactly* that role,
  so a member-level task never mails the whole congregation.
- **A workflow finishes** — the person who started it, plus any distribution
  group the outcome names. An outcome copies a list by naming it:
  `notifyGroups: ['announcements']`.
- **A group's meeting is posted** — the group's distribution list, which is its
  roll mirrored. Cancelling tells the same list; changing the details of a
  posted meeting tells only the people who said they were coming, because
  telling a whole group about a meeting they never answered is how a list gets
  muted.

---

## Monthly Worship Schedule

A workflow that builds a month of worship assignments from the preferences
people set on My Household, owned by the **`serving-schedule`** area. (The
Serving Schedule page can also lay out an empty month directly — see
[Serving Schedule](#serving-schedule). This workflow is the version that fills
the names in for you.)

### How a month is built

`server/workflows/scheduling.js` is pure and deterministic — the same month and
preferences always give the same schedule. Its rules, in order:

1. Never schedule somebody who marked themselves **unavailable** for that role,
   or who has blocked that day out as [time away](#time-away).
2. Never schedule the same person twice in one service.
3. **Spread the load** — whoever has had the fewest turns goes next.
4. On equal turns, someone who said they are *glad to* goes ahead of someone
   merely *willing*.
5. Any remaining tie breaks by name, so the result is stable.

Load deliberately beats keenness. Ordering by keenness first would hand the one
eager song leader every Sunday in the month while a willing volunteer sat idle,
which is not what anybody would do by hand.

A role nobody can cover is **reported as unfilled** rather than left quietly
blank, since an empty slot is the thing the schedule keeper most needs to see
— and, with no self sign-up, filling it by hand is the only way it gets one.

### Running it

Start it from Workflows, choose a month and which services to fill, and a draft
appears as a table on the workflow screen. From there:

- **Try a different draft** regenerates — a different but equally fair split.
- **Publish to the roster** writes it and sends the emails.
- **Abandon** closes it, having written nothing.

Nothing reaches `job_assignments` until publish, so a draft can be regenerated
freely. Publishing replaces only its own month, so publishing June never
disturbs May, and publishing twice does not double it up.

### Who hears about it

- **Everyone given a turn** gets their own assignments — just theirs, not the
  whole month — with a reminder that taking themselves off a slot on the
  Serving Schedule, if they cannot make one, leaves it for the coordinator to
  fill. Addresses come from matching the roster name back to the directory;
  anyone who cannot be matched is recorded on the workflow rather than
  dropped in silence.
- **The whole month** goes to every user who has not opted out. Everyone is
  opted in by default (`users.wants_monthly_report`); the toggle is on **My
  Info → Email**, and turning it off does not stop the emails about jobs you
  are personally given.

---

## Sample Data

**Admin → Database → Sample Data** fills the site with made-up records so a page
can be looked at with something in it — a directory with households, a month of
serving jobs, what each man will volunteer for, guests with visit histories and
follow-ups in each state, church groups with rolls and a meeting each, the
answers and sign-ups that meeting collects, and the replies under it.

Sample answers, sign-ups and replies are attributed to **directory people**,
never to accounts — a made-up sign-in is not sample data, it is a way in. That
is why an answer belongs to a person rather than to an account (see
[Church Groups](#church-groups)): it is the same shape a leader writes down for
somebody who never signs in. The sign-up lists are deliberately left
part-covered, because a list with something still wanted on it is what the page
has to render well and a full one never shows it.

The hard part is not making it. It is getting it back out.

**Every row is written down as it is made.** A generator has no database of its
own: it is handed an `insert`, and that insert records the table and the id it
just created in the same breath. Removing a batch reads that list back and
deletes exactly those rows. Nothing anywhere recognises made-up data by how it
looks — guessing ("names that look fake", "anything created today") is how
somebody's real record ends up deleted.

So a batch can promise two things, and the tests hold it to both: everything it
made is gone, and nothing else moved.

| | |
|---|---|
| **What it fills** | Tick the parts of the site you want, or nothing to fill all of them |
| **How much** | A little (see each page working), a fair bit, or a lot (find out what gets slow) |
| **What is there now** | Each batch, when it was made, who asked for it, and the rows it put in each table |
| **Removing it** | One button per batch, asked about first, and reported afterwards |

Both making and removing a batch are written to the action history, because
putting a few hundred rows into the congregation's records is a change worth
being able to trace even when it is meant to be temporary.

### Adding sample data for something new

Put a file in `server/seed/generators/`. They are found by reading the
directory, so nothing has to be told about it:

```js
module.exports = {
  id:    'lending-library',
  label: 'Lending Library',
  area:  'library',
  page:  'Library',                  // where it shows up, for the panel
  describe: 'Books on the shelf, and who has borrowed them.',
  tables: ['library_books', 'library_loans'],   // what it claims to fill
  generate({ insert, random, scale, db, helpers }) {
    const id = insert('library_books', { title: 'Sample Title' }, 'Sample Title');
    insert('library_loans', { book_id: id, borrower: 'Wren Ashdown' }, 'on loan');
  },
};
```

`insert(table, values, label)` is the only way to write, and it tracks what it
wrote. `random` is seeded from the batch id, so the same batch makes the same
data twice — useful when a screen renders oddly and the batch that did it has
already been removed. `scale` is 1, 3 or 6 and each generator reads it as it
sees fit.

**The coverage test is what keeps this from falling behind the site.**
`server/tests/seed.test.js` fails when a table in the schema is in neither a
generator's `tables` nor `NOT_FILLED`. A feature that adds a table therefore
cannot arrive without somebody deciding whether sample data should fill it —
and answering "no" is fine, as long as the reason is written down:

```js
const NOT_FILLED = {
  users:      'Accounts. Made-up sign-ins are not sample data, they are a way in.',
  action_log: 'Append-only, and the record of what really happened.',
  // …
};
```

The same test also checks that a generator writes to every table it claims, so
a claim cannot quietly stop being true while still counting as covered.

**Sample data has to speak the site's own vocabulary**, too. A generator that
writes `song-leader` where the site says `Song Leader` fills the table and
leaves the screen looking empty, because every page renders only the roles it
knows — so a generator reads its vocabulary from the module that owns it
(`server/lib/people.js` for worship roles and preference levels,
`server/workflows/scheduling.js` for the services in a month) rather than
keeping a list of its own, and `seed.test.js` checks what came out.

## Tests

```bash
# Server tests (Jest)
npm test

# Client tests (Vitest)
npm run test:client
```

Server tests live in `server/tests/`. Client tests live in `client/src/tests/`.

---

## Project Structure

```
capshaw-dashboard/
├── client/                  # Vite + React frontend
│   └── src/
│       ├── App.jsx          # Tab routing + top-level layout
│       ├── components/      # One file per tab/feature
│       └── index.css        # Tailwind + custom theme utilities
├── server/
│   ├── index.js             # Express entry point
│   ├── db.js                # SQLite init (question library)
│   ├── schema.js            # The whole schema, plus its migrations
│   ├── middleware/
│   │   ├── auth.js          # Roles (a ladder) and areas (not one)
│   │   └── impersonation.js # An admin borrowing a member's view of the site
│   ├── lib/
│   │   ├── parsers.js       # HTML parser functions (testable)
│   │   ├── areas.js         # The catalogue of areas, and who holds what
│   │   ├── actionLog.js     # The action history recorder
│   │   ├── worship.js       # Worship role preferences: reading, checking, saving
│   │   ├── recordTables.js  # Which table each area looks after
│   │   ├── recordStore.js   # Reading and writing those tables, logged
│   │   ├── churchGroups.js  # The groups, their rolls, and generating a set
│   │   ├── groupEvents.js   # A group's meetings, invitations and sign-ups
│   │   ├── eventComments.js # One thread per event, whatever kind of event
│   │   └── notifications.js # What somebody has not seen yet
│   ├── routes/
│   │   ├── scraper.js       # Church website scraper + data endpoints
│   │   ├── records.js       # Area-gated CRUD for the record tables
│   │   ├── serving.js       # The roster, preferences, and time away — filled by hand or the workflow
│   │   ├── visitors.js      # Guests, their details and their visits
│   │   ├── leadership.js    # Elders and deacons, with their duties
│   │   ├── groups.js        # Church groups, their rolls and their meetings
│   │   ├── comments.js      # Comments on any kind of event
│   │   ├── notifications.js # One account's bell, and only ever its own
│   │   ├── documents.js     # .docx upload + OOXML → HTML conversion
│   │   └── bibleClass.js    # Question generation + library CRUD
│   ├── data/                # Runtime data (gitignored)
│   │   ├── members.json     # Scraped church data cache
│   │   └── bible_questions.db  # SQLite question library
│   └── uploads/             # Temporary uploaded .docx files
├── Dockerfile               # Three-stage build: client, deps, runtime
├── docker-compose.yml       # The app and its data volume
├── .dockerignore            # What never enters the build context
├── .env.example             # What a deployment has to fill in
├── ecosystem.config.js      # PM2 production config
├── .github/workflows/
│   └── ci-cd.yml            # Test + deploy pipeline
└── package.json
```

---

## Running in Docker

The whole portal — API, React build and SQLite database — runs as one
container. This is the easier path onto a new host: nothing to install but
Docker, no Node version to match, and no native module compiled against the
wrong ABI.

```bash
cp .env.example .env          # fill in at least SESSION_SECRET
docker compose up -d --build
```

That is the deployment. `docker compose logs -f` follows it, `docker compose
down` stops it, and `docker compose up -d --build` after a `git pull` is an
upgrade.

### What is in the image

Three build stages, so what ships carries neither a compiler nor a source tree:

| Stage | Does |
|---|---|
| `client` | `npm ci` and `npm run build` for the React app |
| `deps` | Installs the server's production dependencies, with the toolchain `better-sqlite3` needs if it has to compile |
| `runtime` | Copies out `node_modules`, `server/` and the built client. No toolchain, no tests, no source for the client |

Every stage uses the same base image on purpose. `better-sqlite3` is a native
addon, and a binary built against a different Node or a different libc loads
happily and then aborts the process from a statement destructor during garbage
collection — the failure the SSH deploy has to test for by hand. In the image
the addon is built against the same Node that runs it, and the build proves it
survives being used and collected before the image is finished.

The container runs as the unprivileged `node` user, and `docker compose`
passes `--init` so signals reach Node and zombies are reaped. That is all the
process manager was doing here, so there is none inside the container.

### Data

Everything the app writes lives under `/data`, which the compose file mounts a
named volume over:

| | |
|---|---|
| `/data/bible_questions.db` | The database — accounts, records, the action history |
| `/data/photos` | Family photos from the directory sync |
| `/data/members.json` | The cached copy of the last scrape |
| `/data/uploads` | Uploaded orders of service |

**This volume is the backup.** Nothing else on the host holds congregation
data, and an image never contains any of it.

```bash
# Back it up
docker run --rm -v capshaw-dashboard_capshaw-data:/data -v "$PWD":/backup \
  busybox tar czf /backup/capshaw-data.tar.gz -C /data .
```

Outside a container the app writes to `server/data` and `server/uploads`
exactly as it always has. `CAPSHAW_DATA_DIR` moves the database, photos and
scrape cache together; `CAPSHAW_UPLOAD_DIR` moves the uploads. See
`server/lib/paths.js`.

### In front of it

The container publishes on `127.0.0.1:3001` and expects something in front of
it terminating TLS — the existing nginx does exactly this, unchanged. Two
things that proxy must do, or sign-in silently fails:

- Pass `X-Forwarded-Proto`, since the session cookie is `secure` in production
  and the app trusts the proxy to say whether the request arrived over HTTPS.
- Send an `Origin` (or `Referer`) header on API requests: any mutating request
  from an origin outside the allowed list is refused before it reaches a route.

### CI builds it on every change

The **Container image** job builds the image and then runs it: waits for the
health check, asks for the health endpoint, the React build and an
unauthenticated API call (which must be refused), and checks the database
landed on the volume and the process is not root. A Dockerfile nothing builds
is one that has quietly stopped working.

### And deploys what it built

The image the deploy runs is the one CI exercised — published to
`ghcr.io/jblairkiel/capshaw-dashboard` only **after** it has started, reported
healthy, served a request and been checked for writing to its volume. The
droplet pulls that exact commit tag rather than rebuilding it:

```
CAPSHAW_IMAGE=ghcr.io/jblairkiel/capshaw-dashboard:<sha>
docker compose pull app && docker compose up -d --no-build app
```

Nothing is built on the droplet any more. A deploy is a pull and a restart, so
it takes seconds instead of minutes and cannot fail halfway through an `npm ci`
on a box with less memory than the runner.

**A deploy that does not come up healthy rolls itself back.** The job records
the image that was serving before it started, waits for Docker's own health
check on the new container, and on failure prints the logs, brings the previous
image back up and fails the job. A rolled-back deploy is a red build, not a
quiet one.

### Moving an existing droplet from PM2 to the container

The application is already containerised; what has to move is the data. It
lives under `server/` on the droplet and belongs in the volume.

**First, install Docker** — a droplet set up for the PM2 deployment does not
have it, and the deploy says so rather than failing obscurely:

```bash
# Docker Engine and the compose plugin, from Docker's own repository
curl -fsSL https://get.docker.com | sudo sh

# So the deploy user can run docker without sudo. Log out and back in after.
sudo usermod -aG docker "$USER"

# Check, in a new session
docker run --rm hello-world
docker compose version
```

The deploy connects as `DO_USER`, so it is that account that needs to be in the
`docker` group.

**This is the one step that touches the congregation's records, so it stops the
app first.** Copying a SQLite database while something is writing to it is how
you get a file that opens fine and is subtly wrong.

```bash
cd /var/www/capshaw-dashboard
git pull origin main

# 1. Back up first. This is the only copy of the action history.
tar czf ~/capshaw-backup-$(date +%F).tar.gz server/data server/uploads .env

# 2. Stop the old app, so nothing is mid-write. (A stop lasts until the next
#    reboot or `pm2 resurrect`; the delete at the end of this section is what
#    stops it coming back and taking port 3001 from the container.)
pm2 stop capshaw-dashboard

# 3. Let the droplet pull from the registry (read:packages is enough).
echo "$GHCR_TOKEN" | docker login ghcr.io -u jblairkiel --password-stdin

# 4. Create the volume and copy the four things that outlive a request into it:
#    the database, the photos, the cached scrape, and the uploaded orders of
#    service. Uploads move under /data/uploads — see server/lib/paths.js.
docker volume create capshaw-data
docker run --rm \
  -v capshaw-data:/data \
  -v /var/www/capshaw-dashboard/server:/src:ro \
  node:22-bookworm-slim sh -c '
    cp -a /src/data/. /data/ &&
    mkdir -p /data/uploads &&
    if [ -d /src/uploads ]; then cp -a /src/uploads/. /data/uploads/; fi &&
    chown -R 1000:1000 /data &&
    ls -la /data'

# 5. Start the container on the last image CI published.
export CAPSHAW_IMAGE=ghcr.io/jblairkiel/capshaw-dashboard:main
docker compose pull app
docker compose up -d --no-build app

# 6. Check it came up, and that it is your data and not an empty database.
docker compose ps
curl -fsS http://127.0.0.1:3001/api/health
```

Sign in and confirm the directory, the guests and the action history are all
there. nginx needs no change: the container publishes the same
`127.0.0.1:3001` the PM2 process did.

Once you are satisfied, stop PM2 from coming back on reboot:

```bash
pm2 delete capshaw-dashboard && pm2 save
```

**Going back**, if something about the droplet surprises you:

```bash
docker compose down
pm2 start ecosystem.config.js --env production
```

`ecosystem.config.js` and the PM2 setup are deliberately still in the
repository, and the old data under `server/` is left where it was by the copy
above — the migration reads it, it does not move it. So the way back is two
commands and a revert of the deploy job, for as long as you want to keep that
option.

### When the deploy stops on the droplet

These failures come from the host rather than from the code, and the deploy
names each one rather than failing part-way through:

| What the log says | What to do on the droplet |
|---|---|
| `Docker is not installed on this host` | The install above, once |
| `the compose plugin is not` installed | `sudo apt-get install docker-compose-plugin` |
| `this user cannot reach it` | `sudo usermod -aG docker "$USER"`, then a new login session |
| `Could not update the checkout` | `sudo chown -R "$USER:$USER" /var/www/capshaw-dashboard` |
| `address already in use` on 3001 | Nothing, usually — the deploy stops PM2 itself. `pm2 delete capshaw-dashboard && pm2 save` retires it for good |

The port one is the other tail of the migration, and the deploy now handles it
rather than reporting it. PM2 does not stay stopped: `pm2 stop` lasts until the
next reboot or `pm2 resurrect`, and the process binds `127.0.0.1:3001` the
moment a container releases it — so a deploy that recreates its container finds
the port taken. Each deploy therefore stops PM2 before it starts the container,
and starts it again if nothing came up, so a failed deploy does not leave the
site dark. It stops PM2, it never deletes it: the way back has to stay open.

That leaves one thing worth doing by hand, once, so a reboot stops resurrecting
a process the deploy will only have to stop again:

```bash
pm2 delete capshaw-dashboard && pm2 save
```

`ss -ltnp | grep 3001` says who holds the port, and the deploy prints that
itself when a container will not start.

The checkout one is the tail of the migration too: running any of the steps above with
`sudo git ...` leaves part of `/var/www/capshaw-dashboard` owned by root, and
git will not read a repository owned by somebody else. The deploy marks the
directory trusted for the deploy user itself, so this only remains a problem if
the files are also unwritable by that user — which the `chown` fixes.

### What the deploy needs from you

| Secret | What it is |
|---|---|
| `DO_HOST` / `DO_USER` / `DO_SSH_KEY` | The droplet, as before |
| `GHCR_USER` | Your GitHub username, for the droplet's `docker login` |
| `GHCR_TOKEN` | A classic personal access token with **`read:packages`** only. The droplet pulls with it; it never pushes |

The publishing side needs nothing set up: the image job signs in with the
`GITHUB_TOKEN` that Actions already provides.

---

## Production Deployment

### First-time server setup

These steps only need to be done once on the DigitalOcean droplet.

> These are the PM2 instructions the droplet was first built with. A new
> installation should follow [Running in Docker](#running-in-docker) instead —
> the app is deployed as a container now, and none of the Node toolchain below
> is needed on the host.

```bash
# On the droplet
sudo apt update && sudo apt install -y nodejs npm nginx certbot python3-certbot-nginx
sudo npm install -g pm2

# Clone repo
sudo mkdir -p /var/www/capshaw-dashboard
sudo chown $USER /var/www/capshaw-dashboard
git clone git@github.com:jblairkiel/capshaw-dashboard.git /var/www/capshaw-dashboard
cd /var/www/capshaw-dashboard

# Install deps + build
npm ci --omit=dev
cd client && npm ci && npm run build && cd ..

# Create .env
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env
echo "NODE_ENV=production" >> .env

# Start with PM2
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup   # follow the printed command to enable auto-start on reboot
```

**nginx config** (`/etc/nginx/sites-available/capshaw`):

```nginx
server {
    server_name capshaw.jblairkiel.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/capshaw /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# SSL
sudo certbot --nginx -d capshaw.jblairkiel.com
```

### CI/CD (automatic deploys)

> **The deploy now ships a container.** A push to `main` builds the image,
> exercises it, publishes it and tells the droplet to pull it — see
> [Running in Docker](#running-in-docker). The PM2 setup below is what the
> droplet ran before, and is kept as the way back.

Every push to `main` triggers the GitHub Actions pipeline:

1. **Test job** — runs Jest (server) and Vitest (client) on Node 20
2. **Deploy job** (only on `main` push, only if tests pass) — SSHs into the droplet and runs:
   - `git pull origin main`
   - `npm ci --omit=dev`
   - `cd client && npm ci && npm run build`
   - `pm2 restart ecosystem.config.js --env production`

#### Required GitHub Secrets

| Secret | Value |
|---|---|
| `DO_HOST` | Droplet IP or hostname |
| `DO_USER` | SSH username (e.g. `root`) |
| `DO_SSH_KEY` | Full private key content (ed25519 recommended) |

To generate a deploy key:

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/capshaw_deploy
# Add public key to droplet:
cat ~/.ssh/capshaw_deploy.pub >> ~/.ssh/authorized_keys
# Paste contents of ~/.ssh/capshaw_deploy into the DO_SSH_KEY GitHub secret
```

### Manual deploy (emergency)

```bash
ssh user@your-droplet
cd /var/www/capshaw-dashboard
git pull origin main
npm ci --omit=dev
cd client && npm ci && npm run build && cd ..
pm2 restart capshaw-dashboard
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes (for Bible Class tab) | Anthropic API key for question generation |
| `ADMIN_EMAIL` | Recommended | Email of the owner account — promoted to admin on every login |
| `MAIL_REDIRECT_TO` | No | Redirects all outgoing mail to one address. Defaults to `jblairkiel@gmail.com`; clear it to send for real |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | For email | Mail server. Unset means messages queue but are not sent |
| `MAIL_FROM` | No | From address on outgoing mail |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | For Google sign-in | Google OAuth credentials |
| `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` | For Facebook sign-in | Facebook OAuth credentials |
| `YOUTUBE_CHANNEL` | No | Channel handle for the Livestreams tab (default `@CapshawChurch`) |
| `YOUTUBE_CHANNEL_ID` | No | Skips the handle lookup by giving the `UC…` channel id outright |
| `NODE_ENV` | Production only | Set to `production` to serve the React build |
| `PORT` | No | API port (default `3001`) |
| `SESSION_SECRET` | **Yes in production** | Signs the session cookie. The app refuses to start in production without it rather than using the development fallback |
| `CAPSHAW_DATA_DIR` | No | Moves the database, photos, scrape cache and bug-report screenshots together (default `server/data`). The image sets it to `/data` |
| `CAPSHAW_UPLOAD_DIR` | No | Where uploaded orders of service go (default `server/uploads`) |
| `CAPSHAW_DB_FILE` / `CAPSHAW_PHOTO_DIR` / `CAPSHAW_DATA_FILE` / `CAPSHAW_BUG_SCREENSHOT_DIR` | No | Move one of those on its own, overriding `CAPSHAW_DATA_DIR` |
