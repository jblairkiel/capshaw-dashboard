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

// Every follow-up a guest has had: who was asked, who actually reached them,
// how, and when. The workflow keeps which guest it is about in its own data, so
// that is where this reads it from, and the workflow's own history stays the
// record of what happened — this is a reading of it, not a second copy.
//
// Read for every guest at once rather than per guest: the page shows the whole
// list, and one query beats one per name.
const FOLLOW_UP = 'visitor-follow-up';

function followUpIndex() {
  const instances = db.prepare(`
    SELECT i.id, i.status, i.outcome, i.step_id, i.created_at, i.completed_at, i.data,
           starter.name AS started_by,
           json_extract(i.data, '$.visitorId') AS visitor_id
      FROM workflow_instances i
      LEFT JOIN users starter ON starter.id = i.created_by
     WHERE i.definition_id = ?
     ORDER BY i.id ASC
  `).all(FOLLOW_UP);

  // What was actually done on each round, and by whom. A follow-up can go
  // round more than once — no answer, try again — and each attempt is somebody
  // taking the trouble, so each is kept rather than only the one that landed.
  const rounds = new Map();
  for (const task of db.prepare(`
    SELECT t.instance_id, t.action, t.note, t.completed_at, doer.name AS done_by
      FROM workflow_tasks t
      JOIN workflow_instances i ON i.id = t.instance_id
      LEFT JOIN users doer ON doer.id = t.completed_by
     WHERE i.definition_id = ? AND t.status = 'done'
     ORDER BY t.id ASC
  `).all(FOLLOW_UP)) {
    if (!rounds.has(task.instance_id)) rounds.set(task.instance_id, []);
    rounds.get(task.instance_id).push({
      action: task.action || '',
      by:     task.done_by || '',
      at:     task.completed_at || '',
      note:   task.note || '',
    });
  }

  const byVisitor = new Map();
  for (const row of instances) {
    let data = {};
    try { data = JSON.parse(row.data || '{}'); } catch { data = {}; }

    const key = String(row.visitor_id ?? '');
    if (!key) continue;
    if (!byVisitor.has(key)) byVisitor.set(key, []);
    byVisitor.get(key).push({
      id:          row.id,
      status:      row.status,
      outcome:     row.outcome || '',
      step:        row.step_id || '',
      startedAt:   row.created_at,
      completedAt: row.completed_at || '',
      startedBy:   row.started_by || '',
      // Who was asked to reach out, and who did — not always the same person,
      // because a follow-up somebody cannot take is handed on.
      assignedTo:  data.assigneeName || '',
      contactedBy: data.contactedBy || '',
      method:      data.contactMethod || '',
      rounds:      rounds.get(row.id) || [],
    });
  }
  return byVisitor;
}

// The shape the page reads: whether one is under way, how the last one ended,
// and the whole run of them.
function followUpFrom(history = []) {
  const active   = [...history].reverse().find(h => h.status === 'active');
  const finished = [...history].reverse().find(h => h.status === 'completed');

  return {
    active:   active ? { id: active.id, step: active.step, since: active.startedAt, assignedTo: active.assignedTo } : null,
    lastDone: finished
      ? {
        id: finished.id, outcome: finished.outcome, at: finished.completedAt,
        by: finished.contactedBy, method: finished.method,
      }
      : null,
    history: [...history].reverse(),
  };
}

function followUpFor(id) {
  return followUpFrom(followUpIndex().get(String(id)) || []);
}

function withVisits(row) {
  return row ? { ...row, visits: visitsOf(row.id), followUp: followUpFor(row.id) } : null;
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

  // One read of the follow-ups for the whole list rather than one per guest.
  const follow = followUpIndex();
  const visitors = rows.map(row => ({
    ...row,
    visits:   visitsOf(row.id),
    followUp: followUpFrom(follow.get(String(row.id)) || []),
  }));

  res.json({ success: true, visitors, canManage: holdsArea(req.user, AREA) });
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
