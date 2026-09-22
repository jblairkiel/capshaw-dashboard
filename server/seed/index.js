// ─── Sample data ──────────────────────────────────────────────────────────────
//
// Filling the site up so it can be looked at — a directory with people in it, a
// month of serving jobs, guests with visits — and then getting all of it back
// out again afterwards.
//
// Getting it out is the hard part, and it is why this exists rather than a
// pile of INSERTs. Recognising made-up rows after the fact ("names that look
// fake", "anything created today") is how somebody's real record ends up
// deleted. So nothing here can write a row without writing down that it did:
// a generator is handed an `insert` and has no database of its own, and that
// insert records the table and the id it just created in the same breath.
// Removing a batch reads that list back and deletes exactly those rows.
//
// Adding sample data for a new part of the site means adding one file to
// ./generators — they are discovered by reading the directory, not by being
// listed here — and the coverage test (server/tests/seed.test.js) fails until
// every table in the schema is either covered by a generator or written down
// as deliberately left alone. A new feature therefore cannot quietly arrive
// without somebody deciding whether it can be filled.

const fs   = require('fs');
const path = require('path');
const db   = require('../db');

const GENERATOR_DIR = path.join(__dirname, 'generators');

// Every table the schema defines, read from the database itself rather than
// kept as a second list that can drift from it.
function schemaTables() {
  return db.prepare(`
    SELECT name FROM sqlite_master
     WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
     ORDER BY name
  `).all().map(r => r.name);
}

function loadGenerators() {
  return fs.readdirSync(GENERATOR_DIR)
    .filter(f => f.endsWith('.js'))
    .map(f => require(path.join(GENERATOR_DIR, f)))
    .sort((a, b) => (a.order ?? 50) - (b.order ?? 50) || a.id.localeCompare(b.id));
}

const GENERATORS = loadGenerators();
const BY_ID      = new Map(GENERATORS.map(g => [g.id, g]));

// ─── Tables nothing fills, and why ────────────────────────────────────────────
//
// The coverage test reads this. A table that appears in neither a generator nor
// this list fails it, so a feature that adds a table cannot arrive without
// somebody deciding whether it can be filled with sample data. Answering "no"
// is fine — writing the reason down here is the point.

const NOT_FILLED = {
  users:      'Accounts. Made-up sign-ins are not sample data, they are a way in.',
  user_areas: 'Who may do what, which follows from the accounts.',
  action_log: 'Append-only, and the record of what really happened. Filling it would be a lie about the past, and removing a batch would tear pages out of it.',
  mail_outbox: 'Mail waiting to be sent. Anything put here is liable to actually go out.',
  scraped_meta: 'One row saying when the church site was last read. Sample data would misreport it.',
  service_types: 'The list of services every attendance record agrees on. Seeded once at start-up and shared by real records, so a batch must not take it away.',
  workflow_participants: 'Who may see a workflow, which is earned by taking part. Sample follow-ups are not aimed at a real account, so nobody is a participant in one.',
  notifications: 'Somebody\'s bell. An entry here tells a real person about something, so sample data would be telling them about a meeting that was never called.',
  bug_reports: 'A member saying something is actually broken. Inventing one would be reporting a bug that never happened, which is exactly what this feature exists to tell apart from a real one.',
  seed_batches: 'The record of what sample data made.',
  seed_records: 'The record of what sample data made.',
};

// ─── Made-up but plausible ────────────────────────────────────────────────────
//
// Seeded so a batch can be made again exactly, which matters when a screen
// renders oddly and the data that did it has already been removed.

function rng(seed) {
  let state = [...String(seed)].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRandom(seed) {
  const next = rng(seed);
  const random = {
    next,
    int:  (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: list => list[Math.floor(next() * list.length)],
    some: (list, n) => {
      const copy = [...list];
      const out  = [];
      while (out.length < n && copy.length) out.push(copy.splice(Math.floor(next() * copy.length), 1)[0]);
      return out;
    },
    chance: p => next() < p,
    // A date n days either side of today, as the site writes them.
    date: daysAgo => {
      const d = new Date();
      d.setDate(d.getDate() - daysAgo);
      return d;
    },
  };
  return random;
}

const pad = n => String(n).padStart(2, '0');
const asShortDate = d => `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${String(d.getFullYear()).slice(2)}`;
const asIsoDate   = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// ─── The writer a generator is given ──────────────────────────────────────────

// Table names are checked against the schema before any SQL is built, so a
// generator cannot name a table into existence, and nothing a generator passes
// reaches the statement as anything but a bound value.
function writerFor(batch) {
  const known = new Set(schemaTables());

  const noteRow = db.prepare(
    'INSERT INTO seed_records (batch, table_name, row_id, label) VALUES (?, ?, ?, ?)'
  );

  return function insert(table, values, label = '') {
    const name = [...known].find(t => t === table);
    if (!name) throw new Error(`sample data: there is no "${table}" table to write to`);

    const columns = Object.keys(values);
    if (!columns.length) throw new Error(`sample data: nothing to write to ${name}`);

    const sql = `INSERT INTO "${name}" (${columns.map(c => `"${c}"`).join(', ')}) ` +
                `VALUES (${columns.map(() => '?').join(', ')})`;
    const id = db.prepare(sql).run(...columns.map(c => values[c])).lastInsertRowid;

    noteRow.run(batch, name, id, String(label || '').slice(0, 200));
    return id;
  };
}

// ─── Making a batch ───────────────────────────────────────────────────────────

function newBatchId(now = new Date()) {
  const stamp = asIsoDate(now);
  const tail  = Math.random().toString(36).slice(2, 6);
  return `sample-${stamp}-${tail}`;
}

// `scale` is how much: 1 is enough to look at a page, 5 is enough to find out
// what it does with a lot. Each generator reads it as it sees fit.
function generate({ generators = [], scale = 1, note = '', by = '' } = {}) {
  const chosen = (generators.length ? generators : GENERATORS.map(g => g.id))
    .map(id => BY_ID.get(id))
    .filter(Boolean);

  if (!chosen.length) throw new Error('sample data: none of those parts of the site can be filled');

  const size  = Math.max(1, Math.min(10, Number(scale) || 1));
  const batch = newBatchId();

  const run = db.transaction(() => {
    db.prepare(`
      INSERT INTO seed_batches (id, created_by, note, generators, scale) VALUES (?, ?, ?, ?, ?)
    `).run(batch, by || '', note || '', JSON.stringify(chosen.map(g => g.id)), size);

    const insert  = writerFor(batch);
    const random  = makeRandom(batch);
    const made    = {};

    // In order, because a generator may build on what an earlier one made —
    // the serving schedule needs people to put in it.
    for (const generator of chosen) {
      const before = countFor(batch);
      generator.generate({ insert, random, scale: size, db, helpers: { asShortDate, asIsoDate } });
      made[generator.id] = countFor(batch) - before;
    }
    return made;
  });

  const made = run();
  return { batch, made, total: countFor(batch) };
}

function countFor(batch) {
  return db.prepare('SELECT COUNT(*) AS n FROM seed_records WHERE batch = ?').get(batch).n;
}

// ─── Taking it back out ───────────────────────────────────────────────────────

// Newest first, so a row something else points at goes after the thing that
// points at it. A row already gone — removed by hand, or taken by a cascade
// when its parent went — is not an error: the point is that it is not there.
function remove(batch) {
  const known = new Set(schemaTables());

  const run = db.transaction(() => {
    const rows = db.prepare(
      'SELECT id, table_name, row_id FROM seed_records WHERE batch = ? ORDER BY id DESC'
    ).all(batch);

    let deleted = 0;
    for (const row of rows) {
      const name = [...known].find(t => t === row.table_name);
      if (!name) continue;
      // By rowid rather than by id: not every table has an id column — a join
      // table keyed on two columns has none — and for the ones that do, the id
      // is the rowid. One statement then works for every shape of table.
      deleted += db.prepare(`DELETE FROM "${name}" WHERE rowid = ?`).run(row.row_id).changes;
    }

    db.prepare('DELETE FROM seed_records WHERE batch = ?').run(batch);
    db.prepare('DELETE FROM seed_batches WHERE id = ?').run(batch);
    return { rows: rows.length, deleted };
  });

  return run();
}

// ─── What is there ────────────────────────────────────────────────────────────

function batches() {
  return db.prepare(`
    SELECT b.id, b.created_at, b.created_by, b.note, b.generators, b.scale,
           (SELECT COUNT(*) FROM seed_records r WHERE r.batch = b.id) AS rows
      FROM seed_batches b
     ORDER BY b.created_at DESC, b.id DESC
  `).all().map(b => ({
    ...b,
    generators: safeParse(b.generators),
    tables: db.prepare(`
      SELECT table_name AS name, COUNT(*) AS rows
        FROM seed_records WHERE batch = ?
       GROUP BY table_name ORDER BY table_name
    `).all(b.id),
  }));
}

function safeParse(raw) {
  try { return JSON.parse(raw || '[]'); } catch { return []; }
}

function catalogue() {
  return GENERATORS.map(g => ({
    id: g.id, label: g.label, area: g.area || '', page: g.page || '',
    describe: g.describe || '', tables: g.tables || [],
  }));
}

module.exports = {
  GENERATORS,
  NOT_FILLED,
  generate,
  remove,
  batches,
  catalogue,
  schemaTables,
  makeRandom,
  asShortDate,
  asIsoDate,
};
