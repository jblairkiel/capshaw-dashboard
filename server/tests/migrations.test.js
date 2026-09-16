// What happens to a database that has been running for a while when a new
// version of the schema is applied to it. The interesting cases are the ones
// that have to clean something up, or seed something from what is already
// there — both of which only ever run against real data, so they are worth a
// test that starts from the old shape rather than from a fresh install.
const Database = require('better-sqlite3');
const { initSchema } = require('../schema');

// A database as it stood before this change: guests with only a name, and
// attendance with services typed in by hand.
function oldInstall() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE visitors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL
    );
    CREATE TABLE visitor_visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      visitor_id INTEGER NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
      date TEXT NOT NULL DEFAULT '',
      service TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      service TEXT NOT NULL DEFAULT '',
      count INTEGER NOT NULL DEFAULT 0
    );
  `);
  return db;
}

function addGuest(db, name, columns = {}) {
  const { lastInsertRowid: id } = db.prepare('INSERT INTO visitors (name) VALUES (?)').run(name);
  db.prepare('INSERT INTO visitor_visits (visitor_id, date, service) VALUES (?, ?, ?)')
    .run(id, '04/13/25', 'Sun AM');
  return { id, columns };
}

function names(db) {
  return db.prepare('SELECT name FROM visitors ORDER BY name').all().map(r => r.name);
}

// ─── Guests the old visitor parser invented ───────────────────────────────────

describe('clearing out the guests the old parser invented', () => {
  test('removes the section headings it mistook for people', () => {
    const db = oldInstall();
    addGuest(db, 'Visit History');
    addGuest(db, 'Comments');
    addGuest(db, 'Visitor Tracker');
    addGuest(db, 'Pat Lane');

    initSchema(db);

    expect(names(db)).toEqual(['Pat Lane']);
  });

  test('takes their visits with them, leaving the real guests\' alone', () => {
    const db = oldInstall();
    addGuest(db, 'Visit History');
    addGuest(db, 'Pat Lane');

    initSchema(db);

    expect(db.prepare('SELECT COUNT(*) AS n FROM visitor_visits').get().n).toBe(1);
  });

  test('keeps one somebody has since typed into, whatever it is named', () => {
    const db = oldInstall();
    addGuest(db, 'Visit History');
    initSchema(db);
    expect(names(db)).toEqual([]);

    // The same name, but with a phone number somebody added by hand.
    const db2 = oldInstall();
    addGuest(db2, 'Visit History');
    initSchema(db2);                                    // brings the columns in
    db2.prepare('INSERT INTO visitors (name, phone) VALUES (?, ?)').run('Comments', '256-555-0143');

    initSchema(db2);                                    // and again, as a redeploy would
    expect(names(db2)).toEqual(['Comments']);
  });

  test('is case-insensitive, and ignores surrounding space', () => {
    const db = oldInstall();
    addGuest(db, '  visit history ');
    addGuest(db, 'COMMENTS');
    addGuest(db, 'Pat Lane');

    initSchema(db);

    expect(names(db)).toEqual(['Pat Lane']);
  });
});

// ─── Seeding the service types ────────────────────────────────────────────────

describe('seeding the service types', () => {
  test('takes them from the attendance already on record, so nothing stops matching', () => {
    const db = oldInstall();
    const insert = db.prepare('INSERT INTO attendance (date, service, count) VALUES (?, ?, ?)');
    insert.run('2026-06-07', 'Sun AM', 91);
    insert.run('2026-06-07', 'Wed Bible Study', 44);
    insert.run('2026-06-14', 'Sun AM', 96);

    initSchema(db);

    expect(db.prepare('SELECT name FROM service_types ORDER BY name').all().map(r => r.name))
      .toEqual(['Sun AM', 'Wed Bible Study']);
  });

  test('falls back to the services this congregation holds when there is no attendance yet', () => {
    const db = oldInstall();
    initSchema(db);

    const seeded = db.prepare('SELECT name FROM service_types ORDER BY sort_order').all().map(r => r.name);
    expect(seeded).toContain('Sunday AM Worship');
    expect(seeded).toContain('Wednesday Bible Study');
  });

  test('a second run leaves the list as the admin has since left it', () => {
    const db = oldInstall();
    db.prepare('INSERT INTO attendance (date, service, count) VALUES (?, ?, ?)').run('2026-06-07', 'Sun AM', 91);
    initSchema(db);

    db.prepare('DELETE FROM service_types').run();
    db.prepare('INSERT INTO service_types (name, sort_order) VALUES (?, ?)').run('Only This One', 0);

    initSchema(db);

    expect(db.prepare('SELECT name FROM service_types').all().map(r => r.name)).toEqual(['Only This One']);
  });
});

// ─── The old role ladder ──────────────────────────────────────────────────────

describe('converting the worship coordinator', () => {
  test('becomes a member who looks after the serving schedule', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL, provider_id TEXT NOT NULL,
        email TEXT, name TEXT NOT NULL, photo TEXT,
        role TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL DEFAULT (datetime('now')), last_login TEXT,
        UNIQUE(provider, provider_id)
      );
    `);
    db.prepare("INSERT INTO users (provider, provider_id, name, role) VALUES ('google', 'cora', 'Cora', 'worship-coordinator')").run();

    initSchema(db);

    expect(db.prepare('SELECT role FROM users WHERE name = ?').get('Cora').role).toBe('approved');
    expect(db.prepare('SELECT area FROM user_areas').all().map(r => r.area)).toEqual(['serving-schedule']);
  });
});
