// Rotations: anything the church takes in turns, kept as a queue of directory
// people. Whoever holds the rotations area starts them and appoints
// coordinators; a coordinator runs their own. Whoever is next up is told when
// the rotation moves on.
jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const request = require('supertest');
const express = require('express');
const db = require('../db');
const recordKeeping = require('../lib/recordKeeping');
const router = require('../routes/rotations');

function buildApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/rotations', router);
  return app;
}

function addPerson(name, email = '') {
  return Number(db.prepare('INSERT INTO directory (name, email) VALUES (?, ?)').run(name, email).lastInsertRowid);
}

function addUser(name, { directoryId = null, areas = [], role = 'approved' } = {}) {
  const id = db.prepare('INSERT INTO users (provider, provider_id, email, name, role, directory_id) VALUES (?,?,?,?,?,?)')
    .run('google', `${name}-id`, `${name.toLowerCase()}@example.com`, name, role, directoryId).lastInsertRowid;
  for (const a of areas) db.prepare('INSERT INTO user_areas (user_id, area) VALUES (?, ?)').run(id, a);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

// Who each message is for. Outside production the outbox redirects everything
// to one test address and keeps the real recipient in intended_for.
const outbox = () => db.prepare("SELECT COALESCE(NULLIF(intended_for, ''), to_email) AS to_email, subject, context FROM mail_outbox WHERE context LIKE 'rotation:%' ORDER BY id").all();
const bell = userId => db.prepare("SELECT title, page FROM notifications WHERE user_id = ? AND kind = 'rotation-next-up' ORDER BY id").all(userId);
const names = body => body.rotation.members.map(m => m.name);
const lastLog = () => db.prepare('SELECT summary FROM action_log ORDER BY id DESC LIMIT 1').get()?.summary;

let KEEPER, RUTH_USER, ANN_USER, NOBODY, ruth, ann, beth, cara;

beforeEach(() => {
  for (const t of ['mail_outbox', 'notifications', 'action_log', 'rotation_turns', 'rotation_members', 'rotation_coordinators', 'rotations', 'user_areas', 'users', 'directory']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
  jest.spyOn(recordKeeping, 'churchToday').mockReturnValue('2026-10-14');
  ruth = addPerson('Ruth Hale', 'ruth@example.com');
  ann  = addPerson('Ann Bell', 'ann@example.com');
  beth = addPerson('Beth Cole');                       // no address anywhere
  cara = addPerson('Cara Dean', 'cara@example.com');
  KEEPER    = addUser('Kay', { areas: ['rotations'] });
  RUTH_USER = addUser('Ruth', { directoryId: ruth });
  ANN_USER  = addUser('Ann', { directoryId: ann });
  NOBODY    = addUser('Ned');
});

afterEach(() => jest.restoreAllMocks());

const as = user => request(buildApp(user));

async function startShowers({ coordinators = [ruth], members = [ann, beth, cara] } = {}) {
  const made = await as(KEEPER).post('/api/rotations').send({ name: 'Baby showers', description: 'Hosting the next baby shower.', coordinatorIds: coordinators });
  const id = made.body.rotation.id;
  if (members.length) await as(KEEPER).post(`/api/rotations/${id}/members`).send({ directoryIds: members });
  return id;
}

describe('starting and keeping rotations', () => {
  test('whoever holds the area starts one, with its coordinators', async () => {
    const res = await as(KEEPER).post('/api/rotations').send({ name: '  Ladies\' class teachers ', coordinatorIds: [ruth] });
    expect(res.status).toBe(201);
    expect(res.body.rotation).toMatchObject({ name: 'Ladies\' class teachers', active: true, canManage: true, canRun: true, members: [], nextUp: null });
    expect(res.body.rotation.coordinators).toEqual([{ directoryId: ruth, name: 'Ruth Hale' }]);
    expect(lastLog()).toBe('Started the "Ladies\' class teachers" rotation');
  });

  test('nobody else may start one, and a name is needed', async () => {
    expect((await as(RUTH_USER).post('/api/rotations').send({ name: 'Mine' })).status).toBe(403);
    expect((await as(KEEPER).post('/api/rotations').send({ name: '  ' })).body.error).toMatch(/name/);
    expect((await as(KEEPER).post('/api/rotations').send({ name: 'X', coordinatorIds: [9999] })).body.error).toMatch(/directory/);
  });

  test('everybody signed in sees every rotation and who is next', async () => {
    await startShowers();
    const res = await as(NOBODY).get('/api/rotations');
    expect(res.body.canManage).toBe(false);
    expect(res.body.rotations).toEqual([expect.objectContaining({
      name: 'Baby showers', memberCount: 3, nextUp: { directoryId: ann, name: 'Ann Bell' }, canRun: false, youAreNext: false,
    })]);
    const mine = await as(ANN_USER).get('/api/rotations');
    expect(mine.body.rotations[0]).toMatchObject({ youAreNext: true, youAreIn: true });
  });

  test('only the people running it are told who has no email address', async () => {
    const id = await startShowers();
    const coordinator = await as(RUTH_USER).get(`/api/rotations/${id}`);
    expect(coordinator.body.rotation.members.find(m => m.name === 'Beth Cole').hasEmail).toBe(false);
    const member = await as(ANN_USER).get(`/api/rotations/${id}`);
    expect(member.body.rotation.members[0]).not.toHaveProperty('hasEmail');
  });

  test('a coordinator may rename theirs but not retire, delete or re-staff it', async () => {
    const id = await startShowers();
    expect((await as(RUTH_USER).patch(`/api/rotations/${id}`).send({ name: 'Showers' })).body.rotation.name).toBe('Showers');
    expect((await as(RUTH_USER).patch(`/api/rotations/${id}`).send({ active: false })).status).toBe(403);
    expect((await as(RUTH_USER).delete(`/api/rotations/${id}`)).status).toBe(403);
    expect((await as(RUTH_USER).put(`/api/rotations/${id}/coordinators`).send({ directoryIds: [ann] })).status).toBe(403);
  });

  test('somebody who does not coordinate it cannot change it at all', async () => {
    const id = await startShowers();
    expect((await as(ANN_USER).patch(`/api/rotations/${id}`).send({ name: 'Mine now' })).status).toBe(403);
    expect((await as(ANN_USER).post(`/api/rotations/${id}/turns`).send({})).status).toBe(403);
    expect((await as(ANN_USER).post(`/api/rotations/${id}/members`).send({ directoryIds: [ruth] })).status).toBe(403);
  });

  test('the area retires one (hidden unless asked for) and can bring it back', async () => {
    const id = await startShowers();
    await as(KEEPER).patch(`/api/rotations/${id}`).send({ active: false });
    expect(lastLog()).toBe('Retired the "Baby showers" rotation');
    expect((await as(NOBODY).get('/api/rotations')).body.rotations).toEqual([]);
    expect((await as(KEEPER).get('/api/rotations?retired=1')).body.rotations[0]).toMatchObject({ active: false });
    expect((await as(KEEPER).post(`/api/rotations/${id}/turns`).send({})).body.error).toMatch(/retired/);
    await as(KEEPER).patch(`/api/rotations/${id}`).send({ active: true });
    expect((await as(NOBODY).get('/api/rotations')).body.rotations).toHaveLength(1);
  });

  test('the area appoints coordinators, and deleting a rotation takes its turns', async () => {
    const id = await startShowers();
    const res = await as(KEEPER).put(`/api/rotations/${id}/coordinators`).send({ directoryIds: [ann, cara] });
    expect(res.body.rotation.coordinators.map(c => c.name)).toEqual(['Ann Bell', 'Cara Dean']);
    expect((await as(ANN_USER).patch(`/api/rotations/${id}`).send({ name: 'Ann runs it' })).status).toBe(200);
    expect((await as(RUTH_USER).patch(`/api/rotations/${id}`).send({ name: 'Not Ruth' })).status).toBe(403);

    await as(KEEPER).post(`/api/rotations/${id}/turns`).send({});
    expect((await as(KEEPER).delete(`/api/rotations/${id}`)).status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) AS n FROM rotation_turns').get().n).toBe(0);
    expect((await as(NOBODY).get(`/api/rotations/${id}`)).status).toBe(404);
  });
});

describe('the queue', () => {
  test('people join at the back, once each, and leave', async () => {
    const id = await startShowers({ members: [ann, beth] });
    const res = await as(RUTH_USER).post(`/api/rotations/${id}/members`).send({ directoryIds: [ann, cara] });
    expect(names(res.body)).toEqual(['Ann Bell', 'Beth Cole', 'Cara Dean']);
    expect(lastLog()).toBe('Added Cara Dean to the "Baby showers" rotation');
    const gone = await as(RUTH_USER).delete(`/api/rotations/${id}/members/${beth}`);
    expect(names(gone.body)).toEqual(['Ann Bell', 'Cara Dean']);
  });

  test('a coordinator reorders it, with everybody in it once', async () => {
    const id = await startShowers();
    const res = await as(RUTH_USER).put(`/api/rotations/${id}/order`).send({ order: [cara, ann, beth] });
    expect(names(res.body)).toEqual(['Cara Dean', 'Ann Bell', 'Beth Cole']);
    expect(res.body.rotation.nextUp.name).toBe('Cara Dean');
    expect((await as(RUTH_USER).put(`/api/rotations/${id}/order`).send({ order: [cara, ann] })).status).toBe(409);
    expect((await as(RUTH_USER).put(`/api/rotations/${id}/order`).send({ order: [cara, ann, ann] })).status).toBe(409);
  });

  test('somebody sitting out keeps their place but is passed over', async () => {
    const id = await startShowers();
    const res = await as(RUTH_USER).patch(`/api/rotations/${id}/members/${ann}`).send({ sittingOut: true });
    expect(res.body.rotation.nextUp.name).toBe('Beth Cole');
    expect(res.body.rotation.members[0]).toMatchObject({ name: 'Ann Bell', sittingOut: true, next: false, place: 1 });
    const back = await as(RUTH_USER).patch(`/api/rotations/${id}/members/${ann}`).send({ sittingOut: false });
    expect(back.body.rotation.nextUp.name).toBe('Ann Bell');
  });

  test('sending somebody to the back writes nothing down', async () => {
    const id = await startShowers();
    const res = await as(RUTH_USER).post(`/api/rotations/${id}/members/${ann}/back`);
    expect(names(res.body)).toEqual(['Beth Cole', 'Cara Dean', 'Ann Bell']);
    expect(res.body.rotation.history).toEqual([]);
  });
});

describe('turns', () => {
  test('giving the turn to whoever is next writes it down and sends them to the back', async () => {
    const id = await startShowers();
    const res = await as(RUTH_USER).post(`/api/rotations/${id}/turns`).send({ date: '2026-10-04', note: 'At the fellowship hall' });
    expect(res.status).toBe(201);
    expect(names(res.body)).toEqual(['Beth Cole', 'Cara Dean', 'Ann Bell']);
    expect(res.body.rotation.history).toEqual([expect.objectContaining({ name: 'Ann Bell', date: '2026-10-04', note: 'At the fellowship hall', upcoming: false })]);
    expect(lastLog()).toBe('Gave Ann Bell a turn on the "Baby showers" rotation on 2026-10-04');
  });

  test('somebody else can step in, and whoever was next keeps their place', async () => {
    const id = await startShowers();
    const res = await as(RUTH_USER).post(`/api/rotations/${id}/turns`).send({ directoryId: cara });
    expect(names(res.body)).toEqual(['Ann Bell', 'Beth Cole', 'Cara Dean']);
    expect(res.body.rotation.nextUp.name).toBe('Ann Bell');
    expect(res.body.rotation.history[0]).toMatchObject({ name: 'Cara Dean', date: null });
  });

  test('a turn after today is upcoming; cancelling it puts them back at the front', async () => {
    const id = await startShowers();
    const booked = await as(RUTH_USER).post(`/api/rotations/${id}/turns`).send({ date: '2026-11-08' });
    expect(booked.body.rotation.upcoming).toEqual([expect.objectContaining({ name: 'Ann Bell', date: '2026-11-08', upcoming: true })]);
    expect(booked.body.rotation.nextUp.name).toBe('Beth Cole');

    const turnId = booked.body.rotation.upcoming[0].id;
    const res = await as(RUTH_USER).delete(`/api/rotations/${id}/turns/${turnId}?requeue=1`);
    expect(res.body.rotation.upcoming).toEqual([]);
    expect(names(res.body)).toEqual(['Ann Bell', 'Beth Cole', 'Cara Dean']);
  });

  test('an old turn can be taken out of the history without moving anybody', async () => {
    const id = await startShowers();
    const given = await as(RUTH_USER).post(`/api/rotations/${id}/turns`).send({ date: '2026-09-01' });
    const res = await as(RUTH_USER).delete(`/api/rotations/${id}/turns/${given.body.rotation.history[0].id}`);
    expect(res.body.rotation.history).toEqual([]);
    expect(names(res.body)).toEqual(['Beth Cole', 'Cara Dean', 'Ann Bell']);
  });

  test('a turn needs somebody in the rotation and a real date', async () => {
    const empty = await startShowers({ members: [] });
    expect((await as(RUTH_USER).post(`/api/rotations/${empty}/turns`).send({})).body.error).toMatch(/nobody/);
    const id = await startShowers();
    expect((await as(RUTH_USER).post(`/api/rotations/${id}/turns`).send({ directoryId: ruth })).status).toBe(404);
    expect((await as(RUTH_USER).post(`/api/rotations/${id}/turns`).send({ date: '2026-02-30' })).body.error).toMatch(/not a date/);
  });

  test('the history keeps a name after the person leaves the directory', async () => {
    const id = await startShowers();
    await as(RUTH_USER).post(`/api/rotations/${id}/turns`).send({ date: '2026-09-01' });
    db.prepare('DELETE FROM directory WHERE id = ?').run(ann);
    const res = await as(NOBODY).get(`/api/rotations/${id}`);
    expect(res.body.rotation.history[0]).toMatchObject({ name: 'Ann Bell', directoryId: null });
    expect(names(res.body)).toEqual(['Beth Cole', 'Cara Dean']);
  });
});

describe('telling whoever is next', () => {
  test('when the rotation moves on, the new next up is emailed and gets a notification', async () => {
    const id = await startShowers({ members: [beth, ann, cara] });
    const res = await as(RUTH_USER).post(`/api/rotations/${id}/turns`).send({});
    expect(res.body.told).toMatchObject({ name: 'Ann Bell', emailed: true, notified: true });
    expect(outbox()).toEqual([{ to_email: 'ann@example.com', subject: 'You are next up: Baby showers', context: `rotation:${id}:next-up` }]);
    expect(bell(ANN_USER.id)).toEqual([{ title: 'You are next up: Baby showers', page: 'rotations' }]);
  });

  test('the email names the coordinators and links to the rotation', async () => {
    const id = await startShowers({ members: [beth, ann] });
    await as(RUTH_USER).post(`/api/rotations/${id}/turns`).send({});
    const body = db.prepare("SELECT body FROM mail_outbox WHERE context LIKE 'rotation:%'").get().body;
    expect(body).toMatch(/Ruth Hale will be in touch/);
    expect(body).toContain(`page=rotations&rotation=${id}`);
  });

  test('setting it up, reordering and sitting out tell nobody', async () => {
    const id = await startShowers();
    await as(RUTH_USER).put(`/api/rotations/${id}/order`).send({ order: [cara, ann, beth] });
    await as(RUTH_USER).patch(`/api/rotations/${id}/members/${cara}`).send({ sittingOut: true });
    expect(outbox()).toEqual([]);
  });

  test('one wait is one email, however often the rotation is touched', async () => {
    const id = await startShowers({ members: [ann, beth, cara] });
    await as(RUTH_USER).post(`/api/rotations/${id}/turns`).send({ directoryId: cara }); // Ann still next
    await as(RUTH_USER).post(`/api/rotations/${id}/turns`).send({ directoryId: beth }); // Ann still next
    expect(outbox().map(m => m.to_email)).toEqual(['ann@example.com']);
  });

  test('somebody with no address still gets the notification if they have an account', async () => {
    const bethUser = addUser('Beth', { directoryId: beth });
    db.prepare("UPDATE users SET email = '' WHERE id = ?").run(bethUser.id);
    const id = await startShowers();
    const res = await as(RUTH_USER).post(`/api/rotations/${id}/turns`).send({});
    expect(res.body.told).toMatchObject({ name: 'Beth Cole', emailed: false, notified: true });
    expect(outbox()).toEqual([]);
  });

  test('"Let them know" tells whoever is next, even if they were told before', async () => {
    const id = await startShowers();
    const first = await as(RUTH_USER).post(`/api/rotations/${id}/remind`);
    expect(first.body.told.name).toBe('Ann Bell');
    await as(RUTH_USER).post(`/api/rotations/${id}/remind`);
    expect(outbox()).toHaveLength(2);
    expect(lastLog()).toBe('Let Ann Bell know they are next up on the "Baby showers" rotation');

    const empty = await startShowers({ members: [] });
    expect((await as(RUTH_USER).post(`/api/rotations/${empty}/remind`)).body.error).toMatch(/nobody/);
    expect((await as(ANN_USER).post(`/api/rotations/${id}/remind`)).status).toBe(403);
  });
});
