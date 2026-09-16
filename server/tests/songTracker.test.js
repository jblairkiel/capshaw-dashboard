// /api/songs keeps a local copy of the congregation's song records, which live
// in the church website's admin panel. Everything that leaves the process goes
// through the https mock, so these tests cover the login dance, the HTML
// parsing, the caching rules and the analytics without a network.
//
// The route caches its admin session and the add-form options in module state,
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

const ADD_FORM = `
  <input name="_token" value="csrf-add">
  <select name="song_track[leader_id]">
    <option value="0">-- choose --</option>
    <option value="7">Nelson, Tom</option>
    <option value="9">Harris, Ray</option>
  </select>
  <select name="song_track[service_id]">
    <option value="1">Sunday AM</option>
    <option value="2">Sunday PM</option>
  </select>`;

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

// ─── GET /options and GET /search ─────────────────────────────────────────────

describe('GET /api/songs/options', () => {
  test('reads the leaders and services off the add form', async () => {
    https.__route('GET', '/admin/songsdb/add', () => ({ body: ADD_FORM }));

    const res = await request(buildApp(MEMBER)).get('/api/songs/options');
    expect(res.status).toBe(200);
    // Only entries that look like a person's name ("Last, First") are leaders,
    // which leaves the placeholder option out
    expect(res.body.leaders).toEqual([{ id: 7, name: 'Nelson, Tom' }, { id: 9, name: 'Harris, Ray' }]);
    expect(res.body.services).toEqual([{ id: 1, name: 'Sunday AM' }, { id: 2, name: 'Sunday PM' }]);
  });

  test('an add form without the selects yields empty lists rather than an error', async () => {
    https.__route('GET', '/admin/songsdb/add', () => ({ body: '<html>nothing</html>' }));
    const res = await request(buildApp(MEMBER)).get('/api/songs/options');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ leaders: [], services: [] });
  });

  test('500 when the admin panel cannot be reached', async () => {
    https.__route('GET', '/admin/login', () => ({ error: new Error('ENOTFOUND') }));
    const res = await request(buildApp(MEMBER)).get('/api/songs/options');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('ENOTFOUND');
  });
});

describe('GET /api/songs/search', () => {
  test('an empty query returns nothing without calling the admin panel', async () => {
    const res = await request(buildApp(MEMBER)).get('/api/songs/search?q=%20%20');
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
    expect(https.__calls).toHaveLength(0);
  });

  test('passes the query through and splits each result name into its parts', async () => {
    https.__route('GET', /^\/admin\/songsdb\/tokenize/, () => ({
      body: JSON.stringify([{ id: 10, name: 'AMAZING GRACE (123 - Praise for the Lord)' }]),
    }));

    const res = await request(buildApp(MEMBER)).get('/api/songs/search?q=amazing%20grace');
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([
      { id: 10, title: 'AMAZING GRACE', number: '123', hymnal: 'Praise for the Lord' },
    ]);
    expect(https.__calls.some(c => c.path.includes('q=amazing%20grace'))).toBe(true);
  });

  test('500 when the admin panel answers with something that is not JSON', async () => {
    https.__route('GET', /^\/admin\/songsdb\/tokenize/, () => ({ body: '<html>session expired</html>' }));
    const res = await request(buildApp(MEMBER)).get('/api/songs/search?q=grace');
    expect(res.status).toBe(500);
  });
});

// ─── POST /add ────────────────────────────────────────────────────────────────

describe('POST /api/songs/add', () => {
  const body = { day: 5, month: 1, year: 2025, serviceId: 1, leaderId: 7, songIds: [10, 11] };

  function routeAddForm() {
    https.__route('GET', '/admin/songsdb/add', () => ({ body: ADD_FORM }));
  }

  test('401 signed out, 403 for a member — adding is admin-only', async () => {
    expect((await request(buildApp(null)).post('/api/songs/add').send(body)).status).toBe(401);
    expect((await request(buildApp(MEMBER)).post('/api/songs/add').send(body)).status).toBe(403);
  });

  test('400 when any required part of the record is missing', async () => {
    const bad = [
      { ...body, day: undefined }, { ...body, month: undefined }, { ...body, year: undefined },
      { ...body, serviceId: undefined }, { ...body, leaderId: undefined },
      { ...body, songIds: [] }, { ...body, songIds: 'not an array' },
    ];
    for (const b of bad) {
      const res = await request(buildApp(ADMIN)).post('/api/songs/add').send(b);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/required/);
    }
  });

  test('submits the record and caches it under the id the admin panel assigns', async () => {
    routeAddForm();
    https.__route('POST', '/admin/songsdb/add', () => ({ status: 302, location: '/admin/songsdb/edit/77' }));
    https.__route('GET',  '/admin/songsdb/edit/77', () => ({ body: editPage([{ id: 10, name: 'AMAZING GRACE (123 - Praise for the Lord)' }]) }));

    const res = await request(buildApp(ADMIN)).post('/api/songs/add').send(body);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(77);

    // Stored with the readable service and leader names, not their ids
    expect(db.prepare('SELECT * FROM song_services WHERE id = 77').get())
      .toMatchObject({ date: '2025-01-05', service: 'Sunday AM', leader: 'Nelson, Tom' });
    expect(db.prepare('SELECT song_id FROM service_songs WHERE service_id = 77').all())
      .toEqual([{ song_id: 10 }]);

    // The form carries the CSRF token and the chosen songs
    const post = https.__calls.find(c => c.method === 'POST' && c.path === '/admin/songsdb/add');
    expect(post.body).toContain('_token=csrf-add');
    expect(post.body).toContain(encodeURIComponent('song_track[songs]') + '=10%2C11');
  });

  test('pads a single-digit day and month into the stored date', async () => {
    routeAddForm();
    https.__route('POST', '/admin/songsdb/add', () => ({ status: 302, location: '/admin/songsdb/edit/78' }));
    https.__route('GET',  '/admin/songsdb/edit/78', () => ({ body: '' }));

    await request(buildApp(ADMIN)).post('/api/songs/add').send({ ...body, day: 3, month: 7 });
    expect(db.prepare('SELECT date FROM song_services WHERE id = 78').get().date).toBe('2025-07-03');
  });

  test('falls back to the ids when the form offers no matching names', async () => {
    https.__route('GET', '/admin/songsdb/add', () => ({ body: '<input name="_token" value="csrf-add">' }));
    https.__route('POST', '/admin/songsdb/add', () => ({ status: 302, location: '/admin/songsdb/edit/79' }));
    https.__route('GET',  '/admin/songsdb/edit/79', () => ({ body: '' }));

    await request(buildApp(ADMIN)).post('/api/songs/add').send(body);
    expect(db.prepare('SELECT * FROM song_services WHERE id = 79').get())
      .toMatchObject({ service: '1', leader: '7' });
  });

  test('500 when the add form carries no CSRF token', async () => {
    https.__route('GET', '/admin/songsdb/add', () => ({ body: '<html>signed out</html>' }));
    const res = await request(buildApp(ADMIN)).post('/api/songs/add').send(body);
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/CSRF token/);
  });

  test('500 when the admin panel refuses the submission', async () => {
    routeAddForm();
    https.__route('POST', '/admin/songsdb/add', () => ({ status: 200, body: 'Validation failed' }));
    const res = await request(buildApp(ADMIN)).post('/api/songs/add').send(body);
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/rejected the submission/);
  });

  test('a redirect with no new id reports success but caches nothing', async () => {
    routeAddForm();
    https.__route('POST', '/admin/songsdb/add', () => ({ status: 302, location: '/admin/songsdb' }));

    const res = await request(buildApp(ADMIN)).post('/api/songs/add').send(body);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM song_services').get().n).toBe(0);
  });

  test('a failure fetching the new record afterwards is not fatal', async () => {
    routeAddForm();
    https.__route('POST', '/admin/songsdb/add', () => ({ status: 302, location: '/admin/songsdb/edit/80' }));
    https.__route('GET',  '/admin/songsdb/edit/80', () => ({ error: new Error('timed out') }));

    const res = await request(buildApp(ADMIN)).post('/api/songs/add').send(body);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(80);
    // The header is cached even though the song list could not be read
    expect(db.prepare('SELECT COUNT(*) AS n FROM song_services').get().n).toBe(1);
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
