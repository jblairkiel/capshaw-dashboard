// POST /api/usage/page { page } — a member opened a page of the portal. Counted
// for the weekly reports (lib/portalUsage.js); answers 204 either way, since
// the page never waits on it.
const express = require('express');
const router = express.Router();
const usage = require('../lib/portalUsage');

router.post('/page', (req, res) => {
  try { usage.recordPage(req.user, req.body?.page); } catch (err) { console.error('[usage] could not count a page:', err.message); }
  res.status(204).end();
});

module.exports = router;
