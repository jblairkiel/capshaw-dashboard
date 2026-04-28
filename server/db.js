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

  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    provider    TEXT    NOT NULL,
    provider_id TEXT    NOT NULL,
    email       TEXT,
    name        TEXT    NOT NULL,
    photo       TEXT,
    role        TEXT    NOT NULL DEFAULT 'pending',
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    last_login  TEXT,
    UNIQUE(provider, provider_id)
  );

  CREATE INDEX IF NOT EXISTS idx_questions_set  ON questions(set_id);
  CREATE INDEX IF NOT EXISTS idx_sets_grade     ON question_sets(grade);

  CREATE TABLE IF NOT EXISTS songs (
    id      INTEGER PRIMARY KEY,
    title   TEXT    NOT NULL,
    hymnal  TEXT    NOT NULL DEFAULT '',
    number  TEXT    NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS song_services (
    id      INTEGER PRIMARY KEY,
    date    TEXT    NOT NULL,
    service TEXT    NOT NULL,
    leader  TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS service_songs (
    service_id INTEGER NOT NULL REFERENCES song_services(id) ON DELETE CASCADE,
    song_id    INTEGER NOT NULL REFERENCES songs(id),
    position   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (service_id, song_id)
  );

  CREATE TABLE IF NOT EXISTS song_of_week (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    song_id    INTEGER NOT NULL REFERENCES songs(id),
    week_start TEXT    NOT NULL UNIQUE,
    notes      TEXT    NOT NULL DEFAULT ''
  );

  CREATE INDEX IF NOT EXISTS idx_service_songs_song ON service_songs(song_id);
  CREATE INDEX IF NOT EXISTS idx_song_services_date ON song_services(date);

  -- ── Scraped / editable congregation data ────────────────────────────────────

  CREATE TABLE IF NOT EXISTS attendance (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    date    TEXT    NOT NULL,
    service TEXT    NOT NULL DEFAULT '',
    count   INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS sermons (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    date    TEXT    NOT NULL,
    title   TEXT    NOT NULL DEFAULT '',
    speaker TEXT    NOT NULL DEFAULT '',
    type    TEXT    NOT NULL DEFAULT '',
    series  TEXT    NOT NULL DEFAULT '',
    service TEXT    NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS job_assignments (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    month   TEXT    NOT NULL DEFAULT '',
    date    TEXT    NOT NULL DEFAULT '',
    service TEXT    NOT NULL DEFAULT '',
    job     TEXT    NOT NULL DEFAULT '',
    name    TEXT    NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS visitors (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS visitor_visits (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    visitor_id INTEGER NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
    date       TEXT    NOT NULL DEFAULT '',
    service    TEXT    NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS anniversaries (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    month     TEXT    NOT NULL DEFAULT '',
    date      TEXT    NOT NULL DEFAULT '',
    names     TEXT    NOT NULL DEFAULT '',
    month_num INTEGER NOT NULL DEFAULT 0,
    day       INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS deacons (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS deacon_duties (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    deacon_id INTEGER NOT NULL REFERENCES deacons(id) ON DELETE CASCADE,
    duty      TEXT    NOT NULL,
    position  INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS bulletins (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    url   TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS scraped_meta (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    last_updated  TEXT    NOT NULL DEFAULT '',
    last_warnings TEXT    NOT NULL DEFAULT '[]'
  );

  CREATE INDEX IF NOT EXISTS idx_attendance_date        ON attendance(date);
  CREATE INDEX IF NOT EXISTS idx_sermons_date           ON sermons(date);
  CREATE INDEX IF NOT EXISTS idx_job_assignments_month  ON job_assignments(month);
  CREATE INDEX IF NOT EXISTS idx_visitor_visits_visitor ON visitor_visits(visitor_id);

  CREATE TABLE IF NOT EXISTS directory (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    name    TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    city    TEXT NOT NULL DEFAULT '',
    state   TEXT NOT NULL DEFAULT '',
    zip     TEXT NOT NULL DEFAULT '',
    phone   TEXT NOT NULL DEFAULT '',
    cell    TEXT NOT NULL DEFAULT '',
    email   TEXT NOT NULL DEFAULT '',
    notes   TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_directory_name ON directory(name);
`);

module.exports = db;
