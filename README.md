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
| Process manager | PM2 (production) |
| CI/CD | GitHub Actions → DigitalOcean via SSH |

---

## Local Development

### Prerequisites

- Node.js 20+
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

## Roles & Permissions

Every signed-in user holds exactly one of three roles. They are ranked, so each
role includes everything below it.

| Role | Can do |
|---|---|
| `pending` | Waiting on an admin. An account registered with an email address and password cannot sign in at all while it is `pending`; one that came from Google or Facebook can look around the portal but cannot create or edit anything. |
| `approved` (Member) | Everything a pending user sees, plus: Bible class questions, the lesson planner, site updates, and editing their own household's details and worship preferences. |
| `worship-coordinator` | Everything a member can do, plus building the worship roster — they own the Monthly Worship Schedule workflow. |
| `admin` | Everything above, plus writing announcements, the song tracker and the order of service, and the Church Office tabs — member access, the member directory, and direct editing of every database table. |

Read and write are separate: **announcements, the song tracker and the order of
service are read-only for members** — everyone can see them, only admins can
change them.

| Feature | Member | Admin |
|---|---|---|
| Announcements | read | read + write |
| Song Tracker | read | read + write |
| Order of Service | read | read + write |
| Bible Class & Lesson Planner | read + write | read + write |
| My Household (own household) | read + write | read + write (anyone) |
| Site update (re-scrape) | ✅ | ✅ |
| Member Directory, Church Records, Members & Access | — | ✅ |

New sign-ins land on `pending`. An admin lets them in from **Church Office →
Members & Access**, with the **Approve** button in the grid or from the
person's detail panel.

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
address — always as a suggestion to check, never as an assumption. A role above
plain member can be handed out in the same step, and the approval records who
did it and when (`approved_by`, `approved_at`). The person is emailed as soon
as it is done.

**The members grid.** Accounts are listed in a sortable, filterable grid. Every
column carries its own filter — free text for names, emails, directory links
and dates, a picker for role and sign-in provider — and the filters combine.
Clicking a row (or its **Manage** button) opens a detail panel holding
everything you can do to that account: assign a role, link it to a directory
entry, or remove it. The **Columns** menu chooses which columns are shown — including **Confirmed**, which says whether an
email-and-password account has answered its confirmation email — and
remembers the choice in a cookie (`capshaw.users.columns`, a preference only —
no account data), so the grid comes back the way it was left. Columns the build
no longer has are dropped when the cookie is read, and the name column is always
shown.

Roles are enforced on the server by `server/middleware/auth.js`:
`requireApproved` guards the member routes (Bible class, lesson planner, site
update, profile edits), `requireAdmin` guards announcements, songs, documents,
`/api/admin/*` (the database editor) and user management. The client mirrors
the same ranks in `client/src/lib/roles.js` purely to decide what to show — the
server is always the authority.

Three guardrails keep an admin from locking everyone out:

- You cannot change or delete your own role.
- The last remaining admin cannot be demoted or removed.
- The account named by `ADMIN_EMAIL` is the owner; it is promoted to admin on
  every login and its role cannot be edited.

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
| `admin` | ✅ | ✅ | ✅ (from **Church Office → Member Directory**) |

A *household* is everyone sharing a street address — the same grouping the
directory shows as a family. Someone with no address on file is a household of
one, so a blank address never pulls in strangers.

**Worship preferences** are per person, per role — `preferred` ("glad to"),
`willing`, or `unavailable` ("rather not") — with a free-text note for the
person building the schedule. Roles come from `server/lib/people.js` and match
the job names the scraper reads off the church website.

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
`anniversaries`, `deacons` and `directory`.

### Job assignments

This table is rendered in more than one shape by the church site, so the parser
recognises a date header row, a date in the first column (blank on
continuation rows), and a standalone date row above its assignments. Rows whose
name is still blank are kept, so an unfilled slot is visible rather than
dropped.

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
    title: 'Approve and update the roster',
    assign: { role: 'admin' },
    actions: [
      { id: 'apply',  label: 'Approve', to: 'covered' },
      { id: 'reject', label: 'Not suitable', to: 'find-replacement', requiresNote: true },
    ],
  },
}
```

`to` names the next step, or a terminal outcome, or is a function of the
instance data for conditional routing (an approval threshold, say) — declare
`possibleTo` alongside it so the flowchart can still draw both branches.

**Who gets asked.** A step's `assign` is one of `{ role }` (anyone holding it),
`{ creator: true }` (whoever started it), `{ userField }`, or `{ personField }`
(a directory person, reached through their linked login). If a person has no
linked login the task falls back to the definition's `fallbackRole` rather than
stalling silently.

**Reaching the rest of the site.** An action may carry an `effect` that reads or
writes the site database — the job swap updates `job_assignments` on approval.
An effect that returns an error refuses the action and rolls back, so a failed
write never leaves the workflow half-advanced. A workflow that touches nothing
but its own data is equally fine.

**Dynamic form options.** A start field can declare `optionsFrom` and be filled
from live data, scoped to the person opening the form —
`myAssignments` offers only the duties you are actually rostered for.

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
| **Job Assignment Swap** | Starts from a duty you are really rostered for, loops while a replacement is found, writes the new name to `job_assignments` on approval. |
| **Visitor Follow-Up** | Task aimed at a named person, loops on "no answer", hands off to an admin if they decline. |
| **Monthly Worship Schedule** | Owned by the worship coordinator; builds a draft from everyone's preferences and publishes it to the roster. |

Each one is reached from the page it belongs to, behind a **Roster requests** or
**Follow-ups** button at the top of that page, so the page itself stays the
roster or the guest list.

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

---

## Monthly Worship Schedule

A workflow that builds a month of worship assignments from the preferences
people set on My Household, owned by the **worship coordinator** role.

### How a month is built

`server/workflows/scheduling.js` is pure and deterministic — the same month and
preferences always give the same schedule. Its rules, in order:

1. Never schedule somebody who marked themselves **unavailable** for that role.
2. Never schedule the same person twice in one service.
3. **Spread the load** — whoever has had the fewest turns goes next.
4. On equal turns, someone who said they are *glad to* goes ahead of someone
   merely *willing*.
5. Any remaining tie breaks by name, so the result is stable.

Load deliberately beats keenness. Ordering by keenness first would hand the one
eager song leader every Sunday in the month while a willing volunteer sat idle,
which is not what a coordinator would do by hand.

A role nobody can cover is **reported as unfilled** rather than left quietly
blank, since an empty slot is the thing a coordinator most needs to see.

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
  whole month — with a pointer to the Job Assignment Swap workflow if they
  cannot make one. Addresses come from matching the roster name back to the
  directory; anyone who cannot be matched is recorded on the workflow rather
  than dropped in silence.
- **The whole month** goes to every user who has not opted out. Everyone is
  opted in by default (`users.wants_monthly_report`); the toggle is on **My
  Info → Email**, and turning it off does not stop the emails about jobs you
  are personally given.

---

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
│   ├── lib/
│   │   └── parsers.js       # HTML parser functions (testable)
│   ├── routes/
│   │   ├── scraper.js       # Church website scraper + data endpoints
│   │   ├── documents.js     # .docx upload + OOXML → HTML conversion
│   │   └── bibleClass.js    # Question generation + library CRUD
│   ├── data/                # Runtime data (gitignored)
│   │   ├── members.json     # Scraped church data cache
│   │   └── bible_questions.db  # SQLite question library
│   └── uploads/             # Temporary uploaded .docx files
├── ecosystem.config.js      # PM2 production config
├── .github/workflows/
│   └── ci-cd.yml            # Test + deploy pipeline
└── package.json
```

---

## Production Deployment

### First-time server setup

These steps only need to be done once on the DigitalOcean droplet.

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
