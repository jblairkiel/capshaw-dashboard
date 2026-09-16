// The part of the mailer that actually talks to an SMTP server: how the
// transport is built from the environment, and what draining the outbox does
// to each row it tries. nodemailer is mocked, so nothing leaves the process.
jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());
jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

const db         = require('../db');
const nodemailer = require('nodemailer');
const mailer     = require('../mail/mailer');

const ORIGINAL_ENV = { ...process.env };

let sendMail;

function outbox() {
  return db.prepare('SELECT * FROM mail_outbox ORDER BY id').all();
}

function queue(overrides = {}) {
  return db.prepare(`
    INSERT INTO mail_outbox (to_email, to_name, intended_for, subject, body, context, status, attempts)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    overrides.to_email     ?? 'ray@example.com',
    overrides.to_name      ?? 'Ray Harris',
    overrides.intended_for ?? '',
    overrides.subject      ?? 'Sunday roster',
    overrides.body         ?? 'You are leading singing.',
    overrides.context      ?? 'workflow:1',
    overrides.status       ?? 'pending',
    overrides.attempts     ?? 0,
  ).lastInsertRowid;
}

beforeEach(() => {
  db.prepare('DELETE FROM mail_outbox').run();
  jest.clearAllMocks();
  mailer.resetTransport();

  process.env = { ...ORIGINAL_ENV, SMTP_HOST: 'smtp.example.com', SMTP_PORT: '587' };
  delete process.env.MAIL_REDIRECT_TO;

  sendMail = jest.fn().mockResolvedValue({ messageId: 'abc' });
  nodemailer.createTransport.mockReturnValue({ sendMail });
});

afterEach(() => { mailer.resetTransport(); });
afterAll(() => { process.env = ORIGINAL_ENV; });

// ─── Building the transport ───────────────────────────────────────────────────

describe('the SMTP transport', () => {
  test('is built from the configured host and port', async () => {
    process.env.SMTP_USER = 'postmaster@example.com';
    process.env.SMTP_PASS = 'hunter2';
    queue();

    await mailer.drainOutbox();
    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com', port: 587, secure: false,
      auth: { user: 'postmaster@example.com', pass: 'hunter2' },
    });
  });

  test('uses an implicit TLS connection on port 465', async () => {
    process.env.SMTP_PORT = '465';
    queue();

    await mailer.drainOutbox();
    expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({ port: 465, secure: true }));
  });

  test('connects anonymously when no user is configured', async () => {
    queue();
    await mailer.drainOutbox();
    expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({ auth: undefined }));
  });

  test('is built once and reused across drains', async () => {
    queue(); await mailer.drainOutbox();
    queue(); await mailer.drainOutbox();
    expect(nodemailer.createTransport).toHaveBeenCalledTimes(1);
  });

  test('resetTransport makes the next drain pick up a changed configuration', async () => {
    queue(); await mailer.drainOutbox();

    mailer.resetTransport();
    process.env.SMTP_HOST = 'smtp2.example.com';
    queue(); await mailer.drainOutbox();

    expect(nodemailer.createTransport).toHaveBeenCalledTimes(2);
    expect(nodemailer.createTransport).toHaveBeenLastCalledWith(
      expect.objectContaining({ host: 'smtp2.example.com' })
    );
  });
});

// ─── Draining ─────────────────────────────────────────────────────────────────

describe('drainOutbox', () => {
  test('an empty outbox does no work and builds no transport', async () => {
    expect(await mailer.drainOutbox()).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(nodemailer.createTransport).not.toHaveBeenCalled();
  });

  test('sends a pending message and marks it sent', async () => {
    const id = queue();

    expect(await mailer.drainOutbox()).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'ray@example.com', subject: 'Sunday roster', text: 'You are leading singing.',
    }));

    const row = db.prepare('SELECT * FROM mail_outbox WHERE id = ?').get(id);
    expect(row).toMatchObject({ status: 'sent', attempts: 1 });
    expect(row.sent_at).toBeTruthy();
  });

  test('sends from the configured address', async () => {
    process.env.MAIL_FROM = 'Capshaw <office@example.org>';
    queue();
    await mailer.drainOutbox();
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: 'Capshaw <office@example.org>' }));
  });

  test('records who a redirected message was really for', async () => {
    queue({ to_email: 'tester@example.com', intended_for: 'ray@example.com' });
    await mailer.drainOutbox();
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'tester@example.com', headers: { 'X-Intended-For': 'ray@example.com' },
    }));
  });

  test('adds no header when a message goes to its real recipient', async () => {
    queue();
    await mailer.drainOutbox();
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ headers: undefined }));
  });

  test('leaves everything pending when no SMTP host is configured', async () => {
    delete process.env.SMTP_HOST;
    mailer.resetTransport();
    const id = queue();

    // Rows stay pending rather than being marked sent, so nothing is lost and
    // they go out once mail is configured.
    expect(await mailer.drainOutbox()).toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect(db.prepare('SELECT status FROM mail_outbox WHERE id = ?').get(id).status).toBe('pending');
    expect(sendMail).not.toHaveBeenCalled();
  });

  test('sends several messages in the order they were queued', async () => {
    queue({ subject: 'First' });
    queue({ subject: 'Second' });

    expect(await mailer.drainOutbox()).toMatchObject({ sent: 2 });
    expect(sendMail.mock.calls.map(([m]) => m.subject)).toEqual(['First', 'Second']);
  });

  test('takes at most the requested number at a time', async () => {
    queue(); queue(); queue();
    expect(await mailer.drainOutbox({ limit: 2 })).toMatchObject({ sent: 2 });
    expect(outbox().filter(r => r.status === 'pending')).toHaveLength(1);
  });

  test('ignores messages that are already sent or given up on', async () => {
    queue({ status: 'sent' });
    queue({ status: 'failed' });

    expect(await mailer.drainOutbox()).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(sendMail).not.toHaveBeenCalled();
  });

  test('a failure is recorded against the row and retried next time', async () => {
    const id = queue();
    sendMail.mockRejectedValue(new Error('mailbox unavailable'));

    expect(await mailer.drainOutbox()).toEqual({ sent: 0, failed: 1, skipped: 0 });
    expect(db.prepare('SELECT * FROM mail_outbox WHERE id = ?').get(id))
      .toMatchObject({ status: 'pending', attempts: 1, error: 'mailbox unavailable' });
  });

  test('a message is given up on after the attempt limit', async () => {
    const id = queue({ attempts: mailer.MAX_ATTEMPTS - 1 });
    sendMail.mockRejectedValue(new Error('mailbox unavailable'));

    await mailer.drainOutbox();
    expect(db.prepare('SELECT * FROM mail_outbox WHERE id = ?').get(id))
      .toMatchObject({ status: 'failed', attempts: mailer.MAX_ATTEMPTS });
  });

  test('a message that has already been given up on is not tried again', async () => {
    queue({ attempts: mailer.MAX_ATTEMPTS });
    expect(await mailer.drainOutbox()).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(sendMail).not.toHaveBeenCalled();
  });

  test('a long error message is truncated rather than stored whole', async () => {
    const id = queue();
    sendMail.mockRejectedValue(new Error('x'.repeat(900)));

    await mailer.drainOutbox();
    expect(db.prepare('SELECT error FROM mail_outbox WHERE id = ?').get(id).error).toHaveLength(500);
  });

  test('one failure does not stop the messages behind it', async () => {
    queue({ subject: 'Fails' });
    queue({ subject: 'Succeeds' });
    sendMail
      .mockRejectedValueOnce(new Error('greylisted'))
      .mockResolvedValueOnce({ messageId: 'ok' });

    expect(await mailer.drainOutbox()).toEqual({ sent: 1, failed: 1, skipped: 0 });
    expect(outbox().map(r => r.status)).toEqual(['pending', 'sent']);
  });
});

// ─── send ─────────────────────────────────────────────────────────────────────

describe('send', () => {
  test('queues the message and delivers it without the caller waiting', async () => {
    const rows = mailer.send({
      to: { name: 'Ray Harris', email: 'ray@example.com' },
      subject: 'Sunday roster', body: 'You are leading singing.', context: 'workflow:1',
    });

    expect(rows).toHaveLength(1);
    // The row exists the moment send returns; delivery happens after
    expect(outbox()).toHaveLength(1);

    await new Promise(process.nextTick);
    expect(sendMail).toHaveBeenCalled();
    expect(db.prepare('SELECT status FROM mail_outbox').get().status).toBe('sent');
  });

  test('a message with no reachable recipient queues nothing and sends nothing', async () => {
    expect(mailer.send({ to: [{ name: 'Jo Harris', email: '' }], subject: 'Hi', body: '' })).toEqual([]);
    await new Promise(process.nextTick);
    expect(outbox()).toEqual([]);
    expect(sendMail).not.toHaveBeenCalled();
  });

  test('a delivery failure does not surface as a rejected promise to the caller', async () => {
    sendMail.mockRejectedValue(new Error('connection refused'));

    expect(() => mailer.send({
      to: { name: 'Ray Harris', email: 'ray@example.com' }, subject: 'Hi', body: '',
    })).not.toThrow();

    await new Promise(process.nextTick);
    await new Promise(process.nextTick);
    expect(db.prepare('SELECT status, attempts FROM mail_outbox').get())
      .toMatchObject({ status: 'pending', attempts: 1 });
  });
});
