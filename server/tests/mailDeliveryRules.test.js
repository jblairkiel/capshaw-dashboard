// Email Delivery: while the site is in test mode every email goes to the
// redirect address, except to the roles and people an admin has let through —
// a person's own setting beating any role — and only an admin can change that.
jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const request = require('supertest');
const express = require('express');
const db      = require('../db');
const mailer  = require('../mail/mailer');
const delivery = require('../mail/delivery');
const router  = require('../routes/mailDelivery');

const ORIGINAL_ENV = { ...process.env };
const ADMIN  = { id: 1, name: 'Office Admin', role: 'admin' };
const KEEPER = { id: 2, name: 'Song Keeper', role: 'approved', areas: ['songs', 'records'] };

function buildApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/mail-delivery', router);
  return app;
}

const account = (id, name, email, role, areas = []) => {
  db.prepare("INSERT INTO users (id, provider, provider_id, email, name, role) VALUES (?, 'local', ?, ?, ?, ?)").run(id, `u${id}`, email, name, role);
  for (const a of areas) db.prepare('INSERT INTO user_areas (user_id, area) VALUES (?, ?)').run(id, a);
};

const send = (...emails) => mailer.enqueue({ to: emails.map(email => ({ email, name: email.split('@')[0] })), subject: 'Hi', body: 'Body' });
const whereTo = () => Object.fromEntries(db.prepare('SELECT to_email, intended_for FROM mail_outbox').all()
  .map(r => [r.intended_for || r.to_email, r.intended_for ? 'redirected' : 'real']));

beforeEach(() => {
  for (const t of ['mail_outbox', 'mail_redirect_rules', 'action_log', 'user_areas', 'users', 'directory']) db.prepare(`DELETE FROM ${t}`).run();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.MAIL_REDIRECT_TO;
  delete process.env.SMTP_HOST;
  account(1, 'Office Admin', 'admin@example.com', 'admin');
  account(2, 'Song Keeper', 'songs@example.com', 'approved', ['songs']);
  account(3, 'Plain Member', 'member@example.com', 'approved');
  account(4, 'Waiting', 'waiting@example.com', 'pending', ['songs']);
  db.prepare("INSERT INTO directory (name, email) VALUES ('Dir Person', 'dir@example.com')").run();
});

afterAll(() => { process.env = ORIGINAL_ENV; });

describe('who gets real mail', () => {
  test('by default, nobody: everything goes to the redirect address', () => {
    send('admin@example.com', 'songs@example.com', 'member@example.com', 'dir@example.com');
    expect(Object.values(whereTo()).every(v => v === 'redirected')).toBe(true);
    expect(new Set(db.prepare('SELECT to_email FROM mail_outbox').all().map(r => r.to_email))).toEqual(new Set(['jblairkiel@gmail.com']));
  });

  test('a role let through: its holders get their own mail, with no test-mode notice', () => {
    delivery.setRole('songs', true, ADMIN);
    send('songs@example.com', 'member@example.com', 'admin@example.com');
    expect(whereTo()).toEqual({ 'songs@example.com': 'real', 'member@example.com': 'redirected', 'admin@example.com': 'redirected' });
    const real = db.prepare("SELECT body FROM mail_outbox WHERE to_email = 'songs@example.com'").get();
    expect(real.body).toBe('Body');
  });

  test("an admin's implicit hold on every area does not count — only Admins does", () => {
    delivery.setRole('songs', true, ADMIN);
    expect(delivery.decide('admin@example.com')).toEqual({ deliver: false, why: 'default' });
    delivery.setRole('admin', true, ADMIN);
    expect(delivery.decide('admin@example.com')).toMatchObject({ deliver: true, why: 'role', role: 'admin' });
  });

  test('an account still waiting to be approved holds nothing', () => {
    delivery.setRole('songs', true, ADMIN);
    expect(delivery.decide('waiting@example.com').deliver).toBe(false);
  });

  test('a person let through, with or without an account', () => {
    delivery.setPerson({ email: ' Dir@Example.com ', name: 'Dir Person', deliver: true }, ADMIN);
    send('dir@example.com', 'member@example.com');
    expect(whereTo()).toEqual({ 'dir@example.com': 'real', 'member@example.com': 'redirected' });
  });

  test("a person's own setting beats the role: kept redirected though their role is let through", () => {
    delivery.setRole('songs', true, ADMIN);
    delivery.setPerson({ email: 'songs@example.com', name: 'Song Keeper', deliver: false }, ADMIN);
    expect(delivery.decide('songs@example.com')).toEqual({ deliver: false, why: 'person' });
    delivery.removePerson('songs@example.com');
    expect(delivery.decide('songs@example.com').deliver).toBe(true);
  });

  test('none of it matters once the redirect is cleared: everybody gets real mail', () => {
    process.env.MAIL_REDIRECT_TO = '';
    delivery.setPerson({ email: 'member@example.com', deliver: false }, ADMIN);
    send('member@example.com');
    expect(whereTo()).toEqual({ 'member@example.com': 'real' });
  });

  test('refuses what is not a role or an address', () => {
    expect(delivery.setRole('nope', true, ADMIN).error).toMatch(/No such role/);
    expect(delivery.setPerson({ email: 'not-an-email', deliver: true }, ADMIN).error).toMatch(/not an email/);
    expect(delivery.setPerson({ email: 'a@b.co' }, ADMIN).error).toMatch(/Say whether/);
  });
});

describe('the page', () => {
  test('is for admins only', async () => {
    expect((await request(buildApp(KEEPER)).get('/api/mail-delivery')).status).toBe(403);
    expect((await request(buildApp(KEEPER)).put('/api/mail-delivery/roles/songs').send({ deliver: true })).status).toBe(403);
    expect((await request(buildApp(ADMIN)).get('/api/mail-delivery')).status).toBe(200);
  });

  test('shows the redirect, every role with who holds it, the address book, and who gets real mail', async () => {
    const res = await request(buildApp(ADMIN)).put('/api/mail-delivery/roles/songs').send({ deliver: true });
    expect(res.body).toMatchObject({ redirecting: true, redirectTo: 'jblairkiel@gmail.com' });
    const songs = res.body.roles.find(r => r.key === 'songs');
    expect(songs).toMatchObject({ label: 'Song Tracker', deliver: true, holders: [{ name: 'Song Keeper', email: 'songs@example.com' }] });
    expect(res.body.roles[0]).toMatchObject({ key: 'admin', label: 'Admins', deliver: false });
    expect(res.body.addressBook.map(p => p.email)).toEqual(['dir@example.com', 'admin@example.com', 'member@example.com', 'songs@example.com']);
    expect(res.body.real).toEqual([{ email: 'songs@example.com', name: 'Song Keeper', why: 'role', roleLabel: 'Song Tracker' }]);
  });

  test('people are set, changed and cleared, and every change is in the history', async () => {
    const app = buildApp(ADMIN);
    let res = await request(app).put('/api/mail-delivery/people').send({ email: 'dir@example.com', name: 'Dir Person', deliver: true });
    expect(res.body.people).toEqual([expect.objectContaining({ email: 'dir@example.com', name: 'Dir Person', deliver: true, updatedBy: 'Office Admin' })]);
    expect(res.body.real.map(p => p.email)).toEqual(['dir@example.com']);

    res = await request(app).delete('/api/mail-delivery/people?email=dir@example.com');
    expect(res.body.people).toEqual([]);
    expect((await request(app).delete('/api/mail-delivery/people?email=dir@example.com')).status).toBe(404);
    expect(db.prepare("SELECT COUNT(*) AS n FROM action_log WHERE entity = 'email delivery'").get().n).toBe(2);
  });
});
