// A slot on the serving schedule gets a name in it two ways only: the
// Monthly Worship Schedule workflow publishing a generated draft, or whoever
// holds serving-schedule filling or changing one by hand. These check that
// building a month, and both of those ways of filling a slot, hold — and that
// the one thing left a member may do to a slot themselves, stepping down from
// one they are down for, still works.
jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const request = require('supertest');
const express = require('express');
const db      = require('../db');
const servingRouter = require('../routes/serving');

function buildApp(user = null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/serving', servingRouter);
  return app;
}

function addPerson(name, gender = '') {
  const { lastInsertRowid: id } = db.prepare('INSERT INTO directory (name, gender) VALUES (?, ?)').run(name, gender);
  return db.prepare('SELECT * FROM directory WHERE id = ?').get(id);
}

function addUser(name, role, directoryId = null, areas = []) {
  const { lastInsertRowid: id } = db.prepare(
    'INSERT INTO users (provider, provider_id, email, name, role, directory_id) VALUES (?,?,?,?,?,?)'
  ).run('google', `${name}-id`, `${name.toLowerCase()}@example.com`, name, role, directoryId);
  const grant = db.prepare('INSERT OR IGNORE INTO user_areas (user_id, area) VALUES (?, ?)');
  for (const area of areas) grant.run(id, area);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function slotsIn(month) {
  return db.prepare('SELECT * FROM job_assignments WHERE month = ? ORDER BY id').all(month);
}

let KEEPER, MAN, OTHER_MAN, WOMAN, UNLINKED, man, otherMan, woman;

beforeEach(() => {
  for (const t of ['notifications', 'mail_outbox', 'workflow_events', 'workflow_tasks', 'workflow_participants', 'workflow_instances', 'action_log', 'job_assignments', 'service_jobs', 'worship_preferences', 'worship_profile', 'user_areas', 'users', 'directory']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }

  man      = addPerson('Joe Carter', 'male');
  otherMan = addPerson('Ned Poole',  'male');
  woman    = addPerson('Ruth Poole', 'female');

  KEEPER    = addUser('Cora', 'approved', null,        ['serving-schedule']);
  MAN       = addUser('Joe',  'approved', man.id);
  OTHER_MAN = addUser('Ned',  'approved', otherMan.id);
  WOMAN     = addUser('Ruth', 'approved', woman.id);
  UNLINKED  = addUser('Sam',  'approved', null);
});

// ─── Building a month ─────────────────────────────────────────────────────────

describe('laying out next month', () => {
  test('creates an empty slot for every job each service needs', async () => {
    const res = await request(buildApp(KEEPER))
      .post('/api/serving/months')
      .send({ month: 'June 2026', services: ['Sunday Worship'] });

    expect(res.status).toBe(200);
    expect(res.body.month).toBe('June 2026');
    expect(res.body.created).toBeGreaterThan(0);

    const slots = slotsIn('June 2026');
    expect(slots.every(s => s.name === '')).toBe(true);
    expect(new Set(slots.map(s => s.job))).toContain('Song Leader');
    // June 2026 has four Sundays: the 7th, 14th, 21st and 28th.
    expect([...new Set(slots.map(s => s.date))]).toEqual(['June 7', 'June 14', 'June 21', 'June 28']);
  });

  test('running it twice does not double the month up', async () => {
    const app = buildApp(KEEPER);
    await request(app).post('/api/serving/months').send({ month: 'June 2026', services: ['Sunday Worship'] });
    const before = slotsIn('June 2026').length;

    const again = await request(app).post('/api/serving/months').send({ month: 'June 2026', services: ['Sunday Worship'] });
    expect(again.body.created).toBe(0);
    expect(slotsIn('June 2026')).toHaveLength(before);
  });

  test('a month nobody can read is refused, and writes nothing', async () => {
    const res = await request(buildApp(KEEPER)).post('/api/serving/months').send({ month: 'Junetember' });
    expect(res.status).toBe(400);
    expect(db.prepare('SELECT COUNT(*) n FROM job_assignments').get().n).toBe(0);
  });

  test('a member who does not look after the schedule cannot build one', async () => {
    const res = await request(buildApp(MAN)).post('/api/serving/months').send({ month: 'June 2026' });
    expect(res.status).toBe(403);
    expect(db.prepare('SELECT COUNT(*) n FROM job_assignments').get().n).toBe(0);
  });
});

// ─── Filling a slot — the roster role's to do ──────────────────────────────────

describe('the jobs each service needs', () => {
  const setJobs = (user, body) => request(buildApp(user)).put('/api/serving/service-jobs').send(body);
  const jobsOf = (list, service) => list.find(s => s.service === service);

  test('start from the usual ones: Wednesday closes with a prayer, Sunday morning has its speaker and announcements', async () => {
    const { body } = await request(buildApp(KEEPER)).get('/api/serving');
    expect(jobsOf(body.serviceJobs, 'Wednesday')).toMatchObject({ jobs: ['Song Leader', 'Opening Prayer', 'Closing Prayer'], custom: false });
    expect(jobsOf(body.serviceJobs, 'Sunday Worship').jobs).toEqual(expect.arrayContaining(['Speaker', 'Announcements', 'Closing Prayer']));
    expect(jobsOf(body.serviceJobs, 'Gospel Meeting')).toMatchObject({ special: true, jobs: ['Song Leader', 'Opening Prayer', 'Closing Prayer'] });
  });

  test('the schedule keeper changes them, and the next month built follows', async () => {
    const res = await setJobs(KEEPER, { service: 'Wednesday', jobs: ['Song Leader', 'Scripture Reading', 'Closing Prayer'] });
    expect(res.status).toBe(200);
    expect(jobsOf(res.body.serviceJobs, 'Wednesday')).toMatchObject({ jobs: ['Song Leader', 'Scripture Reading', 'Closing Prayer'], custom: true, updatedBy: 'Cora' });

    await request(buildApp(KEEPER)).post('/api/serving/months').send({ month: 'June 2026', services: ['Wednesday'] });
    const june3 = slotsIn('June 2026').filter(s => s.date === 'June 3').map(s => s.job);
    expect(june3).toEqual(['Song Leader', 'Scripture Reading', 'Closing Prayer']);
    expect(db.prepare("SELECT summary FROM action_log WHERE entity = 'service jobs'").get().summary)
      .toBe('Set the jobs for Wednesday: Song Leader, Scripture Reading, Closing Prayer');
  });

  test('a special service starts with its own jobs, and goes back to the usual ones when cleared', async () => {
    await setJobs(KEEPER, { service: 'Gospel Meeting', jobs: ['Song Leader', 'Speaker'] });
    await request(buildApp(KEEPER)).post('/api/serving/special').send({ service: 'Gospel Meeting', from: '2026-11-15' });
    expect(slotsIn('November 2026').map(s => s.job)).toEqual(['Song Leader', 'Speaker']);

    const res = await setJobs(KEEPER, { service: 'Gospel Meeting', jobs: null });
    expect(jobsOf(res.body.serviceJobs, 'Gospel Meeting')).toMatchObject({ custom: false, jobs: ['Song Leader', 'Opening Prayer', 'Closing Prayer'] });
  });

  test('refuses an unknown job, no jobs, a service not on the schedule, and anyone but the keeper', async () => {
    expect((await setJobs(KEEPER, { service: 'Wednesday', jobs: ['Juggler'] })).body.error).toMatch(/not one of the worship jobs/);
    expect((await setJobs(KEEPER, { service: 'Wednesday', jobs: [] })).body.error).toMatch(/at least one job/);
    expect((await setJobs(KEEPER, { service: 'Made Up', jobs: ['Song Leader'] })).status).toBe(400);
    expect((await setJobs(MAN, { service: 'Wednesday', jobs: ['Song Leader'] })).status).toBe(403);
  });
});

describe('a special service', () => {
  const add = (user, body) => request(buildApp(user)).post('/api/serving/special').send(body);
  const MEETING = { service: 'Gospel Meeting', from: '2026-11-15', through: '2026-11-18', jobs: ['Song Leader', 'Opening Prayer', 'Closing Prayer'] };

  test('lays out each night of a gospel meeting with the jobs asked for, empty', async () => {
    const res = await add(KEEPER, MEETING);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ created: 12, month: 'November 2026' });
    const rows = slotsIn('November 2026');
    expect([...new Set(rows.map(r => r.date))]).toEqual(['November 15', 'November 16', 'November 17', 'November 18']);
    expect(rows.every(r => r.service === 'Gospel Meeting' && r.name === '')).toBe(true);
    expect(db.prepare("SELECT summary FROM action_log WHERE entity = 'serving schedule'").get().summary)
      .toBe('Added Gospel Meeting, November 15 – November 18 (4 nights) — 12 empty slots');

    // Twice never doubles it up.
    expect((await add(KEEPER, MEETING)).body.created).toBe(0);
  });

  test('one night, and a run that crosses into the next month', async () => {
    expect((await add(KEEPER, { ...MEETING, from: '2026-11-29', through: '' })).body.created).toBe(3);
    await add(KEEPER, { ...MEETING, from: '2026-11-30', through: '2026-12-01' });
    expect(slotsIn('December 2026').map(r => r.date)).toEqual(['December 1', 'December 1', 'December 1']);
  });

  test('only from the church\'s list of services, and only what the regular rosters do not cover', async () => {
    const res = await request(buildApp(KEEPER)).get('/api/serving');
    expect(res.body.specialServices).toEqual(expect.arrayContaining(['Gospel Meeting', 'Monthly Singing']));
    expect(res.body.specialServices).not.toEqual(expect.arrayContaining(['Sunday AM Worship']));
    expect(res.body.specialServices).not.toEqual(expect.arrayContaining(['Sunday PM Worship']));
    expect((await add(KEEPER, { ...MEETING, service: 'Sunday AM Worship' })).status).toBe(400);
    expect((await add(KEEPER, { ...MEETING, service: 'Made Up' })).status).toBe(400);
  });

  test('refuses what does not make sense, and anyone but the schedule keeper', async () => {
    expect((await add(MAN, MEETING)).status).toBe(403);
    expect((await add(KEEPER, { ...MEETING, from: '' })).body.error).toMatch(/Choose the day/);
    expect((await add(KEEPER, { ...MEETING, through: '2026-11-01' })).body.error).toMatch(/before the first/);
    expect((await add(KEEPER, { ...MEETING, through: '2026-12-31' })).body.error).toMatch(/more than 14 nights/);
    expect((await add(KEEPER, { ...MEETING, jobs: ['Juggler'] })).body.error).toMatch(/at least one job/);
  });
});

describe('filling a slot by hand', () => {
  test('there is no self sign-up any more — the route is gone', async () => {
    await request(buildApp(KEEPER)).post('/api/serving/months').send({ month: 'June 2026', services: ['Sunday Worship'] });
    const slot = slotsIn('June 2026').find(s => s.job === 'Song Leader');

    const res = await request(buildApp(MAN)).post(`/api/serving/assignments/${slot.id}/signup`);
    expect(res.status).toBe(404);
    expect(db.prepare('SELECT name FROM job_assignments WHERE id = ?').get(slot.id).name).toBe('');
  });

  test('the schedule keeper can put a name in an empty slot', async () => {
    await request(buildApp(KEEPER)).post('/api/serving/months').send({ month: 'June 2026', services: ['Sunday Worship'] });
    const slot = slotsIn('June 2026').find(s => s.job === 'Song Leader');

    const res = await request(buildApp(KEEPER))
      .patch(`/api/serving/assignments/${slot.id}`)
      .send({ name: 'Joe Carter' });

    expect(res.status).toBe(200);
    expect(res.body.assignment.name).toBe('Joe Carter');
  });

  test('a member cannot put a name in an empty slot by editing it directly either', async () => {
    await request(buildApp(KEEPER)).post('/api/serving/months').send({ month: 'June 2026', services: ['Sunday Worship'] });
    const slot = slotsIn('June 2026').find(s => s.job === 'Song Leader');

    const res = await request(buildApp(MAN))
      .patch(`/api/serving/assignments/${slot.id}`)
      .send({ name: 'Joe Carter' });

    expect(res.status).toBe(403);
    expect(db.prepare('SELECT name FROM job_assignments WHERE id = ?').get(slot.id).name).toBe('');
  });
});

// ─── Taking your own name off ──────────────────────────────────────────────────

describe('asking to be replaced', () => {
  let slot;
  const ask = (user, body = { reason: 'Out of town that weekend' }) =>
    request(buildApp(user)).post(`/api/serving/assignments/${slot.id}/replacement`).send(body);
  const nameOn = () => db.prepare('SELECT name FROM job_assignments WHERE id = ?').get(slot.id).name;
  const task = () => db.prepare("SELECT * FROM workflow_tasks WHERE status = 'pending' ORDER BY id DESC").get();
  const instance = () => db.prepare("SELECT * FROM workflow_instances WHERE definition_id = 'serving-replacement' ORDER BY id DESC").get();
  const engine = () => require('../workflows/engine');

  beforeEach(async () => {
    await request(buildApp(KEEPER)).post('/api/serving/months').send({ month: 'June 2026', services: ['Sunday Worship'] });
    slot = slotsIn('June 2026').find(s => s.job === 'Song Leader');
    db.prepare('UPDATE job_assignments SET name = ? WHERE id = ?').run('Joe Carter', slot.id);
  });

  test('asking leaves your name on, and asks the schedule keeper by inbox, email and bell', async () => {
    const res = await ask(MAN);
    expect(res.status).toBe(200);
    expect(nameOn()).toBe('Joe Carter');

    expect(task()).toMatchObject({ step_id: 'find-replacement', assignee_role: 'serving-schedule' });
    expect(engine().inbox(KEEPER).map(t => t.title)).toEqual([`Replace Joe Carter: Song Leader, ${slot.date}, Sunday Worship`]);
    expect(db.prepare("SELECT to_email, intended_for FROM mail_outbox WHERE context LIKE 'workflow:%:task:%'").all()
      .map(r => r.intended_for || r.to_email)).toEqual(['cora@example.com']);
    expect(db.prepare("SELECT user_id, kind, title, body FROM notifications").all()).toEqual([
      { user_id: KEEPER.id, kind: 'serving-replacement-asked', title: `Joe Carter needs replacing: Song Leader, ${slot.date}, Sunday Worship`, body: 'Out of town that weekend' },
    ]);
    // The slot says it has been asked about.
    const shown = res.body.assignments.find(a => a.id === slot.id);
    expect(shown.replacement).toMatchObject({ askedBy: 'Joe', reason: 'Out of town that weekend' });
    expect(db.prepare("SELECT summary FROM action_log WHERE entity = 'serving replacement'").get().summary)
      .toBe(`Joe asked for Joe Carter to be replaced on Song Leader, ${slot.date}, Sunday Worship`);
  });

  test('only for your own slot (or by the keeper), once, and never for an empty one', async () => {
    expect((await ask(OTHER_MAN)).status).toBe(400);
    expect((await ask(UNLINKED)).status).toBe(400);
    expect((await ask(MAN)).status).toBe(200);
    expect((await ask(MAN)).body.error).toMatch(/already been asked for/);
    db.prepare("UPDATE job_assignments SET name = '' WHERE id = ?").run(slot.id);
    const other = slotsIn('June 2026').find(s => s.job === 'Opening Prayer');
    expect((await request(buildApp(KEEPER)).post(`/api/serving/assignments/${other.id}/replacement`).send({})).body.error).toMatch(/Nobody is down/);
  });

  test('the keeper says who is taking it, from the inbox: the slot changes and the asker is told', async () => {
    await ask(MAN);
    const done = engine().act({ taskId: task().id, actionId: 'replaced', note: 'Ned Poole', user: KEEPER });
    expect(done.error).toBeUndefined();
    expect(nameOn()).toBe('Ned Poole');
    expect(instance()).toMatchObject({ status: 'completed', outcome: 'replaced' });
    expect(db.prepare("SELECT title FROM notifications WHERE user_id = ?").get(MAN.id).title)
      .toBe(`Ned Poole is taking Song Leader for you, ${slot.date}, Sunday Worship`);
    expect(db.prepare("SELECT COUNT(*) n FROM mail_outbox WHERE context LIKE 'workflow:%:completed'").get().n).toBe(1);
  });

  test('or leaves it open, or keeps them on', async () => {
    await ask(MAN);
    engine().act({ taskId: task().id, actionId: 'leave-open', user: KEEPER });
    expect(nameOn()).toBe('');
    expect(instance().outcome).toBe('opened');

    db.prepare("UPDATE job_assignments SET name = 'Joe Carter' WHERE id = ?").run(slot.id);
    await ask(MAN);
    expect(engine().act({ taskId: task().id, actionId: 'keep', user: KEEPER }).error).toMatch(/needs a note/);
    engine().act({ taskId: task().id, actionId: 'keep', note: 'Spoke to him — he can do it after all', user: KEEPER });
    expect(nameOn()).toBe('Joe Carter');
    expect(instance().outcome).toBe('kept');
  });

  test('changing the name on the slot closes the request too', async () => {
    await ask(MAN);
    await request(buildApp(KEEPER)).patch(`/api/serving/assignments/${slot.id}`).send({ name: 'Ned Poole' });
    expect(instance()).toMatchObject({ status: 'completed', outcome: 'replaced' });
    expect(task()).toBeUndefined();
    const res = await request(buildApp(MAN)).get('/api/serving?month=June%202026');
    expect(res.body.assignments.find(a => a.id === slot.id).replacement).toBeUndefined();
  });

  test('nobody can take a name off straight away any more', async () => {
    expect((await request(buildApp(MAN)).delete(`/api/serving/assignments/${slot.id}/signup`)).status).toBe(404);
    expect(nameOn()).toBe('Joe Carter');
  });

  test('it is not offered on the page\'s start form', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = KEEPER; next(); });
    app.use('/api/workflows', require('../routes/workflows'));
    const res = await request(app).get('/api/workflows/definitions?page=assignments');
    expect(res.body.definitions.map(d => d.id)).toEqual(['worship-schedule']);
  });
});


// ─── The service roster ───────────────────────────────────────────────────────
// What each man will volunteer for. He can say it himself on his profile; the
// schedule keeper can write down what he said in the foyer.

describe('recording what somebody will serve', () => {
  function prefer(directoryId, role, level) {
    db.prepare('INSERT INTO worship_preferences (directory_id, role, level) VALUES (?, ?, ?)')
      .run(directoryId, role, level);
  }

  function levelsFor(directoryId) {
    return Object.fromEntries(
      db.prepare('SELECT role, level FROM worship_preferences WHERE directory_id = ? ORDER BY role').all(directoryId)
        .map(r => [r.role, r.level])
    );
  }

  test('only the schedule keeper may see the roster', async () => {
    const res = await request(buildApp(MAN)).get('/api/serving/members');
    expect(res.status).toBe(403);
  });

  test('the roster lists everyone with what they said', async () => {
    prefer(man.id, 'Song Leader', 'preferred');
    prefer(man.id, 'Usher', 'unavailable');
    db.prepare('INSERT INTO worship_profile (directory_id, notes) VALUES (?, ?)').run(man.id, 'Away in June');

    const res = await request(buildApp(KEEPER)).get('/api/serving/members');
    expect(res.status).toBe(200);

    const joe = res.body.members.find(m => m.name === 'Joe Carter');
    expect(joe.preferences).toEqual({ 'Song Leader': 'preferred', Usher: 'unavailable' });
    expect(joe.notes).toBe('Away in June');

    // Somebody who has said nothing reads as nothing, not as a refusal.
    expect(res.body.members.find(m => m.name === 'Ned Poole').preferences).toEqual({});
    expect(res.body.levels).toEqual(['preferred', 'willing', 'unavailable']);
  });

  test('the schedule keeper can write down what a man said', async () => {
    const res = await request(buildApp(KEEPER))
      .put(`/api/serving/members/${man.id}/preferences`)
      .send({ preferences: { 'Song Leader': 'preferred', Communion: 'willing' }, notes: 'Told me after services' });

    expect(res.status).toBe(200);
    expect(res.body.member.preferences).toEqual({ 'Song Leader': 'preferred', Communion: 'willing' });
    expect(res.body.member.notes).toBe('Told me after services');
    expect(levelsFor(man.id)).toEqual({ 'Song Leader': 'preferred', Communion: 'willing' });
  });

  test('what is sent replaces what was there, and a cleared role goes', async () => {
    prefer(man.id, 'Song Leader', 'preferred');
    prefer(man.id, 'Usher', 'willing');

    const res = await request(buildApp(KEEPER))
      .put(`/api/serving/members/${man.id}/preferences`)
      .send({ preferences: { 'Song Leader': 'willing', Usher: null } });

    expect(res.status).toBe(200);
    expect(levelsFor(man.id)).toEqual({ 'Song Leader': 'willing' });
  });

  test('a note is left alone by a save that does not mention it', async () => {
    db.prepare('INSERT INTO worship_profile (directory_id, notes) VALUES (?, ?)').run(man.id, 'Works most Wednesdays');

    const res = await request(buildApp(KEEPER))
      .put(`/api/serving/members/${man.id}/preferences`)
      .send({ preferences: { Usher: 'willing' } });

    expect(res.status).toBe(200);
    expect(res.body.member.notes).toBe('Works most Wednesdays');
  });

  test('a role or a level nobody has heard of is refused, and writes nothing', async () => {
    prefer(man.id, 'Song Leader', 'preferred');

    const badRole = await request(buildApp(KEEPER))
      .put(`/api/serving/members/${man.id}/preferences`)
      .send({ preferences: { 'Bell Ringer': 'willing' } });
    expect(badRole.status).toBe(400);
    expect(badRole.body.error).toMatch(/Bell Ringer/);

    const badLevel = await request(buildApp(KEEPER))
      .put(`/api/serving/members/${man.id}/preferences`)
      .send({ preferences: { Usher: 'maybe' } });
    expect(badLevel.status).toBe(400);

    // Neither attempt left half a set behind.
    expect(levelsFor(man.id)).toEqual({ 'Song Leader': 'preferred' });
  });

  test('a member cannot record preferences for somebody else from here', async () => {
    const res = await request(buildApp(MAN))
      .put(`/api/serving/members/${otherMan.id}/preferences`)
      .send({ preferences: { Usher: 'willing' } });

    expect(res.status).toBe(403);
    expect(db.prepare('SELECT COUNT(*) n FROM worship_preferences').get().n).toBe(0);
  });

  test('somebody who is not in the directory at all is a 404', async () => {
    const res = await request(buildApp(KEEPER))
      .put('/api/serving/members/9999/preferences')
      .send({ preferences: {} });
    expect(res.status).toBe(404);
  });

  test('the history says what changed, and who wrote it down', async () => {
    prefer(man.id, 'Usher', 'willing');

    await request(buildApp(KEEPER))
      .put(`/api/serving/members/${man.id}/preferences`)
      .send({ preferences: { Usher: 'unavailable', 'Song Leader': 'preferred' } });

    const entry = db.prepare('SELECT * FROM action_log ORDER BY id DESC').get();
    expect(entry).toMatchObject({ area: 'serving-schedule', user_id: KEEPER.id, entity: 'worship preferences' });
    expect(entry.summary).toMatch(/Joe Carter/);
    expect(entry.summary).toMatch(/Song Leader: no preference → preferred/);
    expect(entry.summary).toMatch(/Usher: willing → unavailable/);
  });
});

// ─── What the page is told ────────────────────────────────────────────────────

describe('GET /api/serving', () => {
  test('tells each person what they may do with the month', async () => {
    await request(buildApp(KEEPER)).post('/api/serving/months').send({ month: 'June 2026', services: ['Sunday Worship'] });

    const keeper = await request(buildApp(KEEPER)).get('/api/serving');
    expect(keeper.body.canManage).toBe(true);
    expect(keeper.body.month).toBe('June 2026');
    expect(keeper.body.assignments.length).toBeGreaterThan(0);

    const member = await request(buildApp(MAN)).get('/api/serving');
    expect(member.body.canManage).toBe(false);
    expect(member.body.me).toMatchObject({ name: 'Joe Carter' });
    // There is nothing left for a member to sign up for, so the page is not
    // told anything about eligibility any more.
    expect(member.body.me.jobs).toBeUndefined();
    expect(member.body.me.canSignUp).toBeUndefined();
  });
});
