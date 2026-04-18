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
| `NODE_ENV` | Production only | Set to `production` to serve the React build |
| `PORT` | No | API port (default `3001`) |
