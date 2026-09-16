// Reading and writing the record tables, in one place.
//
// Both the area-gated screens (/api/records) and the admin database editor
// (/api/admin) go through here, so a change made from either is filtered,
// sorted and — most importantly — recorded in the action history the same way.
const db = require('../db');
const { tableDef, describeRow } = require('./recordTables');
const actionLog = require('./actionLog');

function getRow(table, def, id) {
  return db.prepare(`SELECT ${def.columns.join(', ')} FROM "${table}" WHERE id = ?`).get(id);
}

function list(table, query = {}) {
  const def = tableDef(table);
  if (!def) return null;

  const limit  = Math.min(parseInt(query.limit, 10) || 100, 2000);
  const offset = parseInt(query.offset, 10) || 0;

  // Sort: only ever a column this table declares, never something off the query
  // string, so the ordering clause can never carry anything but a known name.
  const sortCol = def.columns.includes(query.sort) ? query.sort : null;
  const sortDir = query.dir === 'asc' ? 'ASC' : 'DESC';
  const order   = sortCol ? `"${sortCol}" ${sortDir}` : def.order;

  const conditions = [];
  const params     = [];
  for (const col of def.columns) {
    const val = query[`f_${col}`]?.trim?.();
    if (val) {
      conditions.push(`"${col}" LIKE ?`);
      params.push(`%${val}%`);
    }
  }
  const search = query.search?.trim?.();
  if (search && def.search) {
    conditions.push(`"${def.search}" LIKE ?`);
    params.push(`%${search}%`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = db.prepare(
    `SELECT ${def.columns.join(', ')} FROM "${table}" ${where} ORDER BY ${order} LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM "${table}" ${where}`).get(...params).n;

  return { rows, total, limit, offset };
}

function create(table, body, actor, area) {
  const def = tableDef(table);
  if (!def) return { error: 'Unknown table', status: 404 };

  const fields = def.writable.filter(f => body[f] !== undefined);
  if (!fields.length) return { error: 'No valid fields', status: 400 };

  const result = db.prepare(
    `INSERT INTO "${table}" (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`
  ).run(...fields.map(f => body[f] ?? null));

  const row = getRow(table, def, result.lastInsertRowid);
  actionLog.record(actor, {
    area:     area || def.area,
    action:   'create',
    entity:   def.entity,
    entityId: row?.id,
    summary:  `Added ${def.entity} — ${describeRow(table, row)}`,
    after:    row,
  });
  return { row };
}

function update(table, id, body, actor, area) {
  const def = tableDef(table);
  if (!def) return { error: 'Unknown table', status: 404 };

  const before = getRow(table, def, id);
  if (!before) return { error: 'Not found', status: 404 };

  const fields = def.writable.filter(f => body[f] !== undefined);
  if (!fields.length) return { error: 'No valid fields', status: 400 };

  db.prepare(
    `UPDATE "${table}" SET ${fields.map(f => `${f} = ?`).join(', ')} WHERE id = ?`
  ).run(...fields.map(f => body[f] ?? null), id);

  const row = getRow(table, def, id);
  actionLog.record(actor, {
    area:     area || def.area,
    action:   'update',
    entity:   def.entity,
    entityId: id,
    summary:  `Edited ${def.entity} — ${describeRow(table, row)}`,
    before,
    after:    row,
  });
  return { row };
}

function remove(table, id, actor, area) {
  const def = tableDef(table);
  if (!def) return { error: 'Unknown table', status: 404 };

  // Deleting something that is already gone is the outcome the caller wanted,
  // so it succeeds quietly rather than erroring — there is just nothing to
  // record, since nothing changed.
  const before = getRow(table, def, id);
  if (!before) return { ok: true, missing: true };

  db.prepare(`DELETE FROM "${table}" WHERE id = ?`).run(id);
  actionLog.record(actor, {
    area:     area || def.area,
    action:   'delete',
    entity:   def.entity,
    entityId: id,
    summary:  `Deleted ${def.entity} — ${describeRow(table, before)}`,
    before,
  });
  return { ok: true };
}

module.exports = { list, create, update, remove, getRow };
