// My week: one member's own jobs, sign-ups, meetings and rotation turns for
// today and the thirteen days after it, gathered from the pages they live on.
jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const request = require('supertest');
const express = require('express');
const db = require('../db');
const recordKeeping = require('../lib/recordKeeping');
const router = require('../routes/myWeek');

function buildApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/my-week', router);
  return app;
}

const run = (sql, ...args) => Number(db.prepare(sql).run(...args).lastInsertRowid);
const addPerson = name => run('INSERT INTO directory (name) VALUES (?)', name);
function addUser(name, directoryId = null) {
  const id = run('INSERT INTO users (provider, provider_id, email, name, role, directory_id) VALUES (?,?,?,?,?,?)',
    'google', `${name}-id`, `${name.toLowerCase()}@example.com`, name, 'approved', directoryId);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

let tom, ann, TOM, ANN, NOBODY;

beforeEach(() => {
  for (const t of [
    'workflow_instances', 'job_assignments', 'signup_entries', 'signup_items', 'signup_dates', 'signup_lists',
    'group_event_signups', 'group_event_signup_items', 'group_event_rsvps', 'group_events', 'church_group_members', 'church_groups',
    'rotation_turns', 'rotation_members', 'rotations', 'users', 'directory',
  ]) db.prepare(`DELETE FROM ${t}`).run();
  // A Wednesday: the window runs to Tuesday 2026-11-24.
  jest.spyOn(recordKeeping, 'churchToday').mockReturnValue('2026-11-11');
  tom = addPerson('Tom Reed');
  ann = addPerson('Ann Bell');
  TOM = addUser('Tom', tom);
  ANN = addUser('Ann', ann);
  NOBODY = addUser('Ned');
});

afterEach(() => jest.restoreAllMocks());

const weekOf = async user => (await request(buildApp(user)).get('/api/my-week')).body;

test('serving jobs come off the roster by name, whatever the service is called', async () => {
  const wed = run("INSERT INTO job_assignments (month, date, service, job, name) VALUES ('November 2026', 'November 11', 'Wed Bible Class', 'Song Leader', ' tom reed ')");
  run("INSERT INTO job_assignments (month, date, service, job, name) VALUES ('November 2026', 'November 15', 'Sunday Worship', 'Opening Prayer', 'Tom Reed')");
  // Outside the window, and somebody else's.
  run("INSERT INTO job_assignments (month, date, service, job, name) VALUES ('November 2026', 'November 29', 'Sunday Worship', 'Usher', 'Tom Reed')");
  run("INSERT INTO job_assignments (month, date, service, job, name) VALUES ('November 2026', 'November 15', 'Sunday Worship', 'Usher', 'Ann Bell')");
  run("INSERT INTO workflow_instances (definition_id, status, data) VALUES ('serving-replacement', 'active', ?)", JSON.stringify({ slotId: wed }));

  const body = await weekOf(TOM);
  expect(body).toMatchObject({ success: true, from: '2026-11-11', to: '2026-11-24', linked: true, name: 'Tom Reed' });
  expect(body.items).toEqual([
    expect.objectContaining({ kind: 'job', date: '2026-11-11', service: 'Wed Bible Class', job: 'Song Leader', replacementAsked: true }),
    expect.objectContaining({ kind: 'job', date: '2026-11-15', service: 'Sunday Worship', job: 'Opening Prayer', replacementAsked: false }),
  ]);
});

test('sign-ups by account or directory entry, with what they took on', async () => {
  const list = run("INSERT INTO signup_lists (title, free_label) VALUES ('Meals for the Hales', 'Anything')");
  const d1 = run("INSERT INTO signup_dates (list_id, date, time) VALUES (?, '2026-11-13', '17:00')", list);
  const d2 = run("INSERT INTO signup_dates (list_id, date) VALUES (?, '2026-12-01')", list);
  const item = run("INSERT INTO signup_items (list_id, label) VALUES (?, 'Supper')", list);
  run("INSERT INTO signup_entries (list_id, date_id, item_id, name, directory_id) VALUES (?, ?, ?, 'Tom Reed', ?)", list, d1, item, tom);
  run("INSERT INTO signup_entries (list_id, date_id, item_id, name, user_id) VALUES (?, ?, NULL, 'Tom', ?)", list, d1, TOM.id);
  run("INSERT INTO signup_entries (list_id, date_id, item_id, name, directory_id) VALUES (?, ?, ?, 'Tom Reed', ?)", list, d2, item, tom);

  const { items } = await weekOf(TOM);
  expect(items.map(i => [i.kind, i.date, i.item])).toEqual([['signup', '2026-11-13', 'Supper'], ['signup', '2026-11-13', 'Anything']]);
  expect(items[0]).toMatchObject({ listId: list, title: 'Meals for the Hales', time: '17:00' });
  expect((await weekOf(ANN)).items).toEqual([]);
});

test('group meetings: answered yes or maybe, still waiting on an answer, never a no', async () => {
  const group = run("INSERT INTO church_groups (key, name) VALUES ('group-1', 'Young Families')");
  run('INSERT INTO church_group_members (group_id, directory_id) VALUES (?, ?)', group, tom);
  const meet = (title, date, status = 'published') => run(
    'INSERT INTO group_events (group_id, title, event_date, status, rsvp_enabled) VALUES (?, ?, ?, ?, 1)', group, title, date, status);
  const potluck = meet('Potluck', '2026-11-14');
  meet('Hike', '2026-11-20');
  const bowling = meet('Bowling', '2026-11-21');
  meet('Draft night', '2026-11-16', 'draft');
  meet('Christmas party', '2026-12-12');

  run("INSERT INTO group_event_rsvps (event_id, user_id, directory_id, response, guests) VALUES (?, ?, ?, 'yes', 2)", potluck, TOM.id, tom);
  run("INSERT INTO group_event_rsvps (event_id, user_id, directory_id, response) VALUES (?, ?, ?, 'no')", bowling, TOM.id, tom);
  const dish = run("INSERT INTO group_event_signup_items (event_id, label) VALUES (?, 'Dessert')", potluck);
  run("INSERT INTO group_event_signups (item_id, user_id, directory_id, detail) VALUES (?, ?, ?, 'a pie')", dish, TOM.id, tom);

  const { items } = await weekOf(TOM);
  expect(items.map(i => [i.title, i.rsvp])).toEqual([['Potluck', 'yes'], ['Hike', 'unanswered']]);
  expect(items[0]).toMatchObject({ group: 'Young Families', groupId: group, guests: 2, bringing: ['Dessert: a pie'] });
  // Not in the group, so not invited.
  expect((await weekOf(ANN)).items).toEqual([]);
});

test('rotation turns in the window, and rotations where they are next up', async () => {
  const flowers = run("INSERT INTO rotations (name) VALUES ('Flowers')");
  const greeters = run("INSERT INTO rotations (name) VALUES ('Greeters')");
  run('INSERT INTO rotation_members (rotation_id, directory_id, position) VALUES (?, ?, 1)', flowers, tom);
  run('INSERT INTO rotation_members (rotation_id, directory_id, position) VALUES (?, ?, 1)', greeters, ann);
  run('INSERT INTO rotation_members (rotation_id, directory_id, position) VALUES (?, ?, 2)', greeters, tom);
  run("INSERT INTO rotation_turns (rotation_id, directory_id, name, date) VALUES (?, ?, 'Tom Reed', '2026-11-22')", greeters, tom);

  const body = await weekOf(TOM);
  expect(body.items).toEqual([expect.objectContaining({ kind: 'rotation', date: '2026-11-22', title: 'Greeters', rotationId: greeters })]);
  expect(body.nextUp).toEqual([{ rotationId: flowers, title: 'Flowers' }]);
});

test('an account not linked to the directory still gets its own sign-ups, and is told it is not linked', async () => {
  const list = run("INSERT INTO signup_lists (title) VALUES ('Clean-up day')");
  const d = run("INSERT INTO signup_dates (list_id, date) VALUES (?, '2026-11-12')", list);
  run("INSERT INTO signup_entries (list_id, date_id, name, user_id) VALUES (?, ?, 'Ned', ?)", list, d, NOBODY.id);

  const body = await weekOf(NOBODY);
  expect(body).toMatchObject({ linked: false, name: 'Ned', nextUp: [] });
  expect(body.items.map(i => i.title)).toEqual(['Clean-up day']);
});
