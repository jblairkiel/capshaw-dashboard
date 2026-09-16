jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const request    = require('supertest');
const express    = require('express');
const db         = require('../db');
const authRouter = require('../routes/auth');
const { verifyPassword } = require('../lib/passwords');

// The real app hands sign-in to Passport; here we only need somewhere for the
// session to land, so the test app records what was logged in.
function buildApp(user = null) {
  const app = express();
  app.use(express.json());
  const session = {};
  app.use((req, _res, next) => {
    req.user  = user;
    req.logIn = (u, cb) => { session.user = u; cb(null); };
    next();
  });
  app.use('/api/auth', authRouter);
  app.loggedIn = () => session.user;
  return app;
}

const GOOD_PASSWORD = 'harvest-oak-1963';

function accountFor(email) {
  return db.prepare('SELECT * FROM users WHERE provider=? AND provider_id=?').get('local', email);
}

function outbox(context) {
  return db.prepare('SELECT * FROM mail_outbox WHERE context LIKE ? ORDER BY id ASC').all(`${context}%`);
}

// The confirmation link is only ever in the email, which is exactly how a real
// person gets it.
function tokenFromEmail() {
  const mail = outbox('account:verify').at(-1);
  return mail?.body.match(/verify-email\?token=([^\s]+)/)?.[1] ?? null;
}

async function register(app, overrides = {}) {
  return request(app).post('/api/auth/register').send({
    name: 'Pat Nolan', email: 'pat@example.com', password: GOOD_PASSWORD, ...overrides,
  });
}

let ADMIN;

beforeEach(() => {
  delete process.env.ADMIN_EMAIL;
  // Every request in this file arrives from the same address, so without this
  // the per-caller caps would start refusing partway through the suite.
  authRouter.resetRateLimits();
  db.prepare('DELETE FROM mail_outbox').run();
  db.prepare('DELETE FROM users').run();
  db.prepare('DELETE FROM directory').run();
  const { lastInsertRowid: id } = db.prepare(
    'INSERT INTO users (provider, provider_id, email, name, role) VALUES (?,?,?,?,?)'
  ).run('google', 'ada-id', 'ada@example.com', 'Ada', 'admin');
  ADMIN = db.prepare('SELECT * FROM users WHERE id=?').get(id);
});

// ─── Registering ──────────────────────────────────────────────────────────────

describe('POST /api/auth/register', () => {
  test('creates a waiting account and mails a confirmation link', async () => {
    const res = await register(buildApp());
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const account = accountFor('pat@example.com');
    expect(account).toMatchObject({ name: 'Pat Nolan', role: 'pending', provider: 'local' });
    expect(account.email_verified_at).toBeNull();
    expect(tokenFromEmail()).toBeTruthy();
  });

  test('never stores the password, only a scrypt digest of it', async () => {
    await register(buildApp());
    const { password_hash } = accountFor('pat@example.com');

    expect(password_hash).not.toContain(GOOD_PASSWORD);
    expect(password_hash.startsWith('scrypt$')).toBe(true);
    await expect(verifyPassword(GOOD_PASSWORD, password_hash)).resolves.toBe(true);
    await expect(verifyPassword('something else', password_hash)).resolves.toBe(false);
  });

  test('two accounts with the same password get different digests', async () => {
    await register(buildApp());
    await register(buildApp(), { email: 'jo@example.com', name: 'Jo Nolan' });
    expect(accountFor('pat@example.com').password_hash)
      .not.toBe(accountFor('jo@example.com').password_hash);
  });

  test('stores only a digest of the confirmation token, never the token', async () => {
    await register(buildApp());
    const token = tokenFromEmail();
    const { email_verify_hash } = accountFor('pat@example.com');
    expect(email_verify_hash).toBeTruthy();
    expect(email_verify_hash).not.toBe(token);
  });

  test('links no directory entry, however well the address matches', async () => {
    db.prepare('INSERT INTO directory (name, email) VALUES (?,?)').run('Pat Nolan', 'pat@example.com');
    await register(buildApp());
    expect(accountFor('pat@example.com').directory_id).toBeNull();
  });

  test('folds the address, so one person cannot register twice with capitals', async () => {
    await register(buildApp());
    await register(buildApp(), { email: 'PAT@Example.COM' });
    expect(db.prepare("SELECT COUNT(*) AS n FROM users WHERE provider='local'").get().n).toBe(1);
  });

  test('answers a taken address exactly as a new one, and tells only the mailbox', async () => {
    const first  = await register(buildApp());
    const second = await register(buildApp(), { name: 'Somebody Else' });

    expect(second.status).toBe(first.status);
    expect(second.body).toEqual(first.body);
    expect(outbox('account:duplicate')).toHaveLength(1);
    expect(accountFor('pat@example.com').name).toBe('Pat Nolan');
  });

  test('rejects a short password, and creates nothing', async () => {
    const res = await register(buildApp(), { password: 'short1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least 10 characters/i);
    expect(accountFor('pat@example.com')).toBeUndefined();
  });

  test('rejects an obvious password', async () => {
    const res = await register(buildApp(), { password: 'password123' });
    expect(res.status).toBe(400);
    expect(accountFor('pat@example.com')).toBeUndefined();
  });

  test('rejects a malformed address and a missing name', async () => {
    expect((await register(buildApp(), { email: 'not-an-address' })).status).toBe(400);
    expect((await register(buildApp(), { name: '   ' })).status).toBe(400);
  });
});

// ─── Confirming the address ───────────────────────────────────────────────────

describe('GET /api/auth/verify-email', () => {
  test('confirms the address, leaves the account waiting, and tells the admins', async () => {
    const app = buildApp();
    await register(app);

    const res = await request(app).get(`/api/auth/verify-email?token=${tokenFromEmail()}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/verified=pending/);

    const account = accountFor('pat@example.com');
    expect(account.email_verified_at).toBeTruthy();
    expect(account.role).toBe('pending');
    expect(account.email_verify_hash).toBe('');

    const told = outbox('account:');
    expect(told.some(m => /Waiting for approval/.test(m.subject))).toBe(true);
  });

  test('a token only works once', async () => {
    const app = buildApp();
    await register(app);
    const token = tokenFromEmail();

    await request(app).get(`/api/auth/verify-email?token=${token}`);
    const again = await request(app).get(`/api/auth/verify-email?token=${token}`);
    expect(again.headers.location).toMatch(/verify_error=invalid/);
  });

  test('refuses a token that is not ours, and a missing one', async () => {
    const app = buildApp();
    await register(app);

    expect((await request(app).get('/api/auth/verify-email?token=made-up')).headers.location)
      .toMatch(/verify_error=invalid/);
    expect((await request(app).get('/api/auth/verify-email')).headers.location)
      .toMatch(/verify_error=missing/);
    expect(accountFor('pat@example.com').email_verified_at).toBeNull();
  });

  test('refuses an expired token', async () => {
    const app = buildApp();
    await register(app);
    const token = tokenFromEmail();
    db.prepare("UPDATE users SET email_verify_expires_at = datetime('now','-1 hour') WHERE provider='local'").run();

    const res = await request(app).get(`/api/auth/verify-email?token=${token}`);
    expect(res.headers.location).toMatch(/verify_error=expired/);
    expect(accountFor('pat@example.com').email_verified_at).toBeNull();
  });

  test('re-sending replaces the old link', async () => {
    const app = buildApp();
    await register(app);
    const first = tokenFromEmail();

    // The registration email is what throttling counts, so step it back.
    db.prepare("UPDATE users SET email_verify_sent_at = datetime('now','-1 hour') WHERE provider='local'").run();
    await request(app).post('/api/auth/resend-verification').send({ email: 'pat@example.com' });
    const second = tokenFromEmail();

    expect(second).not.toBe(first);
    expect((await request(app).get(`/api/auth/verify-email?token=${first}`)).headers.location)
      .toMatch(/verify_error=invalid/);
    expect((await request(app).get(`/api/auth/verify-email?token=${second}`)).headers.location)
      .toMatch(/verified=pending/);
  });

  test('the owner account named by ADMIN_EMAIL is let straight in', async () => {
    process.env.ADMIN_EMAIL = 'Pat@Example.com';
    const app = buildApp();
    await register(app);

    const res = await request(app).get(`/api/auth/verify-email?token=${tokenFromEmail()}`);
    expect(res.headers.location).toMatch(/verified=1/);
    expect(accountFor('pat@example.com').role).toBe('admin');
  });
});

describe('POST /api/auth/resend-verification', () => {
  test('says the same thing for an unknown address as for a real one', async () => {
    const app = buildApp();
    await register(app);

    const known   = await request(app).post('/api/auth/resend-verification').send({ email: 'pat@example.com' });
    const unknown = await request(app).post('/api/auth/resend-verification').send({ email: 'nobody@example.com' });
    expect(unknown.status).toBe(known.status);
    expect(unknown.body).toEqual(known.body);
  });

  test('will not mail the same address twice in a row', async () => {
    const app = buildApp();
    await register(app);
    const before = outbox('account:verify').length;

    await request(app).post('/api/auth/resend-verification').send({ email: 'pat@example.com' });
    expect(outbox('account:verify')).toHaveLength(before);
  });
});

// ─── Signing in ───────────────────────────────────────────────────────────────

// Registers, confirms the address, and approves with a member profile.
async function fullyApproved(app) {
  await register(app);
  await request(app).get(`/api/auth/verify-email?token=${tokenFromEmail()}`);
  const account = accountFor('pat@example.com');
  await request(buildApp(ADMIN))
    .patch(`/api/auth/users/${account.id}/approve`)
    .send({ person: { name: 'Pat Nolan', email: 'pat@example.com' } });
  return accountFor('pat@example.com');
}

describe('POST /api/auth/login', () => {
  test('refuses before the address is confirmed, even with the right password', async () => {
    const app = buildApp();
    await register(app);

    const res = await request(app).post('/api/auth/login')
      .send({ email: 'pat@example.com', password: GOOD_PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('email_unverified');
    expect(app.loggedIn()).toBeUndefined();
  });

  test('refuses after confirmation while an admin has not approved them', async () => {
    const app = buildApp();
    await register(app);
    await request(app).get(`/api/auth/verify-email?token=${tokenFromEmail()}`);

    const res = await request(app).post('/api/auth/login')
      .send({ email: 'pat@example.com', password: GOOD_PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('pending_approval');
    expect(app.loggedIn()).toBeUndefined();
  });

  test('signs in once the address is confirmed and an admin has approved', async () => {
    const app = buildApp();
    await fullyApproved(app);

    const res = await request(app).post('/api/auth/login')
      .send({ email: 'pat@example.com', password: GOOD_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ name: 'Pat Nolan', role: 'approved', provider: 'local' });
    expect(res.body.user.password_hash).toBeUndefined();
    expect(app.loggedIn().id).toBe(accountFor('pat@example.com').id);
    expect(accountFor('pat@example.com').last_login).toBeTruthy();
  });

  test('says the same thing for a wrong password as for an unknown address', async () => {
    const app = buildApp();
    await fullyApproved(app);

    const wrongPassword = await request(app).post('/api/auth/login')
      .send({ email: 'pat@example.com', password: 'not-the-password' });
    const noSuchAccount = await request(app).post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'not-the-password' });

    expect(wrongPassword.status).toBe(401);
    expect(noSuchAccount.status).toBe(401);
    expect(noSuchAccount.body).toEqual(wrongPassword.body);
    expect(app.loggedIn()).toBeUndefined();
  });

  test('locks the account after repeated wrong passwords, then refuses even the right one', async () => {
    const app = buildApp();
    const account = await fullyApproved(app);

    db.prepare('UPDATE users SET failed_logins = 7 WHERE id = ?').run(account.id);
    await request(app).post('/api/auth/login').send({ email: 'pat@example.com', password: 'wrong-guess' });
    expect(accountFor('pat@example.com').locked_until).toBeTruthy();

    const res = await request(app).post('/api/auth/login')
      .send({ email: 'pat@example.com', password: GOOD_PASSWORD });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('locked');
    expect(app.loggedIn()).toBeUndefined();
  });

  test('a good password clears the failures behind it', async () => {
    const app = buildApp();
    await fullyApproved(app);

    await request(app).post('/api/auth/login').send({ email: 'pat@example.com', password: 'wrong-guess' });
    expect(accountFor('pat@example.com').failed_logins).toBe(1);

    await request(app).post('/api/auth/login').send({ email: 'pat@example.com', password: GOOD_PASSWORD });
    expect(accountFor('pat@example.com').failed_logins).toBe(0);
  });

  test('tells the person their account is ready once it is approved', async () => {
    const app = buildApp();
    await fullyApproved(app);
    expect(outbox('account:').some(m => /account is ready/i.test(m.subject))).toBe(true);
  });
});

// ─── Endpoints a stranger can reach ───────────────────────────────────────────

describe('rate limiting on the open endpoints', () => {
  test('stops one caller hammering sign-in, so passwords are not hashed in a loop', async () => {
    const app = buildApp();

    let refused = null;
    for (let i = 0; i < 25 && !refused; i++) {
      const res = await request(app).post('/api/auth/login')
        .send({ email: 'nobody@example.com', password: 'wrong-guess' });
      if (res.status === 429) refused = res;
    }

    expect(refused).not.toBeNull();
    expect(refused.body.code).toBe('rate_limited');
  });

  test('stops one caller registering over and over', async () => {
    const app = buildApp();

    let refused = null;
    for (let i = 0; i < 15 && !refused; i++) {
      const res = await register(app, { email: `person${i}@example.com` });
      if (res.status === 429) refused = res;
    }

    expect(refused).not.toBeNull();
  });
});
