const express = require('express');
const router  = express.Router();
const participation = require('../lib/participation');
const { requireArea } = require('../middleware/auth');

// ─── Worship Participation ────────────────────────────────────────────────────
//
// Who has served in the worship jobs, and what each man has said he will do
// (server/lib/participation.js). For whoever keeps the serving schedule, and
// admins: how often each man has been relied on is not something for the
// whole congregation to read. Everything here is read-only; the schedule is
// changed on the Serving Schedule, and preferences on the Service Roster.

router.use(requireArea('serving-schedule'));

// ?weeks=26&role=
const options = q => ({ weeks: q.weeks, role: String(q.role || '') });

router.get('/analysis', (req, res) => {
  res.json({ success: true, ...participation.analysis(options(req.query)), servers: participation.servers() });
});

router.get('/person', (req, res) => {
  const result = participation.person({ name: req.query.name, personId: req.query.personId }, options(req.query));
  if (result.error) return res.status(404).json({ success: false, error: result.error });
  res.json({ success: true, ...result });
});

router.get('/preferences', (req, res) => {
  res.json({ success: true, ...participation.preferences(options(req.query)) });
});

module.exports = router;
