// ─── Action history ───────────────────────────────────────────────────────────
//
// Every change anybody makes through the portal lands here, so an admin can
// answer "who changed this, and when?" without guessing. Recording is a side
// effect of a change that has already succeeded: it must never be the reason a
// save fails, so a write that cannot be logged is reported to the console and
// otherwise ignored.
const db = require('../db');

const ACTIONS = ['create', 'update', 'delete', 'other'];

function normaliseAction(action) {
  return ACTIONS.includes(action) ? action : 'other';
}

// Only the fields that actually changed, with what they were and what they
// became. Comparing as text keeps 3 and '3' from looking like a change, which
// is what SQLite hands back for an integer column edited through a form.
function diffOf(before, after) {
  if (!before || !after) return null;
  const changes = {};
  for (const key of Object.keys(after)) {
    const from = before[key];
    const to   = after[key];
    if (from === undefined) continue;
    if (String(from ?? '') === String(to ?? '')) continue;
    changes[key] = { from, to };
  }
  return Object.keys(changes).length ? changes : null;
}

function safeJson(value) {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return '{}';
  }
}

/**
 * Record one change.
 *
 * @param {object|null} actor   req.user, or null for something the site did itself
 * @param {object} entry
 * @param {string} entry.area      which area of responsibility this belongs to
 * @param {string} entry.action    create | update | delete | other
 * @param {string} entry.entity    what kind of thing changed ('announcement', 'visitor', …)
 * @param {string|number} [entry.entityId]
 * @param {string} entry.summary   one line, readable without opening the details
 * @param {object} [entry.details] anything worth keeping: before/after, counts, …
 * @param {object} [entry.before]  shorthand: diffed against `after` into details.changes
 * @param {object} [entry.after]
 */
function record(actor, entry = {}) {
  try {
    const details = { ...(entry.details || {}) };
    const changes = diffOf(entry.before, entry.after);
    if (changes) details.changes = changes;
    else if (entry.before && !entry.after) details.removed = entry.before;
    else if (entry.after && !entry.before) details.created = entry.after;

    db.prepare(`
      INSERT INTO action_log (user_id, user_name, area, action, entity, entity_id, summary, details)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      actor?.id ?? null,
      actor?.name || (actor ? '' : 'the site'),
      entry.area   || '',
      normaliseAction(entry.action),
      entry.entity || '',
      entry.entityId === undefined || entry.entityId === null ? '' : String(entry.entityId),
      entry.summary || '',
      safeJson(details),
    );
  } catch (err) {
    // A history that cannot be written is worth a shout, but never worth
    // undoing the change it was describing.
    console.error('[action-log] could not record an entry:', err.message);
  }
}

// ─── Reading it back ──────────────────────────────────────────────────────────

function list({ area = '', action = '', userId = null, entity = '', search = '', limit = 100, offset = 0 } = {}) {
  const where  = [];
  const params = [];
  if (area)   { where.push('area = ?');      params.push(area); }
  if (action) { where.push('action = ?');    params.push(action); }
  if (entity) { where.push('entity = ?');    params.push(entity); }
  if (userId) { where.push('user_id = ?');   params.push(Number(userId)); }
  if (search) {
    where.push('(summary LIKE ? OR user_name LIKE ? OR entity LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = db.prepare(`
    SELECT id, user_id, user_name, area, action, entity, entity_id, summary, details, created_at
      FROM action_log ${clause}
     ORDER BY id DESC
     LIMIT ? OFFSET ?
  `).all(...params, Math.min(Number(limit) || 100, 500), Number(offset) || 0)
    .map(r => ({ ...r, details: parseDetails(r.details) }));

  const total = db.prepare(`SELECT COUNT(*) AS n FROM action_log ${clause}`).get(...params).n;
  return { rows, total };
}

function parseDetails(json) {
  try { return JSON.parse(json || '{}'); } catch { return {}; }
}

module.exports = { record, list, diffOf, ACTIONS };
