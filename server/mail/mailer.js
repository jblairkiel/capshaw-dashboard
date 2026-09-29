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

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const db     = require('../db');
const paths  = require('../lib/paths');

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

// ─── Attachments ──────────────────────────────────────────────────────────────
//
// A file to send is written once, named by its content, and every queued copy
// of the message points at it — a newsletter to a hundred people is one PDF on
// disk, not a hundred. The row keeps the name the recipient sees separately
// from the stored name, which is only ever a hash.

const ATTACHMENT_NAME = /^[a-f0-9]{64}\.[a-z0-9]{1,5}$/;

function saveAttachment({ buffer, filename, contentType }) {
  const ext  = (path.extname(String(filename || '')).slice(1).toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin').slice(0, 5);
  const file = `${crypto.createHash('sha256').update(buffer).digest('hex')}.${ext}`;
  fs.mkdirSync(paths.mailAttachments, { recursive: true });
  const target = path.join(paths.mailAttachments, file);
  if (!fs.existsSync(target)) fs.writeFileSync(target, buffer);
  return { file, filename: path.basename(String(filename || file)), contentType: contentType || 'application/octet-stream' };
}

// Where a stored attachment is, or null for anything that is not a name this
// module wrote — the column is data, and never a way to reach another file.
function attachmentPath(file) {
  const name = path.basename(String(file || ''));
  return ATTACHMENT_NAME.test(name) ? path.join(paths.mailAttachments, name) : null;
}

function attachmentsOf(row) {
  try {
    const list = JSON.parse(row.attachments || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

// ─── Queueing ─────────────────────────────────────────────────────────────────

function validAddress(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

// Queues one message per recipient. Returns the rows created, so a caller (or
// a test) can see exactly what was queued without touching a mail server.
function enqueue({ to, subject, body, context = '', attachments = [] }) {
  const { redirectTo } = config();
  const recipients = (Array.isArray(to) ? to : [to]).filter(r => validAddress(r?.email));

  // One row per address, deduped: being in three groups should not mean
  // three copies of the same message.
  const seen = new Set();
  const rows = [];

  const insert = db.prepare(`
    INSERT INTO mail_outbox (to_email, to_name, intended_for, subject, body, context, attachments)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const attached = JSON.stringify(attachments.map(({ file, filename, contentType }) => ({ file, filename, contentType })));

  for (const recipient of recipients) {
    const email = recipient.email.trim().toLowerCase();
    if (seen.has(email)) continue;
    seen.add(email);

    const deliverTo   = redirectTo || email;
    const intendedFor = redirectTo ? email : '';
    const finalBody   = redirectTo ? redirectNotice(email, recipient.name) + body : body;

    const { lastInsertRowid: id } = insert.run(
      deliverTo, recipient.name || '', intendedFor, subject, finalBody, context, attached
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
      const attachments = attachmentsOf(row).map(a => {
        const file = attachmentPath(a.file);
        if (!file || !fs.existsSync(file)) throw new Error(`The attachment ${a.filename || ''} is missing`);
        return { filename: a.filename, contentType: a.contentType, path: file };
      });
      await mail.sendMail({
        from,
        to: row.to_email,
        subject: row.subject,
        text: row.body,
        attachments: attachments.length ? attachments : undefined,
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
  saveAttachment, attachmentPath, attachmentsOf,
};
