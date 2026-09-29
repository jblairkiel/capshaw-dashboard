const express = require('express');
const router  = express.Router();
const keeping = require('../lib/recordKeeping');
const { requireArea } = require('../middleware/auth');
const actionLog = require('../lib/actionLog');
const reminder = require('../mail/records');

// ─── Record Keeping ───────────────────────────────────────────────────────────
//
// Which services are missing their songs, guests or contribution
// (server/lib/recordKeeping.js). For admins and whoever holds the Reports &
// Record Keeping area.

router.use(requireArea('records'));

// ─── GET /api/record-keeping?weeks=8 ──────────────────────────────────────────

router.get('/', (req, res) => {
  const weeks = Math.min(26, Math.max(1, Number.parseInt(req.query.weeks, 10) || 8));
  res.json({
    success: true,
    ...keeping.report({ weeks }),
    reminder: { lastRun: reminder.lastRun(), day: keeping.WEEKDAYS[reminder.SEND_DAY], hour: reminder.SEND_HOUR },
  });
});

// ─── POST /api/record-keeping/remind ──────────────────────────────────────────
// Send the weekly reminder now, rather than waiting for Monday.

router.post('/remind', (req, res) => {
  const result = reminder.sendReminder();
  const people = result.sent.length;
  actionLog.record(req.user, {
    area: 'records', action: 'other', entity: 'records reminder', entityId: '',
    summary: result.missing
      ? `Sent the records reminder (${result.missing} missing) to ${people} ${people === 1 ? 'person' : 'people'}`
      : 'Asked for the records reminder; nothing was missing, so none was sent',
    details: result,
  });
  res.json({ success: true, ...result });
});

// ─── POST /api/record-keeping/checkoffs ───────────────────────────────────────
// { date, service, check: songs | guests | contribution | not-held, note }

router.post('/checkoffs', (req, res) => {
  const { date, service, check, note } = req.body || {};
  const result = keeping.addCheckoff({ date, service, check, note }, req.user);
  if (result.error) return res.status(400).json({ success: false, error: result.error });

  const c = result.checkoff;
  const what = check === 'not-held' ? 'did not happen' : `had nothing to record for ${check}`;
  actionLog.record(req.user, {
    area: 'records', action: 'create', entity: 'record sign-off', entityId: String(c.id),
    summary: `Marked that ${c.service || 'the Sunday'} on ${c.date} ${what}`,
    details: c,
  });
  res.status(201).json({ success: true, checkoff: c });
});

// ─── DELETE /api/record-keeping/checkoffs/:id ─────────────────────────────────

router.delete('/checkoffs/:id', (req, res) => {
  const result = keeping.removeCheckoff(Number(req.params.id));
  if (result.error) return res.status(404).json({ success: false, error: result.error });
  const c = result.removed;
  actionLog.record(req.user, {
    area: 'records', action: 'delete', entity: 'record sign-off', entityId: String(c.id),
    summary: `Took back the sign-off for ${c.service || 'the Sunday'} on ${c.date} (${c.check_id})`,
    details: c,
  });
  res.json({ success: true });
});

// ─── GET/PUT /api/record-keeping/services ─────────────────────────────────────
// Which services are expected, on which day, and what the song tracker calls them.

router.get('/services', (req, res) => {
  res.json({ success: true, ...keeping.serviceSettings() });
});

router.put('/services/:id', (req, res) => {
  const result = keeping.updateService(Number(req.params.id), req.body || {});
  if (result.error) return res.status(400).json({ success: false, error: result.error });
  actionLog.record(req.user, {
    area: 'records', action: 'update', entity: 'service type', entityId: String(result.service.id),
    summary: `Changed how ${result.service.name} is tracked`,
    details: { before: result.before, after: result.service },
  });
  res.json({ success: true, service: result.service });
});

module.exports = router;
