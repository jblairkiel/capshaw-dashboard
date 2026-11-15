// ─── The weekly reports, on the portal ────────────────────────────────────────
// The same reports the weekly emails carry (mail/weeklyReports.js), for any
// week: the figures as JSON for the Reports tabs, and the PDF. Each report is
// seen by whoever holds its area (Weekly Summary Report, Weekly Analytical
// Report) and by admins. Only admins change when they are sent, or send one now.
const express = require('express');
const router = express.Router();
const { requireApproved, requireAdmin, holdsArea } = require('../middleware/auth');
const actionLog = require('../lib/actionLog');
const weekly = require('../lib/weeklyReport');
const { reportPdf, reportFilename, KINDS } = require('../lib/reportPdf');
const mail = require('../mail/weeklyReports');
const { churchToday } = require('../lib/recordKeeping');

router.use(requireApproved);

const canSee = (user, kind) => !!KINDS[kind] && holdsArea(user, mail.AREAS[kind]);

// The week asked for (?week=2026-11-10 means the week holding that date), or
// the week just ended. Never a week that has not started.
function dataFor(req) {
  const asked = String(req.query.week || '');
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(asked) && !Number.isNaN(Date.parse(`${asked}T12:00:00Z`)) && asked <= churchToday();
  return weekly.build(valid ? { date: asked } : {});
}

// The summary is not meant to name anybody: the lists behind its counts stay
// in the analytical report.
function forKind(kind, data) {
  const out = JSON.parse(JSON.stringify(data));
  for (const part of [out.week, out.year]) part.portal.inactiveCount = part.portal.inactive === null ? null : part.portal.inactive.length;
  if (kind === 'summary') {
    out.week.guests.list = [];
    out.week.roll.missing = [];
    for (const part of [out.week, out.year]) { part.portal.inactive = null; part.portal.keepers = []; }
  }
  return out;
}

function guard(req, res, next) {
  if (!KINDS[req.params.kind]) return res.status(404).json({ success: false, error: 'No such report' });
  if (!canSee(req.user, req.params.kind)) return res.status(403).json({ success: false, error: 'This report is for the people who receive it' });
  next();
}

// GET /api/reports — which reports this person can see, and for admins when each is sent.
router.get('/', (req, res) => {
  const isAdmin = req.user.role === 'admin';
  res.json({
    success: true,
    reports: Object.entries(KINDS).filter(([kind]) => canSee(req.user, kind)).map(([kind, k]) => ({ kind, title: k.title })),
    canManage: isAdmin,
    settings: isAdmin ? mail.settings() : undefined,
    weekdays: mail.WEEKDAYS,
  });
});

// PUT /api/reports/settings/:kind { weekday, time, enabled } — when a report is sent.
router.put('/settings/:kind', requireAdmin, (req, res) => {
  const result = mail.updateSetting(req.params.kind, req.body || {}, req.user);
  if (result.error) return res.status(result.status || 400).json({ success: false, error: result.error });
  const s = result.setting;
  actionLog.record(req.user, {
    area: mail.AREAS[s.kind], action: 'update', entity: 'report schedule', entityId: s.kind,
    summary: s.enabled
      ? `Set the ${s.title} to send on ${mail.WEEKDAYS[s.weekday]}s at ${s.time}`
      : `Turned off the ${s.title} emails`,
    before: { weekday: result.before.weekday, time: result.before.time, enabled: result.before.enabled },
    after: { weekday: s.weekday, time: s.time, enabled: s.enabled },
  });
  res.json({ success: true, setting: s });
});

// GET /api/reports/:kind?week= — the report's figures.
router.get('/:kind', guard, (req, res) => {
  res.json({ success: true, kind: req.params.kind, title: KINDS[req.params.kind].title, report: forKind(req.params.kind, dataFor(req)) });
});

// GET /api/reports/:kind/pdf?week= — the report as the email attaches it.
router.get('/:kind/pdf', guard, (req, res) => {
  const data = dataFor(req);
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${reportFilename(req.params.kind, data.week)}"`,
  });
  res.send(reportPdf(req.params.kind, data));
});

// POST /api/reports/:kind/send { week? } — send it now to everybody who receives it.
router.post('/:kind/send', requireAdmin, guard, (req, res) => {
  const week = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.week || '')) && req.body.week <= churchToday() ? req.body.week : undefined;
  const result = mail.sendReport(req.params.kind, week ? { date: week } : {});
  actionLog.record(req.user, {
    area: mail.AREAS[req.params.kind], action: 'other', entity: 'report', entityId: req.params.kind,
    summary: `Sent the ${KINDS[req.params.kind].title} for the week of ${result.week} (${result.sent})`,
    details: result,
  });
  res.json({ success: true, ...result });
});

module.exports = router;
