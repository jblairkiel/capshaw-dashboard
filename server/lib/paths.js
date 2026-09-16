// ─── Where this installation keeps what it writes ─────────────────────────────
//
// Four things outlive a request: the database, the family photos, the cached
// copy of the last scrape, and uploaded orders of service. On the droplet they
// all sit under server/, which is fine when the app and its data share a disk.
//
// A container's data has to outlive the container, so all four have to be
// movable — and movable together, since a deployment wants one volume, not
// four. CAPSHAW_DATA_DIR relocates the lot; the individual variables are still
// honoured for the cases that only want one moved (the test run redirects the
// photo library and the scrape cache, and nothing else).
//
// Every default is what it has always been, so an installation that sets none
// of these keeps writing exactly where it did before.
const path = require('path');
const fs   = require('fs');

const SERVER_DIR = path.join(__dirname, '..');

// The one variable a deployment normally sets. Everything below falls back to
// a path inside it.
const DATA_DIR = process.env.CAPSHAW_DATA_DIR || path.join(SERVER_DIR, 'data');

const paths = {
  dataDir:   DATA_DIR,
  database:  process.env.CAPSHAW_DB_FILE    || path.join(DATA_DIR, 'bible_questions.db'),
  photos:    process.env.CAPSHAW_PHOTO_DIR  || path.join(DATA_DIR, 'photos'),
  // The JSON backup of the last scrape. Kept beside the database because it is
  // what the app falls back to when a query cannot be answered from SQLite.
  scrapeCache: process.env.CAPSHAW_DATA_FILE || path.join(DATA_DIR, 'members.json'),
  // Uploaded .docx orders of service. Not under the data directory by default:
  // they are working files rather than congregation records, and the droplet
  // has always kept them apart.
  uploads:   process.env.CAPSHAW_UPLOAD_DIR || path.join(SERVER_DIR, 'uploads'),
};

// Creating a directory is idempotent and cheap, and a missing one is the
// difference between a container that starts and one that crashes on its first
// write. The file paths' parents count too — pointing the database at a fresh
// volume should not require anybody to mkdir first.
function ensure() {
  for (const dir of [paths.dataDir, paths.photos, paths.uploads, path.dirname(paths.database), path.dirname(paths.scrapeCache)]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return paths;
}

module.exports = { ...paths, ensure };
