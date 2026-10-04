const express = require('express');
const router  = express.Router();
const participation = require('../lib/participation');
const { requireArea } = require('../middleware/auth');
const actionLog = require('../lib/actionLog');

// ─── Worship Participation ────────────────────────────────────────────────────
//
// Who actually served in the worship jobs (server/lib/participation.js). For
// whoever keeps the serving schedule, and admins: how often each man has been
// relied on is not something for the whole congregation to read.
//
// Checking one slot is not written to the action history (a Sunday is half a
// dozen of them, and each check carries who made it and when); marking a whole
// service as served as scheduled is.

router.use(requireArea('serving-schedule'));

const bad = (res, error, code = 400) => res.status(code).json({ success: false, error });

// ─── GET /api/participation/services?weeks=13 ─────────────────────────────────
// The services that have happened, newest first, and who could have served.

router.get('/services', (req, res) => {
  res.json({ success: true, services: participation.services({ weeks: req.query.weeks }), servers: participation.servers() });
});

// ─── GET /api/participation/service?date=&service= ────────────────────────────

router.get('/service', (req, res) => {
  const result = participation.service({ date: String(req.query.date || ''), service: String(req.query.service || '') });
  if (result.error) return bad(res, result.error, 404);
  res.json({ success: true, ...result });
});

// ─── PUT /api/participation/check ─────────────────────────────────────────────
// { date, service, job, position, outcome: served | substitute | missed | null,
//   servedName, note }

router.put('/check', (req, res) => {
  const result = participation.record(req.body || {}, req.user);
  if (result.error) return bad(res, result.error);
  res.json({ success: true, check: result.check });
});

// ─── POST /api/participation/served ───────────────────────────────────────────
// { date, service } — every filled slot not yet checked went as scheduled.

router.post('/served', (req, res) => {
  const { date, service } = req.body || {};
  const result = participation.recordAllServed({ date: String(date || ''), service: String(service || '') }, req.user);
  if (result.error) return bad(res, result.error);
  actionLog.record(req.user, {
    area: 'serving-schedule', action: 'update', entity: 'worship participation', entityId: `${date}|${service}`,
    summary: `Marked ${result.count} ${result.count === 1 ? 'job' : 'jobs'} at ${service} on ${date} as served as scheduled`,
    details: { date, service, count: result.count },
  });
  res.json({ success: true, count: result.count });
});

// ─── Analysis ─────────────────────────────────────────────────────────────────
// ?weeks=26&role=&checkedOnly=true

const options = q => ({ weeks: q.weeks, role: String(q.role || ''), checkedOnly: q.checkedOnly === 'true' });

router.get('/analysis', (req, res) => {
  res.json({ success: true, ...participation.analysis(options(req.query)), servers: participation.servers() });
});

router.get('/person', (req, res) => {
  const result = participation.person({ name: req.query.name, personId: req.query.personId }, options(req.query));
  if (result.error) return bad(res, result.error, 404);
  res.json({ success: true, ...result });
});

module.exports = router;
