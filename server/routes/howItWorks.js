const express = require('express');
const router  = express.Router();

const docs = require('../lib/howItWorks');
const { renderHowItWorks } = require('../lib/howItWorksPdf');

// ─── How It Works ─────────────────────────────────────────────────────────────
//
// The portal's documentation (server/lib/howItWorks.js), for the page and as
// a PDF. Everybody signed in reads the sections for everyone; the admin
// sections are only ever sent to an admin.

router.get('/', (req, res) => {
  res.json({ success: true, admin: docs.isAdmin(req.user), sections: docs.sectionsFor(req.user) });
});

router.get('/pdf', async (req, res) => {
  const admin = docs.isAdmin(req.user);
  try {
    const pdf = await renderHowItWorks({ sections: docs.sectionsFor(req.user), admin });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="capshaw-how-it-works${admin ? '-admin' : ''}.pdf"`);
    res.send(pdf);
  } catch (err) {
    console.error('[how-it-works] could not build the PDF:', err.message);
    res.status(500).json({ success: false, error: 'The PDF could not be built. Please try again.' });
  }
});

module.exports = router;
