const express = require('express');
const path    = require('path');
const router  = express.Router();
const attendance = require('../lib/memberAttendance');
const photoStore = require('../lib/photoStore');
const { requireArea } = require('../middleware/auth');
const actionLog = require('../lib/actionLog');

// ─── Member Attendance ────────────────────────────────────────────────────────
//
// Who was at each service, one tap per person (server/lib/memberAttendance.js).
// Everything here — taking the roll, the analytics, the photos it shows and
// the status list — is for whoever holds the Member Attendance area, and
// admins: one person's attendance is not something the whole congregation
// reads.
//
// A single tap is not written to the action history: a roll is a hundred of
// them, and each mark already carries who made it and when. Changes to the
// status list, and marking everybody left at once, are.

router.use(requireArea('member-attendance'));

const bad = (res, error, code = 400) => res.status(code).json({ success: false, error });

// ─── GET /api/member-attendance/roll?date=&service= ───────────────────────────
// Everybody on the roll, in surname order, and how each is marked. Without a
// date and service, just the services and statuses to choose from.

router.get('/roll', (req, res) => {
  const base = { services: attendance.services(), statuses: attendance.statuses() };
  if (!req.query.date && !req.query.service) return res.json({ success: true, ...base, people: attendance.people(), marks: {} });
  const result = attendance.roll({ date: req.query.date, service: req.query.service });
  if (result.error) return bad(res, result.error);
  res.json({ success: true, ...base, ...result });
});

// ─── PUT /api/member-attendance/roll/mark ─────────────────────────────────────
// { date, service, personId, statusId } — statusId null takes the mark off.

router.put('/roll/mark', (req, res) => {
  const result = attendance.mark(req.body || {}, req.user);
  if (result.error) return bad(res, result.error);
  res.json({ success: true, mark: result.mark });
});

// ─── POST /api/member-attendance/roll/mark-rest ───────────────────────────────
// { date, service, statusId } — everybody not yet marked gets this status.

router.post('/roll/mark-rest', (req, res) => {
  const result = attendance.markRest(req.body || {}, req.user);
  if (result.error) return bad(res, result.error);
  actionLog.record(req.user, {
    area: 'member-attendance', action: 'update', entity: 'attendance roll', entityId: `${result.date}|${result.service}`,
    summary: `Marked the ${result.count} people left on the ${result.service} roll for ${result.date} as ${result.status}`,
    details: result,
  });
  res.json({ success: true, count: result.count });
});

// ─── GET /api/member-attendance/photo/:personId ───────────────────────────────

router.get('/photo/:personId', (req, res) => {
  const filename = path.basename(attendance.photoOf(Number(req.params.personId)));
  const file = filename && photoStore.photoPath(filename);
  if (!file || !photoStore.exists(filename)) return bad(res, 'No photo on file', 404);
  res.set('Cache-Control', 'private, max-age=86400');
  res.sendFile(file);
});

// ─── The status list ──────────────────────────────────────────────────────────

router.get('/statuses', (req, res) => {
  res.json({ success: true, statuses: attendance.statuses(), tones: attendance.TONES });
});

router.post('/statuses', (req, res) => {
  const result = attendance.addStatus(req.body || {});
  if (result.error) return bad(res, result.error);
  actionLog.record(req.user, {
    area: 'member-attendance', action: 'create', entity: 'attendance status', entityId: String(result.status.id),
    summary: `Added "${result.status.label}" to the attendance statuses`,
    details: result.status,
  });
  res.status(201).json({ success: true, status: result.status });
});

router.patch('/statuses/:id', (req, res) => {
  const result = attendance.updateStatus(Number(req.params.id), req.body || {});
  if (result.error) return bad(res, result.error, result.error === 'No such status' ? 404 : 400);
  actionLog.record(req.user, {
    area: 'member-attendance', action: 'update', entity: 'attendance status', entityId: String(result.status.id),
    summary: `Changed the attendance status "${result.before.label}"`,
    details: { before: result.before, after: result.status },
  });
  res.json({ success: true, status: result.status });
});

router.delete('/statuses/:id', (req, res) => {
  const result = attendance.removeStatus(Number(req.params.id));
  if (result.error) return bad(res, result.error, result.code || 400);
  actionLog.record(req.user, {
    area: 'member-attendance', action: 'delete', entity: 'attendance status', entityId: String(result.removed.id),
    summary: `Removed "${result.removed.label}" from the attendance statuses`,
    details: result.removed,
  });
  res.json({ success: true });
});

// ─── Analytics ────────────────────────────────────────────────────────────────
// ?weeks=13&service=  (service '' for all of them)

router.get('/analytics', (req, res) => {
  res.json({ success: true, statuses: attendance.statuses(), ...attendance.groupAnalytics(req.query) });
});

router.get('/analytics/person/:id', (req, res) => {
  const result = attendance.personAnalytics(req.params.id, req.query);
  if (result.error) return bad(res, result.error, 404);
  res.json({ success: true, statuses: attendance.statuses(), ...result });
});

module.exports = router;
