const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { readData } = require('./scraper');
const { syncDirectory } = require('../lib/directorySync');
const { TABLES, tableDef } = require('../lib/recordTables');
const store     = require('../lib/recordStore');
const actionLog = require('../lib/actionLog');

// Direct database editing is an admin-only privilege — everyone else edits the
// records their own area owns, through /api/records. Both go through
// server/lib/recordStore.js, so either way the change lands in the action
// history.
router.use(requireAdmin);

// ─── Import from JSON cache (seeds DB without a live scrape) ─────────────────

router.post('/import-cache', (req, res) => {
  try {
    const data = readData();
    if (!data) return res.status(404).json({ success: false, error: 'No cached data found. Run a scrape first.' });

    // Use the same _saveScraped logic — require it directly
    const { runUpdate: _unused, ...scraperModule } = require('./scraper');
    // We need to call saveData — re-expose via a thin wrapper
    const saveScraped = db.transaction((d) => {
      db.prepare('DELETE FROM attendance').run();
      const insA = db.prepare('INSERT INTO attendance (date, service, count) VALUES (?, ?, ?)');
      for (const r of (d.attendance || [])) insA.run(r.date, r.service, r.count);

      db.prepare('DELETE FROM sermons').run();
      const insS = db.prepare('INSERT INTO sermons (date, title, speaker, type, series, service) VALUES (?, ?, ?, ?, ?, ?)');
      for (const r of (d.sermons || [])) insS.run(r.date, r.title, r.speaker, r.type, r.series, r.service);

      db.prepare('DELETE FROM job_assignments').run();
      const insJA = db.prepare('INSERT INTO job_assignments (month, date, service, job, name) VALUES (?, ?, ?, ?, ?)');
      const ja = d.jobAssignments;
      if (ja && ja.assignments) {
        for (const r of ja.assignments) insJA.run(ja.month || '', r.date, r.service, r.job, r.name);
      }

      // Guests are matched by name and kept, for the same reason as in
      // routes/scraper.js: their details are typed in here and nowhere else.
      const findV = db.prepare('SELECT id FROM visitors WHERE lower(trim(name)) = lower(trim(?))');
      const insV  = db.prepare("INSERT INTO visitors (name, created_at) VALUES (?, datetime('now'))");
      const clrVV = db.prepare('DELETE FROM visitor_visits WHERE visitor_id = ?');
      const insVV = db.prepare('INSERT INTO visitor_visits (visitor_id, date, service) VALUES (?, ?, ?)');
      for (const v of (d.visitors || [])) {
        const vid = findV.get(v.name)?.id ?? insV.run(v.name).lastInsertRowid;
        clrVV.run(vid);
        for (const vv of (v.visits || [])) insVV.run(vid, vv.date, vv.service);
      }

      db.prepare('DELETE FROM anniversaries').run();
      const insAnn = db.prepare('INSERT INTO anniversaries (month, date, names, month_num, day) VALUES (?, ?, ?, ?, ?)');
      for (const r of (d.anniversaries || [])) insAnn.run(r.month || '', r.date, r.names, r.monthNum || 0, r.day || 0);

      db.prepare('DELETE FROM deacon_duties').run();
      db.prepare('DELETE FROM deacons').run();
      const insD  = db.prepare('INSERT INTO deacons (name) VALUES (?)');
      const insDd = db.prepare('INSERT INTO deacon_duties (deacon_id, duty, position) VALUES (?, ?, ?)');
      for (const d2 of (d.deacons || [])) {
        const did = insD.run(d2.name).lastInsertRowid;
        (d2.duties || []).forEach((duty, i) => insDd.run(did, duty, i));
      }

      db.prepare('DELETE FROM bulletins').run();
      const insB = db.prepare('INSERT INTO bulletins (url, label) VALUES (?, ?)');
      for (const b of (d.bulletins || [])) insB.run(b.url, b.label);

      syncDirectory(db, data.directory || []);

      db.prepare('INSERT OR REPLACE INTO scraped_meta (id, last_updated, last_warnings) VALUES (1, ?, ?)').run(
        d.lastUpdated || new Date().toISOString(), JSON.stringify(d.warnings || [])
      );
    });

    saveScraped(data);

    const counts = {};
    for (const table of ['attendance', 'sermons', 'job_assignments', 'visitors', 'anniversaries', 'deacons', 'bulletins', 'directory']) {
      counts[table] = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    }
    res.json({ success: true, counts });
  } catch (err) {
    console.error('[admin] import-cache failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Scrape status ────────────────────────────────────────────────────────────

const SCRAPE_SECTIONS = [
  { key: 'jobAssignments', label: 'Job Assignments', table: 'job_assignments', dateCol: null },
  { key: 'attendance',     label: 'Attendance',      table: 'attendance',      dateCol: 'date' },
  { key: 'sermons',        label: 'Sermons',         table: 'sermons',         dateCol: 'date' },
  { key: 'visitors',       label: 'Visitors',        table: 'visitors',        dateCol: null },
  { key: 'anniversaries',  label: 'Anniversaries',   table: 'anniversaries',   dateCol: null },
  { key: 'deacons',        label: 'Deacons',         table: 'deacons',         dateCol: null },
  { key: 'bulletins',      label: 'Bulletins',       table: 'bulletins',       dateCol: null },
  { key: 'directory',     label: 'Directory',       table: 'directory',       dateCol: null },
];

router.get('/scrape-status', (req, res) => {
  try {
    const meta     = db.prepare('SELECT * FROM scraped_meta WHERE id = 1').get();
    const warnings = JSON.parse(meta?.last_warnings || '[]');

    const sections = SCRAPE_SECTIONS.map(s => {
      const count       = db.prepare(`SELECT COUNT(*) AS n FROM "${s.table}"`).get().n;
      const latestDate  = s.dateCol
        ? db.prepare(`SELECT MAX("${s.dateCol}") AS d FROM "${s.table}"`).get()?.d || null
        : null;
      const sectionWarn = warnings.filter(w => w.toLowerCase().startsWith(s.key.toLowerCase() + ':'));

      let status = 'ok';
      if (sectionWarn.length > 0 && count === 0) status = 'error';
      else if (sectionWarn.length > 0)           status = 'warning';
      else if (count === 0)                       status = 'empty';

      return { key: s.key, label: s.label, table: s.table, count, latestDate, warnings: sectionWarn, status };
    });

    res.json({ success: true, lastScraped: meta?.last_updated || null, allWarnings: warnings, sections });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Overview ─────────────────────────────────────────────────────────────────

router.get('/overview', (req, res) => {
  try {
    const counts = {};
    for (const table of Object.keys(TABLES)) {
      try { counts[table] = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n; }
      catch { counts[table] = 0; }
    }
    const meta = db.prepare('SELECT last_updated FROM scraped_meta WHERE id = 1').get();
    res.json({ success: true, counts, lastScraped: meta?.last_updated || null });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Action history ───────────────────────────────────────────────────────────
// Who changed what, and when. Admin-only, and read-only: entries are written by
// the routes that make the change, never by anybody typing here.

router.get('/action-log', (req, res) => {
  try {
    const { rows, total } = actionLog.list({
      area:   req.query.area   || '',
      action: req.query.action || '',
      entity: req.query.entity || '',
      userId: req.query.userId || null,
      search: req.query.search?.trim() || '',
      limit:  req.query.limit,
      offset: req.query.offset,
    });

    // The people and areas actually present, so the filters only ever offer
    // something that will match at least one entry.
    const actors = db.prepare(`
      SELECT user_id AS id, user_name AS name, COUNT(*) AS entries
        FROM action_log GROUP BY user_id, user_name ORDER BY name ASC
    `).all();
    const areas = db.prepare(
      'SELECT area, COUNT(*) AS entries FROM action_log WHERE area <> \'\' GROUP BY area ORDER BY area ASC'
    ).all();

    res.json({ success: true, rows, total, actors, areas });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Generic list ─────────────────────────────────────────────────────────────

router.get('/:table', (req, res) => {
  try {
    const result = store.list(req.params.table, req.query);
    if (!result) return res.status(404).json({ success: false, error: 'Unknown table' });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Create ───────────────────────────────────────────────────────────────────

router.post('/:table', (req, res) => {
  try {
    const result = store.create(req.params.table, req.body ?? {}, req.user);
    if (result.error) return res.status(result.status || 400).json({ success: false, error: result.error });
    res.json({ success: true, row: result.row });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Update ───────────────────────────────────────────────────────────────────

router.patch('/:table/:id', (req, res) => {
  try {
    const result = store.update(req.params.table, req.params.id, req.body ?? {}, req.user);
    if (result.error) return res.status(result.status || 400).json({ success: false, error: result.error });
    res.json({ success: true, row: result.row });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Delete one ───────────────────────────────────────────────────────────────

router.delete('/:table/:id', (req, res) => {
  try {
    if (!tableDef(req.params.table)) return res.status(404).json({ success: false, error: 'Unknown table' });
    if (req.params.table === 'users') return res.status(403).json({ success: false, error: 'Manage users via /api/auth' });
    const result = store.remove(req.params.table, req.params.id, req.user);
    if (result.error) return res.status(result.status || 400).json({ success: false, error: result.error });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Clear table (bulk delete) ────────────────────────────────────────────────

router.delete('/:table', (req, res) => {
  try {
    const protected_ = new Set(['users', 'songs', 'song_services', 'service_songs']);
    if (!tableDef(req.params.table)) return res.status(404).json({ success: false, error: 'Unknown table' });
    if (protected_.has(req.params.table)) return res.status(403).json({ success: false, error: 'Cannot bulk-clear this table' });

    const { changes } = db.prepare(`DELETE FROM "${req.params.table}"`).run();
    actionLog.record(req.user, {
      area:    tableDef(req.params.table).area,
      action:  'delete',
      entity:  tableDef(req.params.table).entity,
      summary: `Cleared every row from ${req.params.table} (${changes} removed)`,
      details: { table: req.params.table, removed: changes },
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
