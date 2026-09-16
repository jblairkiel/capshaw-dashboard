// Viewing the portal as somebody else is the one feature here that hands an
// admin another account's view of the site, so these are mostly about what it
// refuses to do — and about the history always naming who was really acting.
jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const request = require('supertest');
const express = require('express');
const db      = require('../db');

const authRouter    = require('../routes/auth');
const recordsRouter = require('../routes/records');
const { applyImpersonation } = require('../middleware/impersonation');

// The real thing: passport puts the signed-in account on req.user, and the
// middleware swaps it for whoever is being viewed as. The session is a plain
// object here, as express-session would leave it.
function buildApp(signedInAs, session = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = session;
    req.user = signedInAs ? db.prepare('SELECT * FROM users WHERE id = ?').get(signedInAs.id) : null;
    next();
  });
  app.use(applyImpersonation);
  app.use('/api/auth', authRouter);
  app.use('/api/records', recordsRouter);
  return app;
}

let ADMIN, OTHER_ADMIN, MEMBER, SONG_LEADER, PENDING;

function addUser(name, role, areas = []) {
  const { lastInsertRowid: id } = db.prepare(
    'INSERT INTO users (provider, provider_id, email, name, role) VALUES (?,?,?,?,?)'
  ).run('google', `${name}-id`, `${name.toLowerCase()}@example.com`, name, role);
  const grant = db.prepare('INSERT OR IGNORE INTO user_areas (user_id, area) VALUES (?, ?)');
  for (const area of areas) grant.run(id, area);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function history() {
  return db.prepare('SELECT * FROM action_log ORDER BY id DESC').all();
}

beforeEach(() => {
  delete process.env.ADMIN_EMAIL;
  for (const t of ['action_log', 'attendance', 'user_areas', 'users', 'directory']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
  ADMIN       = addUser('Ada', 'admin');
  OTHER_ADMIN = addUser('Bea', 'admin');
  MEMBER      = addUser('Mel', 'approved');
  SONG_LEADER = addUser('Sam', 'approved', ['songs']);
  PENDING     = addUser('Pat', 'pending');
});

// ─── Starting ─────────────────────────────────────────────────────────────────

describe('starting to view as somebody', () => {
  test('an admin may view as a member', async () => {
    const session = {};
    const res = await request(buildApp(ADMIN, session))
      .post('/api/auth/impersonate')
      .send({ userId: MEMBER.id });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: MEMBER.id, name: 'Mel' });
    expect(session.impersonate).toMatchObject({ userId: MEMBER.id });
  });

  test('a member may not view as anybody', async () => {
    const session = {};
    const res = await request(buildApp(MEMBER, session))
      .post('/api/auth/impersonate')
      .send({ userId: SONG_LEADER.id });

    expect(res.status).toBe(403);
    expect(session.impersonate).toBeUndefined();
  });

  test('an admin may not borrow another admin\'s view', async () => {
    const session = {};
    const res = await request(buildApp(ADMIN, session))
      .post('/api/auth/impersonate')
      .send({ userId: OTHER_ADMIN.id });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not somebody else's to borrow/i);
    expect(session.impersonate).toBeUndefined();
  });

  test('viewing as yourself is refused, as is an account that is not there', async () => {
    const self = await request(buildApp(ADMIN, {})).post('/api/auth/impersonate').send({ userId: ADMIN.id });
    expect(self.status).toBe(400);

    const missing = await request(buildApp(ADMIN, {})).post('/api/auth/impersonate').send({ userId: 999999 });
    expect(missing.status).toBe(404);
  });

  test('an account still waiting can be viewed as — that is often the question', async () => {
    const res = await request(buildApp(ADMIN, {})).post('/api/auth/impersonate').send({ userId: PENDING.id });
    expect(res.status).toBe(200);
  });

  test('one cannot be started from inside another', async () => {
    const session = { impersonate: { userId: MEMBER.id, startedAt: 'now' } };
    const res = await request(buildApp(ADMIN, session))
      .post('/api/auth/impersonate')
      .send({ userId: SONG_LEADER.id });

    expect(res.status).toBe(409);
    expect(session.impersonate.userId).toBe(MEMBER.id);
  });

  test('starting and stopping are both recorded', async () => {
    const session = {};
    await request(buildApp(ADMIN, session)).post('/api/auth/impersonate').send({ userId: MEMBER.id });
    await request(buildApp(ADMIN, session)).delete('/api/auth/impersonate');

    const entries = history();
    expect(entries.map(e => e.summary)).toEqual([
      'Ada stopped viewing the portal as Mel',
      'Ada started viewing the portal as Mel',
    ]);
    expect(entries.every(e => e.area === 'impersonation' && e.user_id === ADMIN.id)).toBe(true);
    expect(session.impersonate).toBeUndefined();
  });
});

// ─── While it is on ───────────────────────────────────────────────────────────

describe('while viewing as somebody', () => {
  const viewing = user => ({ impersonate: { userId: user.id, startedAt: '2026-06-01T10:00:00Z' } });

  test('the portal answers as them, and says who is really here', async () => {
    const res = await request(buildApp(ADMIN, viewing(SONG_LEADER))).get('/api/auth/me');

    expect(res.body.user).toMatchObject({ id: SONG_LEADER.id, name: 'Sam', role: 'approved' });
    expect(res.body.user.areas).toEqual(['songs']);
    expect(res.body.impersonatedBy).toMatchObject({ id: ADMIN.id, name: 'Ada' });
  });

  test('the admin\'s own reach is gone — they see exactly what the member sees', async () => {
    // Mel looks after nothing, so the admin-only screens are closed.
    expect((await request(buildApp(ADMIN, viewing(MEMBER))).get('/api/auth/users')).status).toBe(403);

    const refused = await request(buildApp(ADMIN, viewing(MEMBER)))
      .post('/api/records/attendance')
      .send({ date: '2026-06-07', service: 'Sun AM', count: 91 });
    expect(refused.status).toBe(403);
    expect(db.prepare('SELECT COUNT(*) n FROM attendance').get().n).toBe(0);
  });

  test('a change is filed under the member, and says who was really at the keyboard', async () => {
    const keeper = addUser('Ann', 'approved', ['attendance']);

    const res = await request(buildApp(ADMIN, viewing(keeper)))
      .post('/api/records/attendance')
      .send({ date: '2026-06-07', service: 'Sun AM', count: 91 });
    expect(res.status).toBe(200);

    const entry = history()[0];
    expect(entry).toMatchObject({
      user_id: keeper.id, user_name: 'Ann',              // whose account it was
      acting_user_id: ADMIN.id, acting_user_name: 'Ada', // who was really there
    });
  });

  test('an ordinary change records nobody else — the column is only for this', async () => {
    const keeper = addUser('Ann', 'approved', ['attendance']);
    await request(buildApp(keeper, {}))
      .post('/api/records/attendance')
      .send({ date: '2026-06-07', service: 'Sun AM', count: 91 });

    expect(history()[0]).toMatchObject({ user_id: keeper.id, acting_user_id: null, acting_user_name: '' });
  });

  test('it stops the moment the account is promoted to admin, without waiting for the session', async () => {
    const session = viewing(MEMBER);
    db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(MEMBER.id);

    const res = await request(buildApp(ADMIN, session)).get('/api/auth/me');
    expect(res.body.user.id).toBe(ADMIN.id);
    expect(res.body.impersonatedBy).toBeNull();
    expect(session.impersonate).toBeUndefined();
  });

  test('it stops if the account is removed', async () => {
    const session = viewing(MEMBER);
    db.prepare('DELETE FROM users WHERE id = ?').run(MEMBER.id);

    const res = await request(buildApp(ADMIN, session)).get('/api/auth/me');
    expect(res.body.user.id).toBe(ADMIN.id);
    expect(session.impersonate).toBeUndefined();
  });

  test('a member whose session somehow carries one is unaffected by it', async () => {
    // Belt and braces: the session is server-side, but the check is made on
    // every request rather than trusted from when it started.
    const session = viewing(SONG_LEADER);
    const res = await request(buildApp(MEMBER, session)).get('/api/auth/me');

    expect(res.body.user.id).toBe(MEMBER.id);
    expect(res.body.impersonatedBy).toBeNull();
  });
});

// ─── Stopping ─────────────────────────────────────────────────────────────────

describe('stopping', () => {
  test('hands the admin back their own account', async () => {
    const session = { impersonate: { userId: MEMBER.id, startedAt: 'now' } };
    const res = await request(buildApp(ADMIN, session)).delete('/api/auth/impersonate');

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: ADMIN.id, name: 'Ada' });
    expect(session.impersonate).toBeUndefined();
  });

  test('is refused when nobody is being viewed as', async () => {
    const res = await request(buildApp(ADMIN, {})).delete('/api/auth/impersonate');
    expect(res.status).toBe(400);
  });
});
