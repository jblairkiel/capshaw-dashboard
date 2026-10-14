// A Google or Facebook sign-in that came without an email address — Facebook
// gives none for somebody who joined it with a phone number — adding one from
// the waiting page. The address only becomes the account's once its owner
// opens the link mailed to it.
jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const request    = require('supertest');
const express    = require('express');
const db         = require('../db');
const authRouter = require('../routes/auth');

// Signed in as `user` (read fresh on every request, as passport would), and
// optionally as an admin viewing the portal as them.
function buildApp(userId = null, { impersonator = null } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = userId ? db.prepare('SELECT * FROM users WHERE id = ?').get(userId) : null;
    req.impersonator = impersonator;
    next();
  });
  app.use('/api/auth', authRouter);
  return app;
}

function addUser(provider, providerId, email, name, role = 'pending') {
  const { lastInsertRowid: id } = db.prepare(
    'INSERT INTO users (provider, provider_id, email, name, role) VALUES (?,?,?,?,?)'
  ).run(provider, providerId, email, name, role);
  return id;
}

const userRow = id => db.prepare('SELECT * FROM users WHERE id = ?').get(id);
const outbox  = context => db.prepare('SELECT * FROM mail_outbox WHERE context = ? ORDER BY id ASC').all(context);
const linkIn  = mail => mail?.body.match(/verify-email\?token=([^\s]+)/)?.[1] ?? null;

const addEmail = (app, email) => request(app).post('/api/auth/add-email').send({ email });
const openLink = (app, token) => request(app).get(`/api/auth/verify-email?token=${token}`);

let PAT;

beforeEach(() => {
  delete process.env.ADMIN_EMAIL;
  authRouter.resetRateLimits();
  db.prepare('DELETE FROM mail_outbox').run();
  db.prepare('DELETE FROM user_identities').run();
  db.prepare('DELETE FROM users').run();
  db.prepare('DELETE FROM directory').run();
  addUser('google', 'ada-id', 'ada@example.com', 'Ada', 'admin');
  PAT = addUser('facebook', 'fb-pat', null, 'Pat Nolan');
});

describe('POST /api/auth/add-email', () => {
  test('mails a confirmation link to the address, without adding it yet', async () => {
    const res = await addEmail(buildApp(PAT), ' Pat@Example.com ');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, pending_email: 'pat@example.com' });
    expect(res.body.message).toMatch(/pat@example\.com/);

    expect(userRow(PAT)).toMatchObject({ email: null, pending_email: 'pat@example.com' });
    const [mail] = outbox('account:add-email');
    expect(mail.to_email).toBe('pat@example.com');
    expect(mail.body).toMatch(/with Facebook/);
    expect(linkIn(mail)).toBeTruthy();
  });

  test('does not mail the same address twice in a couple of minutes', async () => {
    const app = buildApp(PAT);
    await addEmail(app, 'pat@example.com');
    const again = await addEmail(app, 'pat@example.com');
    expect(again.body.success).toBe(true);
    expect(outbox('account:add-email')).toHaveLength(1);
  });

  test('a different address replaces the first, and only the newer link works', async () => {
    const app = buildApp(PAT);
    await addEmail(app, 'old@example.com');
    const first = linkIn(outbox('account:add-email')[0]);
    await addEmail(app, 'pat@example.com');
    const second = linkIn(outbox('account:add-email')[1]);

    expect((await openLink(app, first)).headers.location).toMatch(/verify_error=invalid/);
    expect((await openLink(app, second)).headers.location).toMatch(/verified=added/);
    expect(userRow(PAT).email).toBe('pat@example.com');
  });

  test('an address another account has is never added, and only its owner is told', async () => {
    const res = await addEmail(buildApp(PAT), 'ada@example.com');
    // The same answer as for a free address, so the form reveals nothing.
    expect(res.body).toMatchObject({ success: true, pending_email: 'ada@example.com' });

    expect(userRow(PAT)).toMatchObject({ email: null, pending_email: '' });
    expect(outbox('account:add-email')).toHaveLength(0);
    const [note] = outbox('account:add-email-in-use');
    expect(note.to_email).toBe('ada@example.com');
    expect(note.body).toMatch(/signs in with Google/);
  });

  test('is refused for an account that already has an address', async () => {
    const jo = addUser('google', 'g-jo', 'jo@example.com', 'Jo');
    const res = await addEmail(buildApp(jo), 'other@example.com');
    expect(res.status).toBe(400);
    expect(userRow(jo).pending_email).toBe('');
  });

  test('is refused for something that is not an email address', async () => {
    const res = await addEmail(buildApp(PAT), 'not an address');
    expect(res.status).toBe(400);
    expect(outbox('account:add-email')).toHaveLength(0);
  });

  test('needs somebody signed in', async () => {
    expect((await addEmail(buildApp(), 'pat@example.com')).status).toBe(401);
  });

  test('an admin viewing the portal as them cannot add one on their behalf', async () => {
    const res = await addEmail(buildApp(PAT, { impersonator: { id: 1, name: 'Ada' } }), 'ada-alt@example.com');
    expect(res.status).toBe(403);
    expect(userRow(PAT).pending_email).toBe('');
  });

  test('GET /me says which address is waiting on its link', async () => {
    const app = buildApp(PAT);
    await addEmail(app, 'pat@example.com');
    const me = await request(app).get('/api/auth/me');
    expect(me.body.user).toMatchObject({ email: null, pending_email: 'pat@example.com' });
  });
});

describe('opening the link', () => {
  async function linkFor(email, userId = PAT) {
    await addEmail(buildApp(userId), email);
    return linkIn(outbox('account:add-email').at(-1));
  }

  test('makes it the account\'s confirmed address, signed in or not', async () => {
    const token = await linkFor('pat@example.com');
    const res = await openLink(buildApp(), token);

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\?verified=added$/);
    const pat = userRow(PAT);
    expect(pat).toMatchObject({ email: 'pat@example.com', pending_email: '', email_verify_hash: '', role: 'pending' });
    expect(pat.email_verified_at).toBeTruthy();
  });

  test('connects the account to the one directory entry with that address', async () => {
    const personId = db.prepare('INSERT INTO directory (name, email) VALUES (?,?)').run('Pat Nolan', 'pat@example.com').lastInsertRowid;
    await openLink(buildApp(), await linkFor('pat@example.com'));
    expect(userRow(PAT).directory_id).toBe(personId);
  });

  test('never re-points a directory link an admin already made', async () => {
    const chosen = db.prepare('INSERT INTO directory (name, email) VALUES (?,?)').run('Patricia Nolan', '').lastInsertRowid;
    db.prepare('INSERT INTO directory (name, email) VALUES (?,?)').run('Pat Nolan', 'pat@example.com');
    db.prepare('UPDATE users SET directory_id = ? WHERE id = ?').run(chosen, PAT);

    await openLink(buildApp(), await linkFor('pat@example.com'));
    expect(userRow(PAT).directory_id).toBe(chosen);
  });

  test('adds nothing if another account took the address after the link was sent', async () => {
    const token = await linkFor('pat@example.com');
    addUser('local', 'pat@example.com', 'pat@example.com', 'Someone Else');

    const res = await openLink(buildApp(), token);
    expect(res.headers.location).toMatch(/verify_error=taken/);
    expect(userRow(PAT)).toMatchObject({ email: null, pending_email: '', email_verify_hash: '' });
  });

  test('an expired link adds nothing', async () => {
    const token = await linkFor('pat@example.com');
    db.prepare("UPDATE users SET email_verify_expires_at = datetime('now', '-1 minute') WHERE id = ?").run(PAT);

    expect((await openLink(buildApp(), token)).headers.location).toMatch(/verify_error=expired/);
    expect(userRow(PAT).email).toBeNull();
  });

  test('works once', async () => {
    const token = await linkFor('pat@example.com');
    await openLink(buildApp(), token);
    expect((await openLink(buildApp(), token)).headers.location).toMatch(/verify_error=invalid/);
  });
});
