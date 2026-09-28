// ─── Importing weekly contribution totals from a CSV ─────────────────────────
//
// Entering one week is an ordinary record (/api/records/contributions); this is
// for bringing in years of them at once from the finance export the old
// church-management site produces. Gated the same way entering a week is: the
// contributions area, or an admin.
//
// A file is read twice: once to show what it holds (dryRun), and again to save
// it, so nobody imports a spreadsheet they have not seen summarised. Only weeks
// nobody has a row for yet are added — a week already on file, typed in or
// imported before, is never overwritten, so importing the same file twice is
// harmless.
const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { requireArea } = require('../middleware/auth');
const actionLog = require('../lib/actionLog');
const { parseContributionsCsv, parseAnyDate } = require('../lib/contributions');

router.post('/import', requireArea('contributions'), (req, res) => {
  const { csv, filename = '', dryRun = false } = req.body ?? {};
  if (typeof csv !== 'string' || !csv.trim()) {
    return res.status(400).json({ success: false, error: 'Choose a CSV file to import.' });
  }

  const parsed = parseContributionsCsv(csv);
  if (parsed.error || !parsed.records.length) {
    return res.status(400).json({
      success: false,
      error: `No weekly totals could be read from this file. ${parsed.error || ''} It needs a column of dates and a column of amounts given, such as "Giving".`.trim(),
    });
  }

  // Rows typed in by hand are ISO; anything older may not be. Compared as the
  // same week either way.
  const onFile  = new Set(db.prepare('SELECT date FROM contributions').all().map(r => parseAnyDate(r.date) || r.date));
  const fresh   = parsed.records.filter(r => !onFile.has(r.date));
  const summary = {
    found:         parsed.records.length,
    alreadyOnFile: parsed.records.length - fresh.length,
    first:         parsed.records[0].date,
    last:          parsed.records[parsed.records.length - 1].date,
    total:         parsed.total,
    statedTotal:   parsed.statedTotal,
    dateColumn:    parsed.dateColumn,
    amountColumn:  parsed.amountColumn,
    warnings:      parsed.warnings,
  };

  if (dryRun) return res.json({ success: true, dryRun: true, added: 0, ...summary });

  const insert = db.transaction(rows => {
    const ins = db.prepare('INSERT INTO contributions (date, amount) VALUES (?, ?)');
    for (const r of rows) ins.run(r.date, r.amount);
  });
  insert(fresh);

  // One entry for the whole file rather than one per week: the history is
  // there to say who brought these in and from where.
  if (fresh.length) {
    actionLog.record(req.user, {
      area:    'contributions',
      action:  'create',
      entity:  'contribution record',
      summary: `Imported ${fresh.length} week(s) of contributions${filename ? ` from ${filename}` : ''}`,
      details: { filename, added: fresh.length, alreadyOnFile: summary.alreadyOnFile, first: summary.first, last: summary.last },
    });
  }

  res.json({ success: true, dryRun: false, added: fresh.length, ...summary });
});

module.exports = router;
