// /api/members is the bridge between the church website and this database: it
// fetches the member-only pages, parses them, and writes what it found. The
// HTTP client and the directory scrape are mocked, so what is under test is how
// the route handles what comes back — including the half-failures, which are
// the whole point of its warnings.
jest.mock('../db', () => {
  globalThis.__scraperDb ||= require('./helpers/memoryDb').createMemoryDb();
  return globalThis.__scraperDb;
});
// Each test re-requires the route from a clean module registry, because
// runUpdate guards itself with module state. The mocks are pinned to globalThis
// so that reset hands back the very spies the test is holding.
jest.mock('../lib/capshawClient', () => {
  globalThis.__scraperClient ||= {
    fetchPage:      jest.fn(),
    resetSession:   jest.fn(),
    parseCookies:   jest.requireActual('../lib/capshawClient').parseCookies,
    cookieStr:      jest.requireActual('../lib/capshawClient').cookieStr,
    mergeCookieStr: jest.requireActual('../lib/capshawClient').mergeCookieStr,
  };
  return globalThis.__scraperClient;
});
jest.mock('../lib/directoryPhotos', () => {
  globalThis.__scraperDirectory ||= { scrapeDirectory: jest.fn() };
  return globalThis.__scraperDirectory;
});

const fs      = require('fs');
const request = require('supertest');
const express = require('express');
const db      = require('../db');

const { fetchPage, resetSession } = require('../lib/capshawClient');
const { scrapeDirectory }         = require('../lib/directoryPhotos');

let scraper;

function buildApp(user = null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/members', scraper.router);
  return app;
}

const ADMIN   = { id: 1, role: 'admin' };
const MEMBER  = { id: 2, role: 'approved' };
const PENDING = { id: 3, role: 'pending' };

const TABLES = ['attendance', 'sermons', 'job_assignments', 'visitor_visits', 'visitors',
                'anniversaries', 'deacon_duties', 'deacons', 'bulletins', 'directory', 'scraped_meta'];

// ─── Page fixtures, in the shape the real parsers expect ──────────────────────

const table = rows => `<table>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`;

const ATTENDANCE_HTML = table([
  ['Date', 'Sunday AM', 'Sunday PM', 'Wednesday'],
  ['01/05/2025', '142', '96', '88'],
]);

const SERMONS_HTML = table([
  ['Date', 'Title', 'Speaker', 'Type', 'Series', 'Service'],
  ['01/05/2025', 'Faith That Works', 'Ray Harris', 'Expository', 'James', 'AM'],
]);

const DASHBOARD_HTML =
  '<h3>Capshaw Bulletin</h3>' +
  '<a href="/media/bulletins/2025-01-05.pdf">January 5 Bulletin</a>' +
  '<h3>Member News</h3>';

const page = (body, over = {}) => ({ status: 200, url: 'https://capshawchurch.org/members', body, ...over });

// Answers fetchPage from a path → page map, so a test describes the whole site.
function serveSite(over = {}) {
  const site = {
    '/members/job-assignments':                    page(''),
    '/members/attendance':                         page(ATTENDANCE_HTML, { url: 'https://capshawchurch.org/members/attendance' }),
    '/members/sermons':                            page(SERMONS_HTML),
    '/members/visitor-tracker':                    page(''),
    '/members/anniversaries-members-non-members':  page(''),
    '/members/deacons':                            page(''),
    '/members':                                    page(DASHBOARD_HTML),
    ...over,
  };
  fetchPage.mockImplementation(async path => {
    const out = site[path];
    if (out === undefined) throw new Error(`unexpected page fetch: ${path}`);
    if (out instanceof Error) throw out;
    return out;
  });
  return site;
}

beforeEach(() => {
  // runUpdate guards itself with module state, so each test gets a fresh copy.
  jest.resetModules();
  jest.clearAllMocks();
  scraper = require('../routes/scraper');

  for (const t of TABLES) db.prepare(`DELETE FROM "${t}"`).run();
  try { fs.unlinkSync(process.env.CAPSHAW_DATA_FILE); } catch { /* not written yet */ }

  scrapeDirectory.mockResolvedValue({
    people:   [{ name: 'Ray Harris', email: 'ray@example.com', familyId: '1' }],
    families: [{ familyId: '1' }],
    warnings: [],
    summary:  { families: 1, people: 1, photos: 0, photosReused: 0, noPhoto: 1, photoErrors: 0 },
  });
});

// ─── normaliseJobAssignments ──────────────────────────────────────────────────

describe('normaliseJobAssignments', () => {
  test('wraps a bare array, which is the shape an older parser returned', () => {
    expect(scraper.normaliseJobAssignments([{ job: 'Usher' }]))
      .toEqual({ month: '', assignments: [{ job: 'Usher' }] });
  });

  test('passes an already-correct object through', () => {
    expect(scraper.normaliseJobAssignments({ month: 'March 2025', assignments: [{ job: 'Usher' }] }))
      .toEqual({ month: 'March 2025', assignments: [{ job: 'Usher' }] });
  });

  test('supplies a missing month', () => {
    expect(scraper.normaliseJobAssignments({ assignments: [] })).toEqual({ month: '', assignments: [] });
  });

  test('anything else becomes the empty shape rather than undefined', () => {
    for (const value of [null, undefined, 'nonsense', 42, {}, { assignments: 'no' }]) {
      expect(scraper.normaliseJobAssignments(value)).toEqual({ month: '', assignments: [] });
    }
  });
});

// ─── GET /status and GET /data ────────────────────────────────────────────────

describe('GET /api/members/status', () => {
  test('reports no data before the first scrape', async () => {
    const res = await request(buildApp(MEMBER)).get('/api/members/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ hasData: false, lastUpdated: null, updateInProgress: false });
  });

  test('reports the timestamp once a scrape has run', async () => {
    db.prepare("INSERT INTO scraped_meta (id, last_updated, last_warnings) VALUES (1, '2025-03-01T00:00:00Z', '[]')").run();
    const res = await request(buildApp(MEMBER)).get('/api/members/status');
    expect(res.body).toMatchObject({ hasData: true, lastUpdated: '2025-03-01T00:00:00Z' });
  });
});

describe('GET /api/members/data', () => {
  test('returns null before anything has been scraped or cached', async () => {
    const res = await request(buildApp(MEMBER)).get('/api/members/data');
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  test('rebuilds the whole cache shape out of the database', async () => {
    db.prepare("INSERT INTO scraped_meta (id, last_updated, last_warnings) VALUES (1, '2025-03-01T00:00:00Z', ?)")
      .run(JSON.stringify(['sermons: parse error']));
    db.prepare('INSERT INTO attendance (date, service, count) VALUES (?,?,?)').run('2025-01-05', 'AM', 142);
    db.prepare('INSERT INTO sermons (date, title, speaker) VALUES (?,?,?)').run('2025-01-05', 'Faith', 'Ray Harris');
    db.prepare('INSERT INTO bulletins (url, label) VALUES (?,?)').run('/b.pdf', 'January 5');

    const vid = db.prepare('INSERT INTO visitors (name) VALUES (?)').run('Pat Lane').lastInsertRowid;
    db.prepare('INSERT INTO visitor_visits (visitor_id, date, service) VALUES (?,?,?)').run(vid, '2025-01-05', 'AM');

    const did = db.prepare('INSERT INTO deacons (name) VALUES (?)').run('Tom Nelson').lastInsertRowid;
    db.prepare('INSERT INTO deacon_duties (deacon_id, duty, position) VALUES (?,?,?)').run(did, 'Grounds', 0);
    db.prepare('INSERT INTO deacon_duties (deacon_id, duty, position) VALUES (?,?,?)').run(did, 'Benevolence', 1);

    const { body: { data } } = await request(buildApp(MEMBER)).get('/api/members/data');

    expect(data.lastUpdated).toBe('2025-03-01T00:00:00Z');
    expect(data.warnings).toEqual(['sermons: parse error']);
    expect(data.attendance).toEqual([{ date: '2025-01-05', service: 'AM', count: 142 }]);
    expect(data.visitors).toEqual([
      { name: 'Pat Lane', comments: '', visits: [{ date: '2025-01-05', service: 'AM' }] },
    ]);
    // Duties come back in the order they were recorded, not alphabetically
    expect(data.deacons).toEqual([{ name: 'Tom Nelson', duties: ['Grounds', 'Benevolence'] }]);
    expect(data.bulletins).toEqual([{ url: '/b.pdf', label: 'January 5' }]);
  });

  test('orders job assignments by the day in their text date, not lexically', async () => {
    db.prepare("INSERT INTO scraped_meta (id, last_updated, last_warnings) VALUES (1, 'now', '[]')").run();
    const ins = db.prepare('INSERT INTO job_assignments (month, date, service, job, name) VALUES (?,?,?,?,?)');
    ins.run('April 2025', 'April 27', 'AM', 'Usher',       'Lee Park');
    ins.run('April 2025', 'April 6',  'AM', 'Song Leader', 'Tom Nelson');

    const { body: { data } } = await request(buildApp(MEMBER)).get('/api/members/data');
    // The 6th must land before the 27th
    expect(data.jobAssignments.assignments.map(a => a.date)).toEqual(['April 6', 'April 27']);
    expect(data.jobAssignments.month).toBe('April 2025');
  });

  test('falls back to the JSON backup when the database has no meta row', async () => {
    fs.writeFileSync(process.env.CAPSHAW_DATA_FILE,
      JSON.stringify({ lastUpdated: '2024-12-01T00:00:00Z', sermons: [{ title: 'From the backup' }] }));

    const { body: { data } } = await request(buildApp(MEMBER)).get('/api/members/data');
    expect(data.lastUpdated).toBe('2024-12-01T00:00:00Z');
    expect(data.sermons[0].title).toBe('From the backup');
  });

  test('an empty JSON backup counts as no data', async () => {
    fs.writeFileSync(process.env.CAPSHAW_DATA_FILE, '{}');
    const { body: { data } } = await request(buildApp(MEMBER)).get('/api/members/data');
    expect(data).toBeNull();
  });
});

// ─── POST /update ─────────────────────────────────────────────────────────────

describe('POST /api/members/update', () => {
  test('401 signed out, 403 while pending', async () => {
    expect((await request(buildApp(null)).post('/api/members/update')).status).toBe(401);
    expect((await request(buildApp(PENDING)).post('/api/members/update')).status).toBe(403);
  });

  test('parses every page and writes what it found', async () => {
    serveSite();

    const res = await request(buildApp(MEMBER)).post('/api/members/update');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.lastUpdated).toBeTruthy();

    expect(db.prepare('SELECT COUNT(*) AS n FROM attendance').get().n).toBeGreaterThan(0);
    expect(db.prepare('SELECT title FROM sermons').get().title).toBe('Faith That Works');
    expect(db.prepare('SELECT label FROM bulletins').get().label).toBe('January 5 Bulletin');
    expect(db.prepare('SELECT name FROM directory').get().name).toBe('Ray Harris');

    // A fresh session is forced first, so a stale cookie cannot silently fail
    expect(resetSession).toHaveBeenCalled();
  });

  test('also writes the JSON backup', async () => {
    serveSite();
    await request(buildApp(MEMBER)).post('/api/members/update');

    const backup = JSON.parse(fs.readFileSync(process.env.CAPSHAW_DATA_FILE, 'utf8'));
    expect(backup.sermons[0].title).toBe('Faith That Works');
    expect(backup.directory[0].name).toBe('Ray Harris');
  });

  test('fails outright when the site bounces the scraper to the login page', async () => {
    serveSite({ '/members/attendance': page('', { url: 'https://capshawchurch.org/members/login' }) });

    const res = await request(buildApp(MEMBER)).post('/api/members/update');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Session expired or login failed/);
    // Nothing is written on a failed sign-in
    expect(db.prepare('SELECT COUNT(*) AS n FROM sermons').get().n).toBe(0);
  });

  test('a section that will not load is a warning, and the rest still saves', async () => {
    serveSite({ '/members/sermons': new Error('socket hang up') });

    const res = await request(buildApp(MEMBER)).post('/api/members/update');
    expect(res.status).toBe(200);
    expect(res.body.warnings).toContain('sermons: fetch error — socket hang up');
    expect(db.prepare('SELECT COUNT(*) AS n FROM attendance').get().n).toBeGreaterThan(0);
  });

  test('a section the church site has disabled is reported as not found', async () => {
    serveSite({ '/members/deacons': page('<h1>Page Not Found</h1>') });

    const { body } = await request(buildApp(MEMBER)).post('/api/members/update');
    expect(body.warnings.some(w => w.startsWith('deacons: page not found (404)'))).toBe(true);
  });

  test('a 404 status counts as not found even without the page text', async () => {
    serveSite({ '/members/visitor-tracker': page('', { status: 404 }) });

    const { body } = await request(buildApp(MEMBER)).post('/api/members/update');
    expect(body.warnings.some(w => w.startsWith('visitors: page not found (404)'))).toBe(true);
  });

  test('a page that loads but reads as nothing is a warning, not a silent success', async () => {
    // The visitor tracker's layout changing is what this is about: the page
    // comes back full, the parser makes nothing of it, and the old rows are
    // kept. That used to be reported as a clean scrape.
    const unreadable = `<html><body>${'<div>something the parser does not know</div>'.repeat(80)}</body></html>`;
    serveSite({ '/members/visitor-tracker': page(unreadable) });

    const { body } = await request(buildApp(MEMBER)).post('/api/members/update');
    expect(body.warnings.some(w => w.startsWith('visitors: the page loaded but nothing could be read'))).toBe(true);
  });

  test('a section that is genuinely empty is not reported as a parse miss', async () => {
    serveSite({ '/members/visitor-tracker': page('<h2>Visitor Tracker</h2><p>No visitors recorded.</p>') });

    const { body } = await request(buildApp(MEMBER)).post('/api/members/update');
    expect(body.warnings.some(w => w.startsWith('visitors:'))).toBe(false);
  });

  test("a guest's address and phone come across from the tracker", async () => {
    const tracker = `
      <div class="vt-card">
        <button class="vt-head"><span class="vt-name">Ray Ann Boyd</span><span class="vt-meta">Last on 09/13/26</span></button>
        <div class="vt-body">
          <div class="dir-row"><span class="dir-v"><a href="https://maps.google.com/?q=6617%20Camilla%20Drive%2CMadison%2CAL%2035757">6617 Camilla Drive</a></span></div>
          <div class="dir-row"><span class="dir-v">(256) 777-4009</span></div>
          <h4 class="vt-sub">Visit History</h4>${table([['Date', 'Service'], ['09/13/26', 'Sun AM']])}
        </div>
      </div>`;

    serveSite({ '/members/visitor-tracker': page(tracker) });
    await request(buildApp(MEMBER)).post('/api/members/update');

    expect(db.prepare('SELECT name, phone, address, city, state, zip FROM visitors').get()).toEqual({
      name: 'Ray Ann Boyd', phone: '(256) 777-4009',
      address: '6617 Camilla Drive', city: 'Madison', state: 'AL', zip: '35757',
    });
  });

  test('a detail the tracker does not carry keeps what somebody typed in', async () => {
    // An empty scrape is not a correction: the card has no email on it, so the
    // one entered by hand stays, while the phone the card does carry wins.
    const tracker = `
      <div class="vt-card">
        <button class="vt-head"><span class="vt-name">Ray Ann Boyd</span><span class="vt-meta">Last on 09/13/26</span></button>
        <div class="vt-body">
          <div class="dir-row"><span class="dir-v">(256) 777-4009</span></div>
          <h4 class="vt-sub">Visit History</h4>${table([['Date', 'Service'], ['09/13/26', 'Sun AM']])}
        </div>
      </div>`;

    db.prepare('INSERT INTO visitors (name, email, phone, notes) VALUES (?, ?, ?, ?)')
      .run('Ray Ann Boyd', 'ray@example.com', '(000) 000-0000', 'Sat with the Carters');

    serveSite({ '/members/visitor-tracker': page(tracker) });
    await request(buildApp(MEMBER)).post('/api/members/update');

    expect(db.prepare('SELECT email, phone, notes FROM visitors').get()).toEqual({
      email: 'ray@example.com', phone: '(256) 777-4009', notes: 'Sat with the Carters',
    });
  });

  test('the tracker is widened to every date and read to its last page', async () => {
    // The page shows a slice: a dropdown picks the span, the rest runs onto
    // further pages. Fetching it as it arrives collects whichever guests the
    // site felt like showing.
    const filter = span => `
      <form method="get" action="/members/visitor-tracker">
        <select name="range">
          <option value="90">Last 90 Days</option>
          <option value="all"${span === 'all' ? ' selected' : ''}>All Time</option>
        </select>
      </form>`;
    const guest = name => `
      <span class="vt-name">${name}</span><span class="vt-meta">Last on 09/13/26</span>
      <h4 class="vt-sub">Visit History</h4>${table([['Date', 'Service'], ['09/13/26', 'Sun AM']])}`;

    serveSite({
      // As it arrives: 90 days, one guest, and no pager at all.
      '/members/visitor-tracker': page(`${filter('90')}${guest('Only Recent')}`),
      // Widened: everybody, across three pages.
      '/members/visitor-tracker?range=all': page(
        `${filter('all')}${guest('Dana Whitfield')}<a href="?range=all&page=2">2</a>`),
      '/members/visitor-tracker?range=all&page=2': page(
        `${filter('all')}${guest('Sam Ford')}<a href="?range=all&page=3">3</a>`),
      '/members/visitor-tracker?range=all&page=3': page(`${filter('all')}${guest('Marcus Reed')}`),
    });

    const res = await request(buildApp(MEMBER)).post('/api/members/update');
    expect(res.status).toBe(200);

    expect(db.prepare('SELECT name FROM visitors ORDER BY name').all().map(v => v.name))
      .toEqual(['Dana Whitfield', 'Marcus Reed', 'Sam Ford']);
    // The unwidened page's guest was never the whole story, and is not kept.
    expect(res.body.warnings.filter(w => w.startsWith('visitors:'))).toEqual([]);
  });

  test('a page of the tracker that will not load is a warning, and the rest is kept', async () => {
    const guest = name => `
      <span class="vt-name">${name}</span>
      <h4 class="vt-sub">Visit History</h4>${table([['Date', 'Service'], ['09/13/26', 'Sun AM']])}`;

    serveSite({
      '/members/visitor-tracker': page(`${guest('Dana Whitfield')}<a href="?page=2">2</a>`),
      '/members/visitor-tracker?page=2': page('', { status: 500 }),
    });

    const { body } = await request(buildApp(MEMBER)).post('/api/members/update');

    expect(db.prepare('SELECT name FROM visitors').all().map(v => v.name)).toEqual(['Dana Whitfield']);
    expect(body.warnings.some(w => w.includes('page=2') && w.includes('some guests may be missing'))).toBe(true);
  });

  test('a pager that loops back on itself is followed once', async () => {
    const guest = name => `
      <span class="vt-name">${name}</span>
      <h4 class="vt-sub">Visit History</h4>${table([['Date', 'Service'], ['09/13/26', 'Sun AM']])}`;
    const bothWays = '<a href="/members/visitor-tracker?page=1">1</a><a href="/members/visitor-tracker?page=2">2</a>';

    serveSite({
      '/members/visitor-tracker':        page(`${guest('Dana Whitfield')}${bothWays}`),
      '/members/visitor-tracker?page=1': page(`${guest('Dana Whitfield')}${bothWays}`),
      '/members/visitor-tracker?page=2': page(`${guest('Sam Ford')}${bothWays}`),
    });

    const { body } = await request(buildApp(MEMBER)).post('/api/members/update');

    expect(body.warnings.filter(w => w.startsWith('visitors:'))).toEqual([]);
    expect(db.prepare('SELECT name FROM visitors ORDER BY name').all().map(v => v.name))
      .toEqual(['Dana Whitfield', 'Sam Ford']);
  });

  test("a guest named after the site's own menu is cleared", async () => {
    const tracker = `
      <span class="vt-name">Ray Ann Boyd</span>
      <h4 class="vt-sub">Visit History</h4>${table([['Date', 'Service'], ['09/13/26', 'Sun AM']])}`;

    // A phone number no longer means somebody typed one in: the tracker's own
    // cards carry them. What guards a row is what is ours — a note, who
    // invited them, a follow-up that reached them.
    db.prepare('INSERT INTO visitors (name) VALUES (?)').run('About Us');
    db.prepare('INSERT INTO visitors (name) VALUES (?)').run('Protected Email');
    db.prepare('INSERT INTO visitors (name, phone, address) VALUES (?, ?, ?)')
      .run('Our Elders', '256-555-0134', '6617 Camilla Drive');
    db.prepare('INSERT INTO visitors (name, notes) VALUES (?, ?)')
      .run('Visitor Notes', 'Kept because somebody wrote this');

    serveSite({ '/members/visitor-tracker': page(tracker) });
    await request(buildApp(MEMBER)).post('/api/members/update');

    // The three the parser would never produce go, address and phone and all,
    // because the tracker put those there rather than a person. The one
    // somebody wrote a note on stays, however it is named.
    expect(db.prepare('SELECT name FROM visitors ORDER BY name').all().map(v => v.name))
      .toEqual(['Ray Ann Boyd', 'Visitor Notes']);
  });

  test('a guest the old parser named after their comment is cleared by the re-scrape', async () => {
    // Before the parser could tell a name from a comment, this page produced a
    // guest called "Just moved from Foley, AL". Guests are matched by name, so
    // that row survives the scrape that reads the page correctly unless it is
    // taken out — leaving the same person listed twice, once under a sentence.
    const tracker = `
      <p class="visitor-name">Pat Lane</p>
      <h4>Comments</h4><p>Just moved from Foley, AL</p>
      <h4>Visit History</h4>${table([['Date', 'Service'], ['09/13/26', 'Sun AM']])}`;

    const misread = db.prepare('INSERT INTO visitors (name) VALUES (?)').run('Just moved from Foley, AL').lastInsertRowid;
    db.prepare('INSERT INTO visitor_visits (visitor_id, date, service) VALUES (?,?,?)').run(misread, '09/13/26', 'Sun AM');

    serveSite({ '/members/visitor-tracker': page(tracker) });
    const res = await request(buildApp(MEMBER)).post('/api/members/update');
    expect(res.status).toBe(200);

    expect(db.prepare('SELECT name, comments FROM visitors').all()).toEqual([
      { name: 'Pat Lane', comments: 'Just moved from Foley, AL' },
    ]);
    // The row went, and its visits went with it rather than being orphaned.
    expect(db.prepare('SELECT COUNT(*) AS n FROM visitor_visits WHERE visitor_id = ?').get(misread).n).toBe(0);
  });

  test("a guest named after the card's summary line is cleared too", async () => {
    // "Last on 09/13/26" is what the card puts beside the name, and what every
    // guest was called before the name was read properly. No person's name
    // carries a digit, so a row whose does is a scrape artifact.
    const tracker = `
      <div class="vt-card">
        <button class="vt-head"><span class="vt-name">Ray Ann Boyd</span><span class="vt-meta">Last on 09/13/26</span></button>
        <div class="vt-body"><h4 class="vt-sub">Visit History</h4>${table([['Date', 'Service'], ['09/13/26', 'Sun AM']])}</div>
      </div>`;

    db.prepare('INSERT INTO visitors (name) VALUES (?)').run('Last on 09/13/26');
    db.prepare('INSERT INTO visitors (name, notes) VALUES (?, ?)').run('Last on 08/30/26', 'Sat with the Carters');

    serveSite({ '/members/visitor-tracker': page(tracker) });
    await request(buildApp(MEMBER)).post('/api/members/update');

    // The untouched one goes; the one somebody wrote a note on stays.
    expect(db.prepare('SELECT name FROM visitors ORDER BY name').all().map(v => v.name))
      .toEqual(['Last on 08/30/26', 'Ray Ann Boyd']);
  });

  test('a scrape that read no guests tidies nothing', async () => {
    // A page that comes back unreadable must never be a reason to delete rows.
    db.prepare('INSERT INTO visitors (name) VALUES (?)').run('Last on 09/13/26');

    serveSite({ '/members/visitor-tracker': page('<h2>Visitor Tracker</h2><p>No visitors recorded.</p>') });
    await request(buildApp(MEMBER)).post('/api/members/update');

    expect(db.prepare('SELECT COUNT(*) AS n FROM visitors').get().n).toBe(1);
  });

  test('a misread guest somebody has since typed into is left alone', async () => {
    // Removing it would throw away the only copy of what was typed. A duplicate
    // in the list is recoverable by hand; a deleted note is not.
    const tracker = `
      <p class="visitor-name">Pat Lane</p>
      <h4>Comments</h4><p>Just moved from Foley, AL</p>
      <h4>Visit History</h4>${table([['Date', 'Service'], ['09/13/26', 'Sun AM']])}`;

    db.prepare('INSERT INTO visitors (name, notes) VALUES (?, ?)')
      .run('Just moved from Foley, AL', 'Rang them on Tuesday');

    serveSite({ '/members/visitor-tracker': page(tracker) });
    await request(buildApp(MEMBER)).post('/api/members/update');

    expect(db.prepare('SELECT name FROM visitors ORDER BY name').all().map(v => v.name))
      .toEqual(['Just moved from Foley, AL', 'Pat Lane']);
  });

  test('a section that fails keeps the rows the last good scrape left', async () => {
    db.prepare("INSERT INTO scraped_meta (id, last_updated, last_warnings) VALUES (1, 'earlier', '[]')").run();
    db.prepare('INSERT INTO sermons (date, title, speaker) VALUES (?,?,?)').run('2024-12-01', 'Kept from before', 'Ray Harris');
    serveSite({ '/members/sermons': new Error('gateway timeout') });

    await request(buildApp(MEMBER)).post('/api/members/update');
    expect(db.prepare('SELECT title FROM sermons').get().title).toBe('Kept from before');
  });

  test('a failed directory scrape is a warning and leaves the directory alone', async () => {
    db.prepare('INSERT INTO directory (name, email) VALUES (?,?)').run('Existing Person', 'e@example.com');
    serveSite();
    scrapeDirectory.mockRejectedValue(new Error('no families found on /members/directory'));

    const res = await request(buildApp(MEMBER)).post('/api/members/update');
    expect(res.status).toBe(200);
    expect(res.body.warnings).toContain('directory: scrape failed — no families found on /members/directory');
    // An empty directory would prune everyone; the existing row must survive
    expect(db.prepare('SELECT name FROM directory').get().name).toBe('Existing Person');
  });

  test('warnings raised by the directory scrape are passed along', async () => {
    serveSite();
    scrapeDirectory.mockResolvedValue({
      people: [{ name: 'Ray Harris', familyId: '1' }], families: [],
      warnings: ['family 2 (Nelson): HTTP 404'],
      summary: { families: 2, people: 1, photos: 0, photosReused: 0, noPhoto: 0, photoErrors: 0 },
    });

    const { body } = await request(buildApp(MEMBER)).post('/api/members/update');
    expect(body.warnings).toContain('family 2 (Nelson): HTTP 404');
  });

  test('hands the scrape the photos it already has, so unchanged ones are not re-downloaded', async () => {
    fs.writeFileSync(process.env.CAPSHAW_DATA_FILE, JSON.stringify({
      directory: [
        { name: 'Ray Harris', familyId: '1', photo: { file: 'abc.jpg', version: 'v1' } },
        { name: 'Jo Nelson',  familyId: '2' },
      ],
    }));
    serveSite();

    await request(buildApp(MEMBER)).post('/api/members/update');

    const { known } = scrapeDirectory.mock.calls[0][0];
    expect(known.get('1')).toEqual({ file: 'abc.jpg', version: 'v1' });
    // Somebody with no stored photo is not offered as already-known
    expect(known.has('2')).toBe(false);
  });

  test('a job-assignments page that yields nothing leaves the existing month in place', async () => {
    db.prepare("INSERT INTO scraped_meta (id, last_updated, last_warnings) VALUES (1, 'earlier', '[]')").run();
    db.prepare('INSERT INTO job_assignments (month, date, service, job, name) VALUES (?,?,?,?,?)')
      .run('March 2025', 'March 2', 'AM', 'Usher', 'Lee Park');
    serveSite({ '/members/job-assignments': new Error('timed out') });

    await request(buildApp(MEMBER)).post('/api/members/update');
    // Clearing the roster because a fetch failed is exactly the bug guarded here
    expect(db.prepare('SELECT name FROM job_assignments').get().name).toBe('Lee Park');
  });

  test('refuses to start a second scrape while one is running', async () => {
    let release = () => {};
    serveSite();
    // Hold the attendance fetch open so the first scrape is still in flight.
    fetchPage.mockImplementation(path =>
      path === '/members/attendance'
        ? new Promise(r => { release = () => r(page(ATTENDANCE_HTML, { url: '/members/attendance' })); })
        : Promise.resolve(page('')));

    // .then() is what actually sends a supertest request
    const first = request(buildApp(MEMBER)).post('/api/members/update').then(r => r);
    try {
      // Give the first request time to take the lock
      await new Promise(r => setTimeout(r, 20));

      const second = await request(buildApp(MEMBER)).post('/api/members/update');
      expect(second.status).toBe(409);
      expect(second.body.error).toMatch(/already in progress/);

      expect((await request(buildApp(MEMBER)).get('/api/members/status')).body.updateInProgress).toBe(true);
    } finally {
      release();
      await first;
    }

    // The lock is released once the scrape finishes
    expect((await request(buildApp(MEMBER)).get('/api/members/status')).body.updateInProgress).toBe(false);
  });
});

// ─── GET /debug/:section ──────────────────────────────────────────────────────

describe('GET /api/members/debug/:section', () => {
  test('401 signed out, 403 for a member — debugging is admin-only', async () => {
    expect((await request(buildApp(null)).get('/api/members/debug/sermons')).status).toBe(401);
    expect((await request(buildApp(MEMBER)).get('/api/members/debug/sermons')).status).toBe(403);
  });

  test('404 for an unknown section, listing the ones that exist', async () => {
    const res = await request(buildApp(ADMIN)).get('/api/members/debug/nonsense');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Try one of: jobAssignments, attendance/);
  });

  test('reports what the page returned and what the parser made of it', async () => {
    serveSite();
    const res = await request(buildApp(ADMIN)).get('/api/members/debug/sermons');

    expect(res.status).toBe(200);
    expect(res.body.section).toBe('sermons');
    expect(res.body.report).toMatchObject({
      path: '/members/sermons', status: 200, looksLikeLogin: false, pageNotFound: false,
    });
    expect(res.body.report.bytes).toBe(SERMONS_HTML.length);
    // Every table is described so a shape change on the site is visible
    expect(res.body.report.tables[0].rowCount).toBe(2);
    expect(res.body.report.parsed).toMatchObject({ shape: 'array', count: 1 });
  });

  test('flags a page that is really the login form', async () => {
    serveSite({ '/members/sermons': page('<form action="/members/login"><input name="_token" value="x"></form>') });
    const { body } = await request(buildApp(ADMIN)).get('/api/members/debug/sermons');
    expect(body.report.looksLikeLogin).toBe(true);
  });

  test('flags a page the church site no longer publishes', async () => {
    serveSite({ '/members/deacons': page('<h1>Page Not Found</h1>', { status: 404 }) });
    const { body } = await request(buildApp(ADMIN)).get('/api/members/debug/deacons');
    expect(body.report.pageNotFound).toBe(true);
  });

  test('truncates long cells in the sample rows', async () => {
    const long = 'x'.repeat(100);
    serveSite({ '/members/sermons': page(table([['Date', long]])) });

    const { body } = await request(buildApp(ADMIN)).get('/api/members/debug/sermons');
    const cell = body.report.tables[0].sampleRows[0][1];
    expect(cell).toHaveLength(41);
    expect(cell.endsWith('…')).toBe(true);
  });

  test('describes the job-assignments object shape, month included', async () => {
    serveSite();
    const { body } = await request(buildApp(ADMIN)).get('/api/members/debug/jobAssignments');
    expect(body.report.parsed.shape).toBe('object');
    expect(body.report.parsed).toHaveProperty('month');
  });

  test('counts families and portraits for the directory, and skips the table dump', async () => {
    const cards = ['1', '2'].map(id => `
      <a class="c-card" href="/members/directory/family/${id}">
        <img src="/media/uploads/photos/families/thumbs/${id === '1' ? '1.jpg?h=v1' : 'no-image.png'}">
        <h2 class="c-title">Family ${id}</h2>
      </a>`).join('');
    serveSite({ '/members/directory': page(cards) });

    const { body } = await request(buildApp(ADMIN)).get('/api/members/debug/directory');
    expect(body.report.photos).toEqual({ families: 2, withPhoto: 1, placeholder: 1 });
    // The directory is not a table, so no table report is produced for it
    expect(body.report.tables).toBeUndefined();
  });

  test('502 when the page cannot be fetched at all', async () => {
    serveSite({ '/members/sermons': new Error('ECONNRESET') });
    const res = await request(buildApp(ADMIN)).get('/api/members/debug/sermons');
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('ECONNRESET');
  });
});
