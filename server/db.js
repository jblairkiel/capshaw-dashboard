const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const { initSchema } = require('./schema');

const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'bible_questions.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Tables, migrations and the seeded distribution groups all live in
// server/schema.js so the test databases are built from the same definition.
initSchema(db);

module.exports = db;
