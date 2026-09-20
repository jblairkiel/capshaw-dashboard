// Worship role preferences: what somebody has said about each job on the
// roster, and how it is written down.
//
// Two screens keep these, and they have to agree: a member (or their
// household) on My Household & Preferences, and whoever looks after the
// serving schedule on the Service Roster page. The vocabulary and the write
// live here so neither can drift from the other — the roles and levels come
// from ./people, and every write goes through the same transaction.
const db = require('../db');
const { PREFERENCE_LEVELS, isWorshipRole, isPreferenceLevel } = require('./people');

// Role → level, for the roles this person has an opinion about. A role that is
// absent means "no preference given", which is not the same as "rather not".
function preferencesOf(directoryId) {
  const rows = db.prepare('SELECT role, level FROM worship_preferences WHERE directory_id = ?').all(directoryId);
  const map  = {};
  for (const row of rows) map[row.role] = row.level;
  return map;
}

function notesOf(directoryId) {
  return db.prepare('SELECT notes FROM worship_profile WHERE directory_id = ?').get(directoryId)?.notes ?? '';
}

// Everyone's at once, for a page that lists the whole congregation rather than
// asking per person.
function allPreferences() {
  const byPerson = new Map();
  for (const row of db.prepare('SELECT directory_id, role, level FROM worship_preferences').all()) {
    if (!byPerson.has(row.directory_id)) byPerson.set(row.directory_id, {});
    byPerson.get(row.directory_id)[row.role] = row.level;
  }
  return byPerson;
}

function allNotes() {
  return new Map(
    db.prepare('SELECT directory_id, notes FROM worship_profile').all().map(r => [r.directory_id, r.notes])
  );
}

/**
 * Read a {role: level} object off a request body.
 *
 * Everything is checked before anything is written, so a single unknown role
 * cannot leave half a set of preferences behind. A level of null or '' means
 * the role was cleared back to "no preference", which is why clearing one is
 * sent rather than merely left out.
 *
 * Returns `{ error }` for the caller to answer with, or `{ preferences }`.
 */
function readPreferences(incoming) {
  if (incoming === undefined || incoming === null || typeof incoming !== 'object' || Array.isArray(incoming)) {
    return { error: 'preferences must be an object of role → level' };
  }

  const preferences = {};
  for (const [role, level] of Object.entries(incoming)) {
    if (level === null || level === '') continue;
    if (!isWorshipRole(role))     return { error: `Unknown worship role: ${role}` };
    if (!isPreferenceLevel(level)) return { error: `Level must be one of: ${PREFERENCE_LEVELS.join(', ')}` };
    preferences[role] = level;
  }
  return { preferences };
}

// The whole set at once: what is not in `preferences` is gone afterwards.
// `notes` left undefined leaves the note alone, so a screen that does not show
// it cannot wipe one somebody wrote.
const save = db.transaction((directoryId, preferences, notes) => {
  db.prepare('DELETE FROM worship_preferences WHERE directory_id = ?').run(directoryId);
  const ins = db.prepare(
    "INSERT INTO worship_preferences (directory_id, role, level, updated_at) VALUES (?, ?, ?, datetime('now'))"
  );
  for (const [role, level] of Object.entries(preferences)) ins.run(directoryId, role, level);

  if (notes === undefined) return;
  db.prepare(
    "INSERT INTO worship_profile (directory_id, notes, updated_at) VALUES (?, ?, datetime('now'))\n" +
    "ON CONFLICT(directory_id) DO UPDATE SET notes = excluded.notes, updated_at = excluded.updated_at"
  ).run(directoryId, notes);
});

// What changed, in words, for the action history: "Song Leader: glad to →
// rather not". Reported rather than merely "updated" so the history says what
// somebody actually agreed to.
function describeChange(before, after) {
  const roles = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const said  = level => PREFERENCE_LEVELS.includes(level) ? level : 'no preference';
  return roles
    .filter(role => before[role] !== after[role])
    .map(role => `${role}: ${said(before[role])} → ${said(after[role])}`);
}

module.exports = {
  preferencesOf,
  notesOf,
  allPreferences,
  allNotes,
  readPreferences,
  save,
  describeChange,
};
