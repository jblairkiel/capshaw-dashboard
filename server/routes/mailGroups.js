const express = require('express');
const router  = express.Router();
const db      = require('../db');
const groups  = require('../mail/groups');
const mailer  = require('../mail/mailer');
const { requireArea } = require('../middleware/auth');
const actionLog = require('../lib/actionLog');

// Who a message reaches is congregation-wide, so this belongs to whoever looks
// after the email groups — and to admins, who look after everything.
router.use(requireArea('mail-groups'));

// ─── GET /api/mail/groups ─────────────────────────────────────────────────────

router.get('/groups', (req, res) => {
  const list = groups.listGroups().map(group => {
    const { recipients, missing } = groups.recipientsFor(group.key);
    return {
      id: group.id,
      key: group.key,
      name: group.name,
      description: group.description,
      memberCount: group.member_count,
      // What a message would actually reach, versus who is on the list —
      // the gap is people with no address on file.
      reachable: recipients.length,
      missing,
    };
  });

  res.json({
    success: true,
    groups: list,
    mail: {
      configured:  mailer.isConfigured(),
      redirecting: mailer.isRedirecting(),
      redirectTo:  mailer.config().redirectTo,
      from:        mailer.config().from,
    },
  });
});

// ─── GET /api/mail/groups/:key ────────────────────────────────────────────────

router.get('/groups/:key', (req, res) => {
  const group = groups.getGroup(req.params.key);
  if (!group) return res.status(404).json({ success: false, error: 'No such group' });

  res.json({
    success: true,
    group: { id: group.id, key: group.key, name: group.name, description: group.description },
    members: groups.membersOf(group.id),
    // Directory people who could be added, with an address on file.
    candidates: db.prepare(`
      SELECT id, name, email FROM directory
      WHERE trim(email) <> '' ORDER BY name ASC LIMIT 500
    `).all(),
  });
});

// ─── POST /api/mail/groups/:key/members ───────────────────────────────────────

router.post('/groups/:key/members', (req, res) => {
  const group = groups.getGroup(req.params.key);
  if (!group) return res.status(404).json({ success: false, error: 'No such group' });

  const directoryId = req.body?.directoryId ? Number(req.body.directoryId) : null;
  const result = groups.addMember(group.id, { directoryId, email: req.body?.email || '' });
  if (result.error) return res.status(400).json({ success: false, error: result.error });

  actionLog.record(req.user, {
    area:     'mail-groups',
    action:   'create',
    entity:   'email group member',
    entityId: group.key,
    summary:  `Added ${req.body?.email || `directory member #${directoryId}`} to the ${group.name} group`,
    details:  { group: group.key, directoryId, email: req.body?.email || '' },
  });
  res.json({ success: true, members: groups.membersOf(group.id) });
});

// ─── DELETE /api/mail/groups/:key/members/:memberId ───────────────────────────

router.delete('/groups/:key/members/:memberId', (req, res) => {
  const group = groups.getGroup(req.params.key);
  if (!group) return res.status(404).json({ success: false, error: 'No such group' });

  const removed = groups.membersOf(group.id).find(m => String(m.id) === String(req.params.memberId));
  const result  = groups.removeMember(group.id, Number(req.params.memberId));
  if (result.error) return res.status(404).json({ success: false, error: result.error });

  actionLog.record(req.user, {
    area:     'mail-groups',
    action:   'delete',
    entity:   'email group member',
    entityId: group.key,
    summary:  `Removed ${removed?.name || removed?.email || 'somebody'} from the ${group.name} group`,
    details:  { group: group.key, member: removed || null },
  });
  res.json({ success: true, members: groups.membersOf(group.id) });
});

// ─── GET /api/mail/outbox ─────────────────────────────────────────────────────
// What the site has tried to send, so a missing notification can be chased
// without server access.

router.get('/outbox', (req, res) => {
  const messages = db.prepare(`
    SELECT id, to_email, to_name, intended_for, subject, context, status, attempts, error, created_at, sent_at
    FROM mail_outbox ORDER BY id DESC LIMIT 100
  `).all();

  const counts = db.prepare('SELECT status, COUNT(*) AS n FROM mail_outbox GROUP BY status').all()
    .reduce((acc, row) => ({ ...acc, [row.status]: row.n }), {});

  res.json({ success: true, messages, counts });
});

// ─── POST /api/mail/outbox/send ───────────────────────────────────────────────
// Try the queue now rather than waiting for the next sweep.

router.post('/outbox/send', async (req, res) => {
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
