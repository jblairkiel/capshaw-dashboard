// ─── The song library ─────────────────────────────────────────────────────────
//
// Every song the congregation sings, in one list that every tab of the
// Upcoming Service page picks from: the service a song leader submits, a song
// somebody requests, the tracker's history.
//
// The portal owns it. Songs imported from capshawchurch.org's song database
// keep that site's ids; a song added here is numbered from PORTAL_IDS_FROM, so
// a later import (which writes the other site's ids as they are) can never
// collide with it. The same goes for song_services rows written here.
//
// Anybody approved can add a song and it is usable straight away. Whoever
// keeps the song tracker tidies up afterwards: corrects a title or number, or
// merges a duplicate into the song it duplicates.

const db = require('../db');

const PORTAL_IDS_FROM = 1_000_000;

const clean = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const key = s => clean(s, 200).toLowerCase().replace(/[^a-z0-9 ]/g, '');

// The next id for a row made here, in the portal's own range.
function nextPortalId(table) {
  const { top } = db.prepare(`SELECT MAX(id) AS top FROM ${table} WHERE id >= ?`).get(PORTAL_IDS_FROM);
  return (top ?? PORTAL_IDS_FROM - 1) + 1;
}

function toSong(row) {
  if (!row) return null;
  return {
    id:       row.id,
    title:    row.title,
    hymnal:   row.hymnal,
    number:   row.number,
    source:   row.source,
    timesSung: row.times_sung ?? undefined,
    lastSung:  row.last_sung ?? undefined,
  };
}

function get(id) {
  return toSong(db.prepare('SELECT * FROM songs WHERE id = ?').get(Number(id)));
}

// Title, number or hymnal. Most-sung first, since the song a leader is
// looking for is usually one the church already knows.
function search(q = '', { limit = 20 } = {}) {
  const text = clean(q, 100);
  const like = `%${text}%`;
  return db.prepare(`
    SELECT s.*, COUNT(x.service_id) AS times_sung, MAX(ss.date) AS last_sung
      FROM songs s
      LEFT JOIN service_songs x ON x.song_id = s.id
      LEFT JOIN song_services ss ON ss.id = x.service_id
     WHERE ? = '' OR s.title LIKE ? OR s.number = ? OR s.hymnal LIKE ?
     GROUP BY s.id
     ORDER BY CASE WHEN s.title LIKE ? THEN 0 ELSE 1 END, times_sung DESC, s.title
     LIMIT ?
  `).all(text, like, text, like, `${text}%`, Math.min(Math.max(Number(limit) || 20, 1), 200)).map(toSong);
}

// The same song already on the list, if it is: same title, and the same number
// when both have one.
function findDuplicate({ title, hymnal, number }) {
  const wanted = key(title);
  return db.prepare('SELECT * FROM songs').all().find(s =>
    key(s.title) === wanted &&
    (!number || !s.number || String(s.number) === String(number)) &&
    (!hymnal || !s.hymnal || key(s.hymnal) === key(hymnal))) || null;
}

function validate(fields) {
  const title  = clean(fields.title, 200);
  const hymnal = clean(fields.hymnal, 100);
  const number = clean(fields.number, 20);
  if (!title) return { error: 'A song needs a title' };
  return { title, hymnal, number };
}

// Adds a song, or hands back the one that is already there.
function add(fields, user) {
  const song = validate(fields);
  if (song.error) return song;

  const existing = findDuplicate(song);
  if (existing) return { song: toSong(existing), existing: true };

  const id = nextPortalId('songs');
  db.prepare(`
    INSERT INTO songs (id, title, hymnal, number, source, added_by, added_at)
    VALUES (?, ?, ?, ?, 'portal', ?, datetime('now'))
  `).run(id, song.title, song.hymnal, song.number, user?.id ?? null);
  return { song: get(id), existing: false };
}

function update(id, fields) {
  const before = get(id);
  if (!before) return { error: 'No such song' };
  const song = validate({ ...before, ...fields });
  if (song.error) return song;
  db.prepare('UPDATE songs SET title = ?, hymnal = ?, number = ? WHERE id = ?').run(song.title, song.hymnal, song.number, before.id);
  return { before, song: get(id) };
}

// Everything that points at `fromId` is moved to `intoId`, then `fromId` goes.
// A service that had both keeps one.
function merge(fromId, intoId) {
  const from = get(fromId);
  const into = get(intoId);
  if (!from || !into) return { error: 'No such song' };
  if (from.id === into.id) return { error: 'A song cannot be merged into itself' };

  db.transaction(() => {
    db.prepare(`
      INSERT OR IGNORE INTO service_songs (service_id, song_id, position)
      SELECT service_id, ?, position FROM service_songs WHERE song_id = ?
    `).run(into.id, from.id);
    db.prepare('DELETE FROM service_songs WHERE song_id = ?').run(from.id);
    db.prepare('UPDATE worship_plan_items SET song_id = ? WHERE song_id = ?').run(into.id, from.id);
    db.prepare('UPDATE song_requests SET song_id = ? WHERE song_id = ?').run(into.id, from.id);
    db.prepare('UPDATE song_of_week SET song_id = ? WHERE song_id = ?').run(into.id, from.id);
    db.prepare('DELETE FROM songs WHERE id = ?').run(from.id);
  })();
  return { from, into: get(into.id) };
}

module.exports = { PORTAL_IDS_FROM, nextPortalId, get, search, add, update, merge, findDuplicate };
