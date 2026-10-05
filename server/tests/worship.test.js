// The Upcoming Service page's server side: a song leader submits a whole
// service, the worship organizer is emailed and confirms it, and confirming
// puts its songs in the song tracker. Also the parts a service is made of,
// and members' song requests.
jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const request = require('supertest');
const express = require('express');
const db      = require('../db');
const plans   = require('../lib/worshipPlans');
const router  = require('../routes/worship');

function buildApp(user = null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/worship', router);
  return app;
}

// A Sunday, and the Serving Schedule's month it falls in.
const SUNDAY = '2026-10-04';

const PEOPLE = {
  admin:     { id: 1, name: 'Office Admin',  role: 'admin' },
  organizer: { id: 2, name: 'Olive Organizer', role: 'approved', areas: ['worship-order'], email: 'olive@example.invalid' },
  keeper:    { id: 3, name: 'Kip Keeper',   role: 'approved', areas: ['songs'] },
  leader:    { id: 4, name: 'Lee Leader',   role: 'approved', areas: [] },
  member:    { id: 5, name: 'Mo Member',    role: 'approved', areas: [] },
  pending:   { id: 6, name: 'Pat Pending',  role: 'pending',  areas: [] },
};

let SONGS;
const partId = name => db.prepare('SELECT id FROM worship_parts WHERE name = ?').get(name).id;

beforeAll(() => {
  const addUser = db.prepare("INSERT INTO users (id, provider, provider_id, name, email, role, directory_id) VALUES (?, 'local', ?, ?, ?, ?, ?)");
  for (const [key, u] of Object.entries(PEOPLE)) {
    const dir = db.prepare('INSERT INTO directory (name) VALUES (?)').run(u.name).lastInsertRowid;
    addUser.run(u.id, key, u.name, u.email || `${key}@example.invalid`, u.role, dir);
    u.directory_id = dir;
    for (const a of u.areas || []) db.prepare('INSERT INTO user_areas (user_id, area) VALUES (?, ?)').run(u.id, a);
  }
});

beforeEach(() => {
  for (const t of ['song_requests', 'worship_plan_items', 'worship_plans', 'service_songs', 'song_services', 'songs', 'job_assignments', 'mail_outbox', 'notifications', 'action_log']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
  const add = db.prepare('INSERT INTO songs (id, title, hymnal, number) VALUES (?, ?, ?, ?)');
  SONGS = {
    grace:  add.run(10, 'Amazing Grace', 'Praise for the Lord', '123').lastInsertRowid,
    abide:  add.run(11, 'Abide With Me', 'Praise for the Lord', '40').lastInsertRowid,
    justAs: add.run(12, 'Just As I Am', 'Songs of Faith and Praise', '915').lastInsertRowid,
  };
  // Lee leads singing on the 4th; Mo leads the opening prayer.
  const job = db.prepare("INSERT INTO job_assignments (month, date, service, job, name) VALUES ('October 2026', 'October 4', 'Sunday Worship', ?, ?)");
  job.run('Song Leader', 'Leader, Lee');
  job.run('Opening Prayer', 'Mo Member');
});

// A small service: song, prayer, song, invitation.
function body(overrides = {}) {
  return {
    date: SUNDAY, service: 'Sunday AM Worship', notes: '',
    items: [
      { partId: partId('Song'), songId: SONGS.grace },
      { partId: partId('Opening prayer'), person: 'Mo Member' },
      { partId: partId('Sermon'), person: 'Sample Preacher', detail: 'The Good Shepherd' },
      { partId: partId('Invitation song'), songId: SONGS.justAs },
    ],
    ...overrides,
  };
}
const submit = (user, b = body()) => request(buildApp(user)).post('/api/worship/plans').send(b);

describe('what a service is made of', () => {
  test('starts from a usual Church of Christ service, which the organizer keeps', async () => {
    const res = await request(buildApp(PEOPLE.member)).get('/api/worship/parts');
    expect(res.body.parts.map(p => p.name)).toEqual([
      'Song', 'Opening prayer', 'Scripture reading', "Lord's Supper", 'Sermon', 'Invitation song', 'Announcements', 'Closing prayer',
    ]);
    const names = new Map(res.body.parts.map(p => [p.id, p.name]));
    expect(res.body.outlines.default.map(id => names.get(id)).slice(0, 4)).toEqual(['Song', 'Song', 'Opening prayer', 'Song']);
    // Wednesday has an order of its own.
    const wednesday = res.body.outlines.services.find(s => /Wednesday/.test(s.name));
    expect(wednesday.own).toBe(true);
  });

  test('only the organizer may add or change parts, or the usual order', async () => {
    const usual = plans.outlines().default;
    expect((await request(buildApp(PEOPLE.keeper)).post('/api/worship/parts').send({ name: 'Welcome', takesPerson: true })).status).toBe(403);

    const added = await request(buildApp(PEOPLE.organizer)).post('/api/worship/parts').send({ name: 'Welcome', takesPerson: true, servingJob: 'Usher' });
    expect(added.status).toBe(201);
    expect((await request(buildApp(PEOPLE.organizer)).post('/api/worship/parts').send({ name: 'Nothing' })).body.error).toMatch(/has to collect something/);
    expect((await request(buildApp(PEOPLE.organizer)).post('/api/worship/parts').send({ name: 'welcome', takesPerson: true })).status).toBe(400);

    const order = [added.body.part.id, partId('Song'), partId('Closing prayer')];
    const set = await request(buildApp(PEOPLE.organizer)).put('/api/worship/outlines/default').send({ partIds: order });
    expect(set.body.outlines.default).toEqual(order);

    const retired = await request(buildApp(PEOPLE.organizer)).put(`/api/worship/parts/${added.body.part.id}`).send({ active: false });
    expect(retired.body.part.active).toBe(false);
    // A retired part is left out of a new service.
    expect(plans.template(SUNDAY, 'Sunday PM Worship').items.map(i => i.partName)).toEqual(['Song', 'Closing prayer']);

    // Back as it was, for the tests after this one.
    plans.setOutline(null, usual);
    db.prepare('DELETE FROM worship_parts WHERE name = ?').run('Welcome');
  });

  test('the organizer can put every service on the default order at once', async () => {
    const wednesday = plans.outlines().services.find(sv => /Wednesday/.test(sv.name));
    const ownOrder = wednesday.partIds;
    expect(wednesday.own).toBe(true);
    expect((await request(buildApp(PEOPLE.keeper)).post('/api/worship/outlines/default/everywhere')).status).toBe(403);

    const res = await request(buildApp(PEOPLE.organizer)).post('/api/worship/outlines/default/everywhere');
    expect(res.status).toBe(200);
    expect(res.body.outlines.services.every(sv => !sv.own && JSON.stringify(sv.partIds) === JSON.stringify(res.body.outlines.default))).toBe(true);
    expect(db.prepare("SELECT summary FROM action_log WHERE entity = 'order of worship' ORDER BY id DESC").get().summary)
      .toBe(`Put every service on the default order of worship (${wednesday.name} had their own)`);

    // Giving one its own order again is named in the history.
    await request(buildApp(PEOPLE.organizer)).put(`/api/worship/outlines/${wednesday.id}`).send({ partIds: ownOrder });
    expect(db.prepare("SELECT summary FROM action_log WHERE entity = 'order of worship' ORDER BY id DESC").get().summary)
      .toBe(`Gave ${wednesday.name} an order of worship of its own`);
    expect(plans.outlines().services.find(sv => sv.id === wednesday.id).own).toBe(true);
  });

  test('a new service comes laid out, with the Serving Schedule already filled in', async () => {
    const res = await request(buildApp(PEOPLE.leader)).get(`/api/worship/plans/for?date=${SUNDAY}&service=Sunday%20AM%20Worship`);
    expect(res.body.plan).toBeNull();
    expect(res.body.canSubmit).toBe(true);
    expect(res.body.template.leader).toBe('Leader, Lee');
    const prayer = res.body.template.items.find(i => i.partName === 'Opening prayer');
    expect(prayer.person).toBe('Mo Member');
    expect(res.body.template.items.filter(i => i.takesSong).length).toBeGreaterThan(3);
  });
});

describe('submitting a service', () => {
  test('is for the scheduled song leader, or whoever keeps the songs', async () => {
    expect((await submit(PEOPLE.member)).status).toBe(403);
    expect((await submit(PEOPLE.pending)).status).toBe(403);
    // Lee is "Leader, Lee" on the schedule and "Lee Leader" in the directory.
    expect((await submit(PEOPLE.leader)).status).toBe(201);
    expect((await submit(PEOPLE.keeper, body({ date: '2026-10-11' }))).status).toBe(201);
    // Lee is not down to lead on the 11th.
    expect((await submit(PEOPLE.leader, body({ date: '2026-10-18' }))).status).toBe(403);
  });

  test('every part that takes a song needs one', async () => {
    const res = await submit(PEOPLE.leader, body({ items: [{ partId: partId('Song') }] }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Choose a song for part 1 (Song), or remove it');
    expect((await submit(PEOPLE.leader, body({ items: [{ partId: 9999 }] }))).status).toBe(400);
    expect((await submit(PEOPLE.leader, body({ items: [] }))).status).toBe(400);
    expect((await submit(PEOPLE.leader, body({ service: 'No Such Service' }))).status).toBe(400);
  });

  test('any part can carry a note, which the organizer sees in the email', async () => {
    const items = body().items.map(i => ({ ...i }));
    items[0].note = '  vv. 1, 2\n and 4 ';
    items[2].note = 'Romans 12:1-8';
    const res = await submit(PEOPLE.leader, body({ items }));
    expect(res.status).toBe(201);
    expect(res.body.plan.items.map(i => i.note)).toEqual(['vv. 1, 2 and 4', '', 'Romans 12:1-8', '']);
    expect(plans.getPlan(res.body.plan.id).items[0].note).toBe('vv. 1, 2 and 4');

    const [mail] = db.prepare('SELECT body FROM mail_outbox').all();
    expect(mail.body).toContain('1. Song: Amazing Grace (Praise for the Lord 123)\n      Note: vv. 1, 2 and 4\n');
    expect(mail.body).toContain('"The Good Shepherd"\n      Note: Romans 12:1-8\n');
    // A part with no note gets no line for one.
    expect(mail.body).toMatch(/Mo Member\n +3\. Sermon/);

    items[0].note = 'x'.repeat(300);
    const long = await submit(PEOPLE.leader, body({ items }));
    expect(long.body.plan.items[0].note).toHaveLength(200);
  });

  test('emails the organizer once, and puts it in their bell each time it changes', async () => {
    const res = await submit(PEOPLE.leader);
    expect(res.body.emailed).toBe(1);
    const [mail] = db.prepare('SELECT * FROM mail_outbox').all();
    expect(mail.context).toBe(`worship-plan:${res.body.plan.id}:submitted`);
    expect(mail.intended_for || mail.to_email).toBe('olive@example.invalid');
    expect(mail.subject).toBe('Service submitted: Sunday AM Worship, Sunday, October 4, 2026');
    expect(mail.body).toContain('1. Song: Amazing Grace (Praise for the Lord 123)');
    expect(mail.body).toContain('Sermon: Sample Preacher — "The Good Shepherd"');
    expect(mail.body).toContain('?page=upcoming&tab=service&plan=');

    const again = await submit(PEOPLE.leader, body({ notes: 'Swapped the invitation song' }));
    expect(again.status).toBe(200);
    expect(again.body.created).toBe(false);
    expect(db.prepare('SELECT COUNT(*) AS n FROM mail_outbox').get().n).toBe(1);
    const bell = db.prepare("SELECT title FROM notifications WHERE user_id = ? AND kind = 'worship-plan-submitted' ORDER BY id").all(PEOPLE.organizer.id);
    expect(bell.map(n => n.title)).toEqual(['Submitted: Sunday AM Worship, 2026-10-04', 'Changed: Sunday AM Worship, 2026-10-04']);
  });

  test('somebody who cannot edit it is told it is already in', async () => {
    await submit(PEOPLE.keeper);
    // Lee can submit this service, so he may change what is submitted…
    expect((await submit(PEOPLE.leader)).status).toBe(200);
    await request(buildApp(PEOPLE.organizer)).post(`/api/worship/plans/${plans.planFor(SUNDAY, 'Sunday AM Worship').id}/confirm`);
    // …but not once it is confirmed.
    const res = await submit(PEOPLE.leader);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/has been confirmed/);
  });
});

describe('confirming it', () => {
  test('is the organizer\'s, and puts the songs in the song tracker under its own name', async () => {
    const { body: { plan } } = await submit(PEOPLE.leader);
    expect((await request(buildApp(PEOPLE.keeper)).post(`/api/worship/plans/${plan.id}/confirm`)).status).toBe(403);
    expect(db.prepare('SELECT COUNT(*) AS n FROM song_services').get().n).toBe(0);

    const res = await request(buildApp(PEOPLE.organizer)).post(`/api/worship/plans/${plan.id}/confirm`);
    expect(res.status).toBe(200);
    expect(res.body.plan).toMatchObject({ status: 'confirmed', confirmedByName: 'Olive Organizer' });

    const tracked = db.prepare('SELECT * FROM song_services').get();
    expect(tracked).toMatchObject({ date: SUNDAY, service: 'AM', leader: 'Leader, Lee', source: 'portal' });
    expect(tracked.id).toBeGreaterThanOrEqual(1_000_000);
    expect(db.prepare('SELECT song_id FROM service_songs WHERE service_id = ? ORDER BY position').all(tracked.id).map(r => r.song_id))
      .toEqual([SONGS.grace, SONGS.justAs]);

    const told = db.prepare("SELECT * FROM notifications WHERE user_id = ? AND kind = 'worship-plan-confirmed'").all(PEOPLE.leader.id);
    expect(told).toHaveLength(1);
    expect((await request(buildApp(PEOPLE.organizer)).post(`/api/worship/plans/${plan.id}/confirm`)).status).toBe(400);
  });

  test('a service already imported for that day is the same service, not a second', async () => {
    db.prepare("INSERT INTO song_services (id, date, service, leader) VALUES (500, ?, 'AM', 'Someone')").run(SUNDAY);
    const { body: { plan } } = await submit(PEOPLE.leader);
    await request(buildApp(PEOPLE.organizer)).post(`/api/worship/plans/${plan.id}/confirm`);
    expect(db.prepare('SELECT id FROM song_services').all()).toEqual([{ id: 500 }]);
  });

  test('the organizer can change it afterwards, and the tracker follows', async () => {
    const { body: { plan } } = await submit(PEOPLE.leader);
    await request(buildApp(PEOPLE.organizer)).post(`/api/worship/plans/${plan.id}/confirm`);
    const res = await submit(PEOPLE.organizer, body({ items: [{ partId: partId('Song'), songId: SONGS.abide }] }));
    expect(res.status).toBe(200);
    expect(res.body.plan.status).toBe('confirmed');
    expect(db.prepare('SELECT song_id FROM service_songs').all()).toEqual([{ song_id: SONGS.abide }]);
  });

  test('a submitted service can be withdrawn; a confirmed one only changed', async () => {
    const { body: { plan } } = await submit(PEOPLE.leader);
    expect((await request(buildApp(PEOPLE.member)).delete(`/api/worship/plans/${plan.id}`)).status).toBe(403);
    expect((await request(buildApp(PEOPLE.leader)).delete(`/api/worship/plans/${plan.id}`)).status).toBe(200);

    const { body: { plan: again } } = await submit(PEOPLE.leader);
    await request(buildApp(PEOPLE.organizer)).post(`/api/worship/plans/${again.id}/confirm`);
    expect((await request(buildApp(PEOPLE.organizer)).delete(`/api/worship/plans/${again.id}`)).status).toBe(400);
  });
});

describe('song requests', () => {
  const ask = (user, b) => request(buildApp(user)).post('/api/worship/requests').send(b);

  test('any member can ask for a song, once', async () => {
    const res = await ask(PEOPLE.member, { songId: SONGS.grace, note: 'For my mother' });
    expect(res.status).toBe(201);
    expect(res.body.request).toMatchObject({ status: 'open', requesterName: 'Mo Member', song: { title: 'Amazing Grace' } });
    expect((await ask(PEOPLE.member, { songId: SONGS.grace })).status).toBe(409);
    expect((await ask(PEOPLE.member, { songId: 99999 })).status).toBe(400);
    expect((await ask(PEOPLE.member, { songId: SONGS.abide, forDate: '2001-01-07' })).body.error).toBe('That date has passed');
    expect((await ask(PEOPLE.pending, { songId: SONGS.abide })).status).toBe(403);
  });

  test('a submitted service with the song plans it, and confirming it makes it done', async () => {
    const { body: { request: asked } } = await ask(PEOPLE.member, { songId: SONGS.grace });
    const { body: { plan } } = await submit(PEOPLE.leader);
    expect(plans.getRequest(asked.id)).toMatchObject({ status: 'planned', plan: { id: plan.id, date: SUNDAY } });
    const told = db.prepare("SELECT title FROM notifications WHERE user_id = ? AND kind = 'song-request-planned'").all(PEOPLE.member.id);
    expect(told.map(n => n.title)).toEqual(['"Amazing Grace" is planned for Sunday AM Worship, 2026-10-04']);

    await request(buildApp(PEOPLE.organizer)).post(`/api/worship/plans/${plan.id}/confirm`);
    expect(plans.getRequest(asked.id).status).toBe('done');
  });

  test('changing the service so it no longer has the song puts the request back', async () => {
    const { body: { request: asked } } = await ask(PEOPLE.member, { songId: SONGS.grace });
    await submit(PEOPLE.leader);
    await submit(PEOPLE.leader, body({ items: [{ partId: partId('Song'), songId: SONGS.abide }] }));
    expect(plans.getRequest(asked.id)).toMatchObject({ status: 'open', plan: null });
  });

  test('the asker may withdraw it; only a song or worship keeper may decline it', async () => {
    const { body: { request: asked } } = await ask(PEOPLE.member, { songId: SONGS.grace });
    const patch = (user, status) => request(buildApp(user)).patch(`/api/worship/requests/${asked.id}`).send({ status });
    expect((await patch(PEOPLE.leader, 'withdrawn')).status).toBe(403);
    expect((await patch(PEOPLE.member, 'declined')).status).toBe(403);
    expect((await patch(PEOPLE.keeper, 'declined')).body.request.status).toBe('declined');
    expect((await patch(PEOPLE.keeper, 'open')).body.request.status).toBe('open');
    expect((await patch(PEOPLE.member, 'withdrawn')).body.request.status).toBe('withdrawn');
    expect((await request(buildApp(PEOPLE.member)).get('/api/worship/requests')).body.requests).toEqual([]);
  });
});

describe('names from the Serving Schedule', () => {
  const slot = db => db.prepare('INSERT INTO job_assignments (month, date, service, job, name) VALUES (?, ?, ?, ?, ?)');

  test('a part with no job linked is filled from a job of the same name, and the sermon from the speaker', () => {
    const add = slot(db);
    add.run('October 2026', 'October 4', 'Sunday Worship', 'Speaker', 'Sam Preacher');
    add.run('October 2026', 'October 4', 'Sunday Worship', 'Announcements', 'Ann Nouncer');
    const items = plans.template(SUNDAY, 'Sunday AM Worship').items;
    const who = name => items.find(i => i.partName === name).person;
    expect(who('Opening prayer')).toBe('Mo Member');
    expect(who('Sermon')).toBe('Sam Preacher');
    expect(who('Announcements')).toBe('Ann Nouncer');
  });

  test('a Sunday Bible class is not given the worship service\'s names', () => {
    expect(plans.servingFor(SUNDAY, 'Sunday Bible Study').jobs).toEqual({});
    expect(plans.servingFor(SUNDAY, 'Sunday AM Worship').jobs).toMatchObject({ 'Song Leader': ['Leader, Lee'] });
  });

  test('a special service put down by its own name is filled, listed, and its leader may submit it', () => {
    const add = slot(db);
    add.run('October 2026', 'October 6', 'Gospel Meeting', 'Song Leader', 'Lee Leader');
    add.run('October 2026', 'October 6', 'Gospel Meeting', 'Opening Prayer', 'Mo Member');
    add.run('October 2026', 'October 7', 'Gospel Meeting', 'Song Leader', '');

    const { jobs, leader } = plans.servingFor('2026-10-06', 'Gospel Meeting');
    expect(jobs).toEqual({ 'Song Leader': ['Lee Leader'], 'Opening Prayer': ['Mo Member'] });
    expect(leader).toBe('Lee Leader');
    expect(plans.template('2026-10-06', 'Gospel Meeting').items.find(i => i.partName === 'Opening prayer').person).toBe('Mo Member');

    const upcoming = plans.upcoming(PEOPLE.leader, { days: 9, today: '2026-09-30' });
    expect(upcoming.map(u => `${u.date} ${u.service}`)).toEqual([
      '2026-09-30 Wednesday Bible Study', '2026-10-04 Sunday AM Worship',
      '2026-10-06 Gospel Meeting', '2026-10-07 Wednesday Bible Study', '2026-10-07 Gospel Meeting',
    ]);
    const meeting = upcoming.find(u => u.date === '2026-10-06');
    expect(meeting).toMatchObject({ leader: 'Lee Leader', canSubmit: true, serving: { 'Opening Prayer': ['Mo Member'] } });
    // Not the regular rosters, and not a service the church does not list.
    add.run('October 2026', 'October 8', 'Not A Service', 'Song Leader', 'Lee Leader');
    expect(plans.specialServices({ from: '2026-10-01', to: '2026-10-31' }).map(s => `${s.date} ${s.service}`))
      .toEqual(['2026-10-06 Gospel Meeting', '2026-10-07 Gospel Meeting']);
  });
});

describe('the overview', () => {
  test('lists each weekly service coming up, who leads it, and whether it is in', async () => {
    await submit(PEOPLE.leader);
    const upcoming = plans.upcoming(PEOPLE.leader, { days: 7, today: '2026-09-30' });
    expect(upcoming.map(u => `${u.date} ${u.service}`)).toEqual(['2026-09-30 Wednesday Bible Study', '2026-10-04 Sunday AM Worship']);
    const sunday = upcoming[1];
    expect(sunday).toMatchObject({ leader: 'Leader, Lee', canSubmit: true, canEdit: true, plan: { status: 'submitted' } });
    expect(plans.upcoming(PEOPLE.member, { days: 7, today: '2026-09-30' })[1]).toMatchObject({ canSubmit: false, canEdit: false });
  });

  test('the page reads it all in one call', async () => {
    const res = await request(buildApp(PEOPLE.member)).get('/api/worship/overview');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ canOrganize: false, keepsSongs: false });
    expect(res.body.parts.length).toBeGreaterThan(0);
    expect(Array.isArray(res.body.upcoming)).toBe(true);
  });
});
