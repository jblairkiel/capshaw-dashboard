jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const request = require('supertest');
const express = require('express');
const db      = require('../db');
const keeping = require('../lib/recordKeeping');
const router  = require('../routes/recordKeeping');

// A Wednesday. The week runs Sunday 27 September – Saturday 3 October; the
// week before starts Sunday 20 September.
const TODAY = '2026-09-30';

function songs(date, service, count = 3) {
  const { lastInsertRowid: id } = db.prepare('INSERT INTO song_services (date, service, leader) VALUES (?, ?, ?)').run(date, service, 'Sample Leader');
  for (let i = 0; i < count; i++) {
    const { lastInsertRowid: song } = db.prepare('INSERT INTO songs (title) VALUES (?)').run(`Song ${id}-${i}`);
    db.prepare('INSERT INTO service_songs (service_id, song_id, position) VALUES (?, ?, ?)').run(id, song, i);
  }
}

function guest(date, service) {
  const { lastInsertRowid: v } = db.prepare('INSERT INTO visitors (name) VALUES (?)').run('Sample Guest');
  db.prepare('INSERT INTO visitor_visits (visitor_id, date, service) VALUES (?, ?, ?)').run(v, date, service);
}

const attend = (date, service, count = 40) =>
  db.prepare('INSERT INTO attendance (date, service, count) VALUES (?, ?, ?)').run(date, service, count);
const give = (date, amount = 5000) => db.prepare('INSERT INTO contributions (date, amount) VALUES (?, ?)').run(date, amount);

const ADMIN   = { id: 1, name: 'Office Admin', role: 'admin' };
const KEEPER  = { id: 2, name: 'Record Keeper', role: 'approved', areas: ['records'] };
const MEMBER  = { id: 3, name: 'Member', role: 'approved', areas: ['songs'] };

function buildApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/record-keeping', router);
  return app;
}

beforeAll(() => {
  const add = db.prepare("INSERT INTO users (id, provider, provider_id, email, name, role) VALUES (?, 'local', ?, ?, ?, ?)");
  for (const u of [ADMIN, KEEPER, MEMBER]) add.run(u.id, `u${u.id}`, `u${u.id}@example.invalid`, u.name, u.role);
});

beforeEach(() => {
  for (const t of ['service_songs', 'song_services', 'songs', 'visitor_visits', 'visitors', 'attendance', 'contributions', 'record_checkoffs']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
});

const weekOf = (r, start) => r.weeks.find(w => w.start === start);
const row = (week, date, service) => week.rows.find(x => x.date === date && x.service === service);

describe('which services are expected', () => {
  test('starts from a guess made from each service name', () => {
    const tracked = db.prepare("SELECT name, tracking, weekday, song_names FROM service_types WHERE tracking <> '' ORDER BY sort_order").all();
    expect(tracked).toEqual([
      { name: 'Sunday AM Worship', tracking: 'weekly', weekday: 0, song_names: 'AM' },
      { name: 'Sunday PM Worship', tracking: 'when-held', weekday: 0, song_names: 'PM' },
      { name: 'Wednesday Bible Study', tracking: 'weekly', weekday: 3, song_names: 'Wednesday' },
      { name: 'Gospel Meeting', tracking: 'when-held', weekday: null, song_names: '' },
    ]);
  });

  test('a weekly service is expected on its day, up to today and not beyond', () => {
    const r = keeping.report({ weeks: 2, today: TODAY });
    expect(weekOf(r, '2026-09-27').rows.map(x => `${x.date} ${x.service}`)).toEqual([
      '2026-09-27 Sunday AM Worship', '2026-09-30 Wednesday Bible Study',
    ]);
    expect(weekOf(r, '2026-09-20').rows).toHaveLength(2);

    const sunday = keeping.report({ weeks: 1, today: '2026-09-27' });
    expect(sunday.weeks[0].rows.map(x => x.service)).toEqual(['Sunday AM Worship']);
  });

  test('a service held only sometimes is expected only when something shows it happened', () => {
    attend('2026-09-27', 'Sunday PM Worship');
    guest('09/24/26', 'Gospel Meeting');

    const r = keeping.report({ weeks: 2, today: TODAY });
    expect(row(weekOf(r, '2026-09-27'), '2026-09-27', 'Sunday PM Worship')).toBeTruthy();
    expect(row(weekOf(r, '2026-09-20'), '2026-09-20', 'Sunday PM Worship')).toBeUndefined();
    expect(row(weekOf(r, '2026-09-20'), '2026-09-24', 'Gospel Meeting')).toBeTruthy();
  });

  test('a service that is not tracked never appears', () => {
    attend('2026-09-27', 'Sunday Bible Study');
    const r = keeping.report({ weeks: 1, today: TODAY });
    expect(r.weeks[0].rows.some(x => x.service === 'Sunday Bible Study')).toBe(false);
  });
});

describe('what counts as recorded', () => {
  test('songs count under the song tracker’s own name for the service', () => {
    songs('2026-09-27', 'AM');
    const r = keeping.report({ weeks: 1, today: TODAY });
    expect(row(r.weeks[0], '2026-09-27', 'Sunday AM Worship').cells.songs.status).toBe('recorded');
    expect(row(r.weeks[0], '2026-09-30', 'Wednesday Bible Study').cells.songs.status).toBe('missing');
  });

  test('a service entered in the song tracker with no songs in it is still missing', () => {
    songs('2026-09-27', 'AM', 0);
    const r = keeping.report({ weeks: 1, today: TODAY });
    expect(row(r.weeks[0], '2026-09-27', 'Sunday AM Worship').cells.songs.status).toBe('missing');
  });

  test('guests count whichever way the date was written', () => {
    guest('09/27/26', 'Sunday AM Worship');
    const r = keeping.report({ weeks: 1, today: TODAY });
    expect(row(r.weeks[0], '2026-09-27', 'Sunday AM Worship').cells.guests.status).toBe('recorded');
  });

  test('the week’s contribution counts whatever day in the week it is dated', () => {
    give('2026-09-21');
    const r = keeping.report({ weeks: 2, today: TODAY });
    expect(weekOf(r, '2026-09-20').contribution.status).toBe('recorded');
    expect(weekOf(r, '2026-09-27').contribution.status).toBe('missing');
  });

  test('counts what is missing, check by check', () => {
    songs('2026-09-27', 'AM');
    guest('2026-09-27', 'Sunday AM Worship');
    give('2026-09-27');
    const r = keeping.report({ weeks: 1, today: TODAY });
    expect(r.missing).toEqual({ songs: 1, guests: 1, contribution: 0, 'head-count': 0 });
    expect(r.totalMissing).toBe(2);
  });
});

describe('signing off', () => {
  test('"no guests" turns a missing cell into a signed-off one, with who said so', () => {
    const { checkoff } = keeping.addCheckoff({ date: '2026-09-30', service: 'Wednesday Bible Study', check: 'guests' }, KEEPER, { today: TODAY });
    const r = keeping.report({ weeks: 1, today: TODAY });
    expect(row(r.weeks[0], '2026-09-30', 'Wednesday Bible Study').cells.guests).toEqual({ status: 'none', checkoffId: checkoff.id, by: 'Record Keeper', note: '' });
  });

  test('a service that did not happen is excused from every check', () => {
    keeping.addCheckoff({ date: '2026-09-27', service: 'sunday am worship', check: 'not-held', note: 'Snow' }, KEEPER, { today: TODAY });
    const r = keeping.report({ weeks: 1, today: TODAY });
    const sunday = row(r.weeks[0], '2026-09-27', 'Sunday AM Worship');
    expect(sunday.notHeld).toMatchObject({ by: 'Record Keeper', note: 'Snow' });
    expect(sunday.cells).toEqual({});
    expect(r.missing.songs).toBe(1);  // only Wednesday's
  });

  test('"no contribution" is for a Sunday', () => {
    expect(keeping.addCheckoff({ date: '2026-09-28', check: 'contribution' }, KEEPER, { today: TODAY }).error).toMatch(/Sunday/);
    expect(keeping.addCheckoff({ date: '2026-09-27', check: 'contribution' }, KEEPER, { today: TODAY }).checkoff).toBeTruthy();
    expect(keeping.report({ weeks: 1, today: TODAY }).weeks[0].contribution.status).toBe('none');
  });

  test('refuses what cannot be right', () => {
    const cases = [
      [{ date: 'yesterday', service: 'Sunday AM Worship', check: 'guests' }, /date/],
      [{ date: '2026-02-30', service: 'Sunday AM Worship', check: 'guests' }, /date/],
      [{ date: '2026-09-27', service: 'Sunday AM Worship', check: 'hymns' }, /not something/],
      [{ date: '2026-09-27', service: 'Choir Practice', check: 'guests' }, /No such service/],
      [{ date: '2099-01-04', service: 'Sunday AM Worship', check: 'guests' }, /not happened/],
    ];
    for (const [input, message] of cases) expect(keeping.addCheckoff(input, KEEPER, { today: TODAY }).error).toMatch(message);

    keeping.addCheckoff({ date: '2026-09-27', service: 'Sunday AM Worship', check: 'guests' }, KEEPER, { today: TODAY });
    expect(keeping.addCheckoff({ date: '2026-09-27', service: 'Sunday AM Worship', check: 'guests' }, KEEPER, { today: TODAY }).error).toMatch(/already/);
  });

  test('a sign-off can be taken back', () => {
    const { checkoff } = keeping.addCheckoff({ date: '2026-09-30', service: 'Wednesday Bible Study', check: 'guests' }, KEEPER, { today: TODAY });
    expect(keeping.removeCheckoff(checkoff.id).removed.id).toBe(checkoff.id);
    expect(row(keeping.report({ weeks: 1, today: TODAY }).weeks[0], '2026-09-30', 'Wednesday Bible Study').cells.guests.status).toBe('missing');
    expect(keeping.removeCheckoff(checkoff.id).error).toBeTruthy();
  });
});

describe('changing which services are tracked', () => {
  const id = name => db.prepare('SELECT id FROM service_types WHERE name = ?').get(name).id;
  afterEach(() => {
    keeping.updateService(id('Sunday PM Worship'), { tracking: 'when-held', weekday: 0, songNames: 'PM' });
  });

  test('a service can become weekly, with the song tracker’s names tidied', () => {
    const { service } = keeping.updateService(id('Sunday PM Worship'), { tracking: 'weekly', weekday: 0, songNames: ' PM ,Evening,' });
    expect(service).toMatchObject({ tracking: 'weekly', weekday: 0, song_names: 'PM, Evening' });
    const r = keeping.report({ weeks: 1, today: TODAY });
    expect(row(r.weeks[0], '2026-09-27', 'Sunday PM Worship')).toBeTruthy();
  });

  test('a weekly service needs a day, and nonsense is refused', () => {
    expect(keeping.updateService(id('Sunday PM Worship'), { tracking: 'weekly', weekday: '' }).error).toMatch(/day/);
    expect(keeping.updateService(id('Sunday PM Worship'), { tracking: 'monthly', weekday: 0 }).error).toBeTruthy();
    expect(keeping.updateService(id('Sunday PM Worship'), { tracking: 'weekly', weekday: 9 }).error).toBeTruthy();
    expect(keeping.updateService(9999, { tracking: '' }).error).toMatch(/No such/);
  });
});

describe('the API', () => {
  test('is for admins and whoever keeps the records', async () => {
    for (const user of [null, MEMBER]) {
      expect([401, 403]).toContain((await request(buildApp(user)).get('/api/record-keeping')).status);
    }
    for (const user of [ADMIN, KEEPER]) {
      const res = await request(buildApp(user)).get('/api/record-keeping?weeks=3');
      expect(res.status).toBe(200);
      expect(res.body.weeks).toHaveLength(3);
      expect(res.body.checks.map(c => c.id)).toEqual(['songs', 'guests', 'contribution', 'head-count']);
    }
  });

  test('signs off and takes it back', async () => {
    const lastSunday = keeping.addDays(keeping.sundayOf(keeping.churchToday()), -7);
    const made = await request(buildApp(KEEPER)).post('/api/record-keeping/checkoffs')
      .send({ date: lastSunday, service: 'Sunday AM Worship', check: 'guests' });
    expect(made.status).toBe(201);
    expect(made.body.checkoff).toMatchObject({ date: lastSunday, check_id: 'guests', user_name: 'Record Keeper' });

    const again = await request(buildApp(KEEPER)).post('/api/record-keeping/checkoffs')
      .send({ date: lastSunday, service: 'Sunday AM Worship', check: 'guests' });
    expect(again.status).toBe(400);

    expect((await request(buildApp(KEEPER)).delete(`/api/record-keeping/checkoffs/${made.body.checkoff.id}`)).status).toBe(200);
    expect((await request(buildApp(KEEPER)).delete(`/api/record-keeping/checkoffs/${made.body.checkoff.id}`)).status).toBe(404);
  });

  test('shows and changes the service settings', async () => {
    songs('2026-09-27', 'AM');
    const list = await request(buildApp(ADMIN)).get('/api/record-keeping/services');
    expect(list.body.songNames).toEqual(['AM']);
    expect(list.body.weekdays[3]).toBe('Wednesday');

    const gospel = list.body.services.find(s => s.name === 'Gospel Meeting');
    const res = await request(buildApp(ADMIN)).put(`/api/record-keeping/services/${gospel.id}`).send({ tracking: '', weekday: null, songNames: '' });
    expect(res.body.service.tracking).toBe('');
    const bad = await request(buildApp(ADMIN)).put(`/api/record-keeping/services/${gospel.id}`).send({ tracking: 'weekly' });
    expect(bad.status).toBe(400);
    await request(buildApp(ADMIN)).put(`/api/record-keeping/services/${gospel.id}`).send({ tracking: 'when-held', weekday: null, songNames: '' });
  });
});

describe('church group meetings', () => {
  let groupId;
  const meeting = (date, { status = 'published', headCount = null, title = 'Fellowship meal' } = {}) =>
    db.prepare('INSERT INTO group_events (group_id, title, event_date, status, head_count) VALUES (?, ?, ?, ?, ?)')
      .run(groupId, title, date, status, headCount).lastInsertRowid;

  beforeAll(() => {
    groupId = db.prepare("INSERT INTO church_groups (key, name) VALUES ('group-report', 'North Harvest')").run().lastInsertRowid;
  });
  beforeEach(() => db.prepare('DELETE FROM group_events').run());

  test('a posted meeting that has happened needs its head count', () => {
    const missing = meeting('2026-09-24');
    meeting('2026-09-27', { headCount: 12, title: 'Singing' });
    meeting('2026-09-26', { status: 'cancelled' });
    meeting('2026-09-25', { status: 'draft' });
    meeting('2026-10-02');  // not yet

    const r = keeping.report({ weeks: 2, today: TODAY });
    expect(weekOf(r, '2026-09-20').meetings).toEqual([
      { eventId: missing, groupId, group: 'North Harvest', title: 'Fellowship meal', date: '2026-09-24', cell: { status: 'missing' } },
    ]);
    expect(weekOf(r, '2026-09-27').meetings).toEqual([
      expect.objectContaining({ title: 'Singing', cell: { status: 'recorded', count: 12 } }),
    ]);
    expect(r.missing['head-count']).toBe(1);
  });

  test('has no "nothing to record" sign-off: 0 is a head count, and a meeting that did not happen is cancelled', () => {
    expect(keeping.addCheckoff({ date: '2026-09-24', check: 'head-count' }, KEEPER, { today: TODAY }).error)
      .toBe('That is not something the report checks');
  });
});
