// Time away from the serving jobs: the days somebody has blocked out, and what
// the schedule does about them. The rule being checked from every side is the
// same one — nobody ends up down for a job on a day they said they are away,
// and the one person who may override that says so out loud.
jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const request = require('supertest');
const express = require('express');
const db      = require('../db');
const servingRouter = require('../routes/serving');
const blackouts     = require('../lib/blackouts');

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

function addUser(name, directoryId = null, areas = []) {
  const { lastInsertRowid: id } = db.prepare(
    'INSERT INTO users (provider, provider_id, email, name, role, directory_id) VALUES (?,?,?,?,?,?)'
  ).run('google', `${name}-id`, `${name.toLowerCase()}@example.com`, name, 'approved', directoryId);
  const grant = db.prepare('INSERT OR IGNORE INTO user_areas (user_id, area) VALUES (?, ?)');
  for (const area of areas) grant.run(id, area);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function block(directoryId, startsOn, endsOn = startsOn, reason = '') {
  return blackouts.add(directoryId, { startsOn, endsOn, reason });
}

function slotsIn(month) {
  return db.prepare('SELECT * FROM job_assignments WHERE month = ? ORDER BY id').all(month);
}

let KEEPER, MAN, OTHER_MAN, UNLINKED, man, otherMan;

beforeEach(() => {
  for (const t of ['action_log', 'job_blackouts', 'job_eligibility', 'job_assignments', 'user_areas', 'users', 'directory']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }

  man      = addPerson('Joe Carter', 'male');
  otherMan = addPerson('Ned Poole',  'male');

  KEEPER    = addUser('Cora', null,        ['serving-schedule']);
  MAN       = addUser('Joe',  man.id);
  OTHER_MAN = addUser('Ned',  otherMan.id);
  UNLINKED  = addUser('Sam',  null);
});

// ─── Reading a range off a request ────────────────────────────────────────────

describe('what counts as a range', () => {
  test('a first day with no last day is a single day away', () => {
    expect(blackouts.readRange({ startsOn: '2026-06-07' }).range)
      .toEqual({ startsOn: '2026-06-07', endsOn: '2026-06-07', reason: '' });
  });

  test('a day that does not exist is not a holiday', () => {
    expect(blackouts.readRange({ startsOn: '2026-02-30' }).error).toMatch(/not a date/);
    expect(blackouts.readRange({ startsOn: 'next June' }).error).toMatch(/not a date/);
    expect(blackouts.readRange({}).error).toMatch(/first day away is required/);
  });

  test('the last day cannot come before the first', () => {
    expect(blackouts.readRange({ startsOn: '2026-06-21', endsOn: '2026-06-07' }).error)
      .toMatch(/cannot come before/);
  });
});

describe('describing a range', () => {
  test('reads the way somebody would say it', () => {
    expect(blackouts.describe({ startsOn: '2026-06-07', endsOn: '2026-06-07' })).toBe('June 7, 2026');
    expect(blackouts.describe({ startsOn: '2026-06-07', endsOn: '2026-06-21' })).toBe('June 7 – June 21, 2026');
    expect(blackouts.describe({ startsOn: '2026-12-28', endsOn: '2027-01-04' })).toBe('December 28, 2026 – January 4, 2027');
  });
});

describe('the day a slot falls on', () => {
  test('reads the roster\'s two halves as one date', () => {
    expect(blackouts.dateOf('June 2026', 'June 7')).toBe('2026-06-07');
    expect(blackouts.dateOf('December 2026', 'December 27')).toBe('2026-12-27');
  });

  test('a slot belonging to no particular day cannot be blocked out', () => {
    expect(blackouts.dateOf('June 2026', '')).toBeNull();
    expect(blackouts.dateOf('', 'June 7')).toBeNull();
    expect(blackouts.dateOf('June 2026', 'sometime')).toBeNull();
  });
});

// ─── Keeping them ─────────────────────────────────────────────────────────────

describe('blocking out days', () => {
  test('a member blocks out their own, and sees them back', async () => {
    const res = await request(buildApp(MAN))
      .post('/api/serving/blackouts')
      .send({ startsOn: '2026-06-07', endsOn: '2026-06-21', reason: 'Away with family' });

    expect(res.status).toBe(200);
    expect(res.body.blackout).toMatchObject({
      directoryId: man.id, startsOn: '2026-06-07', endsOn: '2026-06-21', reason: 'Away with family', name: 'Joe Carter',
    });

    const mine = await request(buildApp(MAN)).get('/api/serving/blackouts');
    expect(mine.body.blackouts).toHaveLength(1);
  });

  test('a member may not block out somebody else\'s days', async () => {
    const res = await request(buildApp(MAN))
      .post('/api/serving/blackouts')
      .send({ directoryId: otherMan.id, startsOn: '2026-06-07' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/only block out your own/i);
    expect(db.prepare('SELECT COUNT(*) n FROM job_blackouts').get().n).toBe(0);
  });

  test('the schedule keeper may block out anybody\'s, because most people say it in the foyer', async () => {
    const res = await request(buildApp(KEEPER))
      .post('/api/serving/blackouts')
      .send({ directoryId: man.id, startsOn: '2026-06-07', endsOn: '2026-06-21' });

    expect(res.status).toBe(200);
    expect(res.body.blackout.directoryId).toBe(man.id);
  });

  test('an account with no directory entry is told to get one linked', async () => {
    const res = await request(buildApp(UNLINKED)).post('/api/serving/blackouts').send({ startsOn: '2026-06-07' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/directory/i);
  });

  test('a member the directory has never heard of is refused', async () => {
    const res = await request(buildApp(KEEPER))
      .post('/api/serving/blackouts')
      .send({ directoryId: 9999, startsOn: '2026-06-07' });
    expect(res.status).toBe(404);

    const nonsense = await request(buildApp(KEEPER))
      .post('/api/serving/blackouts')
      .send({ directoryId: 'whoever', startsOn: '2026-06-07' });
    expect(nonsense.status).toBe(404);
  });

  test('a range nobody can read is refused, and writes nothing', async () => {
    const res = await request(buildApp(MAN)).post('/api/serving/blackouts').send({ startsOn: 'June-ish' });
    expect(res.status).toBe(400);
    expect(db.prepare('SELECT COUNT(*) n FROM job_blackouts').get().n).toBe(0);
  });

  test('everybody\'s is the keeper\'s to see; everyone else sees only their own', async () => {
    block(man.id, '2026-06-07', '2026-06-21');
    block(otherMan.id, '2026-07-05');

    const keeper = await request(buildApp(KEEPER)).get('/api/serving/blackouts');
    expect(keeper.body.blackouts).toHaveLength(2);
    expect(keeper.body.canManage).toBe(true);

    const member = await request(buildApp(MAN)).get('/api/serving/blackouts');
    expect(member.body.blackouts).toHaveLength(1);
    expect(member.body.blackouts[0].name).toBe('Joe Carter');
  });

  test('clearing one is your own to do, or the keeper\'s', async () => {
    const mine = block(man.id, '2026-06-07');

    const refused = await request(buildApp(OTHER_MAN)).delete(`/api/serving/blackouts/${mine.id}`);
    expect(refused.status).toBe(403);
    expect(blackouts.get(mine.id)).not.toBeNull();

    const cleared = await request(buildApp(MAN)).delete(`/api/serving/blackouts/${mine.id}`);
    expect(cleared.status).toBe(200);
    expect(blackouts.get(mine.id)).toBeNull();

    const theirs = block(otherMan.id, '2026-06-07');
    const byKeeper = await request(buildApp(KEEPER)).delete(`/api/serving/blackouts/${theirs.id}`);
    expect(byKeeper.status).toBe(200);
  });

  test('clearing one that is not there says so', async () => {
    const res = await request(buildApp(KEEPER)).delete('/api/serving/blackouts/9999');
    expect(res.status).toBe(404);
  });

  test('both are recorded in the action history, and one taken second-hand says whose it is', async () => {
    await request(buildApp(MAN)).post('/api/serving/blackouts').send({ startsOn: '2026-06-07', endsOn: '2026-06-21' });
    const mine = db.prepare('SELECT * FROM action_log ORDER BY id DESC').get();
    expect(mine).toMatchObject({ area: 'serving-schedule', user_id: MAN.id, entity: 'time away' });
    expect(mine.summary).toMatch(/Blocked out June 7 – June 21, 2026/);

    await request(buildApp(KEEPER)).post('/api/serving/blackouts').send({ directoryId: otherMan.id, startsOn: '2026-07-05' });
    const theirs = db.prepare('SELECT * FROM action_log ORDER BY id DESC').get();
    expect(theirs).toMatchObject({ user_id: KEEPER.id });
    expect(theirs.summary).toMatch(/for Ned Poole/);

    const range = blackouts.forPerson(otherMan.id)[0];
    await request(buildApp(KEEPER)).delete(`/api/serving/blackouts/${range.id}`);
    expect(db.prepare('SELECT * FROM action_log ORDER BY id DESC').get().summary)
      .toMatch(/Cleared Ned Poole's time away/);
  });
});

// ─── What the schedule does about them ────────────────────────────────────────

describe('a day somebody is away', () => {
  let slot, otherSunday;

  beforeEach(async () => {
    await request(buildApp(KEEPER)).post('/api/serving/months').send({ month: 'June 2026', services: ['Sunday Worship'] });
    db.prepare("INSERT OR IGNORE INTO job_eligibility (directory_id, job) VALUES (?, 'Song Leader')").run(man.id);

    const songLeading = slotsIn('June 2026').filter(s => s.job === 'Song Leader');
    slot        = songLeading.find(s => s.date === 'June 7');
    otherSunday = songLeading.find(s => s.date === 'June 14');
  });

  test('cannot be signed up for, and says which days are in the way', async () => {
    block(man.id, '2026-06-01', '2026-06-10', 'Away with family');

    const res = await request(buildApp(MAN)).post(`/api/serving/assignments/${slot.id}/signup`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/June 1 – June 10, 2026/);
    expect(db.prepare('SELECT name FROM job_assignments WHERE id = ?').get(slot.id).name).toBe('');
  });

  test('costs that day only — the rest of the month is still theirs to take', async () => {
    block(man.id, '2026-06-07');

    const res = await request(buildApp(MAN)).post(`/api/serving/assignments/${otherSunday.id}/signup`);
    expect(res.status).toBe(200);
    expect(res.body.assignment.name).toBe('Joe Carter');
  });

  test('once the range is cleared, the slot is theirs again', async () => {
    const range = block(man.id, '2026-06-07');
    await request(buildApp(MAN)).delete(`/api/serving/blackouts/${range.id}`);

    const res = await request(buildApp(MAN)).post(`/api/serving/assignments/${slot.id}/signup`);
    expect(res.status).toBe(200);
  });

  test('is still the keeper\'s call to write somebody into — but never silently', async () => {
    block(man.id, '2026-06-07', '2026-06-07', 'Away with family');

    const res = await request(buildApp(KEEPER))
      .patch(`/api/serving/assignments/${slot.id}`)
      .send({ name: 'Joe Carter' });

    expect(res.status).toBe(200);
    expect(res.body.assignment.name).toBe('Joe Carter');
    expect(res.body.warning).toMatch(/Joe Carter has blocked out June 7, 2026 \(Away with family\)/);
  });

  test('a slot on a clear day carries no warning', async () => {
    block(man.id, '2026-06-07');

    const res = await request(buildApp(KEEPER))
      .patch(`/api/serving/assignments/${otherSunday.id}`)
      .send({ name: 'Joe Carter' });

    expect(res.body.warning).toBeNull();
  });

  test('a job with no date of its own belongs to no day, so nobody is away for it', async () => {
    block(man.id, '2026-06-01', '2026-06-30');

    const res = await request(buildApp(KEEPER))
      .post('/api/serving/assignments')
      .send({ month: 'June 2026', job: 'Visual Preparation', name: 'Joe Carter' });

    expect(res.status).toBe(200);
    expect(res.body.warning).toBeNull();
  });
});

// ─── What the pages are told ──────────────────────────────────────────────────

describe('what the pages are told', () => {
  test('the roster flags a slot whose man is away that day', async () => {
    await request(buildApp(KEEPER)).post('/api/serving/months').send({ month: 'June 2026', services: ['Sunday Worship'] });
    const songLeading = slotsIn('June 2026').filter(s => s.job === 'Song Leader');
    db.prepare('UPDATE job_assignments SET name = ? WHERE id IN (?, ?)')
      .run('Joe Carter', songLeading[0].id, songLeading[1].id);
    block(man.id, '2026-06-07', '2026-06-10', 'Away with family');

    const res = await request(buildApp(KEEPER)).get('/api/serving');
    const flagged = res.body.assignments.find(a => a.id === songLeading[0].id);
    const clear   = res.body.assignments.find(a => a.id === songLeading[1].id);

    expect(flagged.away).toMatchObject({ startsOn: '2026-06-07', endsOn: '2026-06-10', said: 'June 7 – June 10, 2026' });
    expect(clear.away).toBeUndefined();
  });

  test('each person gets their own time away; the keeper gets the congregation\'s', async () => {
    block(man.id, '2026-06-07');
    block(otherMan.id, '2026-07-05');

    const member = await request(buildApp(MAN)).get('/api/serving');
    expect(member.body.me.blackouts).toHaveLength(1);
    expect(member.body.blackouts).toEqual([]);

    const keeper = await request(buildApp(KEEPER)).get('/api/serving');
    expect(keeper.body.blackouts).toHaveLength(2);
  });

  test('the Service Roster carries each man\'s time away beside his preferences', async () => {
    block(man.id, '2026-06-07', '2026-06-21');

    const res = await request(buildApp(KEEPER)).get('/api/serving/members');
    expect(res.body.members.find(m => m.name === 'Joe Carter').blackouts).toHaveLength(1);
    expect(res.body.members.find(m => m.name === 'Ned Poole').blackouts).toEqual([]);
  });

  test('a range goes when the member does', () => {
    block(man.id, '2026-06-07');
    db.prepare('DELETE FROM directory WHERE id = ?').run(man.id);
    expect(blackouts.all()).toEqual([]);
  });
});
