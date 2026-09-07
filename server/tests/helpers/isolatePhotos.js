// Point the photo store at a scratch directory for the whole test run. Without
// this, syncing a fixture database prunes the real congregation's photos.
const fs   = require('fs');
const os   = require('os');
const path = require('path');

process.env.CAPSHAW_PHOTO_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'capshaw-photos-'));
