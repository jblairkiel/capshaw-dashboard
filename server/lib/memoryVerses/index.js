// ─── Memory Verses ────────────────────────────────────────────────────────────
//
// Bible Class → Memory Verses: a library of verse sets, the games that help
// somebody learn them, and classes whose recitations a teacher scores.
//
//   · The library. Every approved member can search it, practise any set, and
//     add sets of their own; whoever made a set (or an admin) changes or
//     removes it. The built-in sets (defaults.js) are an admin's to correct and
//     cannot be removed, but anybody can copy one to make their own version.
//   · Practice. Each game a member plays moves each verse up or down a review
//     ladder (BOXES): right sends it up a rung and further into the future,
//     wrong sends it back to the bottom, due today. A verse three rungs up
//     counts as learned. Practice is the member's own; nobody else sees it.
//   · Classes. Any approved member can start a class, add students from the
//     directory or by name, and add other teachers. A class's teachers score
//     recitations — 3 stars word-perfect, 2 with one or two helps, 1 with a lot
//     of help — and see the class's board. A student sees only their own
//     scores, through the account linked to them in the directory — and a
//     parent sees their household's children's.

const db = require('../../db');
const { hasRole } = require('../../middleware/auth');
const recordKeeping = require('../recordKeeping');
const { NOTICE, TRANSLATION } = require('./defaults');
const { householdKey } = require('../people');

const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];
const AUDIENCES    = ['children', 'youth', 'adults', 'everyone'];
const CATEGORIES   = [
  'Salvation', 'The Church', 'Worship', 'Christian Living', 'Prayer', 'Scripture',
  'Comfort & Hope', 'Psalms & Wisdom', 'Life of Christ', 'Old Testament', 'Sharing the Gospel', 'Other',
];
// How many days until a verse comes round again, by rung. Rung 3 and up is
// "learned".
const BOXES = [0, 1, 3, 7, 14, 30];
const LEARNED_BOX = 3;
const STARS = { 3: 'Word-perfect', 2: 'One or two helps', 1: 'Needed a lot of help' };

const MAX_VERSES = 60;
const MAX_TEXT   = 1500;

const today = () => recordKeeping.churchToday();
const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const isAdmin = user => hasRole(user, 'admin');
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const parseTags = raw => { try { const t = JSON.parse(raw); return Array.isArray(t) ? t : []; } catch { return []; } };

// ─── The library ──────────────────────────────────────────────────────────────

function setRow(id) {
  return db.prepare('SELECT * FROM memory_sets WHERE id = ?').get(Number(id)) || null;
}

const canEdit = (user, set) => !!user && (isAdmin(user) || (!set.built_in && set.created_by === user.id));
const canRemove = (user, set) => !!user && !set.built_in && (isAdmin(user) || set.created_by === user.id);

function shapeSet(row, user) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    difficulty: row.difficulty,
    audience: row.audience,
    translation: row.translation,
    tags: parseTags(row.tags),
    builtIn: !!row.built_in,
    createdBy: row.created_by_name,
    mine: !!user && row.created_by === user.id,
    canEdit: canEdit(user, row),
    canRemove: canRemove(user, row),
    updatedAt: row.updated_at,
  };
}

// The library, searched and filtered. `q` matches a set's title,
// description, tags, and any of its verses' references or words.
function search(user, { q = '', category = '', difficulty = '', audience = '', translation = '', mine = false, sort = 'title' } = {}) {
  const where = [];
  const params = {};
  const words = String(q || '').trim().split(/\s+/).filter(Boolean).slice(0, 8);
  words.forEach((w, i) => {
    params[`w${i}`] = `%${w.replace(/[%_\\]/g, ch => `\\${ch}`)}%`;
    where.push(`(s.title LIKE @w${i} ESCAPE '\\' OR s.description LIKE @w${i} ESCAPE '\\' OR s.tags LIKE @w${i} ESCAPE '\\' OR s.category LIKE @w${i} ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM memory_verses v WHERE v.set_id = s.id AND (v.reference LIKE @w${i} ESCAPE '\\' OR v.text LIKE @w${i} ESCAPE '\\')))`);
  });
  if (category)    { where.push('s.category = @category'); params.category = category; }
  if (difficulty)  { where.push('s.difficulty = @difficulty'); params.difficulty = difficulty; }
  if (audience)    { where.push("(s.audience = @audience OR s.audience = 'everyone')"); params.audience = audience; }
  if (translation) { where.push('s.translation = @translation'); params.translation = translation; }
  if (mine && user) { where.push('s.created_by = @me'); }
  params.me = user?.id ?? -1;

  const order = {
    title:      's.title COLLATE NOCASE',
    newest:     's.created_at DESC, s.id DESC',
    difficulty: "CASE s.difficulty WHEN 'beginner' THEN 0 WHEN 'intermediate' THEN 1 ELSE 2 END, s.title COLLATE NOCASE",
  }[sort] || 's.title COLLATE NOCASE';

  const rows = db.prepare(`
    SELECT s.*,
           (SELECT COUNT(*) FROM memory_verses v WHERE v.set_id = s.id) AS verse_count,
           (SELECT COUNT(*) FROM memory_progress p JOIN memory_verses v ON v.id = p.verse_id
             WHERE v.set_id = s.id AND p.user_id = @me AND p.box >= ${LEARNED_BOX}) AS learned,
           (SELECT COUNT(*) FROM memory_progress p JOIN memory_verses v ON v.id = p.verse_id
             WHERE v.set_id = s.id AND p.user_id = @me) AS practiced,
           (SELECT group_concat(reference, ' · ') FROM (SELECT reference FROM memory_verses v WHERE v.set_id = s.id ORDER BY position LIMIT 4)) AS preview
      FROM memory_sets s
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY ${order}
  `).all(params);
  return rows.map(r => ({ ...shapeSet(r, user), verseCount: r.verse_count, learned: r.learned, practiced: r.practiced, preview: r.preview || '' }));
}

// One set with its verses, and where the member is with each.
function getSet(user, id) {
  const row = setRow(id);
  if (!row) return null;
  const progress = new Map(db.prepare(`
    SELECT p.* FROM memory_progress p JOIN memory_verses v ON v.id = p.verse_id WHERE v.set_id = ? AND p.user_id = ?
  `).all(row.id, user?.id ?? -1).map(p => [p.verse_id, p]));
  const verses = db.prepare('SELECT id, reference, text FROM memory_verses WHERE set_id = ? ORDER BY position, id').all(row.id)
    .map(v => {
      const p = progress.get(v.id);
      return { ...v, progress: p ? { box: p.box, learned: p.box >= LEARNED_BOX, due: !p.due_on || p.due_on <= today(), dueOn: p.due_on, attempts: p.attempts, correct: p.correct } : null };
    });
  return { ...shapeSet(row, user), verses };
}

// A set as sent, checked and tidied: { set } or { error }.
function cleanSet(body = {}) {
  const title = clip(body.title, 100);
  if (title.length < 3) return { error: 'Give the set a title of at least 3 letters' };
  const category = CATEGORIES.includes(body.category) ? body.category : 'Other';
  const difficulty = DIFFICULTIES.includes(body.difficulty) ? body.difficulty : 'beginner';
  const audience = AUDIENCES.includes(body.audience) ? body.audience : 'everyone';
  const translation = clip(body.translation, 40) || TRANSLATION;
  const tags = [...new Set((Array.isArray(body.tags) ? body.tags : String(body.tags || '').split(','))
    .map(t => clip(t, 30).toLowerCase()).filter(Boolean))].slice(0, 12);
  const verses = (Array.isArray(body.verses) ? body.verses : [])
    .map(v => ({ reference: clip(v?.reference, 60), text: String(v?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT) }))
    .filter(v => v.reference || v.text);
  if (!verses.length) return { error: 'Add at least one verse' };
  if (verses.length > MAX_VERSES) return { error: `A set can hold up to ${MAX_VERSES} verses — split a longer one into parts` };
  const missing = verses.findIndex(v => !v.reference || !v.text);
  if (missing >= 0) return { error: `Verse ${missing + 1} needs both its reference and its words` };
  return { set: { title, description: clip(body.description, 400), category, difficulty, audience, translation, tags, verses } };
}

function writeVerses(setId, verses) {
  // Verses kept by id where the reference is unchanged, so practice and
  // scores on them carry on; the rest are replaced.
  const old = db.prepare('SELECT id, reference FROM memory_verses WHERE set_id = ? ORDER BY position, id').all(setId);
  const free = [...old];
  const update = db.prepare('UPDATE memory_verses SET position = ?, reference = ?, text = ? WHERE id = ?');
  const insert = db.prepare('INSERT INTO memory_verses (set_id, position, reference, text) VALUES (?, ?, ?, ?)');
  verses.forEach((v, i) => {
    const at = free.findIndex(o => o.reference === v.reference);
    if (at >= 0) { update.run(i, v.reference, v.text, free[at].id); free.splice(at, 1); }
    else insert.run(setId, i, v.reference, v.text);
  });
  const remove = db.prepare('DELETE FROM memory_verses WHERE id = ?');
  for (const o of free) remove.run(o.id);
}

function createSet(user, body) {
  const { set, error } = cleanSet(body);
  if (error) return { error };
  const id = db.transaction(() => {
    const newId = db.prepare(`
      INSERT INTO memory_sets (title, description, category, difficulty, audience, translation, tags, created_by, created_by_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(set.title, set.description, set.category, set.difficulty, set.audience, set.translation, JSON.stringify(set.tags), user.id, user.name || '').lastInsertRowid;
    writeVerses(newId, set.verses);
    return newId;
  })();
  return { id: Number(id), set };
}

function updateSet(id, body) {
  const { set, error } = cleanSet(body);
  if (error) return { error };
  db.transaction(() => {
    db.prepare(`
      UPDATE memory_sets SET title = ?, description = ?, category = ?, difficulty = ?, audience = ?, translation = ?, tags = ?, updated_at = datetime('now')
       WHERE id = ?
    `).run(set.title, set.description, set.category, set.difficulty, set.audience, set.translation, JSON.stringify(set.tags), Number(id));
    writeVerses(Number(id), set.verses);
  })();
  return { set };
}

function copySet(user, id) {
  const source = getSet(user, id);
  if (!source) return null;
  return createSet(user, { ...source, title: `${source.title} (my copy)`.slice(0, 100) });
}

function removeSet(id) {
  db.prepare('DELETE FROM memory_sets WHERE id = ?').run(Number(id));
}

// What the filters offer: the fixed lists, and the translations in use.
function meta(user) {
  return {
    categories: CATEGORIES,
    difficulties: DIFFICULTIES,
    audiences: AUDIENCES,
    translations: db.prepare("SELECT DISTINCT translation FROM memory_sets WHERE translation <> '' ORDER BY translation").all().map(r => r.translation),
    defaultTranslation: TRANSLATION,
    notice: NOTICE,
    stars: STARS,
    isAdmin: isAdmin(user),
  };
}

// ─── Practice ─────────────────────────────────────────────────────────────────

// One verse practised in a game: right moves it up the ladder, wrong sends it
// back to the bottom, due again today.
function practise(user, verseId, correct) {
  const verse = db.prepare('SELECT id FROM memory_verses WHERE id = ?').get(Number(verseId));
  if (!verse) return null;
  const day = today();
  const was = db.prepare('SELECT * FROM memory_progress WHERE user_id = ? AND verse_id = ?').get(user.id, verse.id);
  const box = correct ? Math.min((was?.box ?? 0) + 1, BOXES.length - 1) : 0;
  const due = addDays(day, BOXES[box]);
  db.prepare(`
    INSERT INTO memory_progress (user_id, verse_id, box, correct, attempts, last_practiced, due_on)
    VALUES (@user, @verse, @box, @right, 1, @day, @due)
    ON CONFLICT (user_id, verse_id) DO UPDATE SET
      box = @box, correct = correct + @right, attempts = attempts + 1, last_practiced = @day, due_on = @due
  `).run({ user: user.id, verse: verse.id, box, right: correct ? 1 : 0, day, due });
  db.prepare('INSERT OR IGNORE INTO memory_practice_days (user_id, day) VALUES (?, ?)').run(user.id, day);
  return { verseId: verse.id, box, learned: box >= LEARNED_BOX, dueOn: due };
}

// Days in a row with some practice, counting today or, if not yet today,
// yesterday — a streak is not broken until a whole day is missed.
function streakOf(userId) {
  const days = new Set(db.prepare('SELECT day FROM memory_practice_days WHERE user_id = ? ORDER BY day DESC LIMIT 400').all(userId).map(r => r.day));
  let day = today();
  if (!days.has(day)) day = addDays(day, -1);
  let n = 0;
  while (days.has(day)) { n++; day = addDays(day, -1); }
  return n;
}

// A member's own practice: verses learned, the streak, and what is due.
function myPractice(user) {
  const day = today();
  const totals = db.prepare(`
    SELECT COUNT(*) AS practiced, SUM(CASE WHEN box >= ${LEARNED_BOX} THEN 1 ELSE 0 END) AS learned
      FROM memory_progress p JOIN memory_verses v ON v.id = p.verse_id WHERE p.user_id = ?
  `).get(user.id);
  const due = db.prepare(`
    SELECT v.id, v.reference, s.id AS set_id, s.title AS set_title, p.box, p.due_on
      FROM memory_progress p JOIN memory_verses v ON v.id = p.verse_id JOIN memory_sets s ON s.id = v.set_id
     WHERE p.user_id = ? AND p.due_on <= ?
     ORDER BY p.due_on, p.box, v.id LIMIT 50
  `).all(user.id, day);
  const sets = db.prepare(`
    SELECT s.id, s.title, COUNT(*) AS practiced, SUM(CASE WHEN p.box >= ${LEARNED_BOX} THEN 1 ELSE 0 END) AS learned,
           (SELECT COUNT(*) FROM memory_verses x WHERE x.set_id = s.id) AS verse_count, MAX(p.last_practiced) AS last
      FROM memory_progress p JOIN memory_verses v ON v.id = p.verse_id JOIN memory_sets s ON s.id = v.set_id
     WHERE p.user_id = ? GROUP BY s.id ORDER BY last DESC LIMIT 12
  `).all(user.id);
  return {
    practiced: totals.practiced || 0,
    learned: totals.learned || 0,
    streak: streakOf(user.id),
    practisedToday: !!db.prepare('SELECT 1 FROM memory_practice_days WHERE user_id = ? AND day = ?').get(user.id, day),
    due: due.map(d => ({ verseId: d.id, reference: d.reference, setId: d.set_id, setTitle: d.set_title, box: d.box })),
    sets: sets.map(s => ({ id: s.id, title: s.title, practiced: s.practiced, learned: s.learned, verseCount: s.verse_count, last: s.last })),
  };
}

// ─── Classes ──────────────────────────────────────────────────────────────────

const classRow = id => db.prepare('SELECT * FROM memory_classes WHERE id = ?').get(Number(id)) || null;
const teaches = (user, classId) => !!user && !!db.prepare('SELECT 1 FROM memory_class_teachers WHERE class_id = ? AND user_id = ?').get(Number(classId), user.id);

function teachersOf(classId) {
  return db.prepare(`
    SELECT u.id, u.name FROM memory_class_teachers t JOIN users u ON u.id = t.user_id WHERE t.class_id = ? ORDER BY u.name COLLATE NOCASE
  `).all(Number(classId));
}

function studentsOf(classId) {
  return db.prepare('SELECT id, directory_id AS directoryId, name FROM memory_class_students WHERE class_id = ? ORDER BY name COLLATE NOCASE')
    .all(Number(classId));
}

// The classes somebody teaches.
function myClasses(user) {
  return db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM memory_class_students s WHERE s.class_id = c.id) AS students,
           (SELECT MAX(scored_on) FROM memory_scores x WHERE x.class_id = c.id) AS last_scored
      FROM memory_classes c JOIN memory_class_teachers t ON t.class_id = c.id
     WHERE t.user_id = ? ORDER BY c.archived, c.name COLLATE NOCASE
  `).all(user.id).map(c => ({ id: c.id, name: c.name, description: c.description, archived: !!c.archived, students: c.students, lastScored: c.last_scored || '' }));
}

function createClass(user, body = {}) {
  const name = clip(body.name, 80);
  if (name.length < 3) return { error: 'Give the class a name of at least 3 letters' };
  const id = db.transaction(() => {
    const newId = db.prepare('INSERT INTO memory_classes (name, description, created_by, created_by_name) VALUES (?, ?, ?, ?)')
      .run(name, clip(body.description, 300), user.id, user.name || '').lastInsertRowid;
    db.prepare('INSERT INTO memory_class_teachers (class_id, user_id) VALUES (?, ?)').run(newId, user.id);
    return Number(newId);
  })();
  return { id, name };
}

function updateClass(id, body = {}) {
  const was = classRow(id);
  const name = body.name === undefined ? was.name : clip(body.name, 80);
  if (name.length < 3) return { error: 'Give the class a name of at least 3 letters' };
  const description = body.description === undefined ? was.description : clip(body.description, 300);
  const archived = body.archived === undefined ? was.archived : (body.archived ? 1 : 0);
  db.prepare('UPDATE memory_classes SET name = ?, description = ?, archived = ? WHERE id = ?').run(name, description, archived, was.id);
  return { before: was, after: classRow(id) };
}

// The class's board between two days: each student's points (their best
// stars on each verse they have recited), verses recited, and how many were
// word-perfect, highest first.
function board(classId, { from = '', to = '' } = {}) {
  const where = ['x.class_id = ?'];
  const params = [Number(classId)];
  if (from) { where.push('x.scored_on >= ?'); params.push(from); }
  if (to)   { where.push('x.scored_on <= ?'); params.push(to); }
  const best = db.prepare(`
    SELECT x.student_id, coalesce(x.verse_id, -x.id) AS verse, MAX(x.stars) AS stars
      FROM memory_scores x WHERE ${where.join(' AND ')}
     GROUP BY x.student_id, coalesce(x.verse_id, -x.id)
  `).all(...params);
  const byStudent = new Map();
  for (const b of best) {
    const s = byStudent.get(b.student_id) || { points: 0, verses: 0, perfect: 0 };
    s.points += b.stars; s.verses++; if (b.stars === 3) s.perfect++;
    byStudent.set(b.student_id, s);
  }
  return studentsOf(classId)
    .map(s => ({ ...s, ...(byStudent.get(s.id) || { points: 0, verses: 0, perfect: 0 }) }))
    .sort((a, b) => b.points - a.points || b.perfect - a.perfect || a.name.localeCompare(b.name));
}

// Everything a class's teachers see.
function classDetail(classId, range = {}) {
  const c = classRow(classId);
  const recent = db.prepare(`
    SELECT x.id, x.student_id AS studentId, s.name AS student, x.set_id AS setId, x.verse_id AS verseId, x.reference,
           x.stars, x.note, x.scored_on AS scoredOn, x.scored_by_name AS scoredBy
      FROM memory_scores x JOIN memory_class_students s ON s.id = x.student_id
     WHERE x.class_id = ? ORDER BY x.scored_on DESC, x.id DESC LIMIT 100
  `).all(c.id);
  return {
    id: c.id, name: c.name, description: c.description, archived: !!c.archived,
    teachers: teachersOf(c.id),
    students: studentsOf(c.id),
    board: board(c.id, range),
    recent,
  };
}

// Each student's best stars on each verse of one set: the grid a teacher
// scores from.
function setGrid(classId, setId) {
  const rows = db.prepare(`
    SELECT student_id, verse_id, MAX(stars) AS stars, MAX(scored_on) AS last
      FROM memory_scores WHERE class_id = ? AND set_id = ? AND verse_id IS NOT NULL GROUP BY student_id, verse_id
  `).all(Number(classId), Number(setId));
  return rows.map(r => ({ studentId: r.student_id, verseId: r.verse_id, stars: r.stars, last: r.last }));
}

function addStudent(classId, { directoryId, name } = {}) {
  let person = null;
  if (directoryId) {
    person = db.prepare("SELECT id, name FROM directory WHERE id = ? AND trim(name) <> ''").get(Number(directoryId));
    if (!person) return { error: 'That person is not in the directory' };
    if (db.prepare('SELECT 1 FROM memory_class_students WHERE class_id = ? AND directory_id = ?').get(Number(classId), person.id)) {
      return { error: `${person.name} is already in this class` };
    }
  }
  const label = person ? person.name : clip(name, 60);
  if (label.length < 2) return { error: 'Choose somebody from the directory, or type a name' };
  const id = db.prepare('INSERT INTO memory_class_students (class_id, directory_id, name) VALUES (?, ?, ?)')
    .run(Number(classId), person?.id ?? null, label).lastInsertRowid;
  return { id: Number(id), name: label, directoryId: person?.id ?? null };
}

function score(user, classId, { studentId, verseId, stars, note, scoredOn } = {}) {
  const student = db.prepare('SELECT * FROM memory_class_students WHERE id = ? AND class_id = ?').get(Number(studentId), Number(classId));
  if (!student) return { error: 'That student is not in this class' };
  const verse = db.prepare('SELECT v.id, v.reference, v.set_id, s.title FROM memory_verses v JOIN memory_sets s ON s.id = v.set_id WHERE v.id = ?').get(Number(verseId));
  if (!verse) return { error: 'Choose the verse they recited' };
  const n = Number(stars);
  if (![1, 2, 3].includes(n)) return { error: 'Give 1, 2 or 3 stars' };
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(scoredOn || '')) ? scoredOn : today();
  const id = db.prepare(`
    INSERT INTO memory_scores (class_id, student_id, set_id, verse_id, reference, stars, note, scored_on, scored_by, scored_by_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(Number(classId), student.id, verse.set_id, verse.id, verse.reference, n, clip(note, 200), day, user.id, user.name || '').lastInsertRowid;
  return { id: Number(id), student, verse, stars: n, scoredOn: day };
}

// The directory people whose scores somebody may see: themselves, and
// everybody in their household (same address, lib/people.js) — so a parent
// sees a child's scores though the child has no account of their own.
function householdIds(user) {
  if (!user?.directory_id) return [];
  const me = db.prepare('SELECT id, address, zip FROM directory WHERE id = ?').get(user.directory_id);
  if (!me) return [];
  const key = householdKey(me);
  if (key.startsWith('_')) return [me.id];
  return db.prepare('SELECT id, address, zip FROM directory').all().filter(p => householdKey(p) === key).map(p => p.id);
}

// The scores a member may see: their own and their household's, in every
// class each of them is a student in.
function myScores(user) {
  const ids = householdIds(user);
  if (!ids.length) return [];
  const students = db.prepare(`
    SELECT c.id AS class_id, c.name AS class_name, s.id AS student_id, s.name, s.directory_id
      FROM memory_class_students s JOIN memory_classes c ON c.id = s.class_id
     WHERE s.directory_id IN (${ids.map(() => '?').join(',')}) ORDER BY c.archived, s.name COLLATE NOCASE, c.name COLLATE NOCASE
  `).all(...ids);
  return students.map(c => {
    const scores = db.prepare(`
      SELECT x.reference, x.stars, x.scored_on AS scoredOn, st.title AS setTitle
        FROM memory_scores x LEFT JOIN memory_sets st ON st.id = x.set_id
       WHERE x.student_id = ? ORDER BY x.scored_on DESC, x.id DESC LIMIT 100
    `).all(c.student_id);
    const mine = board(c.class_id).find(b => b.id === c.student_id) || { points: 0, verses: 0, perfect: 0 };
    return {
      classId: c.class_id, className: c.class_name, student: c.name, self: c.directory_id === user.directory_id,
      points: mine.points, verses: mine.verses, perfect: mine.perfect, scores,
    };
  });
}

// Directory people and accounts, for adding students and teachers.
function findPeople(q) {
  const like = `%${String(q || '').trim().replace(/[%_\\]/g, ch => `\\${ch}`)}%`;
  if (String(q || '').trim().length < 2) return { people: [], accounts: [] };
  return {
    people: db.prepare("SELECT id, name FROM directory WHERE trim(name) <> '' AND name LIKE ? ESCAPE '\\' ORDER BY name COLLATE NOCASE LIMIT 15").all(like),
    accounts: db.prepare("SELECT id, name FROM users WHERE role <> 'pending' AND name LIKE ? ESCAPE '\\' ORDER BY name COLLATE NOCASE LIMIT 15").all(like),
  };
}

module.exports = {
  DIFFICULTIES, AUDIENCES, CATEGORIES, BOXES, LEARNED_BOX, STARS, MAX_VERSES,
  setRow, canEdit, canRemove, search, getSet, cleanSet, createSet, updateSet, copySet, removeSet, meta,
  practise, streakOf, myPractice,
  classRow, teaches, teachersOf, studentsOf, myClasses, createClass, updateClass, board, classDetail, setGrid,
  addStudent, score, householdIds, myScores, findPeople,
};
