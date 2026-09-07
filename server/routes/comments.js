const express = require('express');
const router  = express.Router();
const comments = require('../lib/comments');
const mailer   = require('../mail/mailer');
const { requireAuth, requireApproved } = require('../middleware/auth');

// Announcements themselves are readable by anyone; the conversation under them
// is the congregation talking to itself, so it takes a sign-in to read and an
// approved member to write.
router.use(requireAuth);

function fail(res, result) {
  return res.status(result.status || 400).json({ success: false, error: result.error });
}

// Sending happens after the write has committed, so a failed comment sends
// nothing and a slow mail server never holds the request open.
function flushMail() {
  mailer.drainOutbox().catch(err => console.error('[mail] drain failed:', err.message));
}

// ─── GET /api/comments/:subjectType/counts ────────────────────────────────────
// How many comments each item has, so a list of announcements can show the
// count on every card without a request per card. Declared before the route
// below, or "counts" would be read as a subject id.

router.get('/:subjectType/counts', (req, res) => {
  const { subjectType } = req.params;
  if (!comments.SUBJECT_TYPES.includes(subjectType)) {
    return res.status(404).json({ success: false, error: 'Unknown subject type' });
  }

  const ids = String(req.query.ids || '')
    .split(',')
    .map(Number)
    .filter(Number.isInteger)
    .slice(0, 200);

  res.json({ success: true, counts: comments.countsFor(subjectType, ids) });
});

// ─── GET /api/comments/:subjectType/:subjectId ────────────────────────────────

router.get('/:subjectType/:subjectId', (req, res) => {
  const { subjectType, subjectId } = req.params;
  const subject = comments.subject(subjectType, subjectId);
  if (!subject) return res.status(404).json({ success: false, error: 'There is nothing here to comment on' });

  res.json({
    success: true,
    subject: { id: subject.id, type: subject.type, title: subject.title },
    comments: comments.list(subjectType, subject.id, req.user),
    subscription: comments.subscriptionState(subjectType, subject.id, req.user.id),
    canComment: req.user.role !== 'pending',
  });
});

// ─── POST /api/comments/:subjectType/:subjectId ───────────────────────────────

router.post('/:subjectType/:subjectId', requireApproved, (req, res) => {
  const result = comments.add({
    subjectType: req.params.subjectType,
    subjectId:   req.params.subjectId,
    user:        req.user,
    body:        req.body?.body,
    parentId:    req.body?.parentId ?? null,
  });
  if (result.error) return fail(res, result);

  flushMail();
  res.json({ success: true, comment: result.comment });
});

// ─── PATCH /api/comments/:id ──────────────────────────────────────────────────

router.patch('/:id', requireApproved, (req, res) => {
  const result = comments.edit({ id: req.params.id, user: req.user, body: req.body?.body });
  if (result.error) return fail(res, result);
  res.json({ success: true, comment: result.comment });
});

// ─── DELETE /api/comments/:id ─────────────────────────────────────────────────

router.delete('/:id', requireApproved, (req, res) => {
  const result = comments.remove({ id: req.params.id, user: req.user });
  if (result.error) return fail(res, result);
  res.json({ success: true, id: result.id });
});

// ─── PUT /api/comments/:subjectType/:subjectId/subscription ───────────────────
// Follow or mute one thread, whatever the account-wide comment settings say.

router.put('/:subjectType/:subjectId/subscription', (req, res) => {
  const subject = comments.subject(req.params.subjectType, req.params.subjectId);
  if (!subject) return res.status(404).json({ success: false, error: 'There is nothing here to follow' });

  const result = comments.setSubscription(req.params.subjectType, subject.id, req.user.id, req.body?.state);
  if (result.error) return fail(res, result);
  res.json({ success: true, subscription: result.state });
});

module.exports = router;
