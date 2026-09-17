// ─── The weekly newsletter ────────────────────────────────────────────────────
//
// One week is one URL. Reading a week composes it — the data-backed sections
// queried live, the typed ones loaded from bulletin_issues or carried forward
// from the last week that was written — and the two export endpoints render
// exactly what a read returns, so what the screen shows is what the file says.
//
// Reading is open to anybody signed in, as every other page here is. Writing
// and exporting belong to whoever looks after the newsletter: an export is a
// document going out to the congregation under the church's name, not a view
// of records the portal already shows.
const express = require('express');
const router  = express.Router();

const { requireArea } = require('../middleware/auth');
const issues    = require('../lib/bulletinIssue');
const data      = require('../lib/bulletinData');
const docx      = require('../lib/bulletinDocx');
const pdf       = require('../lib/bulletinPdf');
const actionLog = require('../lib/actionLog');

const requireBulletin = requireArea('bulletin');

// Every route below is for one week, named by any date inside it. Normalising
// here means /2026-05-06 and /2026-05-03 are the same week rather than two,
// and that a malformed date is refused once instead of in four places.
function weekOf(value) {
  const iso = data.toIsoDate(value);
  if (!iso) return null;
  return data.sundayOf(iso);
}

function badWeek(res) {
  return res.status(400).json({
    success: false,
    error: 'Give the week as a date, like 2026-05-03.',
  });
}

// GET /api/bulletin — the weeks somebody has written, newest first.
router.get('/issues', (req, res) => {
  res.json({ success: true, issues: issues.list() });
});

// GET /api/bulletin/:week — the composed newsletter for the week containing
// that date. Defaults to the current week.
router.get('/:week', (req, res) => {
  const sunday = weekOf(req.params.week);
  if (!sunday) return badWeek(res);
  res.json({ success: true, bulletin: issues.compose(sunday) });
});

// PUT /api/bulletin/:week — save the typed half of a week.
router.put('/:week', requireBulletin, (req, res) => {
  const sunday = weekOf(req.params.week);
  if (!sunday) return badWeek(res);

  const before = issues.find(sunday);
  issues.save(sunday, req.body ?? {});
  const after = issues.find(sunday);

  actionLog.record(req.user, {
    area:     'bulletin',
    action:   before ? 'update' : 'create',
    entity:   'newsletter',
    entityId: sunday,
    summary:  `${before ? 'Edited' : 'Wrote'} the newsletter for ${data.longDate(sunday)}`,
    before,
    after,
  });

  res.json({ success: true, bulletin: issues.compose(sunday) });
});

// The two exports differ only in which renderer they call, so they share
// everything else — including the guarantee that they render the same compose()
// a read would have returned.
function exportAs(renderer, contentType) {
  return async (req, res) => {
    const sunday = weekOf(req.params.week);
    if (!sunday) return badWeek(res);

    try {
      const bulletin = issues.compose(sunday);
      const buffer   = await renderer.render(bulletin);
      const name     = renderer.filename(bulletin);

      const format = name.split('.').pop().toUpperCase();
      // 'other' rather than 'export': the history's vocabulary is create,
      // update, delete and other, and anything else is normalised to other
      // anyway. The format is kept in the details so the history can still be
      // read for "who sent out the May 3 newsletter, and as what".
      actionLog.record(req.user, {
        area:     'bulletin',
        action:   'other',
        entity:   'newsletter',
        entityId: sunday,
        summary:  `Exported the newsletter for ${data.longDate(sunday)} as ${format}`,
        details:  { format },
      });

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
      res.setHeader('Content-Length', buffer.length);
      res.send(buffer);
    } catch (err) {
      console.error('[bulletin] could not render', req.params.week, '-', err.message);
      res.status(500).json({ success: false, error: 'The newsletter could not be built. Please try again.' });
    }
  };
}

router.get('/:week/export.docx', requireBulletin,
  exportAs(docx, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'));

router.get('/:week/export.pdf', requireBulletin,
  exportAs(pdf, 'application/pdf'));

module.exports = router;
