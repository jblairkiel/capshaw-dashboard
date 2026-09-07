const express = require('express');
const router  = express.Router();
const notifications = require('../notifications');
const preferences   = require('../notifications/preferences');
const { CATEGORIES } = require('../notifications/types');
const { requireAuth } = require('../middleware/auth');

// An inbox is always somebody's.
router.use(requireAuth);

// ─── GET /api/notifications ───────────────────────────────────────────────────
// The inbox, newest first. ?category= narrows it to one drawer, ?type= to one
// kind, ?unread=1 to what has not been read yet.

router.get('/', (req, res) => {
  const items = notifications.inbox(req.user, {
    category: String(req.query.category || ''),
    type:     String(req.query.type || ''),
    unread:   req.query.unread === '1' || req.query.unread === 'true',
    limit:    Number(req.query.limit) || 50,
    before:   Number(req.query.before) || null,
  });

  const summary = notifications.summary(req.user);

  res.json({
    success: true,
    items,
    summary,
    // The drawers, with their counts, so the inbox can be drawn from one trip.
    categories: CATEGORIES.map(category => ({
      ...category,
      total:  summary.categories[category.id]?.total  || 0,
      unread: summary.categories[category.id]?.unread || 0,
    })),
  });
});

// ─── GET /api/notifications/summary ───────────────────────────────────────────
// Just the counts — what the header badge polls for.

router.get('/summary', (req, res) => {
  res.json({ success: true, summary: notifications.summary(req.user) });
});

// ─── POST /api/notifications/read ─────────────────────────────────────────────
// { ids: [1,2] } marks those, { category: 'comments' } marks that drawer,
// neither marks the lot. read: false puts one back to unread.

router.post('/read', (req, res) => {
  const { changed } = notifications.markRead(req.user, {
    ids:      Array.isArray(req.body?.ids) ? req.body.ids : null,
    category: String(req.body?.category || ''),
    read:     req.body?.read !== false,
  });
  res.json({ success: true, changed, summary: notifications.summary(req.user) });
});

// ─── GET /api/notifications/preferences ───────────────────────────────────────
// The whole catalogue with this person's answers filled in, so the settings
// screen never has to know what types exist.

router.get('/preferences', (req, res) => {
  res.json({ success: true, settings: preferences.settingsFor(req.user) });
});

// ─── PUT /api/notifications/preferences ───────────────────────────────────────
// Partial: only what is named is changed.

router.put('/preferences', (req, res) => {
  const result = preferences.save(req.user, req.body || {});
  if (result.error) return res.status(400).json({ success: false, error: result.error });
  res.json({ success: true, settings: result.settings });
});

module.exports = router;
