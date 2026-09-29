// Every email the site can send has to be on the Emails page. This reads each
// sender's source for the `context` it writes to the outbox, and fails if the
// catalogue (server/mail/catalog.js) has no entry that claims it — so a new
// email cannot arrive without somebody deciding which tab it belongs on.
jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const fs = require('fs');
const path = require('path');
const { CATEGORIES, EMAILS, emailFor } = require('../mail/catalog');

const SERVER = path.join(__dirname, '..');

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return ['tests', 'data', 'seed', 'node_modules'].includes(entry.name) ? [] : sourceFiles(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

// `context: 'account:verify'` and `context: \`workflow:${id}:task:${task.id}\``,
// with anything interpolated replaced by a sample number.
function contextsWritten() {
  const found = [];
  for (const file of sourceFiles(SERVER)) {
    const src = fs.readFileSync(file, 'utf8');
    if (!/mailer\.(enqueue|send)\(/.test(src)) continue;
    for (const m of src.matchAll(/context:\s*(['`])((?:(?!\1).)*)\1/g)) {
      found.push({ file: path.relative(SERVER, file), context: m[2].replace(/\$\{[^}]*\}/g, '1') });
    }
  }
  return found;
}

test('finds the senders it is meant to be checking', () => {
  const files = new Set(contextsWritten().map(c => c.file));
  expect(files).toEqual(new Set([path.join('mail', 'accounts.js'), path.join('mail', 'newsletter.js'), path.join('mail', 'notify.js'), path.join('mail', 'records.js')]));
});

test('every email a sender writes is in the catalogue', () => {
  const missing = contextsWritten().filter(c => !emailFor(c.context));
  expect(missing).toEqual([]);
});

test('every catalogue entry belongs to a real tab and has a unique id', () => {
  const tabs = new Set(CATEGORIES.map(c => c.id));
  expect(EMAILS.every(e => tabs.has(e.category))).toBe(true);
  expect(new Set(EMAILS.map(e => e.id)).size).toBe(EMAILS.length);
});

test('no two entries claim the same message', () => {
  for (const { context } of contextsWritten()) {
    const claims = EMAILS.filter(e => e.matchers.some(m => m.test(context)));
    expect(claims).toHaveLength(1);
  }
});
