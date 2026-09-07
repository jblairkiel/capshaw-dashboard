jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const request    = require('supertest');
const express    = require('express');
const db         = require('../db');
const authRouter = require('../routes/auth');

function buildApp(user = null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/auth', authRouter);
  return app;
}

// Fresh cast for every test: one admin, one member, one pending user.
let ADMIN, MEMBER, PENDING;

function insert(name, email, role) {
  const { lastInsertRowid: id } = db.prepare(
    'INSERT INTO users (provider, provider_id, email, name, role) VALUES (?,?,?,?,?)'
  ).run('google', `${name}-id`, email, name, role);
  return db.prepare('SELECT * FROM users WHERE id=?').get(id);
}

function roleOf(id) {
  return db.prepare('SELECT role FROM users WHERE id=?').get(id)?.role;
}

beforeEach(() => {
  delete process.env.ADMIN_EMAIL;
  db.prepare('DELETE FROM users').run();
  db.prepare('DELETE FROM directory').run();
  ADMIN   = insert('Ada',   'ada@example.com',   'admin');
  MEMBER  = insert('Mel',   'mel@example.com',   'approved');
  PENDING = insert('Pat',   'pat@example.com',   'pending');
});

// ─── GET /users ───────────────────────────────────────────────────────────────

describe('GET /api/auth/users', () => {
  test('401 with no session user', async () => {
    const res = await request(buildApp(null)).get('/api/auth/users');
    expect(res.status).toBe(401);
  });

  test('403 for a member — role management is admin-only', async () => {
    const res = await request(buildApp(MEMBER)).get('/api/auth/users');
    expect(res.status).toBe(403);
  });

  test('200 for an admin, listing every user with the role vocabulary', async () => {
    const res = await request(buildApp(ADMIN)).get('/api/auth/users');
    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(3);
    expect(res.body.roles).toEqual(['pending', 'approved', 'worship-coordinator', 'admin']);
    expect(res.body.users.every(u => 'is_owner' in u)).toBe(true);
  });

  test('flags the ADMIN_EMAIL account as the owner', async () => {
    process.env.ADMIN_EMAIL = 'ADA@example.com';
    const res = await request(buildApp(ADMIN)).get('/api/auth/users');
    expect(res.body.users.find(u => u.id === ADMIN.id).is_owner).toBe(true);
    expect(res.body.users.find(u => u.id === MEMBER.id).is_owner).toBe(false);
  });
});

// ─── PATCH /users/:id/role ────────────────────────────────────────────────────

describe('PATCH /api/auth/users/:id/role', () => {
  test('403 for a member', async () => {
    const res = await request(buildApp(MEMBER))
      .patch(`/api/auth/users/${PENDING.id}/role`)
      .send({ role: 'admin' });
    expect(res.status).toBe(403);
    expect(roleOf(PENDING.id)).toBe('pending');
  });

  test('promotes a pending user to member', async () => {
    const res = await request(buildApp(ADMIN))
      .patch(`/api/auth/users/${PENDING.id}/role`)
      .send({ role: 'approved' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: PENDING.id, role: 'approved' });
    expect(roleOf(PENDING.id)).toBe('approved');
  });

  test('promotes a member to admin', async () => {
    const res = await request(buildApp(ADMIN))
      .patch(`/api/auth/users/${MEMBER.id}/role`)
      .send({ role: 'admin' });
    expect(res.status).toBe(200);
    expect(roleOf(MEMBER.id)).toBe('admin');
  });

  test('400 for an unknown role', async () => {
    const res = await request(buildApp(ADMIN))
      .patch(`/api/auth/users/${MEMBER.id}/role`)
      .send({ role: 'superuser' });
    expect(res.status).toBe(400);
    expect(roleOf(MEMBER.id)).toBe('approved');
  });

  test('404 for an unknown user', async () => {
    const res = await request(buildApp(ADMIN))
      .patch('/api/auth/users/99999/role')
      .send({ role: 'admin' });
    expect(res.status).toBe(404);
  });

  test('400 when an admin tries to change their own role', async () => {
    const res = await request(buildApp(ADMIN))
      .patch(`/api/auth/users/${ADMIN.id}/role`)
      .send({ role: 'approved' });
    expect(res.status).toBe(400);
    expect(roleOf(ADMIN.id)).toBe('admin');
  });

  test('400 when demoting the last admin', async () => {
    const second = insert('Ben', 'ben@example.com', 'admin');
    const res = await request(buildApp(second))
      .patch(`/api/auth/users/${ADMIN.id}/role`)
      .send({ role: 'approved' });
    expect(res.status).toBe(200);          // two admins — this one may be demoted
    expect(roleOf(ADMIN.id)).toBe('approved');

    // Now only `second` remains, and nobody may demote them.
    const last = await request(buildApp(ADMIN))
      .patch(`/api/auth/users/${second.id}/role`)
      .send({ role: 'approved' });
    expect(last.status).toBe(400);
    expect(roleOf(second.id)).toBe('admin');
  });

  test('400 when changing the owner account', async () => {
    process.env.ADMIN_EMAIL = 'ada@example.com';
    const second = insert('Ben', 'ben@example.com', 'admin');
    const res = await request(buildApp(second))
      .patch(`/api/auth/users/${ADMIN.id}/role`)
      .send({ role: 'approved' });
    expect(res.status).toBe(400);
    expect(roleOf(ADMIN.id)).toBe('admin');
  });
});

// ─── approve / revoke shortcuts ───────────────────────────────────────────────

describe('approve and revoke shortcuts', () => {
  test('approve sets the member role', async () => {
    const res = await request(buildApp(ADMIN)).patch(`/api/auth/users/${PENDING.id}/approve`);
    expect(res.status).toBe(200);
    expect(roleOf(PENDING.id)).toBe('approved');
  });

  test('revoke sets the pending role', async () => {
    const res = await request(buildApp(ADMIN)).patch(`/api/auth/users/${MEMBER.id}/revoke`);
    expect(res.status).toBe(200);
    expect(roleOf(MEMBER.id)).toBe('pending');
  });

  test('revoke demotes a non-last admin', async () => {
    const second = insert('Ben', 'ben@example.com', 'admin');
    const res = await request(buildApp(ADMIN)).patch(`/api/auth/users/${second.id}/revoke`);
    expect(res.status).toBe(200);
    expect(roleOf(second.id)).toBe('pending');
  });
});

// ─── DELETE /users/:id ────────────────────────────────────────────────────────

describe('DELETE /api/auth/users/:id', () => {
  test('removes a member', async () => {
    const res = await request(buildApp(ADMIN)).delete(`/api/auth/users/${MEMBER.id}`);
    expect(res.status).toBe(200);
    expect(roleOf(MEMBER.id)).toBeUndefined();
  });

  test('400 when deleting yourself', async () => {
    const res = await request(buildApp(ADMIN)).delete(`/api/auth/users/${ADMIN.id}`);
    expect(res.status).toBe(400);
    expect(roleOf(ADMIN.id)).toBe('admin');
  });

  test('400 when deleting the last admin', async () => {
    const second = insert('Ben', 'ben@example.com', 'admin');
    const res = await request(buildApp(second)).delete(`/api/auth/users/${ADMIN.id}`);
    expect(res.status).toBe(200);

    const last = await request(buildApp(ADMIN)).delete(`/api/auth/users/${second.id}`);
    expect(last.status).toBe(400);
    expect(roleOf(second.id)).toBe('admin');
  });

  test('400 when deleting the owner account', async () => {
    process.env.ADMIN_EMAIL = 'ada@example.com';
    const second = insert('Ben', 'ben@example.com', 'admin');
    const res = await request(buildApp(second)).delete(`/api/auth/users/${ADMIN.id}`);
    expect(res.status).toBe(400);
    expect(roleOf(ADMIN.id)).toBe('admin');
  });
});

// ─── Linking an account to its directory entry ────────────────────────────────

function addPerson(name, email = '', address = '') {
  const { lastInsertRowid: id } = db.prepare(
    'INSERT INTO directory (name, email, address) VALUES (?,?,?)'
  ).run(name, email, address);
  return db.prepare('SELECT * FROM directory WHERE id=?').get(id);
}

function linkOf(userId) {
  return db.prepare('SELECT directory_id FROM users WHERE id=?').get(userId)?.directory_id;
}

describe('PATCH /api/auth/users/:id/directory', () => {
  test('links an account to a directory entry', async () => {
    const person = addPerson('Mel Harris', 'mel@example.com');
    const res = await request(buildApp(ADMIN))
      .patch(`/api/auth/users/${MEMBER.id}/directory`)
      .send({ directory_id: person.id });
    expect(res.status).toBe(200);
    expect(linkOf(MEMBER.id)).toBe(person.id);
  });

  test('clears the link when given null', async () => {
    const person = addPerson('Mel Harris');
    await request(buildApp(ADMIN)).patch(`/api/auth/users/${MEMBER.id}/directory`).send({ directory_id: person.id });
    const res = await request(buildApp(ADMIN))
      .patch(`/api/auth/users/${MEMBER.id}/directory`)
      .send({ directory_id: null });
    expect(res.status).toBe(200);
    expect(linkOf(MEMBER.id)).toBeNull();
  });

  test('403 for a member — linking is an admin job', async () => {
    const person = addPerson('Mel Harris');
    const res = await request(buildApp(MEMBER))
      .patch(`/api/auth/users/${PENDING.id}/directory`)
      .send({ directory_id: person.id });
    expect(res.status).toBe(403);
  });

  test('404 for a directory entry that does not exist', async () => {
    const res = await request(buildApp(ADMIN))
      .patch(`/api/auth/users/${MEMBER.id}/directory`)
      .send({ directory_id: 9999 });
    expect(res.status).toBe(404);
  });

  test('409 when that person is already linked to another account', async () => {
    const person = addPerson('Mel Harris');
    await request(buildApp(ADMIN)).patch(`/api/auth/users/${MEMBER.id}/directory`).send({ directory_id: person.id });
    const res = await request(buildApp(ADMIN))
      .patch(`/api/auth/users/${PENDING.id}/directory`)
      .send({ directory_id: person.id });
    expect(res.status).toBe(409);
    expect(linkOf(PENDING.id)).toBeNull();
  });

  test('400 for a non-numeric directory id', async () => {
    const res = await request(buildApp(ADMIN))
      .patch(`/api/auth/users/${MEMBER.id}/directory`)
      .send({ directory_id: 'Mel' });
    expect(res.status).toBe(400);
  });
});

describe('auto-linking at sign-in', () => {
  const { upsertUser } = authRouter;

  test('links a new account when exactly one directory email matches', () => {
    const person = addPerson('Mel Harris', 'Mel@Example.com');
    const user = upsertUser('google', 'new-1', 'mel@example.com', 'Mel', null);
    expect(user.directory_id).toBe(person.id);
  });

  test('leaves the account unlinked when the email matches nobody', () => {
    addPerson('Mel Harris', 'mel@example.com');
    const user = upsertUser('google', 'new-2', 'someone@example.com', 'Someone', null);
    expect(user.directory_id).toBeNull();
  });

  test('refuses to guess when a shared email matches two people', () => {
    addPerson('Mel Harris', 'harris@example.com');
    addPerson('Ray Harris', 'harris@example.com');
    const user = upsertUser('google', 'new-3', 'harris@example.com', 'Mel', null);
    expect(user.directory_id).toBeNull();
  });

  test('never re-points a link an admin already set', () => {
    const assigned = addPerson('Ray Harris', 'ray@example.com');
    const byEmail  = addPerson('Mel Harris', 'mel@example.com');
    const created  = upsertUser('google', 'new-4', 'mel@example.com', 'Mel', null);
    expect(created.directory_id).toBe(byEmail.id);

    // An admin corrects it, then that person signs in again.
    db.prepare('UPDATE users SET directory_id=? WHERE id=?').run(assigned.id, created.id);
    const again = upsertUser('google', 'new-4', 'mel@example.com', 'Mel', null);
    expect(again.directory_id).toBe(assigned.id);
  });

  test('links an existing unlinked account on their next sign-in', () => {
    const created = upsertUser('google', 'new-5', 'mel@example.com', 'Mel', null);
    expect(created.directory_id).toBeNull();

    const person = addPerson('Mel Harris', 'mel@example.com');
    const again  = upsertUser('google', 'new-5', 'mel@example.com', 'Mel', null);
    expect(again.directory_id).toBe(person.id);
  });
});
