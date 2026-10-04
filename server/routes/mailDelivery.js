const express = require('express');
const router  = express.Router();
const delivery = require('../mail/delivery');
const mailer = require('../mail/mailer');
const { requireAdmin } = require('../middleware/auth');
const actionLog = require('../lib/actionLog');

// ─── Email Delivery ───────────────────────────────────────────────────────────
//
// Which roles and people get their own mail while the site is in test mode
// (server/mail/delivery.js). Admins only: this decides whether a real person
// is written to, which is the one thing test mode exists to stop happening by
// accident. Every change is in the action history.

router.use(requireAdmin);

const bad = (res, error, code = 400) => res.status(code).json({ success: false, error });
const state = () => delivery.overview({ redirectTo: mailer.config().redirectTo });

router.get('/', (req, res) => {
  res.json({ success: true, ...state() });
});

// ─── PUT /api/mail-delivery/roles/:key  { deliver: true | false } ─────────────

router.put('/roles/:key', (req, res) => {
  const deliver = req.body?.deliver;
  if (typeof deliver !== 'boolean') return bad(res, 'Say whether to send for real or keep redirecting');
  const result = delivery.setRole(req.params.key, deliver, req.user);
  if (result.error) return bad(res, result.error, 404);
  const label = delivery.roles().find(r => r.key === req.params.key).label;
  actionLog.record(req.user, {
    area: '', action: 'update', entity: 'email delivery', entityId: `role:${req.params.key}`,
    summary: deliver ? `Let ${label} receive their own email in test mode` : `Put ${label} back to the test-mode redirect`,
    details: result,
  });
  res.json({ success: true, ...state() });
});

// ─── PUT /api/mail-delivery/people  { email, name, deliver } ──────────────────
// ─── DELETE /api/mail-delivery/people?email= ──────────────────────────────────

router.put('/people', (req, res) => {
  const result = delivery.setPerson(req.body || {}, req.user);
  if (result.error) return bad(res, result.error);
  const who = result.name ? `${result.name} <${result.email}>` : result.email;
  actionLog.record(req.user, {
    area: '', action: 'update', entity: 'email delivery', entityId: `person:${result.email}`,
    summary: result.deliver ? `Let ${who} receive their own email in test mode` : `Kept ${who} on the test-mode redirect`,
    details: result,
  });
  res.json({ success: true, ...state() });
});

router.delete('/people', (req, res) => {
  const result = delivery.removePerson(req.query.email);
  if (result.error) return bad(res, result.error, 404);
  actionLog.record(req.user, {
    area: '', action: 'delete', entity: 'email delivery', entityId: `person:${result.removed.key}`,
    summary: `Cleared ${result.removed.label || result.removed.key}'s own email delivery setting`,
    details: result.removed,
  });
  res.json({ success: true, ...state() });
});

module.exports = router;
