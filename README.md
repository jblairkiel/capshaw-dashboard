# Capshaw Dashboard

Internal dashboard for Capshaw Church of Christ. Displays job assignments, attendance, sermons, anniversaries, leadership, and Bible class tools — all pulled from the church website.

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

On first start the server will attempt to scrape the church website. It re-scrapes automatically every 4 hours. Scraped data is cached to `server/data/members.json` (gitignored). The scraper requires valid church website credentials — without them the dashboard tabs that depend on scraped data will be empty.

See [Scraper](#scraper-1) below for family photos and for diagnosing a section that comes back empty.

---

## Roles & Permissions

Every signed-in user holds exactly one of three roles. They are ranked, so each
role includes everything below it.

| Role | Can do |
|---|---|
| `pending` | View the dashboard. Cannot create or edit anything. |
| `approved` (Member) | Everything a pending user sees, plus: Bible class questions, the lesson planner, site updates, and editing their own household's details and worship preferences. |
| `worship-coordinator` | Everything a member can do, plus building the worship roster — they own the Monthly Worship Schedule workflow. |
| `admin` | Everything above, plus writing announcements, the song tracker and the order of service, and the Admin tabs — user roles, the congregation directory, and direct editing of every database table. |

Read and write are separate: **announcements, the song tracker and the order of
service are read-only for members** — everyone can see them, only admins can
change them.

| Feature | Member | Admin |
|---|---|---|
| Announcements | read | read + write |
| Song Tracker | read | read + write |
| Order of Service | read | read + write |
| Bible Class & Lesson Planner | read + write | read + write |
| My Info (own household) | read + write | read + write (anyone) |
| Site update (re-scrape) | ✅ | ✅ |
| Directory, Database, User roles | — | ✅ |

New sign-ins land on `pending`. An admin promotes them from **Admin → Users &
Roles**, either with the one-click **Approve** button or the per-user role
selector.

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
The **My Info** tab shows the person's directory entry, everyone else at the
same address, and each person's worship role preferences.

**Who may edit what**

| | Own entry | Own household | Anyone |
|---|---|---|---|
| `pending` | read-only | read-only | — |
| `approved` (Member) | ✅ | ✅ | — |
| `admin` | ✅ | ✅ | ✅ (from **Admin → Directory**) |

A *household* is everyone sharing a street address — the same grouping the
directory shows as a family. Someone with no address on file is a household of
one, so a blank address never pulls in strangers.

**Notification settings** sit on the same tab: one row per kind of activity the
site can raise, each set to email you right away, save it for a digest, or stay
in your inbox only. See
[Comments & Notifications](#comments--notifications).

**Worship preferences** are per person, per role — `preferred` ("glad to"),
`willing`, or `unavailable` ("rather not") — with a free-text note for the
person building the schedule. Roles come from `server/lib/people.js` and match
the job names the scraper reads off the church website.

**Linking an account to a person.** A login is matched to its directory entry
by email at sign-in, but only when exactly one entry matches — a shared family
email is never guessed at. Admins can set the link by hand from **Admin →
Users & Roles**; an existing link is never re-pointed automatically. Until an
account is linked, My Info explains that and points the person at an admin.

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
page. **Admin → Database → Scrape Status** has a **Diagnose** button on every
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
machine per workflow. **My Info → Workflows & Inbox** shows an inbox of what is
waiting on you, the workflows you are involved in, and a flowchart of where
each one has got to.

### The engine

Definitions live in code (`server/workflows/definitions/`); only running
instances live in the database. A definition is steps, the actions each step
offers, and where each action leads:

```js
steps: {
  review: {
    title: 'Deacon review',
    assign: { role: 'admin' },
    actions: [
      { id: 'approve', label: 'Approve', to: 'confirm' },
      { id: 'decline', label: 'Decline', to: 'declined', requiresNote: true },
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

### The three seeded workflows

| Workflow | Shape it exercises |
|---|---|
| **Facility Use Request** | Role approval, then confirmation back to the requester. Touches no congregation data. |
| **Job Assignment Swap** | Starts from a duty you are really rostered for, loops while a replacement is found, writes the new name to `job_assignments` on approval. |
| **Visitor Follow-Up** | Task aimed at a named person, loops on "no answer", hands off to an admin if they decline. |

### Adding a workflow

Drop a definition in `server/workflows/definitions/` and list it in that
folder's `index.js`. The inbox, the visibility rules, the API and the flowchart
all work off the definition alone. `validateDefinitions()` runs at start-up and
logs any action pointing at a step or outcome that does not exist.

---

## Comments & Notifications

Announcements and calendar events can be talked about, and everything the site
does lands in a notification inbox organised by type.

### Comments

Every announcement and every calendar event carries a thread. Both are rows in
the `announcements` table — the `type` column tells one from the other — so a
single comments table serves both and is told apart by `subject_type`, which is
carried through to the notification so an event's conversation groups apart
from an announcement's.

- **Reading takes a sign-in; writing takes an approved account.** The
  announcements themselves stay readable by anyone.
- **Threads are one level deep.** A reply to a reply joins the branch it
  answers rather than nesting forever.
- **Deleting is soft.** An author may fix their own wording (marked *edited*);
  an author or an admin may take a comment down, and replies under a removed
  comment still read.
- **Commenting is how you come to follow a thread**, and Following/Mute on the
  thread is how you leave one without leaving the rest.
- **`@Ray Harris` tells Ray**, whether or not he was following.

Threads appear under each item on **Announcements** and under the church events
listed on **Calendar**.

### The notification inbox

Every notification has a **type** (`comment.reply`, `event.cancelled`,
`workflow.task`, …), and each type belongs to a **category** — the drawer of
the inbox it lands in and the heading it sits under in the settings. The whole
catalogue lives in `server/notifications/types.js`; nothing anywhere else
invents a type string, so the inbox, the unread counts and a person's email
settings line up by construction.

| Category | Types raised |
|---|---|
| **Announcements** | posted · marked urgent · edited |
| **Calendar events** | posted · date/time/place changed · cancelled |
| **Comments** | a reply to you · a mention of you · activity on a thread you follow |
| **Workflows** | a task waiting on you · a workflow you are part of finishing |
| **Worship schedule** | the turns you are given · the monthly summary |
| **Site administration** | somebody new waiting to be approved · mail the site could not deliver |

The bell in the header carries the unread count and the newest few;
**My Info → Notifications** is the full inbox, with a drawer per category, an
unread-only filter, and *mark read* per item, per drawer or all at once.
Opening a notification goes to the screen that answers it.

### Email preferences

The inbox is the record; email is one way of being told about it. So a person
can turn every email off and still have a complete inbox, and nothing is
emailed that is not also in the inbox.

Settings live on **My Info** and are saved a change at a time — there is no
Save button to forget. Each type can be set to:

| Choice | Meaning |
|---|---|
| **Right away** | Emailed as it happens |
| **Digest** | Saved for the next digest |
| **No email** | Inbox only |

Each type also has its own *show these in my inbox* switch, so a type can be
silenced entirely. Above them sit the account-wide switches: **email me at
all**, and when the digest arrives — every day or one chosen weekday, at an
hour they pick.

Defaults differ by type because the right default does: a reply to your comment
arrives right away, a new event waits for the digest, and an edit to an
announcement's wording is inbox-only. A person who has said nothing has no
stored rows at all — the defaults answer for them.

### The digest

Anything marked *digest* waits in the inbox with `email_state = 'digest'` until
the sweep (every 15 minutes) finds somebody due: their hour has come round, on
the right day, and they have not already had one today. It gathers what has
piled up into one email grouped by category, and marks the rows sent so nothing
goes twice. Reading the digest does not mark the inbox read — it is a copy, not
a receipt.

---

## Email

Workflow notifications and distribution groups. **Admin → Email Groups** manages
who is on each list and shows what the site has recently tried to send.

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

Everything with an account behind it goes through the notification layer, which
decides — per person, per type — whether it belongs in their inbox, in their
email now, or in their next digest. Distribution-group addresses have no
account behind them, so they are written to as the group intends.

- **A task lands on you** — the person named, or everyone holding the role the
  task is waiting on. Role mail goes only to people holding *exactly* that role,
  so a member-level task never mails the whole congregation.
- **A workflow finishes** — the person who started it, plus any distribution
  group the outcome names. An approved facility request copies the
  announcements list, via `notifyGroups: ['announcements']` on the outcome.
  This one reaches the person who started it even when they closed it
  themselves: it is a record of the outcome, not news.
- **An announcement, an event, a comment, a new sign-in waiting for approval** —
  raised as notifications, and emailed to whoever asked for that type by email.
  See [Comments & Notifications](#comments--notifications).

---

## Monthly Worship Schedule

A workflow that builds a month of worship assignments from the preferences
people set on My Info, owned by the **worship coordinator** role.

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
  opted in by default; the switch is *Monthly schedule summary* under **My Info
  → Notifications**, and turning it off does not stop the emails about jobs you
  are personally given. That one setting keeps its own column
  (`users.wants_monthly_report`), which stays the authority for whether it is
  on — so the workflow, the old toggle and the settings screen always agree.

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
│   │   ├── parsers.js       # HTML parser functions (testable)
│   │   └── comments.js      # Comments, thread subscriptions, mentions
│   ├── notifications/
│   │   ├── types.js         # The catalogue: every type, its category, its default
│   │   ├── index.js         # emit() + the inbox
│   │   ├── preferences.js   # Per-person, per-type delivery settings
│   │   └── digest.js        # The sweep that gathers saved-for-later mail
│   ├── routes/
│   │   ├── scraper.js       # Church website scraper + data endpoints
│   │   ├── documents.js     # .docx upload + OOXML → HTML conversion
│   │   ├── comments.js      # Threads on announcements and events
│   │   ├── notifications.js # The inbox and the email preferences
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
| `NODE_ENV` | Production only | Set to `production` to serve the React build |
| `PORT` | No | API port (default `3001`) |
