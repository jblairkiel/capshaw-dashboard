// /api/admin is the generic table editor behind Admin → Database. Every route
// is admin-only, and every table name and sort column has to come from the
// TABLES allow-list rather than the query string — a request may not name a
// table or a column the definition does not list.
jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());
jest.mock('../routes/scraper', () => ({ readData: jest.fn(() => null) }));

const request  = require('supertest');
const express  = require('express');
const db       = require('../db');
const scraper  = require('../routes/scraper');
const router   = require('../routes/admin');

function buildApp(user = null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/admin', router);
  return app;
}

const ADMIN       = { id: 1, role: 'admin' };
const AREA_HOLDER = { id: 2, role: 'approved', areas: ['attendance', 'songs'] };
const MEMBER      = { id: 3, role: 'approved' };
const PENDING     = { id: 4, role: 'pending' };

const TABLES_TO_CLEAR = [
  'attendance', 'sermons', 'job_assignments', 'visitor_visits', 'visitors',
  'anniversaries', 'deacon_duties', 'deacons', 'bulletins', 'directory',
  'announcements', 'service_songs', 'song_services', 'songs', 'scraped_meta',
];

beforeEach(() => {
  for (const t of TABLES_TO_CLEAR) db.prepare(`DELETE FROM "${t}"`).run();
  db.prepare('DELETE FROM seed_records').run();
  db.prepare('DELETE FROM seed_batches').run();
  db.prepare('DELETE FROM action_log').run();
  scraper.readData.mockReset();
  scraper.readData.mockReturnValue(null);
});

// ─── Access ───────────────────────────────────────────────────────────────────

describe('access', () => {
  test('signed-out visitors get 401 on every verb', async () => {
    const app = buildApp(null);
    for (const res of await Promise.all([
      request(app).get('/api/admin/overview'),
      request(app).get('/api/admin/sermons'),
      request(app).post('/api/admin/sermons').send({ title: 'x' }),
      request(app).patch('/api/admin/sermons/1').send({ title: 'x' }),
      request(app).delete('/api/admin/sermons/1'),
      request(app).delete('/api/admin/sermons'),
      request(app).post('/api/admin/import-cache'),
      request(app).get('/api/admin/scrape-status'),
    ])) {
      expect(res.status).toBe(401);
    }
  });

  test('members, whatever areas they look after, get 403 — the table editor is admin-only', async () => {
    for (const user of [PENDING, MEMBER, AREA_HOLDER]) {
      const res = await request(buildApp(user)).get('/api/admin/overview');
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    }
  });
});

// ─── GET /:table ──────────────────────────────────────────────────────────────

describe('GET /api/admin/:table', () => {
  beforeEach(() => {
    const ins = db.prepare('INSERT INTO sermons (date, title, speaker, service) VALUES (?,?,?,?)');
    ins.run('2025-01-05', 'Faith That Works', 'Ray Harris',  'AM');
    ins.run('2025-01-12', 'The Good Shepherd', 'Tom Nelson', 'PM');
    ins.run('2025-01-19', 'Living Water',      'Ray Harris', 'AM');
  });

  test('lists rows newest first with a total', async () => {
    const res = await request(buildApp(ADMIN)).get('/api/admin/sermons');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.rows.map(r => r.title)).toEqual(
      ['Living Water', 'The Good Shepherd', 'Faith That Works']
    );
  });

  test('404s for a table that is not in the allow-list', async () => {
    const res = await request(buildApp(ADMIN)).get('/api/admin/sqlite_master');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Unknown table');
  });

  test('caps limit and honours offset', async () => {
    const res = await request(buildApp(ADMIN)).get('/api/admin/sermons?limit=9999&offset=1');
    expect(res.body.limit).toBe(2000);
    expect(res.body.offset).toBe(1);
    expect(res.body.rows).toHaveLength(2);
    // total counts every matching row, not just the page
    expect(res.body.total).toBe(3);
  });

  test('sorts by a listed column in the requested direction', async () => {
    const res = await request(buildApp(ADMIN)).get('/api/admin/sermons?sort=title&dir=asc');
    expect(res.body.rows.map(r => r.title)).toEqual(
      ['Faith That Works', 'Living Water', 'The Good Shepherd']
    );
  });

  test('ignores a sort column the table definition does not list', async () => {
    const res = await request(buildApp(ADMIN)).get('/api/admin/sermons?sort=rowid%22%20--');
    expect(res.status).toBe(200);
    // Falls back to the definition's own order (date DESC)
    expect(res.body.rows[0].title).toBe('Living Water');
  });

  test('filters on a column with f_<col>, matching anywhere in the value', async () => {
    const res = await request(buildApp(ADMIN)).get('/api/admin/sermons?f_speaker=harris');
    expect(res.body.total).toBe(2);
    expect(res.body.rows.every(r => r.speaker === 'Ray Harris')).toBe(true);
  });

  test('combines several filters with AND', async () => {
    const res = await request(buildApp(ADMIN)).get('/api/admin/sermons?f_speaker=Harris&f_service=PM');
    expect(res.body.total).toBe(0);
  });

  test('a blank filter value is not treated as a filter', async () => {
    const res = await request(buildApp(ADMIN)).get('/api/admin/sermons?f_speaker=%20%20');
    expect(res.body.total).toBe(3);
  });
});

// ─── POST /:table ─────────────────────────────────────────────────────────────

describe('POST /api/admin/:table', () => {
  test('creates a row and returns it', async () => {
    const res = await request(buildApp(ADMIN))
      .post('/api/admin/attendance')
      .send({ date: '2025-02-02', service: 'AM', count: 142 });

    expect(res.status).toBe(200);
    expect(res.body.row).toMatchObject({ date: '2025-02-02', service: 'AM', count: 142 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM attendance').get().n).toBe(1);
  });

  test('ignores fields the table does not list as writable', async () => {
    const res = await request(buildApp(ADMIN))
      .post('/api/admin/directory')
      .send({ name: 'Jo Harris', photo: 'stolen.jpg' });

    expect(res.status).toBe(200);
    expect(res.body.row.name).toBe('Jo Harris');
    // `photo` is readable but not writable — it comes from the vCard sync
    expect(res.body.row.photo).toBe('');
  });

  test('400 when the body carries no writable field at all', async () => {
    const res = await request(buildApp(ADMIN))
      .post('/api/admin/attendance')
      .send({ id: 7, nonsense: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('No valid fields');
  });

  test('404 for an unknown table', async () => {
    const res = await request(buildApp(ADMIN)).post('/api/admin/nope').send({ name: 'x' });
    expect(res.status).toBe(404);
  });

  test('500 rather than a crash when the insert violates a constraint', async () => {
    const res = await request(buildApp(ADMIN))
      .post('/api/admin/deacon_duties')
      .send({ deacon_id: 4242, duty: 'Grounds' });
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});

// ─── PATCH /:table/:id ────────────────────────────────────────────────────────

describe('PATCH /api/admin/:table/:id', () => {
  let id;
  beforeEach(() => {
    id = db.prepare('INSERT INTO visitors (name) VALUES (?)').run('Pat Lane').lastInsertRowid;
  });

  test('updates only the fields supplied and returns the fresh row', async () => {
    const res = await request(buildApp(ADMIN))
      .patch(`/api/admin/visitors/${id}`)
      .send({ name: 'Pat Lane-Reed' });

    expect(res.status).toBe(200);
    expect(res.body.row).toMatchObject({ id, name: 'Pat Lane-Reed' });
  });

  test('400 when no writable field is supplied', async () => {
    const res = await request(buildApp(ADMIN)).patch(`/api/admin/visitors/${id}`).send({ id: 9 });
    expect(res.status).toBe(400);
  });

  test('404 for an unknown table', async () => {
    const res = await request(buildApp(ADMIN)).patch('/api/admin/nope/1').send({ name: 'x' });
    expect(res.status).toBe(404);
  });

  test('a null field clears the column', async () => {
    const res = await request(buildApp(ADMIN))
      .patch(`/api/admin/announcements/${
        db.prepare("INSERT INTO announcements (title, location) VALUES ('Potluck', 'Annex')")
          .run().lastInsertRowid}`)
      .send({ location: null });
    expect(res.status).toBe(200);
    expect(res.body.row.location).toBeNull();
  });
});

// ─── DELETE ───────────────────────────────────────────────────────────────────

describe('DELETE /api/admin/:table/:id', () => {
  test('removes the row', async () => {
    const id = db.prepare('INSERT INTO visitors (name) VALUES (?)').run('Sam Ford').lastInsertRowid;
    const res = await request(buildApp(ADMIN)).delete(`/api/admin/visitors/${id}`);
    expect(res.status).toBe(200);
    expect(db.prepare('SELECT * FROM visitors WHERE id = ?').get(id)).toBeUndefined();
  });

  test('404 for an unknown table', async () => {
    const res = await request(buildApp(ADMIN)).delete('/api/admin/nope/1');
    expect(res.status).toBe(404);
  });

  test('deleting a row that is not there still reports success', async () => {
    const res = await request(buildApp(ADMIN)).delete('/api/admin/visitors/999999');
    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/admin/:table (bulk clear)', () => {
  test('empties the table', async () => {
    db.prepare('INSERT INTO visitors (name) VALUES (?)').run('Sam Ford');
    db.prepare('INSERT INTO visitors (name) VALUES (?)').run('Lee Park');

    const res = await request(buildApp(ADMIN)).delete('/api/admin/visitors');
    expect(res.status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) AS n FROM visitors').get().n).toBe(0);
  });

  test('refuses to bulk-clear the song tables — they are rebuilt by sync, not by hand', async () => {
    for (const table of ['songs', 'song_services']) {
      const res = await request(buildApp(ADMIN)).delete(`/api/admin/${table}`);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Cannot bulk-clear this table');
    }
  });

  test('404 for an unknown table', async () => {
    const res = await request(buildApp(ADMIN)).delete('/api/admin/nope');
    expect(res.status).toBe(404);
  });
});

// ─── GET /overview ────────────────────────────────────────────────────────────

describe('sample data', () => {
  test('only an admin may see it, make it or remove it', async () => {
    for (const user of [null, PENDING, MEMBER, AREA_HOLDER]) {
      const app = buildApp(user);
      const expected = user ? 403 : 401;
      expect((await request(app).get('/api/admin/sample-data')).status).toBe(expected);
      expect((await request(app).post('/api/admin/sample-data').send({})).status).toBe(expected);
      expect((await request(app).delete('/api/admin/sample-data/whatever')).status).toBe(expected);
    }
  });

  test('lists what can be filled, and what is deliberately left alone', async () => {
    const { body } = await request(buildApp(ADMIN)).get('/api/admin/sample-data');

    expect(body.success).toBe(true);
    expect(body.generators.map(g => g.id)).toContain('directory');
    expect(body.generators.every(g => g.label && g.describe && g.page)).toBe(true);
    // The accounts tables are never filled, and the panel can say why.
    expect(body.notFilled.users).toMatch(/account/i);
    expect(body.batches).toEqual([]);
  });

  test('making a batch fills the site and reports what it made', async () => {
    const { body } = await request(buildApp(ADMIN))
      .post('/api/admin/sample-data')
      .send({ generators: ['directory', 'attendance'], scale: 1, note: 'looking at the pages' });

    expect(body.success).toBe(true);
    expect(body.total).toBeGreaterThan(0);
    expect(Object.keys(body.made).sort()).toEqual(['attendance', 'directory']);
    expect(db.prepare('SELECT COUNT(*) AS n FROM directory').get().n).toBeGreaterThan(0);

    const [batch] = body.batches;
    expect(batch.note).toBe('looking at the pages');
    expect(batch.rows).toBe(body.total);
  });

  test('a batch is recorded in the action history, both ways', async () => {
    // The history points at a real account, so one has to exist for the entry
    // to be kept — actionLog drops what it cannot attribute rather than throw.
    db.prepare("INSERT OR IGNORE INTO users (id, provider, provider_id, name, role) VALUES (?, 'google', 'admin-id', 'Ada', 'admin')")
      .run(ADMIN.id);

    const app = buildApp(ADMIN);
    const { body: made } = await request(app)
      .post('/api/admin/sample-data').send({ generators: ['directory'], scale: 1 });

    await request(app).delete(`/api/admin/sample-data/${made.batch}`);

    const entries = db.prepare(
      "SELECT action, summary FROM action_log WHERE entity = 'sample data' ORDER BY id"
    ).all();
    expect(entries.map(e => e.action)).toEqual(['create', 'delete']);
    expect(entries[0].summary).toMatch(/Made \d+ rows of sample data/);
    expect(entries[1].summary).toMatch(/Removed \d+ rows of sample data/);
  });

  test('removing a batch clears what it made and leaves real records alone', async () => {
    db.prepare('INSERT INTO directory (name) VALUES (?)').run('A Real Member');

    const app = buildApp(ADMIN);
    const { body: made } = await request(app)
      .post('/api/admin/sample-data').send({ generators: ['directory'], scale: 1 });

    const { body: gone } = await request(app).delete(`/api/admin/sample-data/${made.batch}`);

    expect(gone.success).toBe(true);
    expect(gone.deleted).toBe(gone.rows);
    expect(gone.batches).toEqual([]);
    expect(db.prepare('SELECT name FROM directory').all()).toEqual([{ name: 'A Real Member' }]);
  });

  test('a batch that is not there is a 404, not a silent success', async () => {
    const res = await request(buildApp(ADMIN)).delete('/api/admin/sample-data/sample-nope-0000');
    expect(res.status).toBe(404);
  });

  test('"sample-data" is not mistaken for a table by the generic editor', async () => {
    // The generic /:table routes would happily treat it as a table name, so
    // the specific ones have to be declared first. If they ever stop being,
    // this asks the table editor for a table that does not exist.
    const res = await request(buildApp(ADMIN)).get('/api/admin/sample-data');
    expect(res.status).toBe(200);
    expect(res.body.generators).toBeDefined();
  });
});

describe('GET /api/admin/overview', () => {
  test('counts every editable table and reports the last scrape', async () => {
    db.prepare('INSERT INTO visitors (name) VALUES (?)').run('Sam Ford');
    db.prepare("INSERT INTO scraped_meta (id, last_updated, last_warnings) VALUES (1, '2025-03-01T00:00:00Z', '[]')").run();

    const res = await request(buildApp(ADMIN)).get('/api/admin/overview');
    expect(res.status).toBe(200);
    expect(res.body.counts.visitors).toBe(1);
    expect(res.body.counts.sermons).toBe(0);
    expect(res.body.lastScraped).toBe('2025-03-01T00:00:00Z');
  });

  test('lastScraped is null before the first scrape', async () => {
    const res = await request(buildApp(ADMIN)).get('/api/admin/overview');
    expect(res.body.lastScraped).toBeNull();
  });
});

// ─── GET /scrape-status ───────────────────────────────────────────────────────

describe('GET /api/admin/scrape-status', () => {
  test('an empty section with no warning reads "empty"', async () => {
    const res = await request(buildApp(ADMIN)).get('/api/admin/scrape-status');
    expect(res.status).toBe(200);
    expect(res.body.sections.every(s => s.status === 'empty')).toBe(true);
    expect(res.body.lastScraped).toBeNull();
  });

  test('a populated section with no warning reads "ok" and reports its latest date', async () => {
    db.prepare('INSERT INTO attendance (date, service, count) VALUES (?,?,?)').run('2025-01-05', 'AM', 120);
    db.prepare('INSERT INTO attendance (date, service, count) VALUES (?,?,?)').run('2025-02-09', 'AM', 131);

    const res = await request(buildApp(ADMIN)).get('/api/admin/scrape-status');
    const attendance = res.body.sections.find(s => s.key === 'attendance');
    expect(attendance).toMatchObject({ status: 'ok', count: 2, latestDate: '2025-02-09' });
  });

  test('a warning on a section that still has rows reads "warning"', async () => {
    db.prepare('INSERT INTO sermons (date, title) VALUES (?,?)').run('2025-01-05', 'Faith');
    db.prepare("INSERT INTO scraped_meta (id, last_updated, last_warnings) VALUES (1, 'now', ?)")
      .run(JSON.stringify(['sermons: only found 1 row']));

    const res = await request(buildApp(ADMIN)).get('/api/admin/scrape-status');
    const sermons = res.body.sections.find(s => s.key === 'sermons');
    expect(sermons.status).toBe('warning');
    expect(sermons.warnings).toEqual(['sermons: only found 1 row']);
  });

  test('a warning on a section with no rows reads "error"', async () => {
    db.prepare("INSERT INTO scraped_meta (id, last_updated, last_warnings) VALUES (1, 'now', ?)")
      .run(JSON.stringify(['Sermons: page did not load']));

    const res = await request(buildApp(ADMIN)).get('/api/admin/scrape-status');
    expect(res.body.sections.find(s => s.key === 'sermons').status).toBe('error');
    // Sections without a matching warning are unaffected
    expect(res.body.sections.find(s => s.key === 'deacons').warnings).toEqual([]);
  });

  test('sections with no date column report a null latestDate', async () => {
    const res = await request(buildApp(ADMIN)).get('/api/admin/scrape-status');
    expect(res.body.sections.find(s => s.key === 'deacons').latestDate).toBeNull();
  });
});

// ─── POST /import-cache ───────────────────────────────────────────────────────

describe('POST /api/admin/import-cache', () => {
  test('404 when there is nothing cached to import', async () => {
    scraper.readData.mockReturnValue(null);
    const res = await request(buildApp(ADMIN)).post('/api/admin/import-cache');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Run a scrape first/);
  });

  test('loads every section of the cache and reports the resulting counts', async () => {
    scraper.readData.mockReturnValue({
      lastUpdated: '2025-04-01T12:00:00Z',
      warnings:    ['directory: 1 family had no address'],
      attendance:  [{ date: '2025-03-02', service: 'AM', count: 118 }],
      sermons:     [{ date: '2025-03-02', title: 'Hope', speaker: 'Ray Harris', type: '', series: '', service: 'AM' }],
      jobAssignments: {
        month: 'March 2025',
        assignments: [{ date: 'March 2', service: 'AM', job: 'Song Leader', name: 'Tom Nelson' }],
      },
      visitors: [{ name: 'Pat Lane', visits: [{ date: '2025-03-02', service: 'AM' }] }],
      anniversaries: [{ month: 'March', date: 'March 14', names: 'Ray & Jo Harris', monthNum: 3, day: 14 }],
      deacons: [{ name: 'Tom Nelson', duties: ['Grounds', 'Benevolence'] }],
      bulletins: [{ url: 'https://example.org/b.pdf', label: 'March 2' }],
      directory: [{ name: 'Ray Harris', email: 'ray@example.com' }],
    });

    const res = await request(buildApp(ADMIN)).post('/api/admin/import-cache');
    expect(res.status).toBe(200);
    expect(res.body.counts).toMatchObject({
      attendance: 1, sermons: 1, job_assignments: 1,
      visitors: 1, anniversaries: 1, deacons: 1, bulletins: 1, directory: 1,
    });

    // Nested rows follow their parent in
    expect(db.prepare('SELECT COUNT(*) AS n FROM visitor_visits').get().n).toBe(1);
    expect(db.prepare('SELECT duty FROM deacon_duties ORDER BY position').all().map(r => r.duty))
      .toEqual(['Grounds', 'Benevolence']);

    const meta = db.prepare('SELECT * FROM scraped_meta WHERE id = 1').get();
    expect(meta.last_updated).toBe('2025-04-01T12:00:00Z');
    expect(JSON.parse(meta.last_warnings)).toEqual(['directory: 1 family had no address']);
  });

  test('replaces what was there rather than appending to it', async () => {
    db.prepare('INSERT INTO attendance (date, service, count) VALUES (?,?,?)').run('1999-01-01', 'AM', 1);
    scraper.readData.mockReturnValue({ attendance: [{ date: '2025-03-02', service: 'AM', count: 118 }] });

    await request(buildApp(ADMIN)).post('/api/admin/import-cache');
    const rows = db.prepare('SELECT date FROM attendance').all();
    expect(rows).toEqual([{ date: '2025-03-02' }]);
  });

  test('a cache missing whole sections imports the ones it has', async () => {
    scraper.readData.mockReturnValue({ attendance: [{ date: '2025-03-02', service: 'AM', count: 118 }] });
    const res = await request(buildApp(ADMIN)).post('/api/admin/import-cache');
    expect(res.status).toBe(200);
    expect(res.body.counts).toMatchObject({ attendance: 1, sermons: 0, deacons: 0 });
  });

  test('a job-assignments block with no month still imports its rows', async () => {
    scraper.readData.mockReturnValue({
      jobAssignments: { assignments: [{ date: 'March 2', service: 'AM', job: 'Usher', name: 'Lee Park' }] },
    });
    await request(buildApp(ADMIN)).post('/api/admin/import-cache');
    expect(db.prepare('SELECT month, name FROM job_assignments').get()).toEqual({ month: '', name: 'Lee Park' });
  });

  test('500 rather than a crash when the cache is malformed', async () => {
    scraper.readData.mockReturnValue({ attendance: [{ /* no date */ }], sermons: 'not an array' });
    const res = await request(buildApp(ADMIN)).post('/api/admin/import-cache');
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});
