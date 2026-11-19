// ─── My week ──────────────────────────────────────────────────────────────────
//
// One person's own fortnight in one place. The gathering lives in
// lib/myWeek.js, which the weekly "Your week" email (mail/myWeek.js) shares.
const express = require('express');
const router  = express.Router();
const { requireAuth } = require('../middleware/auth');
const { weekFor } = require('../lib/myWeek');
// Read through the module, so a test can say what day it is.
const recordKeeping = require('../lib/recordKeeping');

router.use(requireAuth);

// GET /api/my-week — everything above, in date order.
router.get('/', (req, res) => {
  res.json({ success: true, ...weekFor(req.user, { from: recordKeeping.churchToday() }) });
});

module.exports = router;
