const Database = require('better-sqlite3');

const { initSchema } = require('./schema');
// Where this installation keeps what it writes. Defaults to server/data, and a
// container points it at its volume instead — see server/lib/paths.js.
const paths = require('./lib/paths');

paths.ensure();

const db = new Database(paths.database);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Tables, migrations and the seeded distribution groups all live in
// server/schema.js so the test databases are built from the same definition.
initSchema(db);

module.exports = db;
