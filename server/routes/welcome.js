// ─── Waiting for approval ─────────────────────────────────────────────────────
// What somebody signed in but not yet approved can read: who the admins are,
// so they can ask to be let in sooner. The admins are emailed about every new
// account on their own (mail/accounts.js); this is for the person who would
// rather not wait. Only a name and a cellphone number (from the admin's
// directory entry) are given out — this is read by people the church has not
// met yet.
const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// GET /api/welcome/contacts
router.get('/contacts', (req, res) => {
  const admins = db.prepare(`
    SELECT u.name, d.cell FROM users u
      LEFT JOIN directory d ON d.id = u.directory_id
     WHERE u.role = 'admin' AND trim(coalesce(u.name, '')) <> ''
     ORDER BY u.name COLLATE NOCASE
  `).all().map(a => ({ name: a.name, cell: (a.cell || '').trim() || null }));
  res.json({
    success: true,
    approved: req.user.role !== 'pending',
    you: { name: req.user.name, email: req.user.email || null, provider: req.user.provider },
    admins,
  });
});

module.exports = router;
