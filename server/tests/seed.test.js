// Sample data: fills the site up so it can be looked at, and — the part that
// matters — takes every row of it back out again afterwards.
//
// The coverage test at the bottom is why this feature keeps up with the site
// rather than falling behind it.
jest.mock('../db', () => {
  globalThis.__seedDb ||= require('./helpers/memoryDb').createMemoryDb();
  return globalThis.__seedDb;
});

const db   = require('../db');
const seed = require('../seed');
const { WORSHIP_ROLES, PREFERENCE_LEVELS } = require('../lib/people');

// Everything the schema holds, minus the two tables that record what sample
// data did — those are the bookkeeping, not the data.
const DATA_TABLES = () => seed.schemaTables().filter(t => !t.startsWith('seed_'));

function snapshot() {
  return Object.fromEntries(DATA_TABLES().map(t =>
    [t, db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n]));
}

function difference(before, after) {
  return Object.entries(after)
    .filter(([table, n]) => n !== before[table])
    .map(([table, n]) => [table, n - before[table]]);
}

beforeEach(() => {
  for (const table of [...DATA_TABLES()].reverse()) {
    try { db.prepare(`DELETE FROM "${table}"`).run(); } catch { /* a view, or a table with no rows to clear */ }
  }
  db.prepare('DELETE FROM seed_records').run();
  db.prepare('DELETE FROM seed_batches').run();
});

describe('making sample data', () => {
  test('fills a good deal of the site, and says what it made', () => {
    const made = seed.generate({ scale: 1, by: 'Ada', note: 'having a look' });

    expect(made.total).toBeGreaterThan(50);
    // Every generator that ran contributed something.
    for (const [id, rows] of Object.entries(made.made)) {
      expect([id, rows > 0]).toEqual([id, true]);
    }

    const [batch] = seed.batches();
    expect(batch.id).toBe(made.batch);
    expect(batch.created_by).toBe('Ada');
    expect(batch.note).toBe('having a look');
    expect(batch.rows).toBe(made.total);
    expect(batch.tables.length).toBeGreaterThan(10);
  });

  test('only the parts asked for are filled', () => {
    const made = seed.generate({ generators: ['directory'], scale: 1 });

    expect(Object.keys(made.made)).toEqual(['directory']);
    expect(db.prepare('SELECT COUNT(*) AS n FROM directory').get().n).toBeGreaterThan(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM attendance').get().n).toBe(0);
  });

  test('a bigger scale makes more of it', () => {
    const small = seed.generate({ generators: ['attendance'], scale: 1 });
    const large = seed.generate({ generators: ['attendance'], scale: 3 });
    expect(large.total).toBeGreaterThan(small.total);
  });

  test('every row it writes is written down as it is made', () => {
    const made = seed.generate({ scale: 1 });

    const tracked = db.prepare('SELECT COUNT(*) AS n FROM seed_records WHERE batch = ?').get(made.batch).n;
    const rows = Object.values(snapshot()).reduce((sum, n) => sum + n, 0);

    // Nothing was written that was not recorded: the count of rows in the
    // database is the count of rows the batch says it made.
    expect(tracked).toBe(made.total);
    expect(rows).toBe(tracked);
  });

  test('a generator cannot write to a table that does not exist', () => {
    // The writer is the only way in, and it checks the name against the schema
    // before it builds any statement.
    expect(() => seed.generate({ generators: ['directory'] })).not.toThrow();
  });
});

describe('taking it back out', () => {
  test('a batch removes exactly what it made, and nothing else', () => {
    // Something real of our own, to prove removal is exact rather than a wipe.
    db.prepare('INSERT INTO visitors (name, notes) VALUES (?, ?)').run('A Real Guest', 'ours');
    db.prepare('INSERT INTO attendance (date, service, count) VALUES (?, ?, ?)')
      .run('2026-01-04', 'Sunday AM Worship', 142);
    const before = snapshot();

    const made = seed.generate({ scale: 2 });
    expect(difference(before, snapshot()).length).toBeGreaterThan(10);

    const gone = seed.remove(made.batch);
    expect(gone.deleted).toBe(gone.rows);
    expect(difference(before, snapshot())).toEqual([]);

    expect(db.prepare("SELECT 1 FROM visitors WHERE name = 'A Real Guest'").get()).toBeTruthy();
    expect(db.prepare('SELECT COUNT(*) AS n FROM attendance').get().n).toBe(1);
  });

  test('the batch and its record go with it', () => {
    const made = seed.generate({ scale: 1 });
    seed.remove(made.batch);

    expect(seed.batches()).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM seed_records WHERE batch = ?').get(made.batch).n).toBe(0);
  });

  test('one batch is removed without touching another', () => {
    const first  = seed.generate({ generators: ['directory'], scale: 1 });
    const second = seed.generate({ generators: ['directory'], scale: 1 });

    seed.remove(first.batch);

    expect(seed.batches().map(b => b.id)).toEqual([second.batch]);
    // What is left in the directory is exactly what the surviving batch put
    // there — the first batch's people went, and the second's did not.
    expect(db.prepare('SELECT COUNT(*) AS n FROM directory').get().n).toBe(
      db.prepare("SELECT COUNT(*) AS n FROM seed_records WHERE batch = ? AND table_name = 'directory'")
        .get(second.batch).n
    );
  });

  test('a row already deleted by hand is not an error', () => {
    const made = seed.generate({ generators: ['directory'], scale: 1 });
    const one  = db.prepare('SELECT id FROM directory LIMIT 1').get();
    db.prepare('DELETE FROM directory WHERE id = ?').run(one.id);

    const gone = seed.remove(made.batch);
    expect(gone.deleted).toBeLessThan(gone.rows);      // the hand-deleted one was already away
    expect(db.prepare('SELECT COUNT(*) AS n FROM directory').get().n).toBe(0);
  });

  test('a row a cascade already took is not counted twice', () => {
    // Removing a guest takes their visits with it. Newest-first ordering means
    // the visits are reached before the guest, but either way the count of
    // rows actually deleted never exceeds what was tracked.
    const made = seed.generate({ generators: ['visitors'], scale: 1 });
    const gone = seed.remove(made.batch);

    expect(gone.deleted).toBeLessThanOrEqual(gone.rows);
    expect(db.prepare('SELECT COUNT(*) AS n FROM visitors').get().n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM visitor_visits').get().n).toBe(0);
  });
});

// ─── It has to speak the site's own vocabulary ────────────────────────────────
//
// Sample data that says "song-leader" where the site says "Song Leader" is
// worse than no sample data: every page renders only the roles it knows, so the
// rows are there and the screen still looks empty.

describe('the words it writes', () => {
  test('volunteer preferences use the roles and the levels the site knows', () => {
    seed.generate({ scale: 2 });

    const rows = db.prepare('SELECT DISTINCT role, level FROM worship_preferences').all();
    expect(rows.length).toBeGreaterThan(0);

    for (const { role, level } of rows) {
      expect([role,  WORSHIP_ROLES.includes(role)]).toEqual([role, true]);
      expect([level, PREFERENCE_LEVELS.includes(level)]).toEqual([level, true]);
    }

    // And they hang off real people, so the Service Roster can show a name.
    const orphans = db.prepare(`
      SELECT COUNT(*) AS n FROM worship_preferences p
       WHERE NOT EXISTS (SELECT 1 FROM directory d WHERE d.id = p.directory_id)
    `).get().n;
    expect(orphans).toBe(0);
  });

  test('the jobs somebody is signed off for are jobs the roster has', () => {
    seed.generate({ scale: 2 });

    const jobs = db.prepare('SELECT DISTINCT job FROM job_eligibility').all().map(r => r.job);
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.filter(job => !WORSHIP_ROLES.includes(job))).toEqual([]);
  });

  test('nobody is signed off for a job they said they would rather not do', () => {
    seed.generate({ scale: 2 });

    const contradictions = db.prepare(`
      SELECT d.name, e.job FROM job_eligibility e
        JOIN worship_preferences p ON p.directory_id = e.directory_id AND p.role = e.job
        JOIN directory d ON d.id = e.directory_id
       WHERE p.level = 'unavailable'
    `).all();
    expect(contradictions).toEqual([]);
  });

  test('a sample month is laid out the way the page would lay one out', () => {
    seed.generate({ scale: 2 });

    const slots = db.prepare('SELECT DISTINCT job, service FROM job_assignments').all();
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.filter(s => !WORSHIP_ROLES.includes(s.job))).toEqual([]);
    expect(slots.filter(s => !['Sunday Worship', 'Sunday Evening', 'Wednesday'].includes(s.service))).toEqual([]);
  });
});

describe('church groups', () => {
  // A group page with rolls but no answers, nothing on the sign-up list and an
  // empty thread shows none of what the page is for, so a batch fills all of
  // it — and has to do so without inventing a single account.
  test('fills the answers, the sign-up lists and the threads', () => {
    seed.generate({ generators: ['directory', 'announcements', 'church-groups'], scale: 2 });

    for (const table of ['group_event_rsvps', 'group_event_signups', 'event_comments']) {
      expect([table, db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n > 0]).toEqual([table, true]);
    }
  });

  test('attributes all of it to directory people, never to an account', () => {
    seed.generate({ generators: ['directory', 'announcements', 'church-groups'], scale: 2 });

    // Accounts are never sample data, so nothing a batch writes may claim one.
    for (const table of ['group_event_rsvps', 'group_event_signups']) {
      const rows = db.prepare(`SELECT user_id, directory_id FROM "${table}"`).all();
      expect([table, rows.every(r => r.user_id === null)]).toEqual([table, true]);
      expect([table, rows.every(r => r.directory_id !== null)]).toEqual([table, true]);
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM event_comments WHERE user_id IS NOT NULL').get().n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get().n).toBe(0);
  });

  test('never signs more people up for a thing than were asked for', () => {
    seed.generate({ generators: ['directory', 'church-groups'], scale: 3 });

    const overSubscribed = db.prepare(`
      SELECT i.label, i.needed, COALESCE(SUM(s.quantity), 0) AS taken
        FROM group_event_signup_items i
        LEFT JOIN group_event_signups s ON s.item_id = i.id
       GROUP BY i.id
      HAVING taken > i.needed
    `).all();
    expect(overSubscribed).toEqual([]);
  });

  test('everybody it writes down is somebody on that meeting\'s roll', () => {
    seed.generate({ generators: ['directory', 'church-groups'], scale: 2 });

    const strangers = db.prepare(`
      SELECT r.id FROM group_event_rsvps r
        JOIN group_events e ON e.id = r.event_id
       WHERE NOT EXISTS (
         SELECT 1 FROM church_group_members m
          WHERE m.group_id = e.group_id AND m.directory_id = r.directory_id
       )
    `).all();
    expect(strangers).toEqual([]);
  });

  test('a batch takes its answers, sign-ups and replies back out with it', () => {
    const made = seed.generate({ generators: ['directory', 'announcements', 'church-groups'], scale: 2 });
    seed.remove(made.batch);

    for (const table of ['group_event_rsvps', 'group_event_signups', 'event_comments', 'church_groups']) {
      expect([table, db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n]).toEqual([table, 0]);
    }
  });
});

// ─── The part that keeps this honest ──────────────────────────────────────────

describe('coverage', () => {
  test('every table is either filled by a generator or written down as left alone', () => {
    const filled  = new Set(seed.GENERATORS.flatMap(g => g.tables));
    const excused = new Set(Object.keys(seed.NOT_FILLED));

    const unaccounted = seed.schemaTables()
      .filter(table => !filled.has(table) && !excused.has(table));

    // If this fails, a table arrived with a feature and nobody decided whether
    // sample data should fill it. Either add it to a generator's `tables` and
    // write the rows, or add it to NOT_FILLED with the reason it is left alone.
    expect(unaccounted).toEqual([]);
  });

  test('a generator only claims tables that exist', () => {
    const schema = new Set(seed.schemaTables());
    for (const generator of seed.GENERATORS) {
      for (const table of generator.tables) {
        expect([generator.id, table, schema.has(table)]).toEqual([generator.id, table, true]);
      }
    }
  });

  test('a generator writes to every table it claims', () => {
    // A claim that is never written is how a table quietly stops being covered
    // while still counting as covered.
    for (const generator of seed.GENERATORS) {
      const made = seed.generate({ generators: [generator.id], scale: 2 });
      const written = new Set(
        db.prepare('SELECT DISTINCT table_name AS t FROM seed_records WHERE batch = ?').all(made.batch).map(r => r.t)
      );
      expect([generator.id, generator.tables.filter(t => !written.has(t))]).toEqual([generator.id, []]);
    }
  });

  test('every generator says where in the site it shows up', () => {
    for (const entry of seed.catalogue()) {
      expect([entry.id, Boolean(entry.label && entry.describe && entry.page)])
        .toEqual([entry.id, true]);
    }
  });
});
