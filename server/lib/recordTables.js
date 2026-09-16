// The congregation's records, and who looks after each of them.
//
// One registry, used by both the area-gated screens (/api/records, where
// somebody who looks after attendance may edit attendance and nothing else)
// and the admin database editor (/api/admin, where an admin may edit anything).
// Keeping them on one definition means a column added for a feature cannot be
// writable in one place and missing in the other.

const TABLES = {
  // Kept by an admin rather than by an area: the list of services is what
  // every attendance record has to agree on, so it is not one page's to
  // change. Everybody can read it — the attendance form is built from it.
  service_types: {
    area:      'attendance',
    writeRole: 'admin',
    entity:    'service type',
    columns:   ['id', 'name', 'sort_order', 'active', 'created_at'],
    writable:  ['name', 'sort_order', 'active'],
    search:    'name',
    order:     'sort_order ASC, name ASC',
    describe:  r => r.name || 'a service type',
  },
  attendance: {
    area:     'attendance',
    entity:   'attendance record',
    columns:  ['id', 'date', 'service', 'count'],
    writable: ['date', 'service', 'count'],
    search:   'service',
    order:    'date DESC',
    describe: r => `${r.date || 'undated'} · ${r.service || 'service'} · ${r.count ?? 0}`,
  },
  sermons: {
    area:     'worship-order',
    entity:   'sermon',
    columns:  ['id', 'date', 'title', 'speaker', 'type', 'series', 'service'],
    writable: ['date', 'title', 'speaker', 'type', 'series', 'service'],
    search:   'title',
    order:    'date DESC',
    describe: r => `${r.title || 'Untitled'}${r.speaker ? ` — ${r.speaker}` : ''}`,
  },
  job_assignments: {
    area:     'serving-schedule',
    entity:   'serving assignment',
    columns:  ['id', 'month', 'date', 'service', 'job', 'name'],
    writable: ['month', 'date', 'service', 'job', 'name'],
    search:   'name',
    order:    'month DESC, date ASC',
    describe: r => `${r.job || 'job'} on ${r.date || r.month || 'an unset date'} — ${r.name || 'nobody yet'}`,
  },
  visitors: {
    area:     'visitors',
    entity:   'guest',
    columns:  ['id', 'name', 'phone', 'email', 'address', 'city', 'state', 'zip', 'invited_by', 'status', 'notes', 'created_at'],
    writable: ['name', 'phone', 'email', 'address', 'city', 'state', 'zip', 'invited_by', 'status', 'notes'],
    search:   'name',
    order:    'name ASC',
    describe: r => r.name || 'a guest',
  },
  visitor_visits: {
    area:     'visitors',
    entity:   'guest visit',
    columns:  ['id', 'visitor_id', 'date', 'service'],
    writable: ['visitor_id', 'date', 'service'],
    search:   'service',
    order:    'date DESC',
    describe: r => `visit on ${r.date || 'an unset date'}${r.service ? ` · ${r.service}` : ''}`,
  },
  anniversaries: {
    area:     'directory',
    entity:   'birthday or anniversary',
    columns:  ['id', 'month', 'date', 'names', 'month_num', 'day'],
    writable: ['month', 'date', 'names', 'month_num', 'day'],
    search:   'names',
    order:    'month_num ASC, day ASC',
    describe: r => `${r.names || 'somebody'} on ${r.date || 'an unset date'}`,
  },
  elders: {
    area:     'leadership',
    entity:   'elder',
    columns:  ['id', 'name', 'phone', 'email', 'notes'],
    writable: ['name', 'phone', 'email', 'notes'],
    search:   'name',
    order:    'name ASC',
    describe: r => r.name || 'an elder',
  },
  elder_duties: {
    area:     'leadership',
    entity:   "elder's responsibility",
    columns:  ['id', 'elder_id', 'duty', 'position'],
    writable: ['elder_id', 'duty', 'position'],
    search:   'duty',
    order:    'elder_id ASC, position ASC',
    describe: r => r.duty || 'a responsibility',
  },
  deacons: {
    area:     'leadership',
    entity:   'deacon',
    columns:  ['id', 'name'],
    writable: ['name'],
    search:   'name',
    order:    'name ASC',
    describe: r => r.name || 'a deacon',
  },
  deacon_duties: {
    area:     'leadership',
    entity:   "deacon's responsibility",
    columns:  ['id', 'deacon_id', 'duty', 'position'],
    writable: ['deacon_id', 'duty', 'position'],
    search:   'duty',
    order:    'deacon_id ASC, position ASC',
    describe: r => r.duty || 'a responsibility',
  },
  bulletins: {
    area:     'leadership',
    entity:   'bulletin',
    columns:  ['id', 'url', 'label'],
    writable: ['url', 'label'],
    search:   'label',
    order:    'id DESC',
    describe: r => r.label || r.url || 'a bulletin',
  },
  directory: {
    area:   'directory',
    entity: 'directory entry',
    // `photo` is readable so the directory can render it, but not writable —
    // photos come from the vCard sync, not from typing a filename.
    columns:  ['id', 'name', 'address', 'city', 'state', 'zip', 'phone', 'cell', 'email', 'notes', 'gender', 'photo'],
    writable: ['name', 'address', 'city', 'state', 'zip', 'phone', 'cell', 'email', 'notes', 'gender'],
    search:   'name',
    order:    'name ASC',
    describe: r => r.name || 'a member',
  },
  announcements: {
    area:     'announcements',
    entity:   'announcement',
    // The calendar is the same table seen by date, so whoever looks after it
    // may edit the dated rows. routes/announcements.js enforces that split.
    alsoArea: 'calendar',
    columns:  ['id', 'type', 'title', 'body', 'event_date', 'event_time', 'location', 'priority', 'active', 'created_at'],
    writable: ['type', 'title', 'body', 'event_date', 'event_time', 'location', 'priority', 'active'],
    search:   'title',
    order:    'created_at DESC',
    describe: r => r.title || 'an announcement',
  },
  songs: {
    area:     'songs',
    entity:   'song',
    columns:  ['id', 'title', 'hymnal', 'number'],
    writable: ['title', 'hymnal', 'number'],
    search:   'title',
    order:    'title ASC',
    describe: r => r.title || 'a song',
  },
  song_services: {
    area:     'songs',
    entity:   'song service',
    columns:  ['id', 'date', 'service', 'leader'],
    writable: ['date', 'service', 'leader'],
    search:   'leader',
    order:    'date DESC',
    describe: r => `${r.date || 'undated'} · ${r.service || 'service'}${r.leader ? ` — ${r.leader}` : ''}`,
  },
};

// Every table name this module will ever put in a query, as literals from this
// file rather than strings from a request.
const TABLE_NAMES = Object.keys(TABLES);

// Looks a table up by what somebody asked for, and hands back *our* name for
// it. The distinction matters: `def.name` is the literal above, matched against
// the request rather than taken from it, so the SQL built around it is never
// assembled out of anything a caller sent.
function tableDef(requested) {
  const name = TABLE_NAMES.find(known => known === requested);
  return name ? { ...TABLES[name], name } : null;
}

// Which areas may write this table at all. The gate itself still lives in the
// route, because some tables (announcements) split by row rather than wholesale.
//
// A table carrying `writeRole` is nobody's area to write — admins only — so it
// answers with no areas at all rather than with the area it is filed under for
// reading.
function areasForTable(name) {
  const def = tableDef(name);
  if (!def) return [];
  if (def.writeRole) return [];
  return [def.area, def.alsoArea].filter(Boolean);
}

function describeRow(name, row) {
  const def = tableDef(name);
  if (!def || !row) return '';
  try { return def.describe(row); } catch { return ''; }
}

module.exports = { TABLES, TABLE_NAMES, tableDef, areasForTable, describeRow };
