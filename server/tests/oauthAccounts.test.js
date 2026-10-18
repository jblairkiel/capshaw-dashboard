// The Google and Facebook halves of sign-in: the strategies are only registered
// when their credentials are configured, and both callbacks turn a provider
// profile into an account here. Passport itself is mocked so the exchange can be
// driven directly, without a provider.
jest.mock('../db', () => {
  globalThis.__oauthDb ||= require('./helpers/memoryDb').createMemoryDb();
  return globalThis.__oauthDb;
});

const request = require('supertest');
const express = require('express');
const db      = require('../db');

const ORIGINAL_ENV = { ...process.env };

// Loads routes/auth.js afresh, which is what decides whether each strategy is
// registered, and hands back the router, the strategies it registered, and the
// passport instance it is bound to.
//
// The reset is what makes the environment checks at the top of routes/auth.js
// run again — and it gives the module a new passport, so the spies have to go
// on that one rather than on any instance required earlier.
function loadAuth(env = {}) {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env };

  const passport   = require('passport');
  const registered = {};
  const hooks      = {};

  jest.spyOn(passport, 'use').mockImplementation(strategy => {
    registered[strategy.name] = strategy;
    return passport;
  });
  jest.spyOn(passport, 'serializeUser').mockImplementation(fn => { hooks.serialize = fn; });
  jest.spyOn(passport, 'deserializeUser').mockImplementation(fn => { hooks.deserialize = fn; });

  const router = require('../routes/auth');
  return { router, registered, passport, hooks };
}

function buildApp(router, user = null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user   = user;
    req.logIn  = (u, cb) => { app.loggedInUser = u; cb(null); };
    req.logout = cb => { app.loggedOut = true; cb(null); };
    req.session = { destroy: cb => cb() };
    next();
  });
  app.use('/api/auth', router);
  return app;
}

// The shape passport-google-oauth20 hands its verify callback.
const profile = (id, { email, name = 'Ray Harris', photo, verified } = {}) => ({
  id,
  displayName: name,
  emails: email ? [{ value: email, ...(verified === undefined ? {} : { verified }) }] : [],
  photos: photo ? [{ value: photo }] : [],
});

// The account the sign-in lands on — or, when there is nobody to sign in to
// yet (a join waiting on an admin), the reason passport is given.
function verifyWith(strategy, prof) {
  return new Promise((resolve, reject) => {
    strategy._verify('access-token', 'refresh-token', prof, (err, user, info) => {
      if (err) return reject(err);
      resolve(user || { refusal: info?.code, message: info?.message });
    });
  });
}

beforeEach(() => {
  jest.restoreAllMocks();
  db.prepare('DELETE FROM users').run();
  db.prepare('DELETE FROM directory').run();
  db.prepare('DELETE FROM mail_outbox').run();
});

afterEach(() => { process.env = ORIGINAL_ENV; });
afterAll(() => { jest.restoreAllMocks(); process.env = ORIGINAL_ENV; });

// ─── Strategy registration ────────────────────────────────────────────────────

describe('strategy registration', () => {
  test('neither provider is registered when nothing is configured', () => {
    const { registered } = loadAuth({
      GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '',
      FACEBOOK_APP_ID: '',  FACEBOOK_APP_SECRET: '',
    });
    expect(Object.keys(registered)).toEqual([]);
  });

  test('Google is registered once both halves of its credential are present', () => {
    const { registered } = loadAuth({ GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsecret' });
    expect(registered.google).toBeDefined();
  });

  test('half a credential is not enough to register a provider', () => {
    const { registered } = loadAuth({ GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: '' });
    expect(registered.google).toBeUndefined();
  });

  test('Facebook is registered on its own credentials', () => {
    const { registered } = loadAuth({ FACEBOOK_APP_ID: 'fid', FACEBOOK_APP_SECRET: 'fsecret' });
    expect(registered.facebook).toBeDefined();
  });
});

// ─── What a provider profile becomes ──────────────────────────────────────────

describe('signing in through a provider', () => {
  function google(env = {}) {
    return loadAuth({ GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsecret', ...env }).registered.google;
  }

  test('a new account arrives pending, never approved', async () => {
    const user = await verifyWith(google(), profile('g-1', { email: 'ray@example.com', photo: 'https://cdn/ray.jpg' }));

    expect(user).toMatchObject({
      provider: 'google', provider_id: 'g-1', email: 'ray@example.com',
      name: 'Ray Harris', photo: 'https://cdn/ray.jpg', role: 'pending',
    });
    expect(user.last_login).toBeTruthy();
  });

  test('signing in again updates the same account rather than making a second', async () => {
    const first  = await verifyWith(google(), profile('g-1', { email: 'ray@example.com' }));
    const second = await verifyWith(google(), profile('g-1', { email: 'ray.harris@example.com', name: 'Raymond Harris' }));

    expect(second.id).toBe(first.id);
    expect(second).toMatchObject({ name: 'Raymond Harris', email: 'ray.harris@example.com' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get().n).toBe(1);
  });

  test('a profile that stops carrying an address keeps the one on file', async () => {
    const first  = await verifyWith(google(), profile('g-1', { email: 'ray@example.com', photo: 'https://cdn/ray.jpg' }));
    const second = await verifyWith(google(), profile('g-1', {}));

    expect(second.id).toBe(first.id);
    expect(second.email).toBe('ray@example.com');
    expect(second.photo).toBe('https://cdn/ray.jpg');
  });

  test('the configured owner address is made an admin on sign-in', async () => {
    const user = await verifyWith(
      google({ ADMIN_EMAIL: 'owner@example.com' }),
      profile('g-9', { email: 'owner@example.com' })
    );
    expect(user.role).toBe('admin');
  });

  test('an existing account matching the owner address is promoted', async () => {
    db.prepare('INSERT INTO users (provider, provider_id, email, name, role) VALUES (?,?,?,?,?)')
      .run('google', 'g-9', 'owner@example.com', 'Owner', 'pending');

    const user = await verifyWith(
      google({ ADMIN_EMAIL: 'owner@example.com' }),
      profile('g-9', { email: 'owner@example.com' })
    );
    expect(user.role).toBe('admin');
  });

  test('links a new account to the directory entry with the same address', async () => {
    const personId = db.prepare('INSERT INTO directory (name, email) VALUES (?,?)')
      .run('Ray Harris', 'ray@example.com').lastInsertRowid;

    const user = await verifyWith(google(), profile('g-1', { email: 'ray@example.com' }));
    expect(user.directory_id).toBe(personId);
  });

  test('links an existing unlinked account on its next sign-in', async () => {
    await verifyWith(google(), profile('g-1', { email: 'ray@example.com' }));
    const personId = db.prepare('INSERT INTO directory (name, email) VALUES (?,?)')
      .run('Ray Harris', 'ray@example.com').lastInsertRowid;

    const user = await verifyWith(google(), profile('g-1', { email: 'ray@example.com' }));
    expect(user.directory_id).toBe(personId);
  });

  test('never re-points a link an admin already made', async () => {
    const assigned = db.prepare('INSERT INTO directory (name, email) VALUES (?,?)')
      .run('Raymond Harris', 'other@example.com').lastInsertRowid;
    db.prepare('INSERT INTO directory (name, email) VALUES (?,?)').run('Ray Harris', 'ray@example.com');
    db.prepare('INSERT INTO users (provider, provider_id, email, name, role, directory_id) VALUES (?,?,?,?,?,?)')
      .run('google', 'g-1', 'ray@example.com', 'Ray', 'approved', assigned);

    const user = await verifyWith(google(), profile('g-1', { email: 'ray@example.com' }));
    expect(user.directory_id).toBe(assigned);
  });

  test('a database failure is handed to passport rather than thrown', async () => {
    const strategy = google();
    jest.spyOn(db, 'prepare').mockImplementation(() => { throw new Error('database is locked'); });
    await expect(verifyWith(strategy, profile('g-1', { email: 'ray@example.com' })))
      .rejects.toThrow('database is locked');
  });
});

// ─── One person, one account ──────────────────────────────────────────────────

const countUsers = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
const identitiesOf = userId =>
  db.prepare('SELECT provider, provider_id, email, status FROM user_identities WHERE user_id = ? ORDER BY id').all(userId);
const mailsFor = context => db.prepare('SELECT * FROM mail_outbox WHERE context = ?').all(context);

function bothProviders(env = {}) {
  return loadAuth({
    GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsecret',
    FACEBOOK_APP_ID: 'fid',  FACEBOOK_APP_SECRET: 'fsecret',
    ...env,
  });
}

function addAdmin(name = 'Ada', email = 'ada@example.com') {
  return db.prepare(
    "INSERT INTO users (provider, provider_id, email, name, role) VALUES ('google', ?, ?, ?, 'admin') RETURNING *"
  ).get(`g-${name}`, email, name);
}

function localAccount(email, { verified = true, role = 'approved' } = {}) {
  const { lastInsertRowid: id } = db.prepare(`
    INSERT INTO users (provider, provider_id, email, name, role, password_hash, email_verified_at, email_verify_hash)
    VALUES ('local', ?, ?, 'Pat Nolan', ?, 'scrypt$1$1$1$c2FsdA==$aGFzaA==', ?, ?)
  `).run(email, email, role, verified ? '2026-01-01 00:00:00' : null, verified ? '' : 'pending-digest');
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

const requestIdFor = (provider, providerId) =>
  db.prepare('SELECT id FROM user_identities WHERE provider = ? AND provider_id = ?').get(provider, providerId).id;

describe('the same address arriving another way', () => {
  test('Facebook after Google is held for an admin, not signed in and not made a second account', async () => {
    const { registered } = bothProviders();
    const first  = await verifyWith(registered.google,   profile('g-1', { email: 'ray@example.com' }));
    const second = await verifyWith(registered.facebook, profile('f-1', { email: 'ray@example.com' }));

    expect(second).toEqual({ refusal: 'link_pending', message: expect.stringMatching(/admin/) });
    expect(countUsers()).toBe(1);
    expect(identitiesOf(first.id)).toEqual([
      { provider: 'facebook', provider_id: 'f-1', email: 'ray@example.com', status: 'pending' },
    ]);
  });

  test('the strategy tells passport there is nobody to sign in yet, and why', async () => {
    const { registered } = bothProviders();
    await verifyWith(registered.google, profile('g-1', { email: 'ray@example.com' }));

    const outcome = await new Promise(resolve =>
      registered.facebook._verify('a', 'r', profile('f-1', { email: 'ray@example.com' }),
        (err, user, info) => resolve({ err, user, info })));

    expect(outcome.err).toBeNull();
    expect(outcome.user).toBe(false);
    expect(outcome.info.code).toBe('link_pending');
  });

  test('the address is matched without regard to case or stray spaces', async () => {
    const { registered } = bothProviders();
    const first = await verifyWith(registered.google, profile('g-1', { email: 'Ray@Example.com' }));
    const again = await verifyWith(registered.facebook, profile('f-1', { email: ' ray@example.COM ' }));

    expect(again.refusal).toBe('link_pending');
    expect(identitiesOf(first.id)).toHaveLength(1);
    expect(countUsers()).toBe(1);
  });

  test('admins are asked and the account holder is told — once, however often they try', async () => {
    addAdmin();
    const local = localAccount('pat@example.com');
    const { registered } = bothProviders();

    await verifyWith(registered.google, profile('g-7', { email: 'pat@example.com' }));
    await verifyWith(registered.google, profile('g-7', { email: 'pat@example.com' }));
    await verifyWith(registered.google, profile('g-7', { email: 'pat@example.com' }));

    const toAdmins = mailsFor(`account:${local.id}:link-awaiting-approval`);
    expect(toAdmins).toHaveLength(1);
    expect(toAdmins[0].body).toMatch(/Pat Nolan/);
    expect(toAdmins[0].body).toMatch(/New sign-in:\s+Google, as pat@example.com/);

    const toHolder = mailsFor(`account:${local.id}:link-requested`);
    expect(toHolder).toHaveLength(1);
    expect(toHolder[0].body).toMatch(/If it was not you/);
  });

  test('while it waits, the password account is untouched', async () => {
    const local = localAccount('pat@example.com', { verified: false, role: 'pending' });
    const { registered } = bothProviders();

    await verifyWith(registered.facebook, profile('f-7', { email: 'pat@example.com' }));

    const after = db.prepare('SELECT * FROM users WHERE id = ?').get(local.id);
    expect(after.email_verified_at).toBeNull();
    expect(after.password_hash).toBe(local.password_hash);
    expect(after.email_verify_hash).toBe('pending-digest');
  });

  test('an address Google says is unconfirmed is never used to find an account', async () => {
    const local = localAccount('pat@example.com');
    const { registered } = bothProviders();

    const user = await verifyWith(registered.google, profile('g-7', { email: 'pat@example.com', verified: false }));

    expect(user.id).not.toBe(local.id);
    expect(user.role).toBe('pending');
    expect(identitiesOf(local.id)).toEqual([]);
  });

  test('an address Google confirms is used', async () => {
    const local = localAccount('pat@example.com');
    const { registered } = bothProviders();
    const result = await verifyWith(registered.google, profile('g-7', { email: 'pat@example.com', verified: true }));
    expect(result.refusal).toBe('link_pending');
    expect(identitiesOf(local.id)).toHaveLength(1);
  });

  test('a profile without an address cannot be matched to anybody', async () => {
    localAccount('pat@example.com');
    const { registered } = bothProviders();
    const user = await verifyWith(registered.facebook, profile('f-7', {}));
    expect(user.provider).toBe('facebook');
    expect(countUsers()).toBe(2);
  });

  test('where an address is already on two accounts, the request is for the older one', async () => {
    const older = localAccount('pat@example.com');
    db.prepare("INSERT INTO users (provider, provider_id, email, name, role) VALUES ('google', 'g-old', 'pat@example.com', 'Pat', 'pending')").run();
    const { registered } = bothProviders();

    await verifyWith(registered.facebook, profile('f-7', { email: 'pat@example.com' }));
    expect(identitiesOf(older.id)).toHaveLength(1);
  });

  test('the owner address joins straight away, since nobody may be there to approve it', async () => {
    const local = localAccount('owner@example.com', { role: 'pending' });
    const { registered } = bothProviders({ ADMIN_EMAIL: 'owner@example.com' });

    const user = await verifyWith(registered.google, profile('g-9', { email: 'owner@example.com' }));
    expect(user.id).toBe(local.id);
    expect(user.role).toBe('admin');
    expect(identitiesOf(local.id)[0].status).toBe('approved');
    expect(mailsFor(`account:${local.id}:link-awaiting-approval`)).toHaveLength(0);
  });

  test('registering with a password is turned away for an address a waiting sign-in carries', async () => {
    const { router, registered } = bothProviders();
    const first = await verifyWith(registered.google, profile('g-1', { email: 'ray@example.com' }));
    await verifyWith(registered.facebook, profile('f-1', { email: 'ray@example.com' }));
    // The Google address moves on; the Facebook one still points at this person.
    db.prepare('UPDATE users SET email = ? WHERE id = ?').run('ray.new@example.com', first.id);

    const res = await request(buildApp(router)).post('/api/auth/register')
      .send({ name: 'Ray Harris', email: 'ray@example.com', password: 'harvest-oak-1963' });

    expect(res.status).toBe(200);
    expect(countUsers()).toBe(1);
    expect(mailsFor('account:duplicate')).toHaveLength(1);
  });

  test('removing an account removes the sign-ins joined to it', async () => {
    const { registered } = bothProviders();
    const first = await verifyWith(registered.google, profile('g-1', { email: 'ray@example.com' }));
    await verifyWith(registered.facebook, profile('f-1', { email: 'ray@example.com' }));

    db.prepare('DELETE FROM users WHERE id = ?').run(first.id);
    expect(db.prepare('SELECT COUNT(*) AS n FROM user_identities').get().n).toBe(0);

    // And the next Facebook sign-in starts afresh rather than finding a ghost.
    const fresh = await verifyWith(registered.facebook, profile('f-1', { email: 'ray@example.com' }));
    expect(fresh.provider).toBe('facebook');
  });
});

// ─── An admin decides ─────────────────────────────────────────────────────────

describe('an admin approving or declining a join', () => {
  // Ray signs up with Google, then tries Facebook on the same address.
  async function rayWaiting(env = {}) {
    const auth = bothProviders(env);
    const ray  = await verifyWith(auth.registered.google, profile('g-1', { email: 'ray@example.com', name: 'Ray Harris' }));
    db.prepare("UPDATE users SET role = 'approved' WHERE id = ?").run(ray.id);
    await verifyWith(auth.registered.facebook, profile('f-1', { email: 'ray@example.com' }));
    return { ...auth, ray, requestId: requestIdFor('facebook', 'f-1') };
  }

  test('lists the requests waiting, with whose account each would join', async () => {
    const admin = addAdmin();
    const { router, ray, requestId } = await rayWaiting();

    const res = await request(buildApp(router, admin)).get('/api/auth/link-requests');

    expect(res.status).toBe(200);
    expect(res.body.requests).toEqual([expect.objectContaining({
      id: requestId, provider: 'facebook', email: 'ray@example.com', status: 'pending',
      user_id: ray.id, account_name: 'Ray Harris', account_provider: 'google',
    })]);
  });

  test('approving lets that sign-in reach the account from then on', async () => {
    const admin = addAdmin();
    const { router, registered, ray, requestId } = await rayWaiting();

    const res = await request(buildApp(router, admin)).patch(`/api/auth/link-requests/${requestId}/approve`);
    expect(res.status).toBe(200);
    expect(res.body.request).toMatchObject({ status: 'approved', decided_by_name: 'Ada' });
    expect(res.body.user.linked_providers).toEqual(['facebook']);

    const signedIn = await verifyWith(registered.facebook, profile('f-1', { email: 'ray@example.com', name: 'R. H.' }));
    expect(signedIn.id).toBe(ray.id);
    expect(signedIn).toMatchObject({ name: 'Ray Harris', provider: 'google', role: 'approved' });
    expect(countUsers()).toBe(2);
  });

  test('approving tells the account holder and is kept in the action history', async () => {
    const admin = addAdmin();
    const { router, ray, requestId } = await rayWaiting();

    await request(buildApp(router, admin)).patch(`/api/auth/link-requests/${requestId}/approve`);

    expect(mailsFor(`account:${ray.id}:link-approved`)).toHaveLength(1);
    const logged = db.prepare("SELECT * FROM action_log WHERE area = 'accounts' ORDER BY id DESC").get();
    expect(logged).toMatchObject({ user_id: admin.id, entity_id: String(ray.id) });
    expect(logged.summary).toMatch(/Joined a Facebook sign-in \(ray@example.com\) to Ray Harris's account/);
  });

  test('declining keeps that sign-in out, without making it an account of its own', async () => {
    const admin = addAdmin();
    const { router, registered, ray, requestId } = await rayWaiting();

    const res = await request(buildApp(router, admin)).patch(`/api/auth/link-requests/${requestId}/decline`);
    expect(res.status).toBe(200);
    expect(res.body.request.status).toBe('declined');

    const again = await verifyWith(registered.facebook, profile('f-1', { email: 'ray@example.com' }));
    expect(again.refusal).toBe('link_declined');
    expect(countUsers()).toBe(2);
    expect(identitiesOf(ray.id)[0].status).toBe('declined');
    expect(db.prepare("SELECT summary FROM action_log ORDER BY id DESC").get().summary).toMatch(/Declined joining/);
  });

  test('the sign-in page is told the join is waiting, or was declined', async () => {
    const admin = addAdmin();
    const { router, passport, requestId } = await rayWaiting();

    jest.spyOn(passport, 'authenticate').mockImplementation((_name, cb) => () => cb(null, false, { code: 'link_pending' }));
    let res = await request(buildApp(router)).get('/api/auth/facebook/callback');
    expect(res.headers.location).toMatch(/auth_error=link_pending$/);

    await request(buildApp(router, admin)).patch(`/api/auth/link-requests/${requestId}/decline`);
    passport.authenticate.mockImplementation((_name, cb) => () => cb(null, false, { code: 'link_declined' }));
    res = await request(buildApp(router)).get('/api/auth/facebook/callback');
    expect(res.headers.location).toMatch(/auth_error=link_declined$/);
  });

  test('a reason the page does not know is reported as a plain provider failure', async () => {
    const { router, passport } = bothProviders();
    jest.spyOn(passport, 'authenticate').mockImplementation((_name, cb) => () => cb(null, false, { code: 'toString' }));
    const res = await request(buildApp(router)).get('/api/auth/google/callback');
    expect(res.headers.location).toMatch(/auth_error=google$/);
  });

  test('an admin cannot approve a sign-in joining their own account', async () => {
    const ada = addAdmin('Ada', 'ada@example.com');
    const { router, registered } = bothProviders();
    await verifyWith(registered.facebook, profile('f-ada', { email: 'ada@example.com' }));
    const requestId = requestIdFor('facebook', 'f-ada');

    const res = await request(buildApp(router, ada)).patch(`/api/auth/link-requests/${requestId}/approve`);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Another admin/);
    expect(identitiesOf(ada.id)[0].status).toBe('pending');

    // Another admin can.
    const bo = addAdmin('Bo', 'bo@example.com');
    const ok = await request(buildApp(router, bo)).patch(`/api/auth/link-requests/${requestId}/approve`);
    expect(ok.status).toBe(200);
  });

  test('…but can decline one, since that only keeps a sign-in out', async () => {
    const ada = addAdmin('Ada', 'ada@example.com');
    const { router, registered } = bothProviders();
    await verifyWith(registered.facebook, profile('f-ada', { email: 'ada@example.com' }));

    const res = await request(buildApp(router, ada))
      .patch(`/api/auth/link-requests/${requestIdFor('facebook', 'f-ada')}/decline`);
    expect(res.status).toBe(200);
  });

  test('a request can only be decided once', async () => {
    const admin = addAdmin();
    const { router, requestId } = await rayWaiting();
    const app = buildApp(router, admin);

    await request(app).patch(`/api/auth/link-requests/${requestId}/approve`);
    const twice   = await request(app).patch(`/api/auth/link-requests/${requestId}/approve`);
    const reverse = await request(app).patch(`/api/auth/link-requests/${requestId}/decline`);

    expect(twice.status).toBe(409);
    expect(reverse.status).toBe(409);
    expect(reverse.body.error).toMatch(/already been approved/);
  });

  test('deciding on a request that does not exist is a 404', async () => {
    const admin = addAdmin();
    const { router } = bothProviders();
    const app = buildApp(router, admin);
    expect((await request(app).patch('/api/auth/link-requests/999/approve')).status).toBe(404);
    expect((await request(app).patch('/api/auth/link-requests/999/decline')).status).toBe(404);
    expect((await request(app).delete('/api/auth/link-requests/999')).status).toBe(404);
  });

  test.each([
    ['nobody signed in', null, 401],
    ['a member',         { id: 50, role: 'approved' }, 403],
    ['a waiting account', { id: 51, role: 'pending' }, 403],
  ])('%s can neither see nor decide requests', async (_who, user, status) => {
    const { router, ray, requestId } = await rayWaiting();
    const app = buildApp(router, user);

    expect((await request(app).get('/api/auth/link-requests')).status).toBe(status);
    expect((await request(app).patch(`/api/auth/link-requests/${requestId}/approve`)).status).toBe(status);
    expect((await request(app).patch(`/api/auth/link-requests/${requestId}/decline`)).status).toBe(status);
    expect((await request(app).delete(`/api/auth/link-requests/${requestId}`)).status).toBe(status);
    expect(identitiesOf(ray.id)[0].status).toBe('pending');
  });

  test('approving a password account still waiting on its email confirms it, clears its password, and sends it for approval', async () => {
    const admin = addAdmin();
    const local = localAccount('pat@example.com', { verified: false, role: 'pending' });
    const { router, registered } = bothProviders();
    await verifyWith(registered.facebook, profile('f-7', { email: 'pat@example.com' }));

    await request(buildApp(router, admin)).patch(`/api/auth/link-requests/${requestIdFor('facebook', 'f-7')}/approve`);

    const after = db.prepare('SELECT * FROM users WHERE id = ?').get(local.id);
    expect(after.email_verified_at).toBeTruthy();
    expect(after.email_verify_hash).toBe('');
    expect(after.password_hash).toBe('');
    expect(mailsFor(`account:${local.id}:awaiting-approval`)).toHaveLength(1);
  });

  test('approving a confirmed password account leaves its password alone', async () => {
    const admin = addAdmin();
    const local = localAccount('pat@example.com');
    const { router, registered } = bothProviders();
    await verifyWith(registered.google, profile('g-7', { email: 'pat@example.com' }));

    await request(buildApp(router, admin)).patch(`/api/auth/link-requests/${requestIdFor('google', 'g-7')}/approve`);

    const signedIn = await verifyWith(registered.google, profile('g-7', { email: 'pat@example.com' }));
    expect(signedIn.id).toBe(local.id);
    expect(signedIn.password_hash).toBe(local.password_hash);
  });

  test('a joined sign-in fills in a missing photo but never replaces one', async () => {
    const admin = addAdmin();
    const { router, registered, ray, requestId } = await rayWaiting();
    await request(buildApp(router, admin)).patch(`/api/auth/link-requests/${requestId}/approve`);

    const linked = await verifyWith(registered.facebook, profile('f-1', { email: 'ray@example.com', photo: 'https://fb/ray.jpg' }));
    expect(linked.photo).toBe('https://fb/ray.jpg');

    db.prepare('UPDATE users SET photo = ? WHERE id = ?').run('https://g/ray.jpg', ray.id);
    const again = await verifyWith(registered.facebook, profile('f-1', { email: 'ray@example.com', photo: 'https://fb/new.jpg' }));
    expect(again.photo).toBe('https://g/ray.jpg');
  });

  test('a joined sign-in links the account to its directory entry if nothing has yet', async () => {
    const admin = addAdmin();
    const local = localAccount('pat@example.com');
    const { router, registered } = bothProviders();
    await verifyWith(registered.google, profile('g-7', { email: 'pat@example.com' }));
    const personId = db.prepare('INSERT INTO directory (name, email) VALUES (?,?)')
      .run('Pat Nolan', 'pat@example.com').lastInsertRowid;
    await request(buildApp(router, admin)).patch(`/api/auth/link-requests/${requestIdFor('google', 'g-7')}/approve`);

    const user = await verifyWith(registered.google, profile('g-7', { email: 'pat@example.com' }));
    expect(user.id).toBe(local.id);
    expect(user.directory_id).toBe(personId);
  });

  test('removing a declined request lets that sign-in ask again', async () => {
    const admin = addAdmin();
    const { router, registered, ray, requestId } = await rayWaiting();
    const app = buildApp(router, admin);
    await request(app).patch(`/api/auth/link-requests/${requestId}/decline`);

    const res = await request(app).delete(`/api/auth/link-requests/${requestId}`);
    expect(res.status).toBe(200);
    expect(identitiesOf(ray.id)).toEqual([]);

    const again = await verifyWith(registered.facebook, profile('f-1', { email: 'ray@example.com' }));
    expect(again.refusal).toBe('link_pending');
    expect(identitiesOf(ray.id)[0].status).toBe('pending');
  });

  test('the list can show what was decided, too', async () => {
    const admin = addAdmin();
    const { router, requestId } = await rayWaiting();
    const app = buildApp(router, admin);
    await request(app).patch(`/api/auth/link-requests/${requestId}/decline`);

    expect((await request(app).get('/api/auth/link-requests')).body.requests).toEqual([]);
    const declined = await request(app).get('/api/auth/link-requests?status=declined');
    expect(declined.body.requests.map(r => r.id)).toEqual([requestId]);
  });

  test('the admin list shows only the sign-ins an admin has approved', async () => {
    const admin = addAdmin();
    const { router, ray, requestId } = await rayWaiting();
    const app = buildApp(router, admin);

    let ray_ = (await request(app).get('/api/auth/users')).body.users.find(u => u.id === ray.id);
    expect(ray_.linked_providers).toEqual([]);

    await request(app).patch(`/api/auth/link-requests/${requestId}/approve`);
    ray_ = (await request(app).get('/api/auth/users')).body.users.find(u => u.id === ray.id);
    expect(ray_.linked_providers).toEqual(['facebook']);
  });
});

// ─── Session serialization ────────────────────────────────────────────────────

describe('session serialization', () => {
  let serialize, deserialize;

  beforeEach(() => {
    ({ hooks: { serialize, deserialize } } = loadAuth());
  });

  test('only the account id goes into the session', done => {
    serialize({ id: 42, name: 'Ray', email: 'ray@example.com' }, (err, stored) => {
      expect(err).toBeNull();
      expect(stored).toBe(42);
      done();
    });
  });

  test('the id is read back into the current account row', done => {
    const id = db.prepare('INSERT INTO users (provider, provider_id, email, name, role) VALUES (?,?,?,?,?)')
      .run('google', 'g-1', 'ray@example.com', 'Ray Harris', 'approved').lastInsertRowid;

    deserialize(id, (err, user) => {
      expect(err).toBeNull();
      expect(user).toMatchObject({ id, name: 'Ray Harris', role: 'approved' });
      done();
    });
  });

  test('an account that has since been deleted deserializes to nobody', done => {
    deserialize(999999, (err, user) => {
      expect(err).toBeNull();
      expect(user).toBe(false);
      done();
    });
  });

  test('a database failure is reported rather than swallowed', done => {
    jest.spyOn(db, 'prepare').mockImplementation(() => { throw new Error('database is locked'); });
    deserialize(1, err => {
      expect(err).toEqual(new Error('database is locked'));
      done();
    });
  });
});

// ─── The callback routes ──────────────────────────────────────────────────────

describe.each(['google', 'facebook'])('GET /api/auth/%s/callback', provider => {
  const CLIENT_URL = 'http://localhost:5173';

  // Stands in for passport.authenticate, calling the route's own handler with
  // whatever a provider exchange would have produced.
  function appFor(...outcome) {
    const { router, passport } = loadAuth({
      CLIENT_URL,
      GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsecret',
      FACEBOOK_APP_ID: 'fid',  FACEBOOK_APP_SECRET: 'fsecret',
    });
    jest.spyOn(passport, 'authenticate').mockImplementation((_name, handler) =>
      (req, res, next) => handler(...outcome));
    return buildApp(router);
  }

  test('sends the member to the portal once signed in', async () => {
    const app = appFor(null, { id: 7, role: 'approved' }, null);
    const res = await request(app).get(`/api/auth/${provider}/callback`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(CLIENT_URL);
    expect(app.loggedInUser).toMatchObject({ id: 7 });
  });

  test('redirects with an error when the provider exchange fails', async () => {
    const res = await request(appFor(new Error('token exchange failed'), null, null))
      .get(`/api/auth/${provider}/callback`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${CLIENT_URL}/?auth_error=${provider}`);
  });

  test('redirects with an error when the provider returns nobody', async () => {
    const res = await request(appFor(null, null, { message: 'access denied' }))
      .get(`/api/auth/${provider}/callback`);
    expect(res.headers.location).toBe(`${CLIENT_URL}/?auth_error=${provider}`);
  });

  test('redirects with an error when the provider returns nobody and says nothing', async () => {
    const res = await request(appFor(null, null, null)).get(`/api/auth/${provider}/callback`);
    expect(res.headers.location).toBe(`${CLIENT_URL}/?auth_error=${provider}`);
  });

  test('redirects with an error when the session cannot be written', async () => {
    const { router, passport } = loadAuth({
      CLIENT_URL, GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsecret',
      FACEBOOK_APP_ID: 'fid', FACEBOOK_APP_SECRET: 'fsecret',
    });
    jest.spyOn(passport, 'authenticate').mockImplementation((_name, handler) =>
      (req, res, next) => handler(null, { id: 7, role: 'approved' }, null));

    const app = express();
    app.use((req, _res, next) => { req.logIn = (_u, cb) => cb(new Error('session store down')); next(); });
    app.use('/api/auth', router);

    const res = await request(app).get(`/api/auth/${provider}/callback`);
    expect(res.headers.location).toBe(`${CLIENT_URL}/?auth_error=${provider}`);
  });
});

// ─── What Facebook is asked for ───────────────────────────────────────────────

test('Facebook sign-in asks for the email address again if it was declined last time', () => {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, FACEBOOK_APP_ID: 'fid', FACEBOOK_APP_SECRET: 'fsecret' };
  const passport = require('passport');
  jest.spyOn(passport, 'use').mockReturnValue(passport);
  const authenticate = jest.spyOn(passport, 'authenticate').mockReturnValue((req, res, next) => next());
  require('../routes/auth');

  expect(authenticate).toHaveBeenCalledWith('facebook', { scope: ['email'], authType: 'rerequest' });
});

// ─── Which providers the sign-in page offers ──────────────────────────────────

describe('GET /api/auth/providers', () => {
  const list = async env => {
    const { router } = loadAuth(env);
    return (await request(buildApp(router)).get('/api/auth/providers')).body.providers;
  };

  test('lists nothing when neither provider is configured', async () => {
    expect(await list({ GOOGLE_CLIENT_ID: '', FACEBOOK_APP_ID: '' })).toEqual([]);
  });

  test('lists only the providers with both credentials set', async () => {
    expect(await list({ GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsecret', FACEBOOK_APP_ID: 'fid', FACEBOOK_APP_SECRET: '' }))
      .toEqual(['google']);
    expect(await list({ GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsecret', FACEBOOK_APP_ID: 'fid', FACEBOOK_APP_SECRET: 'fsecret' }))
      .toEqual(['google', 'facebook']);
  });
});

describe.each(['google', 'facebook'])('a link to %s when it is not configured', provider => {
  const CLIENT_URL = 'http://localhost:5173';
  const unconfigured = { GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', FACEBOOK_APP_ID: '', FACEBOOK_APP_SECRET: '' };

  test.each([
    ['the sign-in link', ''],
    ['the callback',     '/callback'],
  ])('%s goes back to the sign-in page with its error', async (_what, suffix) => {
    const { router } = loadAuth(unconfigured);
    const res = await request(buildApp(router)).get(`/api/auth/${provider}${suffix}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${CLIENT_URL}/?auth_error=${provider}`);
  });
});

// ─── /me, /logout and /password-policy ────────────────────────────────────────

describe('session endpoints', () => {
  test('GET /me is 401 when nobody is signed in', async () => {
    const { router } = loadAuth();
    const res = await request(buildApp(router)).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test('GET /me describes the signed-in member without leaking the password hash', async () => {
    const { router } = loadAuth();
    const id = db.prepare(
      'INSERT INTO users (provider, provider_id, email, name, role, password_hash) VALUES (?,?,?,?,?,?)'
    ).run('local', 'ray@example.com', 'ray@example.com', 'Ray Harris', 'approved', 'scrypt$secret').lastInsertRowid;
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(id);

    const res = await request(buildApp(router, user)).get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id, name: 'Ray Harris', role: 'approved' });
    expect(JSON.stringify(res.body)).not.toContain('scrypt$secret');
  });

  test('POST /logout clears the session', async () => {
    const { router } = loadAuth();
    const app = buildApp(router);

    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(app.loggedOut).toBe(true);
  });

  test('POST /logout reports a failure to clear the session', async () => {
    const { router } = loadAuth();
    const app = express();
    app.use((req, _res, next) => { req.logout = cb => cb(new Error('session store down')); next(); });
    app.use('/api/auth', router);

    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });

  test('GET /password-policy tells the sign-up form the minimum length', async () => {
    const { router } = loadAuth();
    const res = await request(buildApp(router)).get('/api/auth/password-policy');
    expect(res.status).toBe(200);
    expect(typeof res.body.minLength).toBe('number');
    expect(res.body.minLength).toBeGreaterThan(0);
  });
});
