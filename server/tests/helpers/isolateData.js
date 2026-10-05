// Point everything a test could write at a scratch directory of its own. Without
// this, syncing a fixture database prunes the real congregation's photos, a
// scrape test overwrites their cached export — and a test that loads the
// database without mocking it opens server/data's real file, where two test
// files migrating it at once can collide ("duplicate column name") and fail
// the run. Jest runs this once per test file, so each file gets its own
// directory, and its own database.
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'capshaw-test-'));

process.env.CAPSHAW_DB_FILE    = path.join(scratch, 'test.db');
process.env.CAPSHAW_PHOTO_DIR  = path.join(scratch, 'photos');
process.env.CAPSHAW_DATA_FILE  = path.join(scratch, 'members.json');
process.env.CAPSHAW_BUG_SCREENSHOT_DIR = path.join(scratch, 'bug-screenshots');
process.env.CAPSHAW_MAIL_ATTACHMENT_DIR = path.join(scratch, 'mail-attachments');

fs.mkdirSync(process.env.CAPSHAW_PHOTO_DIR, { recursive: true });
fs.mkdirSync(process.env.CAPSHAW_BUG_SCREENSHOT_DIR, { recursive: true });
fs.mkdirSync(process.env.CAPSHAW_MAIL_ATTACHMENT_DIR, { recursive: true });
