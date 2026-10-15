// Telling the person a change concerns: whoever is put on, taken off, or let
// down by something somebody else did. Each is a notification on their bell
// and an email (mail/notices.js); nobody is told about their own doing, and a
// change to something already past tells nobody.
jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const request = require('supertest');
const express = require('express');
const db = require('../db');
const recordKeeping = require('../lib/recordKeeping');
const groups = require('../lib/churchGroups');

const ROUTES = {
  '/api/serving':        require('../routes/serving'),
  '/api/communion-prep': require('../routes/communionPrep'),
  '/api/signups':        require('../routes/signups'),
  '/api/groups':         require('../routes/groups'),
  '/api/rotations':      require('../routes/rotations'),
  '/api/auth':           require('../routes/auth'),
  '/api/workflows':      require('../routes/workflows'),
};

function buildApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  for (const [path, router] of Object.entries(ROUTES)) app.use(path, router);
  return app;
}
const as = user => request(buildApp(user));

const addPerson = (name, email = '') => Number(db.prepare('INSERT INTO directory (name, email) VALUES (?, ?)').run(name, email).lastInsertRowid);
function addUser(name, { directoryId = null, areas = [], role = 'approved', email } = {}) {
  const id = db.prepare('INSERT INTO users (provider, provider_id, email, name, role, directory_id) VALUES (?,?,?,?,?,?)')
    .run('google', `${name}-id`, email ?? `${name.toLowerCase()}@example.com`, name, role, directoryId).lastInsertRowid;
  for (const a of areas) db.prepare('INSERT INTO user_areas (user_id, area) VALUES (?, ?)').run(id, a);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

// Who each notice went to: the real recipient, not the test-mode redirect.
const mail = prefix => db.prepare(`
  SELECT COALESCE(NULLIF(intended_for, ''), to_email) AS to_email, subject, body, context
    FROM mail_outbox WHERE context LIKE ? ORDER BY id
`).all(`${prefix}%`);
const bell = (userId, kind) => db.prepare('SELECT title, page FROM notifications WHERE user_id = ? AND kind = ? ORDER BY id').all(userId, kind);

let KAY, ADA, JOE, ann, joe, ned;

beforeEach(() => {
  for (const t of ['mail_outbox', 'notifications', 'action_log', 'workflow_tasks', 'workflow_instances', 'job_assignments', 'communion_prep_signups', 'communion_prep_years',
    'signup_entries', 'signup_items', 'signup_dates', 'signup_lists', 'group_event_signups', 'group_event_signup_items', 'group_events',
    'church_group_members', 'church_groups', 'rotation_turns', 'rotation_members', 'rotation_coordinators', 'rotations',
    'user_areas', 'users', 'directory']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
  jest.spyOn(recordKeeping, 'churchToday').mockReturnValue('2026-10-14');
  ann = addPerson('Ann Bell', 'ann@example.com');
  joe = addPerson('Joe Carter', 'joe@example.com');
  ned = addPerson('Ned Lowe');                       // in the directory, with no address and no account
  KAY = addUser('Kay', { areas: ['serving-schedule', 'communion-prep', 'church-groups', 'rotations'] });
  ADA = addUser('Ada', { role: 'admin' });
  JOE = addUser('Joe', { directoryId: joe });
});

afterEach(() => jest.restoreAllMocks());

// ─── Serving Schedule ─────────────────────────────────────────────────────────

describe('the serving schedule, changed by hand', () => {
  const slot = (date, name = '') => Number(db.prepare('INSERT INTO job_assignments (month, date, service, job, name) VALUES (?,?,?,?,?)')
    .run('November 2026', date, 'Sunday AM', 'Lead Singing', name).lastInsertRowid);

  test('whoever is written into a slot is told, by email and bell', async () => {
    const id = slot('November 1');
    await as(KAY).patch(`/api/serving/assignments/${id}`).send({ name: 'Joe Carter' });
    expect(mail('notice:serving:')).toEqual([expect.objectContaining({
      to_email: 'joe@example.com', subject: 'You are down for Lead Singing: November 1, Sunday AM', context: `notice:serving:${id}:assigned`,
    })]);
    expect(mail('notice:serving:')[0].body).toMatch(/Ask to be replaced/);
    expect(bell(JOE.id, 'serving-changed')).toEqual([{ title: 'You are down for Lead Singing: November 1, Sunday AM', page: 'service-roster' }]);
  });

  test('swapping one name for another tells both', async () => {
    const id = slot('November 1', 'Ann Bell');
    await as(KAY).patch(`/api/serving/assignments/${id}`).send({ name: 'Joe Carter' });
    const sent = mail('notice:serving:');
    expect(sent.map(m => [m.to_email, m.subject])).toEqual([
      ['joe@example.com', 'You are down for Lead Singing: November 1, Sunday AM'],
      ['ann@example.com', 'You are off Lead Singing: November 1, Sunday AM'],
    ]);
    expect(sent[1].body).toMatch(/Joe Carter is doing it instead/);
  });

  test('a slot moved to another day, or taken off the schedule, tells whoever is on it', async () => {
    const id = slot('November 1', 'Ann Bell');
    await as(KAY).patch(`/api/serving/assignments/${id}`).send({ date: 'November 8' });
    await as(KAY).delete(`/api/serving/assignments/${id}`);
    expect(mail('notice:serving:').map(m => m.subject)).toEqual([
      'Changed: Lead Singing, now November 8, Sunday AM',
      'You are off Lead Singing: November 8, Sunday AM',
    ]);
  });

  test('a new slot filled straight away tells whoever is in it', async () => {
    await as(KAY).post('/api/serving/assignments').send({ month: 'November 2026', date: 'November 1', service: 'Sunday AM', job: 'Prayer', name: 'Ann Bell' });
    expect(mail('notice:serving:').map(m => m.to_email)).toEqual(['ann@example.com']);
  });

  test('correcting a Sunday already past, or putting yourself down, tells nobody', async () => {
    const past = Number(db.prepare('INSERT INTO job_assignments (month, date, service, job, name) VALUES (?,?,?,?,?)')
      .run('October 2026', 'October 5', 'Sunday AM', 'Prayer', '').lastInsertRowid);
    await as(KAY).patch(`/api/serving/assignments/${past}`).send({ name: 'Ann Bell' });
    const keeperJoe = addUser('Joe K', { directoryId: joe, areas: ['serving-schedule'] });
    await as(keeperJoe).patch(`/api/serving/assignments/${slot('November 1')}`).send({ name: 'Joe Carter' });
    expect(mail('notice:serving:')).toEqual([]);
  });

  test('a replacement settled from My Inbox tells whoever is now doing it', async () => {
    const id = slot('November 1', 'Joe Carter');
    const asked = await as(JOE).post(`/api/serving/assignments/${id}/replacement`).send({ reason: 'Away' });
    expect(asked.status).toBe(200);
    const task = db.prepare("SELECT id FROM workflow_tasks WHERE status = 'pending' ORDER BY id DESC").get();
    const done = await as(KAY).post(`/api/workflows/tasks/${task.id}`).send({ action: 'replaced', note: 'Ann Bell' });
    expect(done.status).toBe(200);
    const [sent] = mail('notice:serving:');
    expect(sent).toMatchObject({ to_email: 'ann@example.com', subject: 'You are down for Lead Singing: November 1, Sunday AM' });
    expect(sent.body).toMatch(/in place of Joe Carter/);
    expect(mail('notice:serving:')).toHaveLength(1);
  });

  test('a name that is in the directory twice is not guessed at', async () => {
    addPerson('Ann Bell', 'other.ann@example.com');
    await as(KAY).patch(`/api/serving/assignments/${slot('November 1')}`).send({ name: 'Ann Bell' });
    expect(mail('notice:serving:')).toEqual([]);
  });
});

// ─── Communion preparation ────────────────────────────────────────────────────

describe('communion preparation', () => {
  beforeEach(async () => { await as(KAY).post('/api/communion-prep/years').send({ year: 2026 }); });

  test('the keeper putting somebody down, then somebody else in their place, tells both', async () => {
    await as(KAY).put('/api/communion-prep/2026/11').send({ name: 'Ann Bell' });
    await as(KAY).put('/api/communion-prep/2026/11').send({ name: 'Joe Carter' });
    expect(mail('notice:communion-prep:').map(m => [m.to_email, m.subject])).toEqual([
      ['ann@example.com', 'You are down to prepare communion in November 2026'],
      ['joe@example.com', 'You are down to prepare communion in November 2026'],
      ['ann@example.com', 'You are no longer preparing communion in November 2026'],
    ]);
    expect(bell(JOE.id, 'communion-prep-changed')).toHaveLength(1);
  });

  test('a member taking their own name off tells the keeper, who was counting on them', async () => {
    await as(JOE).post('/api/communion-prep/2026/12/signup');
    await as(JOE).delete('/api/communion-prep/2026/12/signup');
    expect(mail('notice:communion-prep:')).toEqual([expect.objectContaining({
      to_email: 'kay@example.com', subject: 'Joe Carter can no longer prepare communion in December 2026',
    })]);
    expect(bell(KAY.id, 'communion-prep-changed')).toHaveLength(1);
  });

  test('with nobody keeping the list, the admins are told instead', async () => {
    db.prepare("DELETE FROM user_areas WHERE area = 'communion-prep'").run();
    await as(JOE).post('/api/communion-prep/2026/12/signup');
    await as(JOE).delete('/api/communion-prep/2026/12/signup');
    expect(mail('notice:communion-prep:').map(m => m.to_email)).toEqual(['ada@example.com']);
  });

  test('a month already over tells nobody', async () => {
    await as(KAY).put('/api/communion-prep/2026/9').send({ name: 'Ann Bell' });
    expect(mail('notice:communion-prep:')).toEqual([]);
  });
});

// ─── Sign-ups ─────────────────────────────────────────────────────────────────

describe('sign-ups', () => {
  const MEAL = {
    title: 'Fellowship meal', kind: 'one-date', dates: [{ date: '2026-11-15', time: '12:00' }],
    items: [{ label: 'Dessert', needed: '' }], allowFree: false,
  };
  let MIA;
  beforeEach(() => { MIA = addUser('Mia'); });
  const make = async () => (await as(MIA).post('/api/signups').send(MEAL)).body.list;
  const lastEntry = () => db.prepare('SELECT MAX(id) AS id FROM signup_entries').get().id;

  test('putting somebody else down tells them; taking them off tells them too', async () => {
    const list = await make();
    await as(MIA).post(`/api/signups/${list.id}/entries`).send({ dateId: list.dates[0].id, itemId: list.items[0].id, name: 'Joe Carter' });
    await as(MIA).delete(`/api/signups/entries/${lastEntry()}`);
    expect(mail('notice:signup:').map(m => [m.to_email, m.subject])).toEqual([
      ['joe@example.com', 'You are down for “Dessert” on “Fellowship meal”'],
      ['joe@example.com', 'You are no longer down for “Dessert” on “Fellowship meal”'],
    ]);
    expect(bell(JOE.id, 'signup-changed')).toHaveLength(2);
  });

  test('taking your own name off tells whoever made the list', async () => {
    const list = await make();
    await as(JOE).post(`/api/signups/${list.id}/entries`).send({ dateId: list.dates[0].id, itemId: list.items[0].id });
    await as(JOE).delete(`/api/signups/entries/${lastEntry()}`);
    expect(mail('notice:signup:')).toEqual([expect.objectContaining({
      to_email: 'mia@example.com', subject: 'Joe Carter took their name off “Fellowship meal”',
    })]);
  });

  test('moving a date, or deleting the list, tells everybody on it', async () => {
    const list = await make();
    await as(JOE).post(`/api/signups/${list.id}/entries`).send({ dateId: list.dates[0].id, itemId: list.items[0].id });
    await as(MIA).put(`/api/signups/${list.id}`).send({ ...MEAL, dates: [{ id: list.dates[0].id, date: '2026-11-22', time: '12:00' }], items: [{ id: list.items[0].id, label: 'Dessert', needed: '' }] });
    await as(MIA).delete(`/api/signups/${list.id}`);
    expect(mail('notice:signup:').map(m => m.subject)).toEqual([
      'Date changed on “Fellowship meal”: now 2026-11-22 at 12:00',
      'The sign-up “Fellowship meal” has been taken down',
    ]);
  });

  test('signing yourself up, or editing without moving a date, tells nobody', async () => {
    const list = await make();
    await as(JOE).post(`/api/signups/${list.id}/entries`).send({ dateId: list.dates[0].id, itemId: list.items[0].id });
    await as(MIA).put(`/api/signups/${list.id}`).send({ ...MEAL, title: 'Fellowship lunch', dates: [{ id: list.dates[0].id, date: '2026-11-15', time: '12:00' }], items: [{ id: list.items[0].id, label: 'Dessert', needed: '' }] });
    expect(mail('notice:signup:')).toEqual([]);
  });
});

// ─── Church groups ────────────────────────────────────────────────────────────

describe('church groups', () => {
  let group;
  beforeEach(() => {
    group = groups.createGroup({ name: 'North Harvest' }).group;
    groups.addMember(group.id, { directoryId: joe, role: 'member' });
    groups.addMember(group.id, { directoryId: ann, role: 'leader' });
  });
  const ANN = () => addUser('Ann', { directoryId: ann });

  test('taken off the roll: told, and told the group will not write any more', async () => {
    const member = groups.membersOf(group.id).find(m => m.directoryId === joe);
    await as(KAY).delete(`/api/groups/${group.id}/members/${member.id}`);
    expect(mail('notice:group:')).toEqual([expect.objectContaining({ to_email: 'joe@example.com', subject: 'You are no longer in North Harvest' })]);
    expect(bell(JOE.id, 'group-changed')).toHaveLength(1);
  });

  test('a group retired or deleted tells its roll', async () => {
    await as(KAY).put(`/api/groups/${group.id}`).send({ active: false });
    expect(mail('notice:group:').map(m => [m.to_email, m.subject])).toEqual([
      ['ann@example.com', 'North Harvest has stopped meeting'],
      ['joe@example.com', 'North Harvest has stopped meeting'],
    ]);
  });

  test('a posted meeting deleted rather than cancelled is still called off for the roll', async () => {
    const eventId = Number(db.prepare("INSERT INTO group_events (group_id, title, event_date, status) VALUES (?, 'Supper', '2026-10-30', 'published')").run(group.id).lastInsertRowid);
    await as(KAY).delete(`/api/groups/${group.id}/events/${eventId}`);
    expect(bell(JOE.id, 'group-event-cancelled')).toEqual([{ title: 'Cancelled: Supper', page: 'groups' }]);
  });

  test('dropping what you were bringing tells the leaders; a leader dropping it for you tells you', async () => {
    const leader = ANN();
    const eventId = Number(db.prepare("INSERT INTO group_events (group_id, title, event_date, status, signup_enabled) VALUES (?, 'Supper', '2026-10-30', 'published', 1)").run(group.id).lastInsertRowid);
    const itemId = Number(db.prepare("INSERT INTO group_event_signup_items (event_id, label) VALUES (?, 'Rolls')").run(eventId).lastInsertRowid);
    const claim = () => Number(db.prepare('INSERT INTO group_event_signups (item_id, user_id, directory_id, user_name) VALUES (?, ?, ?, ?)').run(itemId, JOE.id, joe, 'Joe Carter').lastInsertRowid);

    await as(JOE).delete(`/api/groups/${group.id}/events/${eventId}/signups/${claim()}`);
    expect(bell(leader.id, 'group-event-signup')).toEqual([{ title: 'Joe Carter is no longer bringing Rolls', page: 'groups' }]);

    await as(leader).delete(`/api/groups/${group.id}/events/${eventId}/signups/${claim()}`);
    expect(mail('notice:group:')).toEqual([expect.objectContaining({ to_email: 'joe@example.com', subject: 'You are no longer down to bring Rolls' })]);
  });
});

// ─── Rotations ────────────────────────────────────────────────────────────────

describe('rotations', () => {
  async function showers() {
    const id = (await as(KAY).post('/api/rotations').send({ name: 'Baby showers' })).body.rotation.id;
    await as(KAY).post(`/api/rotations/${id}/members`).send({ directoryIds: [joe, ann] });
    return id;
  }

  test('taken off a rotation: told', async () => {
    const id = await showers();
    await as(KAY).delete(`/api/rotations/${id}/members/${joe}`);
    expect(mail('notice:rotation:')).toEqual([expect.objectContaining({ to_email: 'joe@example.com', subject: 'You are no longer on the "Baby showers" rotation' })]);
  });

  test('a turn still to come, cancelled: told, and told they are back at the front', async () => {
    const id = await showers();
    const given = await as(KAY).post(`/api/rotations/${id}/turns`).send({ date: '2026-11-08' });
    await as(KAY).delete(`/api/rotations/${id}/turns/${given.body.rotation.upcoming[0].id}?requeue=1`);
    const [sent] = mail('notice:rotation:');
    expect(sent).toMatchObject({ to_email: 'joe@example.com', subject: 'Your turn on "Baby showers" on 2026-11-08 is off' });
    expect(sent.body).toMatch(/back at the front of the line/);
  });

  test('taking an old turn out of the history tells nobody', async () => {
    const id = await showers();
    const given = await as(KAY).post(`/api/rotations/${id}/turns`).send({ date: '2026-09-01' });
    await as(KAY).delete(`/api/rotations/${id}/turns/${given.body.rotation.history[0].id}`);
    expect(mail('notice:rotation:')).toEqual([]);
  });
});

// ─── What somebody looks after ────────────────────────────────────────────────

describe('areas', () => {
  test('an area given or taken away tells the member, with what it means', async () => {
    await as(ADA).patch(`/api/auth/users/${JOE.id}/areas`).send({ areas: ['rotations'] });
    await as(ADA).patch(`/api/auth/users/${JOE.id}/areas`).send({ areas: [] });
    const sent = mail('notice:areas:');
    expect(sent.map(m => m.subject)).toEqual([
      'You now look after Rotations on the member portal',
      'You no longer look after Rotations on the member portal',
    ]);
    expect(sent[0].body).toMatch(/Start a rotation for anything the church takes in turns/);
    expect(bell(JOE.id, 'areas-changed')).toHaveLength(2);
  });

  test('saving the same areas again tells nobody', async () => {
    await as(ADA).patch(`/api/auth/users/${JOE.id}/areas`).send({ areas: [] });
    expect(mail('notice:areas:')).toEqual([]);
  });
});

// ─── Somebody nobody can reach ────────────────────────────────────────────────

test('somebody with no address and no account is simply not told, and the change still saves', async () => {
  const id = Number(db.prepare('INSERT INTO job_assignments (month, date, service, job, name) VALUES (?,?,?,?,?)')
    .run('November 2026', 'November 1', 'Sunday AM', 'Prayer', '').lastInsertRowid);
  const res = await as(KAY).patch(`/api/serving/assignments/${id}`).send({ name: 'Ned Lowe' });
  expect(res.status).toBe(200);
  expect(db.prepare('SELECT name FROM job_assignments WHERE id = ?').get(id).name).toBe('Ned Lowe');
  expect(mail('notice:')).toEqual([]);
  expect(ned).toBeTruthy();
});
