const express = require('express');
const router  = express.Router();
const db      = require('../db');
const mailer  = require('../mail/mailer');
const { CATEGORIES, EMAILS, emailFor } = require('../mail/catalog');
const { requireArea } = require('../middleware/auth');
const actionLog = require('../lib/actionLog');

// ─── Emails ───────────────────────────────────────────────────────────────────
//
// Every kind of email the site sends (server/mail/catalog.js), what each says,
// and everything that has actually gone out. Who a message reaches is
// congregation-wide, so this belongs with the Email Groups area — and admins.

router.use(requireArea('mail-groups'));

const PAGE_SIZE = 50;

// A confirmation email carries a link that proves the address — anybody who
// could read it here could confirm somebody else's account. The link is kept
// in the outbox for the mailer; it is never shown back.
function redact(body) {
  return String(body || '').replace(/([?&]token=)[^\s&]+/g, '$1[hidden]');
}

// A WHERE clause matching every message sent by the given catalogue entries.
function contextClause(emails) {
  const likes = emails.flatMap(e => e.like);
  if (!likes.length) return { sql: '0', args: [] };
  return { sql: `(${likes.map(() => 'context LIKE ?').join(' OR ')})`, args: likes };
}

function uncategorisedClause() {
  const { sql, args } = contextClause(EMAILS);
  return { sql: `NOT ${sql}`, args };
}

// ─── GET /api/emails/catalog ──────────────────────────────────────────────────

router.get('/catalog', (req, res) => {
  const statsFor = clause => {
    const row = db.prepare(`
      SELECT
        SUM(CASE WHEN status = 'sent' AND sent_at >= datetime('now', '-30 days') THEN 1 ELSE 0 END) AS sent30,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
        MAX(created_at) AS last
      FROM mail_outbox WHERE ${clause.sql}
    `).get(...clause.args);
    return { sent30: row.sent30 || 0, pending: row.pending || 0, failed: row.failed || 0, last: row.last || null };
  };

  const categories = CATEGORIES.map(category => ({
    ...category,
    emails: EMAILS.filter(e => e.category === category.id).map(e => ({
      id: e.id, name: e.name, audience: e.audience, trigger: e.trigger, ...statsFor(contextClause([e])),
    })),
  }));

  const other = statsFor(uncategorisedClause());
  const { redirectTo } = mailer.config();

  res.json({
    success: true,
    categories,
    uncategorised: other.sent30 + other.pending + other.failed,
    redirect: mailer.isRedirecting() ? redirectTo : null,
  });
});

// ─── GET /api/emails/catalog/:id/preview ──────────────────────────────────────
// The email as its template writes it, filled with made-up details.

router.get('/catalog/:id/preview', (req, res) => {
  const email = EMAILS.find(e => e.id === req.params.id);
  if (!email) return res.status(404).json({ success: false, error: 'No such email' });
  const { subject, body } = email.preview();
  res.json({ success: true, subject, body: redact(body) });
});

// ─── GET /api/emails/history ──────────────────────────────────────────────────
// ?category=  ?email=  ?status=  ?q=  ?page=

router.get('/history', (req, res) => {
  const where = [];
  const args = [];
  const add = ({ sql, args: a }) => { where.push(sql); args.push(...a); };

  const { category, email, status, q } = req.query;
  if (email) {
    const one = EMAILS.find(e => e.id === email);
    if (!one) return res.status(400).json({ success: false, error: 'No such email' });
    add(contextClause([one]));
  } else if (category === 'other') {
    add(uncategorisedClause());
  } else if (category) {
    if (!CATEGORIES.some(c => c.id === category)) return res.status(400).json({ success: false, error: 'No such category' });
    add(contextClause(EMAILS.filter(e => e.category === category)));
  }
  if (status) {
    if (!['pending', 'sent', 'failed'].includes(status)) return res.status(400).json({ success: false, error: 'No such status' });
    add({ sql: 'status = ?', args: [status] });
  }
  if (q && String(q).trim()) {
    const like = `%${String(q).trim()}%`;
    add({ sql: '(subject LIKE ? OR to_email LIKE ? OR to_name LIKE ? OR intended_for LIKE ?)', args: [like, like, like, like] });
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM mail_outbox ${whereSql}`).get(...args).n;
  const rows = db.prepare(`
    SELECT id, to_email, to_name, intended_for, subject, context, status, attempts, error, created_at, sent_at
      FROM mail_outbox ${whereSql}
     ORDER BY id DESC LIMIT ? OFFSET ?
  `).all(...args, PAGE_SIZE, (page - 1) * PAGE_SIZE);

  const messages = rows.map(({ context, ...row }) => {
    const kind = emailFor(context);
    return { ...row, emailId: kind?.id || null, emailName: kind?.name || 'Other', category: kind?.category || 'other' };
  });

  res.json({ success: true, messages, total, page, pageSize: PAGE_SIZE });
});

// ─── GET /api/emails/history/:id ──────────────────────────────────────────────

router.get('/history/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM mail_outbox WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ success: false, error: 'No such message' });
  const kind = emailFor(row.context);
  const { context, ...message } = row;
  res.json({
    success: true,
    message: { ...message, body: redact(row.body), emailId: kind?.id || null, emailName: kind?.name || 'Other', category: kind?.category || 'other' },
  });
});

// ─── POST /api/emails/send-now ────────────────────────────────────────────────
// Try the waiting mail now rather than at the next sweep.

router.post('/send-now', async (req, res) => {
  try {
    const result = await mailer.drainOutbox({ limit: 50 });
    actionLog.record(req.user, {
      area:    'mail-groups',
      action:  'other',
      entity:  'outbox',
      summary: `Sent the waiting email queue (${result.sent ?? 0} sent, ${result.failed ?? 0} failed)`,
      details: result,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
