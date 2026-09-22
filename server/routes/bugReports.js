// ─── Bug reports ────────────────────────────────────────────────────────────
//
// Reachable from a link at the bottom of every page in the portal.
//
//   · Anybody signed in — a pending account included, since they can already
//     look around and are as likely as anybody to hit something broken — can
//     file one. Which page they were on, the full URL and their browser are
//     captured from the click itself, not typed in.
//   · Only an admin can see the list and move a report through its states.
//     There is no area for this: it is not one part of the site to look
//     after, it is the whole site, so it stays with whoever already holds
//     everything else.
//
// Every report and every status change lands in the action history, the same
// as any other write. A status change also tells the reporter through their
// own bell — but never by linking them to the triage page, since they cannot
// open it; the notification carries what changed instead.
const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const db      = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { isSeverity, isStatus } = require('../lib/bugReports');
const screenshots = require('../lib/bugScreenshots');
const actionLog    = require('../lib/actionLog');
const notifications = require('../lib/notifications');

router.use(requireAuth);

const IMAGE_MIMES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']);
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => cb(null, IMAGE_MIMES.has(file.mimetype)),
  limits: { fileSize: MAX_SCREENSHOT_BYTES },
});

const SELECT = `
  SELECT id, reporter_id AS reporterId, reporter_name AS reporterName, title, description, steps,
         severity, status, page, page_label AS pageLabel, url, user_agent AS userAgent, screenshot,
         admin_note AS adminNote, created_at AS createdAt, updated_at AS updatedAt
    FROM bug_reports
`;

function getReport(id) {
  return db.prepare(`${SELECT} WHERE id = ?`).get(id) || null;
}

function adminIds() {
  return db.prepare("SELECT id FROM users WHERE role = 'admin'").all().map(r => r.id);
}

// "Just a little something" reads better in a bell than "minor" does.
const SEVERITY_SAID = { minor: 'a minor issue', annoying: 'something in the way', blocking: 'a blocking issue' };
const STATUS_SAID    = { open: 'reopened', in_progress: 'in progress', resolved: 'resolved', wont_fix: "closed as won't fix" };

// ─── POST /api/bug-reports — file one ──────────────────────────────────────────
// A multipart body always, screenshot or not — multer reads the text fields
// into req.body either way, so the form never has to switch how it submits
// depending on whether somebody attached a picture.

router.post('/', upload.single('screenshot'), (req, res) => {
  const title       = String(req.body?.title || '').trim();
  const description = String(req.body?.description || '').trim();
  const steps       = String(req.body?.steps || '').trim();
  const severity    = isSeverity(req.body?.severity) ? req.body.severity : 'annoying';
  const page        = String(req.body?.page || '').trim();
  const pageLabel   = String(req.body?.pageLabel || '').trim();
  const url         = String(req.body?.url || '').trim().slice(0, 500);
  const userAgent   = String(req.body?.userAgent || '').trim().slice(0, 500);

  if (!title)       return res.status(400).json({ success: false, error: 'A short title is required' });
  if (!description) return res.status(400).json({ success: false, error: 'Say what happened' });

  let screenshot = null;
  if (req.file) {
    screenshot = screenshots.save(req.file.buffer, MAX_SCREENSHOT_BYTES);
    if (!screenshot) {
      return res.status(400).json({ success: false, error: 'That screenshot could not be read as an image' });
    }
  }

  const { lastInsertRowid: id } = db.prepare(`
    INSERT INTO bug_reports (reporter_id, reporter_name, title, description, steps, severity, page, page_label, url, user_agent, screenshot)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.user.id, req.user.name || '', title, description, steps, severity, page, pageLabel, url, userAgent, screenshot);

  const report = getReport(id);

  actionLog.record(req.user, {
    area:     'bug-reports',
    action:   'create',
    entity:   'bug report',
    entityId: id,
    summary:  `Filed a bug report: "${title}"`,
    details:  { severity, page, hasScreenshot: !!screenshot },
  });

  notifications.notify({
    users:       adminIds(),
    kind:        'bug-report-new',
    title:       `Bug report: ${title}`,
    body:        `${req.user.name || 'Somebody'} ran into ${SEVERITY_SAID[severity]}${pageLabel ? ` on ${pageLabel}` : ''}.`,
    subjectType: 'bug-report',
    subjectId:   id,
    page:        'bug-reports',
    actor:       req.user,
  });

  res.json({ success: true, report });
});

// ─── GET /api/bug-reports — the triage list ────────────────────────────────────

router.get('/', requireAdmin, (req, res) => {
  const status = String(req.query?.status || '').trim();
  const rows = status && isStatus(status)
    ? db.prepare(`${SELECT} WHERE status = ? ORDER BY id DESC`).all(status)
    : db.prepare(`${SELECT} ORDER BY id DESC`).all();

  const counts = Object.fromEntries(
    db.prepare('SELECT status, COUNT(*) AS n FROM bug_reports GROUP BY status').all()
      .map(r => [r.status, r.n]),
  );

  res.json({ success: true, reports: rows, counts });
});

// ─── GET /api/bug-reports/:id/screenshot ───────────────────────────────────────

router.get('/:id/screenshot', requireAdmin, (req, res) => {
  const report = getReport(req.params.id);
  if (!report) return res.status(404).json({ success: false, error: 'No such report' });
  if (!report.screenshot || !screenshots.exists(report.screenshot)) {
    return res.status(404).json({ success: false, error: 'No screenshot on this report' });
  }

  res.set('Cache-Control', 'private, max-age=86400');
  res.set('Content-Type', screenshots.contentTypeFor(report.screenshot));
  res.sendFile(screenshots.screenshotPath(report.screenshot));
});

// ─── PATCH /api/bug-reports/:id — move it through triage ──────────────────────

router.patch('/:id', requireAdmin, (req, res) => {
  const before = getReport(req.params.id);
  if (!before) return res.status(404).json({ success: false, error: 'No such report' });

  const status = req.body?.status;
  if (status !== undefined && !isStatus(status)) {
    return res.status(400).json({ success: false, error: 'Unknown status' });
  }
  const adminNote = req.body?.adminNote;

  const nextStatus = status ?? before.status;
  const nextNote   = adminNote === undefined ? before.adminNote : String(adminNote).trim();

  db.prepare("UPDATE bug_reports SET status = ?, admin_note = ?, updated_at = datetime('now') WHERE id = ?")
    .run(nextStatus, nextNote, before.id);

  const after = getReport(before.id);
  const statusChanged = after.status !== before.status;

  actionLog.record(req.user, {
    area:     'bug-reports',
    action:   'update',
    entity:   'bug report',
    entityId: after.id,
    summary:  statusChanged
      ? `Marked "${after.title}" ${STATUS_SAID[after.status]}`
      : `Updated the note on "${after.title}"`,
    before,
    after,
  });

  if (statusChanged && after.reporterId) {
    notifications.notify({
      users:       [after.reporterId],
      kind:        'bug-report-status',
      title:       `Your report "${after.title}" was marked ${STATUS_SAID[after.status]}`,
      body:        after.adminNote || '',
      subjectType: 'bug-report',
      subjectId:   after.id,
      page:        '',
      actor:       req.user,
    });
  }

  res.json({ success: true, report: after });
});

module.exports = router;
