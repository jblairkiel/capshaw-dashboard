// Starts the portal for a recording: the API against the run's own throwaway
// data directory, and the client through Vite on a port the dev server does
// not use. Both are stopped again however the run ends.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '../../..');
// 5175 is one of the origins the API trusts in development (server/app.js),
// and not the port `npm run dev` takes.
const API_PORT = 3101;
const WEB_PORT = 5175;

// The repo's .env may hold the real church site's login, a mail server, or
// OAuth keys. dotenv never overwrites a variable that is already set, so each
// is set to empty here: a guide run can then neither scrape the live site nor
// send anybody an email, and every file it writes lands in the run's own
// directory rather than wherever a path override points.
const BLANKED = [
  'CAPSHAW_MEMBER_USERNAME', 'CAPSHAW_MEMBER_PASSWORD',
  'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM',
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET',
  'ANTHROPIC_API_KEY', 'ADMIN_EMAIL',
  'CAPSHAW_DB_FILE', 'CAPSHAW_PHOTO_DIR', 'CAPSHAW_DATA_FILE', 'CAPSHAW_BUG_SCREENSHOT_DIR', 'CAPSHAW_MAIL_ATTACHMENT_DIR',
];

function portalEnv(work) {
  const env = { ...process.env, NODE_ENV: 'development' };
  for (const key of BLANKED) env[key] = '';
  env.CAPSHAW_DATA_DIR = path.join(work, 'data');
  env.CAPSHAW_UPLOAD_DIR = path.join(work, 'data', 'uploads');
  return env;
}

async function waitFor(url, what, ms = 90000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 400));
  }
  throw new Error(`${what} did not come up at ${url} — see the logs in the run's work directory`);
}

async function start(work) {
  const log = name => fs.openSync(path.join(work, `${name}.log`), 'w');
  const children = [];
  const stop = () => { for (const c of children) if (c.exitCode === null) c.kill(); };
  try {
    children.push(spawn(process.execPath, ['server/index.js'], {
      cwd: REPO, env: { ...portalEnv(work), PORT: String(API_PORT) }, stdio: ['ignore', log('api'), log('api-err')],
    }));
    // Tailwind and PostCSS find their config from the working directory.
    children.push(spawn(process.execPath, [path.join(__dirname, 'web.mjs')], {
      cwd: path.join(REPO, 'client'), env: { ...process.env, GUIDE_API_PORT: String(API_PORT), GUIDE_WEB_PORT: String(WEB_PORT) },
      stdio: ['ignore', log('web'), log('web-err')],
    }));
    await waitFor(`http://localhost:${API_PORT}/api/health`, 'The API');
    await waitFor(`http://localhost:${WEB_PORT}/`, 'The client');
  } catch (e) {
    stop();
    throw e;
  }
  return { base: `http://localhost:${WEB_PORT}`, stop };
}

module.exports = { start, portalEnv, REPO };
