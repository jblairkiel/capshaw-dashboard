// ─── Memory Verses ────────────────────────────────────────────────────────────
// Bible Class → Memory Verses (lib/memoryVerses). Every approved member reads
// and searches the library, practises, and adds sets; whoever made a set (or
// an admin) changes or removes it. Any approved member can start a class; only
// a class's own teachers see it, change it, and score its students. A student,
// or their household, sees their own scores, and is told on their bell when a
// teacher scores them.
const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { requireAuth, requireApproved } = require('../middleware/auth');
const actionLog = require('../lib/actionLog');
const notifications = require('../lib/notifications');
const memory = require('../lib/memoryVerses');
const { STARS } = memory;

router.use(requireAuth, requireApproved);

const log = (req, entry) => actionLog.record(req.user, { area: '', ...entry });
const fail = (res, status, error) => res.status(status).json({ success: false, error });
const stars = n => '★'.repeat(n);

// ─── The library ──────────────────────────────────────────────────────────────

router.get('/meta', (req, res) => {
  res.json({ success: true, ...memory.meta(req.user) });
});

router.get('/sets', (req, res) => {
  const { q, category, difficulty, audience, translation, mine, sort } = req.query;
  res.json({ success: true, sets: memory.search(req.user, { q, category, difficulty, audience, translation, mine: mine === '1' || mine === 'true', sort }) });
});

router.get('/sets/:id', (req, res) => {
  const set = memory.getSet(req.user, req.params.id);
  if (!set) return fail(res, 404, 'No such set');
  res.json({ success: true, set });
});

router.post('/sets', (req, res) => {
  const made = memory.createSet(req.user, req.body);
  if (made.error) return fail(res, 400, made.error);
  log(req, {
    action: 'create', entity: 'memory verse set', entityId: made.id,
    summary: `Added the memory verse set "${made.set.title}" (${made.set.verses.length} verse${made.set.verses.length === 1 ? '' : 's'})`,
    after: { title: made.set.title, verses: made.set.verses.map(v => v.reference) },
  });
  res.json({ success: true, set: memory.getSet(req.user, made.id) });
});

function editable(req, res, next) {
  const row = memory.setRow(req.params.id);
  if (!row) return fail(res, 404, 'No such set');
  if (!memory.canEdit(req.user, row)) {
    return fail(res, 403, row.built_in ? 'Only an admin can change a built-in set — make a copy to change your own' : 'Only whoever made this set can change it');
  }
  req.set = row;
  next();
}

router.put('/sets/:id', editable, (req, res) => {
  const before = memory.getSet(req.user, req.set.id);
  const done = memory.updateSet(req.set.id, req.body);
  if (done.error) return fail(res, 400, done.error);
  log(req, {
    action: 'update', entity: 'memory verse set', entityId: req.set.id,
    summary: `Changed the memory verse set "${done.set.title}"`,
    before: { title: before.title, verses: before.verses.map(v => v.reference) },
    after:  { title: done.set.title, verses: done.set.verses.map(v => v.reference) },
  });
  res.json({ success: true, set: memory.getSet(req.user, req.set.id) });
});

router.delete('/sets/:id', (req, res) => {
  const row = memory.setRow(req.params.id);
  if (!row) return fail(res, 404, 'No such set');
  if (!memory.canRemove(req.user, row)) {
    return fail(res, 403, row.built_in ? 'A built-in set cannot be removed' : 'Only whoever made this set can remove it');
  }
  memory.removeSet(row.id);
  log(req, { action: 'delete', entity: 'memory verse set', entityId: row.id, summary: `Removed the memory verse set "${row.title}"`, before: { title: row.title } });
  res.json({ success: true });
});

router.post('/sets/:id/copy', (req, res) => {
  const made = memory.copySet(req.user, req.params.id);
  if (!made) return fail(res, 404, 'No such set');
  if (made.error) return fail(res, 400, made.error);
  log(req, { action: 'create', entity: 'memory verse set', entityId: made.id, summary: `Copied a memory verse set as "${made.set.title}"` });
  res.json({ success: true, set: memory.getSet(req.user, made.id) });
});

// ─── Practice ─────────────────────────────────────────────────────────────────

// { verseId, correct } — one verse, once, in any game. Practice is the
// member's own, so it is not written to the history of changes.
router.post('/practice', (req, res) => {
  const done = memory.practise(req.user, req.body?.verseId, req.body?.correct === true);
  if (!done) return fail(res, 404, 'No such verse');
  res.json({ success: true, ...done });
});

router.get('/me', (req, res) => {
  res.json({ success: true, practice: memory.myPractice(req.user), scores: memory.myScores(req.user), classes: memory.myClasses(req.user) });
});

// ─── Classes ──────────────────────────────────────────────────────────────────

router.get('/people', (req, res) => {
  res.json({ success: true, ...memory.findPeople(req.query.q) });
});

router.post('/classes', (req, res) => {
  const made = memory.createClass(req.user, req.body);
  if (made.error) return fail(res, 400, made.error);
  log(req, { action: 'create', entity: 'memory verse class', entityId: made.id, summary: `Started the memory verse class "${made.name}"` });
  res.json({ success: true, id: made.id, classes: memory.myClasses(req.user) });
});

// Only the class's own teachers go further.
function teacherOnly(req, res, next) {
  const c = memory.classRow(req.params.id);
  if (!c) return fail(res, 404, 'No such class');
  if (!memory.teaches(req.user, c.id)) return fail(res, 403, 'Only this class\'s teachers can see or change it');
  req.memoryClass = c;
  next();
}

const range = q => ({
  from: /^\d{4}-\d{2}-\d{2}$/.test(String(q.from || '')) ? q.from : '',
  to:   /^\d{4}-\d{2}-\d{2}$/.test(String(q.to || '')) ? q.to : '',
});

router.get('/classes/:id', teacherOnly, (req, res) => {
  res.json({ success: true, class: memory.classDetail(req.memoryClass.id, range(req.query)) });
});

router.get('/classes/:id/sets/:setId', teacherOnly, (req, res) => {
  const set = memory.getSet(req.user, req.params.setId);
  if (!set) return fail(res, 404, 'No such set');
  res.json({ success: true, set, grid: memory.setGrid(req.memoryClass.id, set.id), students: memory.studentsOf(req.memoryClass.id) });
});

router.put('/classes/:id', teacherOnly, (req, res) => {
  const done = memory.updateClass(req.memoryClass.id, req.body);
  if (done.error) return fail(res, 400, done.error);
  const { before, after } = done;
  log(req, {
    action: 'update', entity: 'memory verse class', entityId: after.id,
    summary: before.archived !== after.archived
      ? `${after.archived ? 'Put away' : 'Brought back'} the memory verse class "${after.name}"`
      : `Changed the memory verse class "${after.name}"`,
    before: { name: before.name, description: before.description, archived: !!before.archived },
    after:  { name: after.name, description: after.description, archived: !!after.archived },
  });
  res.json({ success: true, class: memory.classDetail(after.id, range(req.query)) });
});

router.delete('/classes/:id', teacherOnly, (req, res) => {
  const c = req.memoryClass;
  db.prepare('DELETE FROM memory_classes WHERE id = ?').run(c.id);
  log(req, { action: 'delete', entity: 'memory verse class', entityId: c.id, summary: `Removed the memory verse class "${c.name}" and its scores`, before: { name: c.name } });
  res.json({ success: true, classes: memory.myClasses(req.user) });
});

// The accounts to tell about a student: theirs, or — for a child with no
// account — their household's.
function accountsForStudent(directoryId) {
  if (!directoryId) return [];
  const own = notifications.accountsForDirectory([directoryId]);
  if (own.length) return own;
  return notifications.accountsForDirectory(memory.householdIds({ directory_id: directoryId }));
}

router.post('/classes/:id/students', teacherOnly, (req, res) => {
  const c = req.memoryClass;
  const added = memory.addStudent(c.id, req.body);
  if (added.error) return fail(res, 400, added.error);
  log(req, { action: 'update', entity: 'memory verse class', entityId: c.id, summary: `Added ${added.name} to the memory verse class "${c.name}"` });
  notifications.notify({
    users: accountsForStudent(added.directoryId), kind: 'memory-class', actor: req.user,
    title: `${added.name} was added to the memory verse class "${c.name}"`,
    body: 'Scores from the class will show under Bible Class → Memory Verses → My scores.',
    subjectType: 'memory-class', subjectId: c.id,
  });
  res.json({ success: true, class: memory.classDetail(c.id, range(req.query)) });
});

router.delete('/classes/:id/students/:studentId', teacherOnly, (req, res) => {
  const c = req.memoryClass;
  const student = memory.studentsOf(c.id).find(s => s.id === Number(req.params.studentId));
  if (!student) return fail(res, 404, 'That student is not in this class');
  db.prepare('DELETE FROM memory_class_students WHERE id = ?').run(student.id);
  log(req, { action: 'update', entity: 'memory verse class', entityId: c.id, summary: `Took ${student.name} out of the memory verse class "${c.name}", with their scores` });
  res.json({ success: true, class: memory.classDetail(c.id, range(req.query)) });
});

router.post('/classes/:id/teachers', teacherOnly, (req, res) => {
  const c = req.memoryClass;
  const teacher = db.prepare("SELECT id, name FROM users WHERE id = ? AND role <> 'pending'").get(Number(req.body?.userId));
  if (!teacher) return fail(res, 400, 'Choose somebody with an approved account');
  db.prepare('INSERT OR IGNORE INTO memory_class_teachers (class_id, user_id) VALUES (?, ?)').run(c.id, teacher.id);
  log(req, { action: 'update', entity: 'memory verse class', entityId: c.id, summary: `Made ${teacher.name} a teacher of the memory verse class "${c.name}"` });
  notifications.notify({
    users: [teacher], kind: 'memory-class', actor: req.user,
    title: `${req.user.name || 'Somebody'} made you a teacher of the memory verse class "${c.name}"`,
    body: 'You can now score its students under Bible Class → Memory Verses → My classes.',
    subjectType: 'memory-class', subjectId: c.id,
  });
  res.json({ success: true, class: memory.classDetail(c.id, range(req.query)) });
});

router.delete('/classes/:id/teachers/:userId', teacherOnly, (req, res) => {
  const c = req.memoryClass;
  const teachers = memory.teachersOf(c.id);
  const leaving = teachers.find(t => t.id === Number(req.params.userId));
  if (!leaving) return fail(res, 404, 'They do not teach this class');
  if (teachers.length === 1) return fail(res, 400, 'A class needs at least one teacher — add another first, or remove the class');
  db.prepare('DELETE FROM memory_class_teachers WHERE class_id = ? AND user_id = ?').run(c.id, leaving.id);
  log(req, { action: 'update', entity: 'memory verse class', entityId: c.id, summary: `${leaving.id === req.user.id ? 'Stopped teaching' : `Took ${leaving.name} off teaching`} the memory verse class "${c.name}"` });
  res.json({ success: true, class: memory.teaches(req.user, c.id) ? memory.classDetail(c.id, range(req.query)) : null, classes: memory.myClasses(req.user) });
});

// { studentId, verseId, stars, note?, scoredOn? } — one recitation.
router.post('/classes/:id/scores', teacherOnly, (req, res) => {
  const c = req.memoryClass;
  const done = memory.score(req.user, c.id, req.body);
  if (done.error) return fail(res, 400, done.error);
  log(req, {
    action: 'create', entity: 'memory verse score', entityId: done.id,
    summary: `Scored ${done.student.name} ${stars(done.stars)} on ${done.verse.reference} in "${c.name}"`,
  });
  notifications.notify({
    users: accountsForStudent(done.student.directory_id), kind: 'memory-score', actor: req.user,
    title: `${done.student.name}: ${stars(done.stars)} on ${done.verse.reference}`,
    body: `${STARS[done.stars]} — scored by ${req.user.name || 'a teacher'} in "${c.name}".`,
    subjectType: 'memory-class', subjectId: c.id,
  });
  res.json({ success: true, id: done.id, grid: memory.setGrid(c.id, done.verse.set_id), class: memory.classDetail(c.id, range(req.query)) });
});

router.delete('/classes/:id/scores/:scoreId', teacherOnly, (req, res) => {
  const c = req.memoryClass;
  const row = db.prepare(`
    SELECT x.*, s.name AS student FROM memory_scores x JOIN memory_class_students s ON s.id = x.student_id WHERE x.id = ? AND x.class_id = ?
  `).get(Number(req.params.scoreId), c.id);
  if (!row) return fail(res, 404, 'No such score');
  db.prepare('DELETE FROM memory_scores WHERE id = ?').run(row.id);
  log(req, { action: 'delete', entity: 'memory verse score', entityId: row.id, summary: `Took back ${row.student}'s ${stars(row.stars)} on ${row.reference} in "${c.name}"` });
  res.json({ success: true, grid: row.set_id ? memory.setGrid(c.id, row.set_id) : [], class: memory.classDetail(c.id, range(req.query)) });
});

module.exports = router;
