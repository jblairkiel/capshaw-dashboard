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
      edited_fields TEXT NOT NULL DEFAULT '[]',
      photo         TEXT NOT NULL DEFAULT ''
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
  db.exec(`
    CREATE TABLE job_assignments (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      month   TEXT NOT NULL DEFAULT '',
      date    TEXT NOT NULL DEFAULT '',
      service TEXT NOT NULL DEFAULT '',
      job     TEXT NOT NULL DEFAULT '',
      name    TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE visitors (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL
    );
    CREATE TABLE workflow_instances (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      definition_id TEXT    NOT NULL,
      title         TEXT    NOT NULL DEFAULT '',
      status        TEXT    NOT NULL DEFAULT 'active',
      step_id       TEXT    NOT NULL DEFAULT '',
      outcome       TEXT    NOT NULL DEFAULT '',
      data          TEXT    NOT NULL DEFAULT '{}',
      created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      completed_at  TEXT
    );
    CREATE TABLE workflow_tasks (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id      INTEGER NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
      step_id          TEXT    NOT NULL,
      assignee_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      assignee_role    TEXT    NOT NULL DEFAULT '',
      status           TEXT    NOT NULL DEFAULT 'pending',
      action           TEXT    NOT NULL DEFAULT '',
      note             TEXT    NOT NULL DEFAULT '',
      created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
      completed_at     TEXT,
      completed_by     INTEGER REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE TABLE workflow_events (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id   INTEGER NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
      step_id       TEXT    NOT NULL DEFAULT '',
      action        TEXT    NOT NULL DEFAULT '',
      summary       TEXT    NOT NULL DEFAULT '',
      note          TEXT    NOT NULL DEFAULT '',
      actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE workflow_participants (
      instance_id INTEGER NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      added_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (instance_id, user_id)
    );
  `);

  db.exec(`
    CREATE TABLE mail_groups (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      key         TEXT    NOT NULL UNIQUE,
      name        TEXT    NOT NULL,
      description TEXT    NOT NULL DEFAULT '',
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE mail_group_members (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id     INTEGER NOT NULL REFERENCES mail_groups(id) ON DELETE CASCADE,
      directory_id INTEGER REFERENCES directory(id) ON DELETE CASCADE,
      email        TEXT    NOT NULL DEFAULT '',
      added_at     TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE mail_outbox (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      to_email     TEXT    NOT NULL,
      to_name      TEXT    NOT NULL DEFAULT '',
      intended_for TEXT    NOT NULL DEFAULT '',
      subject      TEXT    NOT NULL,
      body         TEXT    NOT NULL DEFAULT '',
      context      TEXT    NOT NULL DEFAULT '',
      status       TEXT    NOT NULL DEFAULT 'pending',
      attempts     INTEGER NOT NULL DEFAULT 0,
      error        TEXT    NOT NULL DEFAULT '',
      created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      sent_at      TEXT
    );
  `);

  const seedGroup = db.prepare('INSERT INTO mail_groups (key, name, sort_order) VALUES (?, ?, ?)');
  ['elders', 'deacons', 'men', 'women', 'announcements',
   'group-1', 'group-2', 'group-3', 'group-4', 'group-5', 'group-6']
    .forEach((key, i) => seedGroup.run(key, key, i));

  return db;
}

module.exports = { createMemoryDb };
