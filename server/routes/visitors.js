// ─── Our guests ───────────────────────────────────────────────────────────────
//
// The church site only ever told us a guest's name and the dates they came, so
// the page could show little more than a visit history. Everything else worth
// knowing — how to reach them, who invited them, what was said, where the
// follow-up got to — is kept here and typed in by whoever looks after the
// Guest Tracker.
//
// Reading is open to everybody signed in; writing is the area's.
const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { requireAuth, requireApproved, requireArea, holdsArea } = require('../middleware/auth');
const actionLog = require('../lib/actionLog');

const AREA = 'visitors';
const manageOnly = requireArea(AREA);

// What somebody may type in about a guest. `name` is the only one that matters.
const FIELDS = ['name', 'phone', 'email', 'address', 'city', 'state', 'zip', 'invited_by', 'status', 'notes'];

router.use(requireAuth);

function visitorRow(id) {
  return db.prepare('SELECT * FROM visitors WHERE id = ?').get(id);
}

function visitsOf(id) {
  return db.prepare('SELECT id, date, service FROM visitor_visits WHERE visitor_id = ? ORDER BY id ASC').all(id);
}

function withVisits(row) {
  return row ? { ...row, visits: visitsOf(row.id) } : null;
}

function cleanFields(body) {
  const values = {};
  for (const field of FIELDS) {
    if (body?.[field] === undefined) continue;
    values[field] = String(body[field] ?? '').trim();
  }
  return values;
}

// ─── GET /api/visitors ────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const search = String(req.query.search || '').trim();
  const rows = search
    ? db.prepare('SELECT * FROM visitors WHERE name LIKE ? ORDER BY name ASC').all(`%${search}%`)
    : db.prepare('SELECT * FROM visitors ORDER BY name ASC').all();

  res.json({ success: true, visitors: rows.map(withVisits), canManage: holdsArea(req.user, AREA) });
});

router.get('/:id', (req, res) => {
  const row = visitorRow(req.params.id);
  if (!row) return res.status(404).json({ success: false, error: 'No such guest' });
  res.json({ success: true, visitor: withVisits(row), canManage: holdsArea(req.user, AREA) });
});

// ─── Adding, editing and removing a guest ─────────────────────────────────────

router.post('/', requireApproved, manageOnly, (req, res) => {
  const values = cleanFields(req.body);
  if (!values.name) return res.status(400).json({ success: false, error: 'A guest needs a name' });

  const fields = Object.keys(values);
  const { lastInsertRowid: id } = db.prepare(
    `INSERT INTO visitors (${fields.join(', ')}, created_at) VALUES (${fields.map(() => '?').join(', ')}, datetime('now'))`
  ).run(...fields.map(f => values[f]));

  // A guest is usually added because they have just been, so the first visit
  // can come in with them rather than needing a second trip to the page.
  const firstVisit = req.body?.visit;
  if (firstVisit?.date) {
    db.prepare('INSERT INTO visitor_visits (visitor_id, date, service) VALUES (?, ?, ?)')
      .run(id, String(firstVisit.date).trim(), String(firstVisit.service || '').trim());
  }

  const row = withVisits(visitorRow(id));
  actionLog.record(req.user, {
    area: AREA, action: 'create', entity: 'guest', entityId: id,
    summary: `Added guest ${row.name}`,
    after: row,
  });
  res.json({ success: true, visitor: row });
});

router.patch('/:id', requireApproved, manageOnly, (req, res) => {
  const before = visitorRow(req.params.id);
  if (!before) return res.status(404).json({ success: false, error: 'No such guest' });

  const values = cleanFields(req.body);
  const fields = Object.keys(values);
  if (!fields.length) return res.status(400).json({ success: false, error: 'Nothing to change' });
  if (fields.includes('name') && !values.name) {
    return res.status(400).json({ success: false, error: 'A guest needs a name' });
  }

  db.prepare(`UPDATE visitors SET ${fields.map(f => `${f} = ?`).join(', ')} WHERE id = ?`)
    .run(...fields.map(f => values[f]), before.id);

  const after = visitorRow(before.id);
  actionLog.record(req.user, {
    area: AREA, action: 'update', entity: 'guest', entityId: before.id,
    summary: `Edited guest ${after.name}`,
    before, after,
  });
  res.json({ success: true, visitor: withVisits(after) });
});

router.delete('/:id', requireApproved, manageOnly, (req, res) => {
  const before = visitorRow(req.params.id);
  if (!before) return res.status(404).json({ success: false, error: 'No such guest' });

  db.prepare('DELETE FROM visitors WHERE id = ?').run(before.id);   // visits cascade
  actionLog.record(req.user, {
    area: AREA, action: 'delete', entity: 'guest', entityId: before.id,
    summary: `Deleted guest ${before.name}`,
    before,
  });
  res.json({ success: true });
});

// ─── Visits ───────────────────────────────────────────────────────────────────

router.post('/:id/visits', requireApproved, manageOnly, (req, res) => {
  const guest = visitorRow(req.params.id);
  if (!guest) return res.status(404).json({ success: false, error: 'No such guest' });

  const date    = String(req.body?.date || '').trim();
  const service = String(req.body?.service || '').trim();
  if (!date) return res.status(400).json({ success: false, error: 'A visit needs a date' });

  const { lastInsertRowid: id } = db
    .prepare('INSERT INTO visitor_visits (visitor_id, date, service) VALUES (?, ?, ?)')
    .run(guest.id, date, service);

  actionLog.record(req.user, {
    area: AREA, action: 'create', entity: 'guest visit', entityId: id,
    summary: `Recorded a visit by ${guest.name} on ${date}${service ? ` (${service})` : ''}`,
    details: { visitor: guest.name, date, service },
  });
  res.json({ success: true, visitor: withVisits(visitorRow(guest.id)) });
});

router.delete('/:id/visits/:visitId', requireApproved, manageOnly, (req, res) => {
  const guest = visitorRow(req.params.id);
  if (!guest) return res.status(404).json({ success: false, error: 'No such guest' });

  const visit = db.prepare('SELECT * FROM visitor_visits WHERE id = ? AND visitor_id = ?')
    .get(req.params.visitId, guest.id);
  if (!visit) return res.status(404).json({ success: false, error: 'No such visit' });

  db.prepare('DELETE FROM visitor_visits WHERE id = ?').run(visit.id);
  actionLog.record(req.user, {
    area: AREA, action: 'delete', entity: 'guest visit', entityId: visit.id,
    summary: `Removed ${guest.name}'s visit on ${visit.date}`,
    before: visit,
  });
  res.json({ success: true, visitor: withVisits(visitorRow(guest.id)) });
});

module.exports = router;
