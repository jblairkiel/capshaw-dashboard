// ─── The records each area looks after ────────────────────────────────────────
//
// One shape of endpoint for every table a page can edit, gated by the area that
// owns it: somebody who looks after attendance gets the Add button on
// Attendance and may edit and delete what is there, and nothing else about
// their access changes. Admins reach every table here as well as through the
// database editor.
//
// Reading is open to anybody signed in — the portal is members-only already,
// and these are the same rows the pages have always rendered.
const express = require('express');
const router  = express.Router();
const { requireAuth, requireApproved, holdsArea, hasRole, areaLabel } = require('../middleware/auth');
const { TABLES, tableDef, areasForTable } = require('../lib/recordTables');
const store = require('../lib/recordStore');

router.use(requireAuth);

// Which of these tables this person may write, so a page can decide whether to
// show its Add button without hard-coding the rules on the client.
router.get('/', (req, res) => {
  const tables = {};
  for (const name of Object.keys(TABLES)) {
    tables[name] = { areas: areasForTable(name), canWrite: canWrite(req.user, name) };
  }
  res.json({ success: true, tables });
});

function canWrite(user, table) {
  // A table that names a role instead of an area is that role's alone — the
  // service types are the list every attendance record agrees on, so they are
  // not one page's to change.
  const def = tableDef(table);
  if (def?.writeRole) return hasRole(user, def.writeRole);
  return areasForTable(table).some(area => holdsArea(user, area));
}

// The area this write is being made under — the first one the person holds, so
// the history says "Attendance" rather than guessing.
function areaUsed(user, table) {
  return areasForTable(table).find(area => holdsArea(user, area)) || tableDef(table)?.area;
}

function guard(req, res, next) {
  const def = tableDef(req.params.table);
  if (!def) return res.status(404).json({ success: false, error: 'Unknown table' });
  if (canWrite(req.user, req.params.table)) return next();

  const areas = areasForTable(req.params.table);
  return res.status(403).json({
    success: false,
    error: areas.length
      ? `You do not look after ${areas.map(areaLabel).join(' or ')}. Ask an admin if you should.`
      : `${def.entity ? `The ${def.entity} list is` : 'This is'} kept by an admin. Ask one to change it.`,
    areas,
  });
}

router.get('/:table', (req, res) => {
  const result = store.list(req.params.table, req.query);
  if (!result) return res.status(404).json({ success: false, error: 'Unknown table' });
  res.json({ success: true, ...result, canWrite: canWrite(req.user, req.params.table) });
});

router.post('/:table', requireApproved, guard, (req, res) => {
  const result = store.create(req.params.table, req.body ?? {}, req.user, areaUsed(req.user, req.params.table));
  if (result.error) return res.status(result.status || 400).json({ success: false, error: result.error });
  res.json({ success: true, row: result.row });
});

router.patch('/:table/:id', requireApproved, guard, (req, res) => {
  const result = store.update(req.params.table, req.params.id, req.body ?? {}, req.user, areaUsed(req.user, req.params.table));
  if (result.error) return res.status(result.status || 400).json({ success: false, error: result.error });
  res.json({ success: true, row: result.row });
});

router.delete('/:table/:id', requireApproved, guard, (req, res) => {
  const result = store.remove(req.params.table, req.params.id, req.user, areaUsed(req.user, req.params.table));
  if (result.error) return res.status(result.status || 400).json({ success: false, error: result.error });
  res.json({ success: true });
});

module.exports = router;
