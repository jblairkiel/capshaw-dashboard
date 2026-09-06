// A throwaway SQLite database with the same shape as server/db.js, for tests
// that exercise routes without touching the real data directory.
const Database = require('better-sqlite3');

function createMemoryDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE directory (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL DEFAULT '',
      address       TEXT NOT NULL DEFAULT '',
      city          TEXT NOT NULL DEFAULT '',
      state         TEXT NOT NULL DEFAULT '',
      zip           TEXT NOT NULL DEFAULT '',
      phone         TEXT NOT NULL DEFAULT '',
      cell          TEXT NOT NULL DEFAULT '',
      email         TEXT NOT NULL DEFAULT '',
      notes         TEXT NOT NULL DEFAULT '',
      edited_fields TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE users (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      provider     TEXT    NOT NULL,
      provider_id  TEXT    NOT NULL,
      email        TEXT,
      name         TEXT    NOT NULL,
      photo        TEXT,
      role         TEXT    NOT NULL DEFAULT 'pending',
      created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      last_login   TEXT,
      directory_id INTEGER REFERENCES directory(id) ON DELETE SET NULL,
      UNIQUE(provider, provider_id)
    );
    CREATE TABLE worship_preferences (
      directory_id INTEGER NOT NULL REFERENCES directory(id) ON DELETE CASCADE,
      role         TEXT    NOT NULL,
      level        TEXT    NOT NULL DEFAULT 'willing',
      updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (directory_id, role)
    );
    CREATE TABLE worship_profile (
      directory_id INTEGER PRIMARY KEY REFERENCES directory(id) ON DELETE CASCADE,
      notes        TEXT    NOT NULL DEFAULT '',
      updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

module.exports = { createMemoryDb };
