// ─── Elders and deacons ───────────────────────────────────────────────────────
//
// The deacons and what each of them looks after come off the church site; the
// eldership is kept here by hand, because the site does not list it. Both are
// edited by whoever holds the Elders & Deacons area, and both work the same
// way: a person, and the list of responsibilities under their name.
const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { requireAuth, requireApproved, requireArea, holdsArea } = require('../middleware/auth');
const actionLog = require('../lib/actionLog');

const AREA = 'leadership';
const manageOnly = requireArea(AREA);

// The two groups differ only in their table names and which fields a person
// carries, so one set of handlers serves both.
const GROUPS = {
  elders: {
    table:  'elders',
    duties: 'elder_duties',
    key:    'elder_id',
    label:  'elder',
    fields: ['name', 'phone', 'email', 'notes'],
  },
  deacons: {
    table:  'deacons',
    duties: 'deacon_duties',
    key:    'deacon_id',
    label:  'deacon',
    fields: ['name'],
  },
};

router.use(requireAuth);

function groupFor(req, res) {
  const group = GROUPS[req.params.group];
  if (!group) {
    res.status(404).json({ success: false, error: 'Unknown group — expected elders or deacons' });
    return null;
  }
  return group;
}

function peopleIn(group) {
  const rows = db.prepare(`SELECT * FROM "${group.table}" ORDER BY name ASC`).all();
  const duties = db.prepare(`SELECT "${group.key}" AS person_id, duty FROM "${group.duties}" ORDER BY position ASC, id ASC`).all();
  return rows.map(row => ({
    ...row,
    duties: duties.filter(d => d.person_id === row.id).map(d => d.duty),
  }));
}

function personIn(group, id) {
  const row = db.prepare(`SELECT * FROM "${group.table}" WHERE id = ?`).get(id);
  if (!row) return null;
  const duties = db.prepare(`SELECT duty FROM "${group.duties}" WHERE "${group.key}" = ? ORDER BY position ASC, id ASC`).all(id);
  return { ...row, duties: duties.map(d => d.duty) };
}

// Responsibilities arrive as a list and are stored as a list — replaced whole,
// so re-ordering or dropping one is the same operation as adding one.
function saveDuties(group, personId, duties) {
  db.prepare(`DELETE FROM "${group.duties}" WHERE "${group.key}" = ?`).run(personId);
  const ins = db.prepare(`INSERT INTO "${group.duties}" ("${group.key}", duty, position) VALUES (?, ?, ?)`);
  duties
    .map(d => String(d ?? '').trim())
    .filter(Boolean)
    .forEach((duty, i) => ins.run(personId, duty, i));
}

function cleanFields(group, body) {
  const values = {};
  for (const field of group.fields) {
    if (body?.[field] === undefined) continue;
    values[field] = String(body[field] ?? '').trim();
  }
  return values;
}

// ─── GET /api/leadership ──────────────────────────────────────────────────────

router.get('/', (req, res) => {
  res.json({
    success:   true,
    elders:    peopleIn(GROUPS.elders),
    deacons:   peopleIn(GROUPS.deacons),
    bulletins: db.prepare('SELECT id, url, label FROM bulletins ORDER BY id DESC').all(),
    canManage: holdsArea(req.user, AREA),
  });
});

// ─── Adding, editing and removing ─────────────────────────────────────────────

router.post('/:group', requireApproved, manageOnly, (req, res) => {
  const group = groupFor(req, res);
  if (!group) return undefined;

  const values = cleanFields(group, req.body);
  if (!values.name) return res.status(400).json({ success: false, error: `An ${group.label} needs a name` });

  const fields = Object.keys(values);
  const { lastInsertRowid: id } = db.prepare(
    `INSERT INTO "${group.table}" (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`
  ).run(...fields.map(f => values[f]));

  if (Array.isArray(req.body?.duties)) saveDuties(group, id, req.body.duties);

  const person = personIn(group, id);
  actionLog.record(req.user, {
    area: AREA, action: 'create', entity: group.label, entityId: id,
    summary: `Added ${group.label} ${person.name}`,
    after: person,
  });
  return res.json({ success: true, person });
});

router.patch('/:group/:id', requireApproved, manageOnly, (req, res) => {
  const group = groupFor(req, res);
  if (!group) return undefined;

  const before = personIn(group, req.params.id);
  if (!before) return res.status(404).json({ success: false, error: `No such ${group.label}` });

  const values = cleanFields(group, req.body);
  if (values.name === '') return res.status(400).json({ success: false, error: `An ${group.label} needs a name` });

  const fields = Object.keys(values);
  if (fields.length) {
    db.prepare(`UPDATE "${group.table}" SET ${fields.map(f => `${f} = ?`).join(', ')} WHERE id = ?`)
      .run(...fields.map(f => values[f]), before.id);
  }
  if (Array.isArray(req.body?.duties)) saveDuties(group, before.id, req.body.duties);
  if (!fields.length && !Array.isArray(req.body?.duties)) {
    return res.status(400).json({ success: false, error: 'Nothing to change' });
  }

  const after = personIn(group, before.id);
  actionLog.record(req.user, {
    area: AREA, action: 'update', entity: group.label, entityId: before.id,
    summary: `Edited ${group.label} ${after.name}`,
    before: { ...before, duties: before.duties.join(' · ') },
    after:  { ...after,  duties: after.duties.join(' · ') },
  });
  return res.json({ success: true, person: after });
});

router.delete('/:group/:id', requireApproved, manageOnly, (req, res) => {
  const group = groupFor(req, res);
  if (!group) return undefined;

  const before = personIn(group, req.params.id);
  if (!before) return res.status(404).json({ success: false, error: `No such ${group.label}` });

  db.prepare(`DELETE FROM "${group.table}" WHERE id = ?`).run(before.id);   // duties cascade
  actionLog.record(req.user, {
    area: AREA, action: 'delete', entity: group.label, entityId: before.id,
    summary: `Removed ${group.label} ${before.name}`,
    before: { ...before, duties: before.duties.join(' · ') },
  });
  return res.json({ success: true });
});

module.exports = router;
