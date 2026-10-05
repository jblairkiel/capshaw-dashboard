const express = require('express');
const router  = express.Router();

const plans = require('../lib/worshipPlans');
const actionLog = require('../lib/actionLog');
const notifications = require('../lib/notifications');
const notify = require('../mail/notify');
const { requireArea, requireApproved } = require('../middleware/auth');
const { churchToday } = require('../lib/recordKeeping');

// ─── The Upcoming Service page ────────────────────────────────────────────────
//
// Services song leaders submit, the worship organizer confirms, the parts a
// service is made of, and members' song requests (server/lib/worshipPlans.js).
// Everybody signed in can read all of it: what is being sung on Sunday is not
// a secret.

const requireOrganizer = requireArea('worship-order');

const fail = (res, result) => res.status(result.status || 400).json({ success: false, error: result.error });

function describe(plan) {
  return `${plan.service} on ${plan.date}`;
}

// ─── GET /api/worship/overview?days=14 ────────────────────────────────────────

router.get('/overview', (req, res) => {
  const days = Math.min(Math.max(Number.parseInt(req.query.days, 10) || 14, 1), 60);
  res.json({
    success: true,
    today: churchToday(),
    upcoming: plans.upcoming(req.user, { days }),
    requests: plans.listRequests(),
    parts: plans.listParts({ includeRetired: false }),
    services: plans.outlines().services.map(({ id, name }) => ({ id, name })),
    canOrganize: plans.canOrganize(req.user),
    keepsSongs: plans.keepsSongs(req.user),
  });
});

// ─── Plans ────────────────────────────────────────────────────────────────────

// GET /api/worship/plans?from&to — services submitted in a range (default: the
// last four weeks and everything ahead).
router.get('/plans', (req, res) => {
  const today = churchToday();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : '0000-01-01';
  const to   = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '')   ? req.query.to   : '9999-12-31';
  res.json({ success: true, today, plans: plans.plansBetween(from, to).map(p => ({ ...p, canEdit: plans.canEdit(req.user, p) })) });
});

// GET /api/worship/plans/for?date&service — the service as submitted, or a
// blank one laid out in the usual order with the Serving Schedule filled in.
router.get('/plans/for', (req, res) => {
  const { date = '', service = '' } = req.query;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !service) return res.status(400).json({ success: false, error: 'Choose a date and a service' });
  const plan = plans.planFor(date, service);
  res.json({
    success: true,
    plan: plan ? { ...plan, canEdit: plans.canEdit(req.user, plan) } : null,
    template: plans.template(date, service),
    canSubmit: plans.canSubmit(req.user, date, service),
    canOrganize: plans.canOrganize(req.user),
  });
});

router.get('/plans/:id', (req, res) => {
  const plan = plans.getPlan(req.params.id);
  if (!plan) return res.status(404).json({ success: false, error: 'No such service' });
  res.json({ success: true, plan: { ...plan, canEdit: plans.canEdit(req.user, plan) }, canOrganize: plans.canOrganize(req.user) });
});

// Tell the people a submission affects: the organizer (by email the first
// time, in the bell every time) and anybody whose request it answers.
function announce(req, result) {
  const { plan, created, planned } = result;
  const organizers = plans.holdersOfOrganizer();
  let emailed = 0;
  if (created) emailed = notify.worshipPlanSubmitted({ plan, to: organizers }).length;
  if (plan.status === 'submitted') {
    notifications.notify({
      users: organizers, kind: 'worship-plan-submitted', actor: req.user,
      title: `${created ? 'Submitted' : 'Changed'}: ${plan.service}, ${plan.date}`,
      body: `${plan.submittedByName || 'A song leader'} ${created ? 'submitted' : 'changed'} the service. It is waiting to be confirmed.`,
      subjectType: 'worship-plan', subjectId: plan.id,
    });
  }
  for (const r of planned) {
    notifications.notify({
      users: [r.requestedBy], kind: 'song-request-planned', actor: req.user,
      title: `"${r.song.title}" is planned for ${plan.service}, ${plan.date}`,
      body: 'The song you asked for is in the service the song leader submitted.',
      subjectType: 'song-request', subjectId: r.id,
    });
  }
  return emailed;
}

// POST /api/worship/plans { date, service, leader, notes, items: [{ partId, songId, person, detail }] }
// Submits a service, or changes the one already submitted for that day.
router.post('/plans', requireApproved, (req, res) => {
  const result = plans.submit(req.user, req.body || {});
  if (result.error) return fail(res, result);
  const emailed = announce(req, result);
  actionLog.record(req.user, {
    area: 'songs', action: result.created ? 'create' : 'update', entity: 'service', entityId: result.plan.id,
    summary: `${result.created ? 'Submitted' : 'Changed'} the ${describe(result.plan)}`,
    details: { before: result.before, after: result.plan, emailed },
  });
  res.status(result.created ? 201 : 200).json({ success: true, plan: { ...result.plan, canEdit: plans.canEdit(req.user, result.plan) }, created: result.created, emailed });
});

// POST /api/worship/plans/:id/confirm — the organizer's go-ahead; the songs go
// into the song tracker.
router.post('/plans/:id/confirm', requireOrganizer, (req, res) => {
  const result = plans.confirm(req.user, req.params.id);
  if (result.error) return fail(res, result);
  const { plan } = result;
  notifications.notify({
    users: [plan.submittedBy], kind: 'worship-plan-confirmed', actor: req.user,
    title: `Confirmed: ${plan.service}, ${plan.date}`,
    body: `${plan.confirmedByName || 'The worship organizer'} confirmed the service you submitted.`,
    subjectType: 'worship-plan', subjectId: plan.id,
  });
  actionLog.record(req.user, {
    area: 'worship-order', action: 'update', entity: 'service', entityId: plan.id,
    summary: `Confirmed the ${describe(plan)}`, details: { songService: plan.songServiceId },
  });
  res.json({ success: true, plan: { ...plan, canEdit: plans.canEdit(req.user, plan) } });
});

router.delete('/plans/:id', requireApproved, (req, res) => {
  const result = plans.remove(req.user, req.params.id);
  if (result.error) return fail(res, result);
  actionLog.record(req.user, {
    area: 'songs', action: 'delete', entity: 'service', entityId: result.removed.id,
    summary: `Withdrew the ${describe(result.removed)}`, before: result.removed,
  });
  res.json({ success: true });
});

// ─── Parts and the usual order (the worship organizer's) ──────────────────────

router.get('/parts', (req, res) => {
  res.json({ success: true, parts: plans.listParts(), outlines: plans.outlines(), canOrganize: plans.canOrganize(req.user) });
});

router.post('/parts', requireOrganizer, (req, res) => {
  const result = plans.addPart(req.body || {});
  if (result.error) return fail(res, result);
  actionLog.record(req.user, {
    area: 'worship-order', action: 'create', entity: 'service part', entityId: result.part.id,
    summary: `Added the service part "${result.part.name}"`, details: result.part,
  });
  res.status(201).json({ success: true, part: result.part });
});

router.put('/parts/:id', requireOrganizer, (req, res) => {
  const result = plans.updatePart(req.params.id, req.body || {});
  if (result.error) return fail(res, result);
  actionLog.record(req.user, {
    area: 'worship-order', action: 'update', entity: 'service part', entityId: result.part.id,
    summary: `Changed the service part "${result.part.name}"`, details: { before: result.before, after: result.part },
  });
  res.json({ success: true, part: result.part });
});

// PUT /api/worship/outlines/:serviceTypeId { partIds } — 'default' for the
// order every other service uses; partIds null takes a service back to it.
router.put('/outlines/:serviceTypeId', requireOrganizer, (req, res) => {
  const id = req.params.serviceTypeId === 'default' ? null : Number(req.params.serviceTypeId);
  if (id !== null && !Number.isInteger(id)) return res.status(400).json({ success: false, error: 'No such service' });
  const result = plans.setOutline(id, req.body?.partIds ?? null);
  if (result.error) return fail(res, result);
  const name = id === null ? '' : plans.outlines().services.find(sv => sv.id === id)?.name || 'a service';
  actionLog.record(req.user, {
    area: 'worship-order', action: 'update', entity: 'order of worship', entityId: id ?? 'default',
    summary: id === null ? 'Changed the default order of worship'
      : req.body?.partIds == null ? `Put ${name} back on the default order of worship` : `Gave ${name} an order of worship of its own`,
    details: { serviceTypeId: id, partIds: req.body?.partIds ?? null },
  });
  res.json({ success: true, outlines: plans.outlines() });
});

// POST /api/worship/outlines/default/everywhere — every service on the default
// order, dropping any order a service had of its own.
router.post('/outlines/default/everywhere', requireOrganizer, (req, res) => {
  const result = plans.useDefaultEverywhere();
  actionLog.record(req.user, {
    area: 'worship-order', action: 'update', entity: 'order of worship', entityId: 'default',
    summary: result.services.length
      ? `Put every service on the default order of worship (${result.services.join(', ')} had their own)`
      : 'Put every service on the default order of worship',
    details: result,
  });
  res.json({ success: true, outlines: plans.outlines() });
});

// PUT /api/worship/services/:id/start-time { time: 'HH:MM' | '' }
router.put('/services/:id/start-time', requireOrganizer, (req, res) => {
  const result = plans.setStartTime(req.params.id, req.body?.time);
  if (result.error) return fail(res, result);
  actionLog.record(req.user, {
    area: 'worship-order', action: 'update', entity: 'service type', entityId: result.service.id,
    summary: `Set ${result.service.name} to start at ${result.service.startTime || 'no set time'}`,
    details: { before: result.before, after: result.service.startTime },
  });
  res.json({ success: true, service: result.service });
});

// ─── Song requests ────────────────────────────────────────────────────────────

router.get('/requests', (req, res) => {
  const statuses = String(req.query.status || 'open,planned').split(',');
  res.json({ success: true, requests: plans.listRequests({ statuses }) });
});

router.post('/requests', requireApproved, (req, res) => {
  const result = plans.addRequest(req.user, req.body || {});
  if (result.error) return fail(res, result);
  actionLog.record(req.user, {
    area: 'songs', action: 'create', entity: 'song request', entityId: result.request.id,
    summary: `Asked for "${result.request.song.title}"${result.request.forDate ? ` on ${result.request.forDate}` : ''}`,
    details: result.request,
  });
  res.status(201).json({ success: true, request: result.request });
});

router.patch('/requests/:id', requireApproved, (req, res) => {
  const result = plans.setRequestStatus(req.user, req.params.id, String(req.body?.status || ''));
  if (result.error) return fail(res, result);
  actionLog.record(req.user, {
    area: 'songs', action: 'update', entity: 'song request', entityId: result.request.id,
    summary: `Marked the request for "${result.request.song.title}" ${result.request.status}`,
    details: { before: result.before.status, after: result.request.status },
  });
  res.json({ success: true, request: result.request });
});

module.exports = router;
