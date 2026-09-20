const express = require('express');
const router  = express.Router();

const notifications = require('../lib/notifications');
const { requireAuth } = require('../middleware/auth');

// ─── Notifications ────────────────────────────────────────────────────────────
//
// Everything here is about the account asking, and only about that account:
// the user id is taken from the session rather than from the request, and the
// ids a request names are matched against it in the WHERE clause, so there is
// no way to read or clear somebody else's bell.

router.use(requireAuth);

// ─── GET /api/notifications ───────────────────────────────────────────────────

router.get('/', (req, res) => {
  res.json({
    success: true,
    notifications: notifications.listFor(req.user.id, {
      limit:      req.query.limit,
      unreadOnly: req.query.unread === '1',
    }),
    unread: notifications.unreadCount(req.user.id),
  });
});

// ─── GET /api/notifications/count ─────────────────────────────────────────────
// What the bell polls for: one number, and nothing else to render.

router.get('/count', (req, res) => {
  res.json({ success: true, unread: notifications.unreadCount(req.user.id) });
});

// ─── POST /api/notifications/read ─────────────────────────────────────────────
// A list of ids, or nothing at all to mean "all of them" — which is what the
// "mark everything read" button sends.

router.post('/read', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
  const marked = ids ? notifications.markRead(req.user.id, ids) : notifications.markAllRead(req.user.id);
  res.json({ success: true, marked, unread: notifications.unreadCount(req.user.id) });
});

module.exports = router;
