// ─── Waiting for approval ─────────────────────────────────────────────────────
// What somebody signed in but not yet approved can read: who the admins are,
// so they can ask to be let in sooner. The admins are emailed about every new
// account on their own (mail/accounts.js); this is for the person who would
// rather not wait. Only a name and an email address are given out — this is
// read by people the church has not met yet.
const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// GET /api/welcome/contacts
router.get('/contacts', (req, res) => {
  const admins = db.prepare(`
    SELECT name, email FROM users
     WHERE role = 'admin' AND trim(coalesce(name, '')) <> ''
     ORDER BY name COLLATE NOCASE
  `).all().map(a => ({ name: a.name, email: (a.email || '').trim() || null }));
  res.json({
    success: true,
    approved: req.user.role !== 'pending',
    you: { name: req.user.name, email: req.user.email || null, provider: req.user.provider },
    admins,
  });
});

module.exports = router;
