const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { requireAuth } = require('../middleware/auth');
const { readData, saveScraped } = require('./scraper');
const { PHOTO_DIR } = require('../lib/directory');
const fs   = require('fs');
const path = require('path');

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ success: false, error: 'Admin only' });
  next();
}

router.use(requireAuth, requireAdmin);

// ─── Table definitions ────────────────────────────────────────────────────────
// Each entry describes columns (for SELECT), writable fields (for INSERT/UPDATE),
// and an optional search column.

const TABLES = {
  attendance: {
    columns:  ['id', 'date', 'service', 'count'],
    writable: ['date', 'service', 'count'],
    search:   'service',
    order:    'date DESC',
  },
  sermons: {
    columns:  ['id', 'date', 'title', 'speaker', 'type', 'series', 'service'],
    writable: ['date', 'title', 'speaker', 'type', 'series', 'service'],
    search:   'title',
    order:    'date DESC',
  },
  job_assignments: {
    columns:  ['id', 'month', 'date', 'service', 'job', 'name'],
    writable: ['month', 'date', 'service', 'job', 'name'],
    search:   'name',
    order:    'month DESC, date ASC',
  },
  visitors: {
    columns:  ['id', 'name'],
    writable: ['name'],
    search:   'name',
    order:    'name ASC',
  },
  visitor_visits: {
    columns:  ['id', 'visitor_id', 'date', 'service'],
    writable: ['visitor_id', 'date', 'service'],
    search:   'service',
    order:    'date DESC',
  },
  anniversaries: {
    columns:  ['id', 'month', 'date', 'names', 'month_num', 'day'],
    writable: ['month', 'date', 'names', 'month_num', 'day'],
    search:   'names',
    order:    'month_num ASC, day ASC',
  },
  deacons: {
    columns:  ['id', 'name'],
    writable: ['name'],
    search:   'name',
    order:    'name ASC',
  },
  deacon_duties: {
    columns:  ['id', 'deacon_id', 'duty', 'position'],
    writable: ['deacon_id', 'duty', 'position'],
    search:   'duty',
    order:    'deacon_id ASC, position ASC',
  },
  bulletins: {
    columns:  ['id', 'url', 'label'],
    writable: ['url', 'label'],
    search:   'label',
    order:    'id DESC',
  },
  directory: {
    columns:  ['id', 'name', 'address', 'city', 'state', 'zip', 'phone', 'cell', 'email', 'notes', 'family_id'],
    writable: ['name', 'address', 'city', 'state', 'zip', 'phone', 'cell', 'email', 'notes', 'family_id'],
    search:   'name',
    order:    'name ASC',
  },
  directory_families: {
    columns:  ['id', 'name', 'address', 'city', 'state', 'zip', 'photo_file', 'photo_version'],
    writable: ['name', 'address', 'city', 'state', 'zip'],
    search:   'name',
    order:    'name ASC',
  },
  announcements: {
    columns:  ['id', 'type', 'title', 'body', 'event_date', 'event_time', 'location', 'priority', 'active', 'created_at'],
    writable: ['type', 'title', 'body', 'event_date', 'event_time', 'location', 'priority', 'active'],
    search:   'title',
    order:    'created_at DESC',
  },
  songs: {
    columns:  ['id', 'title', 'hymnal', 'number'],
    writable: ['title', 'hymnal', 'number'],
    search:   'title',
    order:    'title ASC',
  },
  song_services: {
    columns:  ['id', 'date', 'service', 'leader'],
    writable: ['date', 'service', 'leader'],
    search:   'leader',
    order:    'date DESC',
  },
};

// ─── Import from JSON cache (seeds DB without a live scrape) ─────────────────

router.post('/import-cache', (req, res) => {
  try {
    const data = readData();
    if (!data) return res.status(404).json({ success: false, error: 'No cached data found. Run a scrape first.' });

    saveScraped(data);

    const counts = {};
    for (const table of ['attendance', 'sermons', 'job_assignments', 'visitors', 'anniversaries', 'deacons', 'bulletins', 'directory_families', 'directory']) {
      counts[table] = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    }
    res.json({ success: true, counts });
  } catch (err) {
    console.error('[admin] import-cache failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Directory families ───────────────────────────────────────────────────────

// The directory grouped the way the church site groups it, with each family's
// scraped photo. Members with no family_id are collected under a null-id bucket
// so hand-added rows stay visible.
router.get('/directory-families', (req, res) => {
  try {
    const families = db.prepare('SELECT * FROM directory_families ORDER BY name ASC').all();
    const members  = db.prepare('SELECT * FROM directory ORDER BY name ASC').all();

    const byFamily = new Map(families.map(f => [f.id, { ...f, photoUrl: f.photo_file ? `/api/admin/directory-photo/${f.id}` : null, members: [] }]));
    const unassigned = [];
    for (const m of members) {
      const fam = m.family_id != null ? byFamily.get(m.family_id) : null;
      (fam ? fam.members : unassigned).push(m);
    }

    const rows = [...byFamily.values()];
    if (unassigned.length) {
      rows.push({ id: null, name: 'Unassigned', address: '', city: '', state: '', zip: '', photo_file: '', photoUrl: null, members: unassigned });
    }
    res.json({ success: true, families: rows, memberCount: members.length });
  } catch (err) {
    console.error('[admin] directory-families failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Photos live on disk (server/data/photos), not in the DB — they are re-scraped
// rather than backed up, and the source CDN links expire.
router.get('/directory-photo/:familyId', (req, res) => {
  const fam = db.prepare('SELECT photo_file FROM directory_families WHERE id = ?').get(req.params.familyId);
  if (!fam || !fam.photo_file) return res.status(404).json({ success: false, error: 'No photo for this family' });

  // photo_file is written by our own scraper, but never trust a stored path.
  const file = path.basename(fam.photo_file);
  const full = path.join(PHOTO_DIR, file);
  if (!fs.existsSync(full)) return res.status(404).json({ success: false, error: 'Photo file missing — re-run the directory scrape' });

  res.sendFile(full, { maxAge: '1h' });
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
  { key: 'directoryFamilies', label: 'Directory Families', table: 'directory_families', dateCol: null },
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

// ─── Generic list ─────────────────────────────────────────────────────────────

router.get('/:table', (req, res) => {
  try {
    const def = TABLES[req.params.table];
    if (!def) return res.status(404).json({ success: false, error: 'Unknown table' });

    const limit  = Math.min(parseInt(req.query.limit) || 100, 500);
    const offset = parseInt(req.query.offset) || 0;

    // Sort: only allow columns in this table's definition
    const sortCol = def.columns.includes(req.query.sort) ? req.query.sort : null;
    const sortDir = req.query.dir === 'asc' ? 'ASC' : 'DESC';
    const order   = sortCol ? `"${sortCol}" ${sortDir}` : def.order;

    // Per-column filters via f_<col>=value
    const conditions = [];
    const params     = [];
    for (const col of def.columns) {
      const val = req.query[`f_${col}`]?.trim();
      if (val) {
        conditions.push(`"${col}" LIKE ?`);
        params.push(`%${val}%`);
      }
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows  = db.prepare(`SELECT ${def.columns.join(', ')} FROM "${req.params.table}" ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, limit, offset);
    const total = db.prepare(`SELECT COUNT(*) AS n FROM "${req.params.table}" ${where}`).get(...params).n;

    res.json({ success: true, rows, total, limit, offset });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Create ───────────────────────────────────────────────────────────────────

router.post('/:table', (req, res) => {
  try {
    const def = TABLES[req.params.table];
    if (!def) return res.status(404).json({ success: false, error: 'Unknown table' });

    const fields = def.writable.filter(f => req.body[f] !== undefined);
    if (!fields.length) return res.status(400).json({ success: false, error: 'No valid fields' });

    const result = db.prepare(
      `INSERT INTO "${req.params.table}" (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`
    ).run(...fields.map(f => req.body[f] ?? null));

    const row = db.prepare(`SELECT ${def.columns.join(', ')} FROM "${req.params.table}" WHERE id = ?`).get(result.lastInsertRowid);
    res.json({ success: true, row });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Update ───────────────────────────────────────────────────────────────────

router.patch('/:table/:id', (req, res) => {
  try {
    const def = TABLES[req.params.table];
    if (!def) return res.status(404).json({ success: false, error: 'Unknown table' });

    const fields = def.writable.filter(f => req.body[f] !== undefined);
    if (!fields.length) return res.status(400).json({ success: false, error: 'No valid fields' });

    db.prepare(
      `UPDATE "${req.params.table}" SET ${fields.map(f => `${f} = ?`).join(', ')} WHERE id = ?`
    ).run(...fields.map(f => req.body[f] ?? null), req.params.id);

    const row = db.prepare(`SELECT ${def.columns.join(', ')} FROM "${req.params.table}" WHERE id = ?`).get(req.params.id);
    res.json({ success: true, row });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Delete one ───────────────────────────────────────────────────────────────

router.delete('/:table/:id', (req, res) => {
  try {
    if (!TABLES[req.params.table]) return res.status(404).json({ success: false, error: 'Unknown table' });
    if (req.params.table === 'users') return res.status(403).json({ success: false, error: 'Manage users via /api/auth' });
    db.prepare(`DELETE FROM "${req.params.table}" WHERE id = ?`).run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Clear table (bulk delete) ────────────────────────────────────────────────

router.delete('/:table', (req, res) => {
  try {
    const protected_ = new Set(['users', 'songs', 'song_services', 'service_songs']);
    if (!TABLES[req.params.table]) return res.status(404).json({ success: false, error: 'Unknown table' });
    if (protected_.has(req.params.table)) return res.status(403).json({ success: false, error: 'Cannot bulk-clear this table' });
    db.prepare(`DELETE FROM "${req.params.table}"`).run();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
