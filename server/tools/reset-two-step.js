#!/usr/bin/env node
// ─── Last-resort two-step sign-in reset ───────────────────────────────────────
//
// For when nobody who could reset it on the Users page can sign in: the last
// admin has lost their phone and their recovery codes. Run it on the server,
// in the app's directory:
//
//   docker compose exec -T app node server/tools/reset-two-step.js someone@example.com
//
// (or plain `node server/tools/reset-two-step.js …` outside Docker). It turns two-step sign-in off for every account with that email address and
// records it in the action history. If the account has to use two-step
// sign-in, it is asked to set it up again at the next sign-in. Anybody who can
// run this already controls the server, so it gives nothing away.
require('dotenv').config({ quiet: true });

const email = String(process.argv[2] || '').trim().toLowerCase();
if (!email || !email.includes('@')) {
  console.error('Usage: node server/tools/reset-two-step.js someone@example.com');
  process.exit(2);
}

const db = require('../db');
const twoStep = require('../lib/twoStep');
const actionLog = require('../lib/actionLog');

const users = db.prepare('SELECT * FROM users WHERE lower(trim(email)) = ?').all(email);
if (!users.length) {
  console.error(`No account has the email address ${email}.`);
  process.exit(1);
}

let reset = 0;
for (const user of users) {
  if (!twoStep.isEnabled(user)) {
    console.log(`${user.name} (${user.provider}, id ${user.id}): two-step sign-in is not on, nothing to do.`);
    continue;
  }
  twoStep.disable(user.id);
  actionLog.record(null, {
    area:     'accounts',
    action:   'update',
    entity:   'account',
    entityId: user.id,
    summary:  `Reset two-step sign-in for ${user.name} from the server`,
    details:  { email: user.email, via: 'server/tools/reset-two-step.js' },
  });
  reset += 1;
  console.log(`${user.name} (${user.provider}, id ${user.id}): two-step sign-in reset. They can sign in with their password and set it up again.`);
}
process.exit(reset ? 0 : 1);
