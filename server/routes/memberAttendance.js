const express = require('express');
const path    = require('path');
const router  = express.Router();
const attendance = require('../lib/memberAttendance');
const photoStore = require('../lib/photoStore');
const { requireArea } = require('../middleware/auth');
const actionLog = require('../lib/actionLog');
const multer = require('multer');
const importer = require('../lib/memberAttendanceImport');

// Spreadsheets are read straight from memory and never written to disk; a
// run of weekly sheets can be chosen at once.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 200 } }).array('file', 200);

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

// ─── POST /api/member-attendance/import ───────────────────────────────────────
// Multipart: one or more `file` (.xlsx), and as fields `sheet`, `service`,
// `overwrite`, `dryRun`, and JSON `keyMap` ({ colour or text key: statusId }),
// `personMap` ({ person key: personId, or '' to leave them out }) and
// `dateMap` ({ page id: date } for a sheet that does not say its date).
//
// Sent twice, like the contributions import: a dry run says what is in the
// files and what the choices would do, and the second saves it. The files are
// read afresh each time, so nothing about them is held between the two.

const MAX_FILES = 200;

function parseJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

router.post('/import', (req, res) => {
  upload(req, res, async err => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return bad(res, 'One of those files is over 10 MB.');
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') return bad(res, `Choose at most ${MAX_FILES} files at a time.`);
      return bad(res, 'The files could not be read.');
    }
    const files = (req.files || []).map(f => ({ buffer: f.buffer, name: f.originalname }));
    if (!files.length) return bad(res, 'Choose an Excel file (.xlsx) to import.');

    // An error in here would otherwise escape Express 4, which does not catch
    // a rejected promise.
    let read;
    try {
      read = await importer.readFiles(files, { sheet: req.body.sheet, dateMap: parseJson(req.body.dateMap, {}) });
    } catch (e) {
      console.error('[member-attendance] import could not read', files.map(f => f.name).join(', '), '-', e.message);
      return bad(res, 'Those workbooks could not be read.');
    }

    const options = {
      service:   req.body.service,
      overwrite: req.body.overwrite === 'true',
      keyMap:    parseJson(req.body.keyMap, {}),
      personMap: parseJson(req.body.personMap, {}),
    };
    const planned = importer.plan(read, options);
    const preview = { ...read, people: read.people.map(({ marks, ...p }) => ({ ...p, marks: marks.length })), counts: planned.counts, service: planned.service };

    if (req.body.dryRun === 'true') return res.json({ success: true, dryRun: true, ...preview });
    if (!planned.service) return bad(res, 'Choose the service these dates are for.');
    if (!planned.writes.length) return bad(res, 'There is nothing to import with these choices.');

    importer.save(planned.writes, planned.service, req.user);
    const names = files.map(f => f.name).filter(Boolean);
    actionLog.record(req.user, {
      area: 'member-attendance', action: 'create', entity: 'attendance import', entityId: names[0] || '',
      summary: `Imported ${planned.writes.length} attendance marks for ${planned.service} from ${names.length === 1 ? names[0] : `${files.length} spreadsheets`} (${read.dates.length} ${read.dates.length === 1 ? 'date' : 'dates'})`,
      details: { files: names, dates: read.dates, service: planned.service, counts: planned.counts, keyMap: options.keyMap, overwrite: options.overwrite },
    });
    res.json({ success: true, imported: planned.writes.length, ...preview });
  });
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
