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
| `admin` | Everything a member can do, plus writing announcements, the song tracker and the order of service, and the Admin tabs — user roles, the congregation directory, and direct editing of every database table. |

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
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | For Google sign-in | Google OAuth credentials |
| `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` | For Facebook sign-in | Facebook OAuth credentials |
| `NODE_ENV` | Production only | Set to `production` to serve the React build |
| `PORT` | No | API port (default `3001`) |
