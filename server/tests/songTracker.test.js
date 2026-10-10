// /api/songs is the portal's song tracker. Its history can still be imported
// from the church website's admin panel; everything that leaves the process
// goes through the https mock, so these tests cover the login dance, the HTML
// parsing, the caching rules, the analytics and the song library without a
// network.
//
// The route caches its admin session in module state,
// so each test re-requires the router from a clean module registry. Both mocks
// are pinned to globalThis so that reset hands back the same database and the
// same request log the test is holding.
jest.mock('../db', () => {
  globalThis.__songTrackerDb ||= require('./helpers/memoryDb').createMemoryDb();
  return globalThis.__songTrackerDb;
});
jest.mock('https', () => {
  globalThis.__songTrackerHttps ||= require('./helpers/httpsMock').createHttpsMock();
  return globalThis.__songTrackerHttps;
});

const request = require('supertest');
const express = require('express');
const https   = require('https');
const db      = require('../db');

let router;

function buildApp(user = null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/songs', router);
  return app;
}

const ADMIN  = { id: 1, role: 'admin' };
const MEMBER = { id: 2, role: 'approved' };

const LOGIN_HTML = '<form><input name="_token" value="csrf-abc123"> </form>';

// One row of the admin song list, in the exact shape the parser looks for.
const listRow = ({ id, date, service, count, leader }) =>
  `<tr><td><a href="/admin/songsdb/edit/${id}?x=1">${date}</a></td>` +
  `<td>${service}</td><td>${count}</td><td>${leader}</td></tr>`;

const editPage = songs =>
  `<script>$('#songs').tokenInput({ prePopulate: ${JSON.stringify(songs)}, theme: 'facebook' });</script>`;

const ORIGINAL_ENV = { ...process.env };

// The route module caches the admin session and the form options in module
// state, so each test starts from a fresh copy of it.
beforeEach(() => {
  jest.resetModules();
  router = require('../routes/songTracker');
  https.__reset();
  for (const t of ['service_songs', 'song_services', 'songs']) db.prepare(`DELETE FROM "${t}"`).run();

  process.env = { ...ORIGINAL_ENV, CAPSHAW_MEMBER_USERNAME: 'member', CAPSHAW_MEMBER_PASSWORD: 'secret' };

  // A working admin login, which most tests just want in the background.
  https.__route('GET',  '/admin/login', () => ({ body: LOGIN_HTML, setCookie: 'session=abc; Path=/; HttpOnly' }));
  https.__route('POST', '/admin/login', () => ({ status: 302, location: '/admin/songsdb', setCookie: 'auth=xyz' }));
  https.__route('GET',  '/admin/songsdb', () => ({ body: '<html>dashboard</html>' }));
});

afterAll(() => { process.env = ORIGINAL_ENV; });

function seedService({ id, date, service, leader, songs = [] }) {
  db.prepare('INSERT INTO song_services (id, date, service, leader) VALUES (?,?,?,?)')
    .run(id, date, service, leader);
  songs.forEach((s, i) => {
    db.prepare('INSERT OR IGNORE INTO songs (id, title, hymnal, number) VALUES (?,?,?,?)')
      .run(s.id, s.title, s.hymnal || '', s.number || '');
    db.prepare('INSERT INTO service_songs (service_id, song_id, position) VALUES (?,?,?)').run(id, s.id, i);
  });
}

// ─── GET / ────────────────────────────────────────────────────────────────────

describe('GET /api/songs', () => {
  beforeEach(() => {
    seedService({ id: 1, date: '2025-01-05', service: 'Sunday AM', leader: 'Nelson, Tom',
                  songs: [{ id: 10, title: 'Amazing Grace' }, { id: 11, title: 'How Great Thou Art' }] });
    seedService({ id: 2, date: '2025-01-12', service: 'Sunday PM', leader: 'Harris, Ray',
                  songs: [{ id: 10, title: 'Amazing Grace' }] });
    seedService({ id: 3, date: '2025-01-19', service: 'Sunday AM', leader: '' });
  });

  test('lists records newest first with a song count', async () => {
    const res = await request(buildApp(MEMBER)).get('/api/songs');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.records.map(r => r.id)).toEqual([3, 2, 1]);
    expect(res.body.records.find(r => r.id === 1).song_count).toBe(2);
    // A record with no songs cached still appears, at zero
    expect(res.body.records.find(r => r.id === 3).song_count).toBe(0);
  });

  test('filters by service', async () => {
    const res = await request(buildApp(MEMBER)).get('/api/songs?service=PM');
    expect(res.body.total).toBe(1);
    expect(res.body.records[0].id).toBe(2);
  });

  test('filters by song title, matching any service that sang it', async () => {
    const res = await request(buildApp(MEMBER)).get('/api/songs?q=Amazing');
    expect(res.body.records.map(r => r.id).sort()).toEqual([1, 2]);
  });

  test('combines both filters', async () => {
    const res = await request(buildApp(MEMBER)).get('/api/songs?q=Amazing&service=PM');
    expect(res.body.records.map(r => r.id)).toEqual([2]);
  });

  test('pages with limit and offset while reporting the full total', async () => {
    const res = await request(buildApp(MEMBER)).get('/api/songs?limit=2&offset=1');
    expect(res.body.records.map(r => r.id)).toEqual([2, 1]);
    expect(res.body.total).toBe(3);
  });
});

// ─── GET /analytics ───────────────────────────────────────────────────────────

describe('GET /api/songs/analytics', () => {
  test('reports zeroes over an empty database', async () => {
    const res = await request(buildApp(MEMBER)).get('/api/songs/analytics');
    expect(res.status).toBe(200);
    expect(res.body.totals).toEqual({ services: 0, uniqueSongs: 0, plays: 0 });
    expect(res.body.topSongs).toEqual([]);
  });

  test('ranks the most-sung songs and records when each was last sung', async () => {
    seedService({ id: 1, date: '2025-01-05', service: 'Sunday AM', leader: 'Nelson, Tom',
                  songs: [{ id: 10, title: 'Amazing Grace', hymnal: 'Praise', number: '123' },
                          { id: 11, title: 'How Great Thou Art' }] });
    seedService({ id: 2, date: '2025-02-09', service: 'Sunday AM', leader: 'Nelson, Tom',
                  songs: [{ id: 10, title: 'Amazing Grace' }] });

    const res = await request(buildApp(MEMBER)).get('/api/songs/analytics');
    expect(res.body.topSongs[0]).toMatchObject({
      id: 10, title: 'Amazing Grace', hymnal: 'Praise', number: '123', count: 2, last_sung: '2025-02-09',
    });
    expect(res.body.totals).toEqual({ services: 2, uniqueSongs: 2, plays: 3 });
  });

  test('counts services by service name and by leader', async () => {
    seedService({ id: 1, date: '2025-01-05', service: 'Sunday AM', leader: 'Nelson, Tom' });
    seedService({ id: 2, date: '2025-01-12', service: 'Sunday AM', leader: 'Harris, Ray' });
    seedService({ id: 3, date: '2025-01-19', service: 'Sunday PM', leader: 'Nelson, Tom' });

    const res = await request(buildApp(MEMBER)).get('/api/songs/analytics');
    expect(res.body.byService).toEqual([{ service: 'Sunday AM', count: 2 }, { service: 'Sunday PM', count: 1 }]);
    expect(res.body.byLeader[0]).toEqual({ leader: 'Nelson, Tom', count: 2 });
  });

  test('leaves records with no leader out of the leader breakdown', async () => {
    seedService({ id: 1, date: '2025-01-05', service: 'Sunday AM', leader: '' });
    const res = await request(buildApp(MEMBER)).get('/api/songs/analytics');
    expect(res.body.byLeader).toEqual([]);
  });

  test('the monthly series covers only the last twelve months', async () => {
    const thisMonth = new Date().toISOString().slice(0, 7);
    seedService({ id: 1, date: `${thisMonth}-01`, service: 'Sunday AM', leader: 'Nelson, Tom' });
    seedService({ id: 2, date: '2001-06-03',      service: 'Sunday AM', leader: 'Nelson, Tom' });

    const res = await request(buildApp(MEMBER)).get('/api/songs/analytics');
    expect(res.body.monthly).toEqual([{ month: thisMonth, count: 1 }]);
  });
});

// ─── GET /:id ─────────────────────────────────────────────────────────────────

describe('GET /api/songs/:id', () => {
  test('404 for a record that is not cached locally', async () => {
    const res = await request(buildApp(MEMBER)).get('/api/songs/404');
    expect(res.status).toBe(404);
  });

  test('serves cached songs in order without touching the admin panel', async () => {
    seedService({ id: 5, date: '2025-01-05', service: 'Sunday AM', leader: 'Nelson, Tom',
                  songs: [{ id: 10, title: 'First' }, { id: 11, title: 'Second' }] });

    const res = await request(buildApp(MEMBER)).get('/api/songs/5');
    expect(res.status).toBe(200);
    expect(res.body.songs.map(s => s.title)).toEqual(['First', 'Second']);
    expect(https.__calls).toHaveLength(0);
  });

  test('fetches and caches the songs the first time a record is opened', async () => {
    seedService({ id: 5, date: '2025-01-05', service: 'Sunday AM', leader: 'Nelson, Tom' });
    https.__route('GET', '/admin/songsdb/edit/5', () => ({
      body: editPage([{ id: 10, name: 'AMAZING GRACE (123 - Praise for the Lord)' },
                      { id: 11, name: 'BLESSED ASSURANCE' }]),
    }));

    const res = await request(buildApp(MEMBER)).get('/api/songs/5');
    expect(res.status).toBe(200);
    // "TITLE (number - Hymnal)" is split into its parts
    expect(res.body.songs[0]).toMatchObject({ id: 10, title: 'AMAZING GRACE', number: '123', hymnal: 'Praise for the Lord', position: 0 });
    // A name with no parenthetical keeps the whole string as the title
    expect(res.body.songs[1]).toMatchObject({ title: 'BLESSED ASSURANCE', number: '', hymnal: '' });

    // Cached, so a second read makes no further requests
    const before = https.__calls.length;
    await request(buildApp(MEMBER)).get('/api/songs/5');
    expect(https.__calls).toHaveLength(before);
  });

  test('an edit page with no song list yields no songs and caches nothing', async () => {
    seedService({ id: 5, date: '2025-01-05', service: 'Sunday AM', leader: 'Nelson, Tom' });
    https.__route('GET', '/admin/songsdb/edit/5', () => ({ body: '<html>nothing here</html>' }));

    const res = await request(buildApp(MEMBER)).get('/api/songs/5');
    expect(res.status).toBe(200);
    expect(res.body.songs).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM service_songs').get().n).toBe(0);
  });

  test('malformed prePopulate JSON is treated as no songs, not a crash', async () => {
    seedService({ id: 5, date: '2025-01-05', service: 'Sunday AM', leader: 'Nelson, Tom' });
    https.__route('GET', '/admin/songsdb/edit/5', () => ({ body: 'prePopulate: [{oops}]' }));

    const res = await request(buildApp(MEMBER)).get('/api/songs/5');
    expect(res.status).toBe(200);
    expect(res.body.songs).toEqual([]);
  });

  test('500 when the admin credentials are missing', async () => {
    delete process.env.CAPSHAW_MEMBER_USERNAME;
    seedService({ id: 5, date: '2025-01-05', service: 'Sunday AM', leader: 'Nelson, Tom' });

    const res = await request(buildApp(MEMBER)).get('/api/songs/5');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/CAPSHAW_MEMBER_USERNAME/);
  });

  test('500 when the login page carries no CSRF token', async () => {
    https.__route('GET', '/admin/login', () => ({ body: '<form></form>' }));
    seedService({ id: 5, date: '2025-01-05', service: 'Sunday AM', leader: 'Nelson, Tom' });

    const res = await request(buildApp(MEMBER)).get('/api/songs/5');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/CSRF token/);
  });

  test('500 when the admin panel rejects the credentials', async () => {
    https.__route('POST', '/admin/login', () => ({ status: 200, body: 'Bad credentials' }));
    seedService({ id: 5, date: '2025-01-05', service: 'Sunday AM', leader: 'Nelson, Tom' });

    const res = await request(buildApp(MEMBER)).get('/api/songs/5');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/check credentials/);
  });
});

// ─── POST /sync ───────────────────────────────────────────────────────────────

describe('POST /api/songs/sync', () => {
  const today    = new Date();
  const recent   = new Date(today.getTime() - 10 * 86_400_000).toISOString().slice(0, 10);
  const recentUS = `${String(today.getMonth() + 1).padStart(2, '0')}/${String(new Date(recent).getUTCDate()).padStart(2, '0')}/${String(today.getFullYear()).slice(2)}`;

  test('401 signed out, 403 for a member — syncing is admin-only', async () => {
    expect((await request(buildApp(null)).post('/api/songs/sync')).status).toBe(401);
    expect((await request(buildApp(MEMBER)).post('/api/songs/sync')).status).toBe(403);
  });

  test('stores each listed record and its songs, converting the date to ISO', async () => {
    https.__route('GET', '/admin/songsdb?page=1', () => ({
      body: listRow({ id: 31, date: '01/05/25', service: 'Sunday AM', count: 2, leader: 'Nelson, Tom' }),
    }));
    https.__route('GET', '/admin/songsdb?page=2', () => ({ body: '<html>no rows</html>' }));
    https.__route('GET', '/admin/songsdb/edit/31', () => ({
      body: editPage([{ id: 10, name: 'AMAZING GRACE (123 - Praise for the Lord)' }]),
    }));

    const res = await request(buildApp(ADMIN)).post('/api/songs/sync').send({ pages: 3 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ synced: 1, warnings: [] });

    expect(db.prepare('SELECT * FROM song_services WHERE id = 31').get())
      .toMatchObject({ date: '2025-01-05', service: 'Sunday AM', leader: 'Nelson, Tom' });
    expect(db.prepare('SELECT * FROM songs WHERE id = 10').get())
      .toMatchObject({ title: 'AMAZING GRACE', hymnal: 'Praise for the Lord', number: '123' });
  });

  test('stops early at the first page with no records', async () => {
    https.__route('GET', /^\/admin\/songsdb\?page=/, () => ({ body: '<html>empty</html>' }));
    const res = await request(buildApp(ADMIN)).post('/api/songs/sync').send({ pages: 20 });
    expect(res.body.synced).toBe(0);
    expect(https.__calls.filter(c => c.path.startsWith('/admin/songsdb?page=')))
      .toHaveLength(1);
  });

  test('caps the page count at twenty and defaults to five', async () => {
    https.__route('GET', /^\/admin\/songsdb\?page=/, () => ({ body: '<html>empty</html>' }));

    expect((await request(buildApp(ADMIN)).post('/api/songs/sync').send({ pages: 999 })).body.pages).toBe(20);
    expect((await request(buildApp(ADMIN)).post('/api/songs/sync').send({})).body.pages).toBe(5);
  });

  test('updates a record that changed rather than duplicating it', async () => {
    seedService({ id: 31, date: '2025-01-05', service: 'Sunday AM', leader: 'Was, Wrong' });
    https.__route('GET', '/admin/songsdb?page=1', () => ({
      body: listRow({ id: 31, date: '01/05/25', service: 'Sunday PM', count: 0, leader: 'Harris, Ray' }),
    }));
    https.__route('GET', '/admin/songsdb?page=2', () => ({ body: '' }));

    await request(buildApp(ADMIN)).post('/api/songs/sync').send({ pages: 2 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM song_services').get().n).toBe(1);
    expect(db.prepare('SELECT * FROM song_services WHERE id = 31').get())
      .toMatchObject({ service: 'Sunday PM', leader: 'Harris, Ray' });
  });

  test('skips the detail fetch for a record that lists no songs', async () => {
    https.__route('GET', '/admin/songsdb?page=1', () => ({
      body: listRow({ id: 31, date: '01/05/25', service: 'Sunday AM', count: 0, leader: 'Nelson, Tom' }),
    }));
    https.__route('GET', '/admin/songsdb?page=2', () => ({ body: '' }));

    await request(buildApp(ADMIN)).post('/api/songs/sync').send({ pages: 2 });
    expect(https.__calls.some(c => c.path.includes('/edit/31'))).toBe(false);
  });

  test('re-fetches a recent record even when its songs are already cached', async () => {
    seedService({ id: 31, date: recent, service: 'Sunday AM', leader: 'Nelson, Tom',
                  songs: [{ id: 10, title: 'Stale' }] });
    https.__route('GET', '/admin/songsdb?page=1', () => ({
      body: listRow({ id: 31, date: recentUS, service: 'Sunday AM', count: 1, leader: 'Nelson, Tom' }),
    }));
    https.__route('GET', '/admin/songsdb?page=2', () => ({ body: '' }));
    https.__route('GET', '/admin/songsdb/edit/31', () => ({ body: editPage([{ id: 12, name: 'FRESH SONG' }]) }));

    await request(buildApp(ADMIN)).post('/api/songs/sync').send({ pages: 2 });
    // The cached list is replaced, not appended to
    expect(db.prepare('SELECT song_id FROM service_songs WHERE service_id = 31').all())
      .toEqual([{ song_id: 12 }]);
  });

  test('leaves an old, already-cached record alone', async () => {
    seedService({ id: 31, date: '2015-01-05', service: 'Sunday AM', leader: 'Nelson, Tom',
                  songs: [{ id: 10, title: 'Long ago' }] });
    https.__route('GET', '/admin/songsdb?page=1', () => ({
      body: listRow({ id: 31, date: '01/05/15', service: 'Sunday AM', count: 1, leader: 'Nelson, Tom' }),
    }));
    https.__route('GET', '/admin/songsdb?page=2', () => ({ body: '' }));

    await request(buildApp(ADMIN)).post('/api/songs/sync').send({ pages: 2 });
    expect(https.__calls.some(c => c.path.includes('/edit/31'))).toBe(false);
  });

  test('a detail page that fails is reported as a warning, not a failed sync', async () => {
    https.__route('GET', '/admin/songsdb?page=1', () => ({
      body: listRow({ id: 31, date: '01/05/25', service: 'Sunday AM', count: 2, leader: 'Nelson, Tom' }),
    }));
    https.__route('GET', '/admin/songsdb?page=2', () => ({ body: '' }));
    https.__route('GET', '/admin/songsdb/edit/31', () => ({ error: new Error('connection reset') }));

    const res = await request(buildApp(ADMIN)).post('/api/songs/sync').send({ pages: 2 });
    expect(res.status).toBe(200);
    expect(res.body.synced).toBe(1);
    expect(res.body.warnings).toEqual(['Record 31: connection reset']);
    // The header still landed
    expect(db.prepare('SELECT COUNT(*) AS n FROM song_services').get().n).toBe(1);
  });

  test('500 when the admin session cannot be established at all', async () => {
    delete process.env.CAPSHAW_MEMBER_PASSWORD;
    const res = await request(buildApp(ADMIN)).post('/api/songs/sync').send({ pages: 1 });
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});

// ─── The song library ─────────────────────────────────────────────────────────

describe('the song library', () => {
  const KEEPER = { id: 3, role: 'approved', areas: ['songs'] };
  const PENDING = { id: 4, role: 'pending' };
  beforeEach(() => {
    // Who added a song is a foreign key into users.
    for (const u of [ADMIN, MEMBER, KEEPER, PENDING]) {
      db.prepare("INSERT OR IGNORE INTO users (id, provider, provider_id, name, role) VALUES (?, 'local', ?, ?, ?)").run(u.id, `u${u.id}`, `User ${u.id}`, u.role);
    }
    db.prepare("INSERT INTO songs (id, title, hymnal, number) VALUES (10, 'Amazing Grace', 'Praise for the Lord', '123')").run();
    db.prepare("INSERT INTO songs (id, title, hymnal, number) VALUES (11, 'Be With Me Lord', 'Praise for the Lord', '44')").run();
  });

  test('search reads the portal\'s own list, and never calls the other site', async () => {
    expect((await request(buildApp(MEMBER)).get('/api/songs/search?q=%20%20')).body.results).toEqual([]);
    const res = await request(buildApp(MEMBER)).get('/api/songs/search?q=grace');
    expect(res.body.results.map(s => s.title)).toEqual(['Amazing Grace']);
    expect((await request(buildApp(MEMBER)).get('/api/songs/search?q=44')).body.results.map(s => s.id)).toEqual([11]);
    expect(https.__calls).toHaveLength(0);
  });

  test('any approved member can add a song, numbered clear of the other site\'s ids', async () => {
    const res = await request(buildApp(MEMBER)).post('/api/songs/library').send({ title: '  Sing to Me of Heaven ', hymnal: 'Songs of Faith and Praise', number: '731' });
    expect(res.status).toBe(201);
    expect(res.body.song).toMatchObject({ title: 'Sing to Me of Heaven', number: '731', source: 'portal' });
    expect(res.body.song.id).toBeGreaterThanOrEqual(1_000_000);
    expect((await request(buildApp(PENDING)).post('/api/songs/library').send({ title: 'x' })).status).toBe(403);
    expect((await request(buildApp(MEMBER)).post('/api/songs/library').send({ title: ' ' })).status).toBe(400);
  });

  test('adding a song already on the list hands back that one', async () => {
    const res = await request(buildApp(MEMBER)).post('/api/songs/library').send({ title: 'amazing grace!', number: '123' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ existing: true, song: { id: 10 } });
    expect(db.prepare('SELECT COUNT(*) AS n FROM songs').get().n).toBe(2);
  });

  test('whoever keeps the songs can correct one, and merge a duplicate into another', async () => {
    db.prepare("INSERT INTO song_services (id, date, service, leader) VALUES (5, '2026-09-20', 'AM', 'x')").run();
    db.prepare('INSERT INTO service_songs (service_id, song_id, position) VALUES (5, 11, 0)').run();

    expect((await request(buildApp(MEMBER)).put('/api/songs/library/11').send({ title: 'Be With Me, Lord' })).status).toBe(403);
    const fixed = await request(buildApp(KEEPER)).put('/api/songs/library/11').send({ title: 'Be With Me, Lord' });
    expect(fixed.body.song).toMatchObject({ id: 11, title: 'Be With Me, Lord', number: '44' });

    const merged = await request(buildApp(KEEPER)).post('/api/songs/library/11/merge').send({ into: 10 });
    expect(merged.status).toBe(200);
    expect(db.prepare('SELECT id FROM songs').all()).toEqual([{ id: 10 }]);
    expect(db.prepare('SELECT song_id FROM service_songs WHERE service_id = 5').all()).toEqual([{ song_id: 10 }]);
    expect((await request(buildApp(KEEPER)).post('/api/songs/library/10/merge').send({ into: 10 })).status).toBe(400);
  });
});

// ─── POST /:id/refresh ────────────────────────────────────────────────────────

describe('POST /api/songs/:id/refresh', () => {
  test('401 signed out, 403 for a member', async () => {
    expect((await request(buildApp(null)).post('/api/songs/5/refresh')).status).toBe(401);
    expect((await request(buildApp(MEMBER)).post('/api/songs/5/refresh')).status).toBe(403);
  });

  test('replaces the cached song list with what the admin panel now says', async () => {
    seedService({ id: 5, date: '2025-01-05', service: 'Sunday AM', leader: 'Nelson, Tom',
                  songs: [{ id: 10, title: 'Removed since' }] });
    https.__route('GET', '/admin/songsdb/edit/5', () => ({
      body: editPage([{ id: 11, name: 'NEW FIRST' }, { id: 12, name: 'NEW SECOND' }]),
    }));

    const res = await request(buildApp(ADMIN)).post('/api/songs/5/refresh');
    expect(res.status).toBe(200);
    expect(res.body.songs.map(s => s.title)).toEqual(['NEW FIRST', 'NEW SECOND']);
    expect(db.prepare('SELECT COUNT(*) AS n FROM service_songs WHERE song_id = 10').get().n).toBe(0);
  });

  test('an empty edit page leaves the cached list untouched', async () => {
    seedService({ id: 5, date: '2025-01-05', service: 'Sunday AM', leader: 'Nelson, Tom',
                  songs: [{ id: 10, title: 'Still here' }] });
    https.__route('GET', '/admin/songsdb/edit/5', () => ({ body: '<html>nothing</html>' }));

    const res = await request(buildApp(ADMIN)).post('/api/songs/5/refresh');
    expect(res.status).toBe(200);
    expect(res.body.songs.map(s => s.title)).toEqual(['Still here']);
  });

  test('500 when the admin panel cannot be reached', async () => {
    https.__route('GET', '/admin/songsdb/edit/5', () => ({ error: new Error('socket hang up') }));
    const res = await request(buildApp(ADMIN)).post('/api/songs/5/refresh');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('socket hang up');
  });
});

// ─── Recording a service by hand ──────────────────────────────────────────────

describe('recording a service by hand', () => {
  const KEEPER = { id: 3, role: 'approved', name: 'Kay', areas: ['songs'] };
  const song = (id, title, number = '') => db.prepare("INSERT INTO songs (id, title, hymnal, number) VALUES (?, ?, 'Hymns for Worship', ?)").run(id, title, number);
  const add = (user, body) => request(buildApp(user)).post('/api/songs/services').send(body);

  beforeEach(() => {
    db.prepare('DELETE FROM action_log').run();
    db.prepare("UPDATE service_types SET song_names = 'AM' WHERE name = 'Sunday AM Worship'").run();
    song(10, 'Blest Be the Tie', '858');
    song(11, 'Just As I Am', '64');
    song(12, 'Be With Me Lord', '370');
  });

  test('offers the church\'s services and the leaders on record', async () => {
    db.prepare("INSERT INTO song_services (id, date, service, leader) VALUES (5, '2026-01-04', 'AM', 'Al Adams')").run();
    const res = await request(buildApp(MEMBER)).get('/api/songs/services/options');
    expect(res.body.services).toContainEqual({ name: 'Sunday AM Worship', tracker: 'AM' });
    expect(res.body.leaders).toEqual(['Al Adams']);
  });

  test('puts a service and its songs, in order, into the history under the name that service already uses', async () => {
    const res = await add(KEEPER, { date: '2026-02-01', service: 'Sunday AM Worship', leader: ' Ben  Brown ', songIds: [12, 10, 11, 10] });
    expect(res.status).toBe(201);
    expect(res.body.record).toMatchObject({ date: '2026-02-01', service: 'AM', leader: 'Ben Brown', source: 'portal' });
    expect(res.body.record.id).toBeGreaterThanOrEqual(1_000_000);
    expect(res.body.songs.map(s => s.title)).toEqual(['Be With Me Lord', 'Blest Be the Tie', 'Just As I Am']);

    const list = await request(buildApp(MEMBER)).get('/api/songs');
    expect(list.body.records).toEqual([expect.objectContaining({ service: 'AM', song_count: 3, source: 'portal' })]);
    expect(db.prepare("SELECT summary FROM action_log WHERE entity = 'song service'").get().summary)
      .toBe('Recorded AM, 2026-02-01 (Ben Brown) — Be With Me Lord, Blest Be the Tie, Just As I Am');
  });

  test('refuses a second copy of the same service, and anything incomplete', async () => {
    await add(KEEPER, { date: '2026-02-01', service: 'Sunday AM Worship', songIds: [10] });
    const again = await add(KEEPER, { date: '2026-02-01', service: 'Sunday AM Worship', songIds: [11] });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/already in the history/);
    expect((await add(KEEPER, { service: 'Sunday AM Worship', songIds: [10] })).body.error).toMatch(/Choose the date/);
    expect((await add(KEEPER, { date: '2026-02-08', songIds: [10] })).body.error).toMatch(/which service/);
    expect((await add(KEEPER, { date: '2026-02-08', service: 'Sunday AM Worship', songIds: [] })).body.error).toMatch(/at least one song/);
    expect((await add(KEEPER, { date: '2026-02-08', service: 'Sunday AM Worship', songIds: [999] })).body.error).toMatch(/not in the song list/);
  });

  test('only whoever keeps the songs', async () => {
    expect((await add(MEMBER, { date: '2026-02-01', service: 'Sunday AM Worship', songIds: [10] })).status).toBe(403);
  });

  test('a service can be corrected, or taken out of the history', async () => {
    const { body } = await add(KEEPER, { date: '2026-02-01', service: 'Sunday AM Worship', leader: 'Ben Brown', songIds: [10, 11] });
    const id = body.record.id;
    const fixed = await request(buildApp(KEEPER)).put(`/api/songs/services/${id}`).send({ date: '2026-02-01', service: 'Sunday AM Worship', leader: 'Cal Cole', songIds: [11, 12] });
    expect(fixed.status).toBe(200);
    expect(fixed.body.songs.map(s => s.title)).toEqual(['Just As I Am', 'Be With Me Lord']);
    expect(db.prepare('SELECT leader FROM song_services WHERE id = ?').get(id).leader).toBe('Cal Cole');
    expect((await request(buildApp(MEMBER)).put(`/api/songs/services/${id}`).send({})).status).toBe(403);

    expect((await request(buildApp(KEEPER)).delete(`/api/songs/services/${id}`)).status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) n FROM song_services').get().n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) n FROM service_songs').get().n).toBe(0);
    expect(db.prepare("SELECT summary FROM action_log WHERE entity = 'song service' AND action = 'delete'").get().summary)
      .toBe('Removed AM, 2026-02-01 (Cal Cole) from the song history');
    expect((await request(buildApp(KEEPER)).delete(`/api/songs/services/${id}`)).status).toBe(404);
  });
});
