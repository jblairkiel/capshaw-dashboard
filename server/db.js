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

  CREATE INDEX IF NOT EXISTS idx_questions_set  ON questions(set_id);
  CREATE INDEX IF NOT EXISTS idx_sets_grade     ON question_sets(grade);
`);

module.exports = db;
