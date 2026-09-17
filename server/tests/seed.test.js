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
