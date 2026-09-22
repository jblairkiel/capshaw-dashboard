// Point everything that writes outside the database at a scratch directory for
// the whole test run. Without this, syncing a fixture database prunes the real
// congregation's photos and a scrape test overwrites their cached export.
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'capshaw-test-'));

process.env.CAPSHAW_PHOTO_DIR  = path.join(scratch, 'photos');
process.env.CAPSHAW_DATA_FILE  = path.join(scratch, 'members.json');
process.env.CAPSHAW_BUG_SCREENSHOT_DIR = path.join(scratch, 'bug-screenshots');

fs.mkdirSync(process.env.CAPSHAW_PHOTO_DIR, { recursive: true });
fs.mkdirSync(process.env.CAPSHAW_BUG_SCREENSHOT_DIR, { recursive: true });
