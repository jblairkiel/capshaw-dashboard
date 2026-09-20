const express = require('express');
const router  = express.Router();

const comments  = require('../lib/eventComments');
const actionLog = require('../lib/actionLog');
const { requireAuth, requireApproved } = require('../middleware/auth');

// ─── Comments on events ───────────────────────────────────────────────────────
//
// One router for every kind of event, because the thread is the same thing
// wherever it hangs: /api/comments/:subjectType/:subjectId. Which kinds exist,
// and who may read or write each, is server/lib/eventComments.js — nothing
// here branches on the kind.

router.use(requireAuth);

// ─── GET /api/comments/:subjectType/:subjectId ────────────────────────────────

router.get('/:subjectType/:subjectId', (req, res) => {
  const found = comments.resolve(req.params.subjectType, req.params.subjectId);
  if (found.error) return res.status(404).json({ success: false, error: found.error });

  const { kind, subject } = found;
  if (!kind.canRead(req.user, subject)) {
    return res.status(403).json({ success: false, error: 'That is not yours to read' });
  }

  res.json({
    success:  true,
    comments: comments.listComments(req.params.subjectType, subject.id, req.user),
    canReply: kind.canReply(req.user, subject),
    canModerate: kind.canModerate(req.user, subject),
    maxLength: comments.MAX_LENGTH,
  });
});

// ─── POST /api/comments/:subjectType/:subjectId ───────────────────────────────

router.post('/:subjectType/:subjectId', requireApproved, (req, res) => {
  const result = comments.addComment(req.params.subjectType, req.params.subjectId, req.user, req.body?.body);
  if (result.error) {
    return res.status(result.status || 400).json({ success: false, error: result.error });
  }

  actionLog.record(req.user, {
    area:     req.params.subjectType === 'group-event' ? 'church-groups' : 'announcements',
    action:   'create',
    entity:   'comment',
    entityId: result.comment.id,
    summary:  `Replied on "${result.kind.title(result.subject)}"`,
    details:  { subjectType: req.params.subjectType, subjectId: result.subject.id },
  });

  res.json({
    success:  true,
    comments: comments.listComments(req.params.subjectType, result.subject.id, req.user),
  });
});

// ─── PUT /api/comments/:commentId ─────────────────────────────────────────────
// Only ever your own words. A leader can take a comment down; nobody can
// change what somebody else said.

router.put('/:commentId', requireApproved, (req, res) => {
  const result = comments.editComment(Number(req.params.commentId), req.user, req.body?.body);
  if (result.error) return res.status(result.status || 400).json({ success: false, error: result.error });

  res.json({
    success:  true,
    comments: comments.listComments(result.comment.subject_type, result.comment.subject_id, req.user),
  });
});

// ─── DELETE /api/comments/:commentId ──────────────────────────────────────────

router.delete('/:commentId', requireApproved, (req, res) => {
  const result = comments.deleteComment(Number(req.params.commentId), req.user);
  if (result.error) return res.status(result.status || 400).json({ success: false, error: result.error });

  if (result.byModerator) {
    actionLog.record(req.user, {
      area:     result.comment.subject_type === 'group-event' ? 'church-groups' : 'announcements',
      action:   'delete',
      entity:   'comment',
      entityId: result.comment.id,
      summary:  `Removed a comment by ${result.comment.author_name || 'somebody'}`,
      before:   result.comment,
    });
  }

  res.json({
    success:  true,
    comments: comments.listComments(result.comment.subject_type, result.comment.subject_id, req.user),
  });
});

module.exports = router;
