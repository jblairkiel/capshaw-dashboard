// Sign-up lists: any member makes one; whoever made it keeps it; the sign-up
// manager keeps them all, emails whole groups about them, and sees the
// analytics.
jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const request = require('supertest');
const express = require('express');
const db = require('../db');
const recordKeeping = require('../lib/recordKeeping');
const router = require('../routes/signups');

function buildApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/signups', router);
  return app;
}

const addPerson = (name, email = '') => db.prepare('INSERT INTO directory (name, email) VALUES (?, ?)').run(name, email).lastInsertRowid;
function addUser(name, { directoryId = null, areas = [] } = {}) {
  const id = db.prepare('INSERT INTO users (provider, provider_id, email, name, role, directory_id) VALUES (?,?,?,?,?,?)')
    .run('google', `${name}-id`, `${name.toLowerCase()}@example.com`, name, 'approved', directoryId).lastInsertRowid;
  for (const a of areas) db.prepare('INSERT INTO user_areas (user_id, area) VALUES (?, ?)').run(id, a);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

let MANAGER, MAKER, JOE, NED, joe;
const MEAL = {
  title: 'Fellowship meal', description: 'After worship', kind: 'one-date',
  dates: [{ date: '2026-11-15', time: '12:00' }],
  items: [{ label: 'Main dish', needed: 2 }, { label: 'Dessert', needed: '' }],
  allowFree: true, freeLabel: 'Something else',
};
const TRAIN = {
  title: 'Meal train', kind: 'multi-date',
  dates: [{ date: '2026-10-22' }, { date: '2026-10-20' }, { date: '2026-10-21' }],
  items: [{ label: 'Bring dinner', needed: 1 }],
};

beforeEach(() => {
  for (const t of ['mail_outbox', 'action_log', 'signup_entries', 'signup_items', 'signup_dates', 'signup_lists', 'mail_group_members', 'user_areas', 'users', 'directory']) db.prepare(`DELETE FROM ${t}`).run();
  jest.spyOn(recordKeeping, 'churchToday').mockReturnValue('2026-10-11');
  joe = addPerson('Joe Carter', 'joe.carter@example.com');
  MANAGER = addUser('Mona', { areas: ['signups'] });
  MAKER = addUser('Mia');
  JOE = addUser('Joe', { directoryId: joe });
  NED = addUser('Ned');
});
afterEach(() => jest.restoreAllMocks());

const make = (body = MEAL, user = MAKER) => request(buildApp(user)).post('/api/signups').send(body);
const signUp = (user, id, body) => request(buildApp(user)).post(`/api/signups/${id}/entries`).send(body);

describe('making a sign-up list', () => {
  test('any member makes one, on one date, with set items and free sign-ups', async () => {
    const res = await make();
    expect(res.status).toBe(201);
    const { list } = res.body;
    expect(list).toMatchObject({ title: 'Fellowship meal', kind: 'one-date', allowFree: true, freeLabel: 'Something else', createdBy: 'Mia', canEdit: true });
    expect(list.items.map(i => [i.label, i.needed])).toEqual([['Main dish', 2], ['Dessert', null]]);
    expect(list.dates).toHaveLength(1);
    expect(list.totals).toEqual({ entries: 0, needed: 2, filled: 0, people: 0 });
    expect(db.prepare("SELECT summary FROM action_log WHERE entity = 'sign-up list'").get().summary).toBe('Made the sign-up “Fellowship meal”');
  });

  test('or one sign-up across several dates, kept in date order', async () => {
    const { body } = await make(TRAIN);
    expect(body.list.dates.map(d => d.date)).toEqual(['2026-10-20', '2026-10-21', '2026-10-22']);
    expect(body.list.totals.needed).toBe(3);
  });

  test('refuses what does not make sense', async () => {
    expect((await make({ ...MEAL, title: '' })).body.error).toMatch(/title/);
    expect((await make({ ...MEAL, dates: [] })).body.error).toMatch(/date/);
    expect((await make({ ...MEAL, dates: [{ date: '2026-11-15' }, { date: '2026-11-16' }] })).body.error).toMatch(/single date/);
    expect((await make({ ...MEAL, items: [], allowFree: false })).body.error).toMatch(/what is needed/);
    expect((await make({ ...MEAL, items: [{ label: 'Pie', needed: 0 }] })).body.error).toMatch(/whole number/);
  });

  test('only its maker or the manager can change, close or delete it', async () => {
    const { body } = await make();
    const id = body.list.id;
    expect((await request(buildApp(NED)).put(`/api/signups/${id}`).send(MEAL)).status).toBe(403);
    expect((await request(buildApp(NED)).post(`/api/signups/${id}/close`).send({})).status).toBe(403);
    expect((await request(buildApp(NED)).delete(`/api/signups/${id}`)).status).toBe(403);
    expect((await request(buildApp(MANAGER)).put(`/api/signups/${id}`).send({ ...MEAL, title: 'Fellowship lunch' })).body.list.title).toBe('Fellowship lunch');
    expect((await request(buildApp(MAKER)).post(`/api/signups/${id}/close`).send({ closed: true })).body.list.closed).toBe(true);
    expect((await request(buildApp(MAKER)).delete(`/api/signups/${id}`)).status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) n FROM signup_lists').get().n).toBe(0);
  });

  test('a date or item somebody is down for cannot be dropped from under them', async () => {
    const { body } = await make();
    const { list } = body;
    await signUp(JOE, list.id, { dateId: list.dates[0].id, itemId: list.items[0].id });
    const res = await request(buildApp(MAKER)).put(`/api/signups/${list.id}`).send({ ...MEAL, dates: [{ id: list.dates[0].id, date: '2026-11-15' }], items: [{ id: list.items[1].id, label: 'Dessert' }] });
    expect(res.body.error).toMatch(/Main dish.*take their names off/);
    const renamed = await request(buildApp(MAKER)).put(`/api/signups/${list.id}`).send({ ...MEAL, dates: [{ id: list.dates[0].id, date: '2026-11-22' }], items: [{ id: list.items[0].id, label: 'Casserole', needed: 3 }] });
    expect(renamed.body.list.dates[0].date).toBe('2026-11-22');
    expect(renamed.body.list.dates[0].items[0]).toMatchObject({ taken: 1, needed: 3 });
  });
});

describe('signing up', () => {
  let list;
  beforeEach(async () => { list = (await make()).body.list; });
  const date = () => list.dates[0].id;

  test('a member signs up by their directory name, up to how many are needed, and takes it off', async () => {
    const res = await signUp(JOE, list.id, { dateId: date(), itemId: list.items[0].id });
    const slot = res.body.list.dates[0].items[0];
    expect(slot).toMatchObject({ taken: 1, needed: 2, full: false });
    expect(slot.entries[0]).toMatchObject({ name: 'Joe Carter', mine: true, canRemove: true });
    expect((await signUp(JOE, list.id, { dateId: date(), itemId: list.items[0].id })).body.error).toMatch(/already down/);
    await signUp(NED, list.id, { dateId: date(), itemId: list.items[0].id });
    expect((await signUp(MAKER, list.id, { dateId: date(), itemId: list.items[0].id })).status).toBe(409);

    const nedSees = (await request(buildApp(NED)).get(`/api/signups/${list.id}`)).body.list.dates[0].items[0];
    const joes = nedSees.entries.find(e => e.name === 'Joe Carter');
    expect(joes).toMatchObject({ mine: false, canRemove: false });
    expect((await request(buildApp(NED)).delete(`/api/signups/entries/${joes.id}`)).status).toBe(403);
    expect((await request(buildApp(JOE)).delete(`/api/signups/entries/${joes.id}`)).status).toBe(200);
  });

  test('an item with no limit takes everybody; a free sign-up says what it is', async () => {
    for (const u of [JOE, NED, MAKER]) expect((await signUp(u, list.id, { dateId: date(), itemId: list.items[1].id })).status).toBe(200);
    expect((await signUp(NED, list.id, { dateId: date() })).body.error).toMatch(/what you will bring/);
    const res = await signUp(NED, list.id, { dateId: date(), note: 'Paper plates' });
    expect(res.body.list.dates[0].free).toEqual([expect.objectContaining({ name: 'Ned', note: 'Paper plates' })]);
  });

  test('the maker puts somebody else down; nobody else can', async () => {
    expect((await signUp(NED, list.id, { dateId: date(), itemId: list.items[0].id, name: 'Visiting Sister' })).status).toBe(403);
    const res = await signUp(MAKER, list.id, { dateId: date(), itemId: list.items[0].id, name: 'joe carter' });
    expect(res.body.list.dates[0].items[0].entries[0].name).toBe('Joe Carter');
  });

  test('never on a closed list or a date that has passed', async () => {
    const past = (await make({ ...TRAIN, dates: [{ date: '2026-10-01' }, { date: '2026-10-20' }] })).body.list;
    expect((await signUp(JOE, past.id, { dateId: past.dates[0].id, itemId: past.items[0].id })).body.error).toMatch(/passed/);
    await request(buildApp(MAKER)).post(`/api/signups/${list.id}/close`).send({ closed: true });
    expect((await signUp(JOE, list.id, { dateId: date(), itemId: list.items[0].id })).body.error).toMatch(/closed/);
  });

  test('the index lists every sign-up, with how full each is and whether you are on it', async () => {
    await signUp(JOE, list.id, { dateId: date(), itemId: list.items[0].id });
    const res = await request(buildApp(JOE)).get('/api/signups');
    expect(res.body.lists[0]).toMatchObject({ id: list.id, title: 'Fellowship meal', mine: true, madeByMe: false, past: false, totals: { filled: 1, needed: 2 } });
    expect(res.body.canManage).toBe(false);
  });
});

describe('emailing about a list', () => {
  let list;
  beforeEach(async () => {
    list = (await make()).body.list;
    await signUp(JOE, list.id, { dateId: list.dates[0].id, itemId: list.items[0].id });
  });
  const email = (user, body) => request(buildApp(user)).post(`/api/signups/${list.id}/email`).send(body);

  test('the maker previews and sends to everyone signed up: their words, then the list as it stands', async () => {
    const preview = await request(buildApp(MAKER)).post(`/api/signups/${list.id}/email/preview`).send({ message: 'One more main dish, please!' });
    expect(preview.body).toMatchObject({ subject: 'Sign up: Fellowship meal', audience: 'everyone signed up', count: 1 });
    expect(preview.body.body).toMatch(/^One more main dish, please!/);
    expect(preview.body.body).toMatch(/Main dish — 1 of 2 still needed/);
    expect(preview.body.body).toMatch(/page=signups&list=\d+/);

    const sent = await email(MAKER, { message: 'One more main dish, please!', subject: 'Help needed' });
    expect(sent.body.sent).toBe(1);
    const row = db.prepare("SELECT to_email, intended_for, subject, context FROM mail_outbox").get();
    expect(row.intended_for || row.to_email).toBe('joe.carter@example.com');
    expect(row).toMatchObject({ subject: 'Help needed', context: `signup:${list.id}:email` });
  });

  test('needs a few words of its own, and is only for its maker or the manager', async () => {
    expect((await email(MAKER, { message: '  ' })).body.error).toMatch(/words of your own/);
    expect((await email(NED, { message: 'Hi' })).status).toBe(403);
  });

  test('a whole distribution group is the manager\'s to email, not the maker\'s', async () => {
    expect((await email(MAKER, { to: 'announcements', message: 'Hi' })).status).toBe(403);
    const group = db.prepare("SELECT id FROM mail_groups WHERE key = 'announcements'").get();
    db.prepare('INSERT INTO mail_group_members (group_id, directory_id) VALUES (?, ?)').run(group.id, joe);
    expect((await request(buildApp(MAKER)).get(`/api/signups/${list.id}`)).body.emailGroups).toEqual([]);
    expect((await request(buildApp(MANAGER)).get(`/api/signups/${list.id}`)).body.emailGroups.length).toBeGreaterThan(0);
    const res = await email(MANAGER, { to: 'announcements', message: 'Everyone welcome' });
    expect(res.body.sent).toBe(1);
  });
});

describe('analytics', () => {
  test('for the manager only: totals, fill rate, who signs up most, by month, and what is still short', async () => {
    const meal = (await make()).body.list;
    const train = (await make(TRAIN, NED)).body.list;
    await signUp(JOE, meal.id, { dateId: meal.dates[0].id, itemId: meal.items[0].id });
    await signUp(JOE, train.id, { dateId: train.dates[0].id, itemId: train.items[0].id });
    await signUp(NED, train.id, { dateId: train.dates[1].id, itemId: train.items[0].id });

    expect((await request(buildApp(MAKER)).get('/api/signups/analytics')).status).toBe(403);
    const res = await request(buildApp(MANAGER)).get('/api/signups/analytics');
    expect(res.body.totals).toEqual({ lists: 2, open: 2, entries: 3, people: 2, fillRate: 60 });
    expect(res.body.topPeople[0]).toEqual({ name: 'Joe Carter', count: 2, lists: 2 });
    expect(res.body.byMonth).toEqual([{ month: '2026-10', count: 2 }, { month: '2026-11', count: 1 }]);
    expect(res.body.short.map(s => [s.title, s.missing])).toEqual([['Meal train', 1], ['Fellowship meal', 1]]);
    expect(res.body.byCreator).toEqual([{ name: 'Mia', count: 1 }, { name: 'Ned', count: 1 }]);
  });
});

describe('on the church calendar', () => {
  test('every date of every list, with what is still needed that day, for anybody signed in', async () => {
    const meal = (await make()).body.list;
    const train = (await make(TRAIN, NED)).body.list;
    await signUp(JOE, train.id, { dateId: train.dates[0].id, itemId: train.items[0].id });
    await signUp(NED, meal.id, { dateId: meal.dates[0].id, itemId: null, note: 'Rolls' });
    await request(buildApp(MAKER)).post(`/api/signups/${meal.id}/close`).send({ closed: true });

    const res = await request(buildApp(NED)).get('/api/signups/calendar');
    expect(res.status).toBe(200);
    expect(res.body.dates.map(d => [d.title, d.date, d.stillNeeded, d.names])).toEqual([
      ['Meal train', '2026-10-20', 0, 1],
      ['Meal train', '2026-10-21', 1, 0],
      ['Meal train', '2026-10-22', 1, 0],
      ['Fellowship meal', '2026-11-15', 2, 1],
    ]);
    expect(res.body.dates[3]).toMatchObject({ listId: meal.id, dateId: meal.dates[0].id, time: '12:00', closed: true, needed: 2 });
  });
});
