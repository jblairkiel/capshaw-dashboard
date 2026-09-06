// ─── Outgoing mail ────────────────────────────────────────────────────────────
// Messages are queued in mail_outbox and sent from there, so a slow or
// unreachable mail server never blocks the request that caused it, and there
// is always a record of what the site tried to send.
//
// While MAIL_REDIRECT_TO is set, every message is delivered to that one
// address instead of its real recipient, with the intended recipient kept on
// the row and written into the body. That is deliberately the default: it
// means a mistake in a workflow, a group, or a test cannot mail the
// congregation. Clearing MAIL_REDIRECT_TO is the single, explicit step that
// makes this site able to write to real people.

const db = require('../db');

const MAX_ATTEMPTS = 3;

function config() {
  return {
    host:       process.env.SMTP_HOST || '',
    port:       Number(process.env.SMTP_PORT || 587),
    user:       process.env.SMTP_USER || '',
    pass:       process.env.SMTP_PASS || '',
    from:       process.env.MAIL_FROM || 'Capshaw Dashboard <jblairkiel@gmail.com>',
    // Default on, not off: real delivery has to be opted into.
    redirectTo: process.env.MAIL_REDIRECT_TO ?? 'jblairkiel@gmail.com',
  };
}

function isConfigured() {
  const { host } = config();
  return !!host;
}

function isRedirecting() {
  return !!config().redirectTo;
}

// ─── Queueing ─────────────────────────────────────────────────────────────────

function validAddress(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

// Queues one message per recipient. Returns the rows created, so a caller (or
// a test) can see exactly what was queued without touching a mail server.
function enqueue({ to, subject, body, context = '' }) {
  const { redirectTo } = config();
  const recipients = (Array.isArray(to) ? to : [to]).filter(r => validAddress(r?.email));

  // One row per address, deduped: being in three groups should not mean
  // three copies of the same message.
  const seen = new Set();
  const rows = [];

  const insert = db.prepare(`
    INSERT INTO mail_outbox (to_email, to_name, intended_for, subject, body, context)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const recipient of recipients) {
    const email = recipient.email.trim().toLowerCase();
    if (seen.has(email)) continue;
    seen.add(email);

    const deliverTo   = redirectTo || email;
    const intendedFor = redirectTo ? email : '';
    const finalBody   = redirectTo ? redirectNotice(email, recipient.name) + body : body;

    const { lastInsertRowid: id } = insert.run(
      deliverTo, recipient.name || '', intendedFor, subject, finalBody, context
    );
    rows.push(db.prepare('SELECT * FROM mail_outbox WHERE id = ?').get(id));
  }

  return rows;
}

function redirectNotice(email, name) {
  return [
    '[TEST MODE] This message was not sent to its real recipient.',
    `It was addressed to: ${name ? `${name} <${email}>` : email}`,
    'Clear MAIL_REDIRECT_TO in the environment to deliver to real recipients.',
    '',
    '─────────────────────────────────────────',
    '',
  ].join('\n');
}

// ─── Sending ──────────────────────────────────────────────────────────────────

let _transport = null;

function transport() {
  if (_transport) return _transport;
  const { host, port, user, pass } = config();
  if (!host) return null;

  // Required lazily so the app runs, and the outbox still fills, on an
  // install that has never configured mail.
  const nodemailer = require('nodemailer');
  _transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: user ? { user, pass } : undefined,
  });
  return _transport;
}

// For tests: forget any transport built from earlier environment variables.
function resetTransport() {
  _transport = null;
}

// Sends what is waiting. Safe to call often — it takes only pending rows that
// have not already been tried too many times.
async function drainOutbox({ limit = 25 } = {}) {
  const pending = db.prepare(`
    SELECT * FROM mail_outbox
    WHERE status = 'pending' AND attempts < ?
    ORDER BY id ASC LIMIT ?
  `).all(MAX_ATTEMPTS, limit);

  if (!pending.length) return { sent: 0, failed: 0, skipped: 0 };

  const mail = transport();
  if (!mail) {
    // Nothing configured: leave the rows pending rather than marking them
    // sent, so nothing is silently lost and they go out once mail is set up.
    console.log(`[mail] ${pending.length} message(s) queued; SMTP_HOST is not set so none were sent`);
    return { sent: 0, failed: 0, skipped: pending.length };
  }

  const { from } = config();
  let sent = 0, failed = 0;

  for (const row of pending) {
    try {
      await mail.sendMail({
        from,
        to: row.to_email,
        subject: row.subject,
        text: row.body,
        headers: row.intended_for ? { 'X-Intended-For': row.intended_for } : undefined,
      });
      db.prepare("UPDATE mail_outbox SET status = 'sent', sent_at = datetime('now'), attempts = attempts + 1 WHERE id = ?")
        .run(row.id);
      sent++;
    } catch (err) {
      const attempts = row.attempts + 1;
      db.prepare('UPDATE mail_outbox SET attempts = ?, error = ?, status = ? WHERE id = ?')
        .run(attempts, String(err.message).slice(0, 500), attempts >= MAX_ATTEMPTS ? 'failed' : 'pending', row.id);
      failed++;
      console.error(`[mail] send failed (attempt ${attempts}):`, err.message);
    }
  }

  return { sent, failed, skipped: 0 };
}

// Queue and then try to send, without making the caller wait on the network.
function send(message) {
  const rows = enqueue(message);
  if (rows.length) drainOutbox().catch(err => console.error('[mail] drain failed:', err.message));
  return rows;
}

module.exports = {
  config, isConfigured, isRedirecting, validAddress,
  enqueue, send, drainOutbox, resetTransport, MAX_ATTEMPTS,
};
