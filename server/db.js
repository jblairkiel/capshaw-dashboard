const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'bible_questions.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS question_sets (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    passage    TEXT    NOT NULL,
    grade      TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS questions (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    set_id   INTEGER NOT NULL REFERENCES question_sets(id) ON DELETE CASCADE,
    question TEXT    NOT NULL,
    answer   TEXT    NOT NULL,
    type     TEXT    NOT NULL,
    hint     TEXT    NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS announcements (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    type       TEXT    NOT NULL DEFAULT 'announcement',
    title      TEXT    NOT NULL,
    body       TEXT    NOT NULL DEFAULT '',
    event_date TEXT,
    event_time TEXT,
    location   TEXT,
    priority   TEXT    NOT NULL DEFAULT 'normal',
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS lesson_plans (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT    NOT NULL,
    passage    TEXT    NOT NULL,
    grade      TEXT    NOT NULL,
    duration   INTEGER NOT NULL,
    focuses    TEXT    NOT NULL DEFAULT '',
    plan_json  TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS custom_game_questions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    type       TEXT    NOT NULL,
    question   TEXT    NOT NULL,
    options    TEXT,
    answer     TEXT    NOT NULL,
    hint       TEXT    NOT NULL DEFAULT '',
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_questions_set  ON questions(set_id);
  CREATE INDEX IF NOT EXISTS idx_sets_grade     ON question_sets(grade);
`);

module.exports = db;
