// A throwaway SQLite database carrying the real schema, for tests that
// exercise routes without touching the data directory.
//
// It is built from server/schema.js — the same module server/db.js uses — so a
// table or column added for a feature is available to its tests automatically.
const Database = require('better-sqlite3');
const { initSchema } = require('../../schema');

function createMemoryDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  return db;
}

module.exports = { createMemoryDb };
