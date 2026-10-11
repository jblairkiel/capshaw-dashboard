// The communion preparation sign-up list: a list a year, one name a month.
// Whoever holds communion-prep starts each year's list and can write anybody
// in; members put their own names down. A week before the month, whoever is
// down for it is emailed.
jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const request = require('supertest');
const express = require('express');
const db = require('../db');
const recordKeeping = require('../lib/recordKeeping');
const router = require('../routes/communionPrep');
const reminders = require('../mail/communionPrep');

function buildApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/communion-prep', router);
  return app;
}

function addPerson(name, email = '') {
  return db.prepare('INSERT INTO directory (name, email) VALUES (?, ?)').run(name, email).lastInsertRowid;
}

function addUser(name, { directoryId = null, areas = [], role = 'approved', email = null } = {}) {
  const id = db.prepare('INSERT INTO users (provider, provider_id, email, name, role, directory_id) VALUES (?,?,?,?,?,?)')
    .run('google', `${name}-id`, email ?? `${name.toLowerCase()}@example.com`, name, role, directoryId).lastInsertRowid;
  for (const a of areas) db.prepare('INSERT INTO user_areas (user_id, area) VALUES (?, ?)').run(id, a);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

let KEEPER, JOE, NED, joe;
const outbox = () => db.prepare("SELECT to_email, intended_for, subject, context FROM mail_outbox WHERE context LIKE 'communion-prep:%' ORDER BY id").all();
const month = (body, m) => body.months.find(x => x.month === m);

beforeEach(() => {
  for (const t of ['mail_outbox', 'action_log', 'communion_prep_signups', 'communion_prep_years', 'user_areas', 'users', 'directory']) db.prepare(`DELETE FROM ${t}`).run();
  jest.spyOn(recordKeeping, 'churchToday').mockReturnValue('2026-10-11');
  joe = addPerson('Joe Carter', 'joe.carter@example.com');
  KEEPER = addUser('Kay', { areas: ['communion-prep'] });
  JOE = addUser('Joe', { directoryId: joe });
  NED = addUser('Ned');
});

afterEach(() => jest.restoreAllMocks());

const start = (year, user = KEEPER) => request(buildApp(user)).post('/api/communion-prep/years').send({ year });

describe('starting a year\'s list', () => {
  test('the keeper starts it, and it has twelve open months', async () => {
    const res = await start(2027);
    expect(res.status).toBe(201);
    expect(res.body.months.map(m => m.label)).toEqual(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']);
    expect(res.body.months.every(m => m.signup === null)).toBe(true);
    expect(db.prepare("SELECT summary FROM action_log WHERE entity = 'communion preparation list'").get().summary).toBe('Started the 2027 communion preparation list');
  });

  test('only once a year, only this year to two years ahead, and only by the keeper', async () => {
    await start(2026);
    expect((await start(2026)).body.error).toMatch(/already been started/);
    expect((await start(2025)).body.error).toMatch(/2026 to 2028/);
    expect((await start(2029)).body.error).toMatch(/2026 to 2028/);
    expect((await start(2027, JOE)).status).toBe(403);
  });

  test('the page opens on this year, says which years the keeper could start, and members see none', async () => {
    await start(2026);
    const keeper = await request(buildApp(KEEPER)).get('/api/communion-prep');
    expect(keeper.body).toMatchObject({ year: 2026, years: [2026], startable: [2027, 2028], canManage: true });
    expect(keeper.body.people).toEqual(['Joe Carter']);
    const member = await request(buildApp(JOE)).get('/api/communion-prep');
    expect(member.body).toMatchObject({ year: 2026, startable: [], canManage: false, people: [] });
    // Past and current months are marked as begun.
    expect(month(member.body, 10).started).toBe(true);
    expect(month(member.body, 11).started).toBe(false);
  });

  test('with no list yet, there is nothing to sign up for', async () => {
    const res = await request(buildApp(JOE)).get('/api/communion-prep');
    expect(res.body.months).toBeNull();
    expect((await request(buildApp(JOE)).post('/api/communion-prep/2026/11/signup')).body.error).toMatch(/no list for 2026/);
  });
});

describe('signing up', () => {
  beforeEach(async () => { await start(2026); await start(2027); });

  test('a member puts their own name down, by their directory name, and can take it off', async () => {
    const res = await request(buildApp(JOE)).post('/api/communion-prep/2027/3/signup');
    expect(res.status).toBe(200);
    expect(month(res.body, 3).signup).toMatchObject({ name: 'Joe Carter', mine: true, hasEmail: true });
    expect((await request(buildApp(NED)).get('/api/communion-prep?year=2027')).body.months[2].signup.mine).toBe(false);

    const off = await request(buildApp(JOE)).delete('/api/communion-prep/2027/3/signup');
    expect(month(off.body, 3).signup).toBeNull();
    expect(db.prepare("SELECT summary FROM action_log WHERE action = 'delete'").get().summary)
      .toBe('Joe Carter took their name off communion preparation in March 2027');
  });

  test('one name a month, never someone else\'s name off, and never a month that has begun', async () => {
    await request(buildApp(JOE)).post('/api/communion-prep/2027/3/signup');
    const taken = await request(buildApp(NED)).post('/api/communion-prep/2027/3/signup');
    expect(taken.status).toBe(409);
    expect((await request(buildApp(NED)).delete('/api/communion-prep/2027/3/signup')).status).toBe(403);
    expect((await request(buildApp(NED)).post('/api/communion-prep/2026/10/signup')).body.error).toMatch(/October 2026 has already begun/);
    expect((await request(buildApp(NED)).post('/api/communion-prep/2026/13/signup')).body.error).toMatch(/No such month/);
  });

  test('somebody not in the directory signs up under their account name', async () => {
    const res = await request(buildApp(NED)).post('/api/communion-prep/2027/1/signup');
    expect(month(res.body, 1).signup).toMatchObject({ name: 'Ned', mine: true, hasEmail: true });
  });

  test('the keeper writes anybody in, matching the directory, replaces a name, or clears it', async () => {
    const put = (m, name) => request(buildApp(KEEPER)).put(`/api/communion-prep/2027/${m}`).send({ name });
    let res = await put(5, 'joe carter');
    expect(month(res.body, 5).signup).toMatchObject({ name: 'Joe Carter', directoryId: joe, hasEmail: true });
    res = await put(5, 'The Smith family');
    expect(month(res.body, 5).signup).toMatchObject({ name: 'The Smith family', directoryId: null, hasEmail: false });
    res = await put(5, '');
    expect(month(res.body, 5).signup).toBeNull();
    expect(db.prepare("SELECT summary FROM action_log WHERE entity = 'communion preparation' ORDER BY id").all().map(r => r.summary)).toEqual([
      'Put Joe Carter down to prepare communion in May 2027',
      'Put The Smith family down to prepare communion in May 2027 in place of Joe Carter',
      'Cleared communion preparation in May 2027 (was The Smith family)',
    ]);
    expect((await request(buildApp(JOE)).put('/api/communion-prep/2027/5').send({ name: 'Joe Carter' })).status).toBe(403);
  });
});

describe('the reminder a week before the month', () => {
  beforeEach(async () => { await start(2026); });
  const tickOn = iso => reminders.tick(new Date(`${iso}T17:00:00Z`));

  test('goes a week before, once, to whoever is down for the month', async () => {
    await request(buildApp(JOE)).post('/api/communion-prep/2026/11/signup');
    expect(tickOn('2026-10-24')).toEqual([]);
    expect(tickOn('2026-10-25')).toEqual([{ name: 'Joe Carter', year: 2026, month: 11 }]);
    expect(tickOn('2026-10-26')).toEqual([]);
    const mail = outbox();
    expect(mail).toHaveLength(1);
    expect(mail[0].intended_for || mail[0].to_email).toBe('joe.carter@example.com');
    expect(mail[0].subject).toBe('Reminder: you are preparing communion in November 2026');
    expect(mail[0].context).toBe('communion-prep:2026-11:reminder');
  });

  test('a late sign-up is reminded straight away, but never once the month has begun', async () => {
    await request(buildApp(KEEPER)).put('/api/communion-prep/2026/11').send({ name: 'Joe Carter' });
    expect(tickOn('2026-10-30')).toHaveLength(1);
    db.prepare("UPDATE communion_prep_signups SET reminded_at = NULL").run();
    expect(tickOn('2026-11-01')).toEqual([]);
  });

  test('a new name on the month is reminded afresh; a name with no address waits for one', async () => {
    await request(buildApp(JOE)).post('/api/communion-prep/2026/11/signup');
    tickOn('2026-10-25');
    await request(buildApp(KEEPER)).put('/api/communion-prep/2026/11').send({ name: 'Visiting Brother' });
    expect(tickOn('2026-10-26')).toEqual([]);
    const brother = addPerson('Visiting Brother', 'brother@example.com');
    await request(buildApp(KEEPER)).put('/api/communion-prep/2026/11').send({ name: '' });
    await request(buildApp(KEEPER)).put('/api/communion-prep/2026/11').send({ name: 'Visiting Brother' });
    expect(db.prepare('SELECT directory_id FROM communion_prep_signups').get().directory_id).toBe(brother);
    expect(tickOn('2026-10-26')).toEqual([{ name: 'Visiting Brother', year: 2026, month: 11 }]);
    expect(outbox()).toHaveLength(2);
  });
});
