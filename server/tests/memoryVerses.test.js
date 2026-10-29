// Bible Class → Memory Verses: the built-in library, searching it, members'
// own sets, practice and its review ladder, and classes whose teachers score
// recitations that a student and their household see.
jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const request = require('supertest');
const express = require('express');
const db      = require('../db');
const { initSchema } = require('../schema');
const recordKeeping = require('../lib/recordKeeping');
const router  = require('../routes/memoryVerses');
const { SETS, NOTICE } = require('../lib/memoryVerses/defaults');

function buildApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/memory-verses', router);
  return app;
}

function addPerson(name, { address = '', zip = '' } = {}) {
  return Number(db.prepare('INSERT INTO directory (name, address, zip) VALUES (?, ?, ?)').run(name, address, zip).lastInsertRowid);
}

function addUser(name, { role = 'approved', directoryId = null } = {}) {
  const id = db.prepare('INSERT INTO users (provider, provider_id, email, name, role, directory_id) VALUES (?,?,?,?,?,?)')
    .run('google', `${name}-id`, `${name.toLowerCase()}@example.com`, name, role, directoryId).lastInsertRowid;
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

const as = user => request(buildApp(user));
const bell = (userId, kind) => db.prepare('SELECT title, body FROM notifications WHERE user_id = ? AND kind = ? ORDER BY id').all(userId, kind);
const setId = slug => db.prepare('SELECT id FROM memory_sets WHERE slug = ?').get(slug).id;
const versesOf = id => db.prepare('SELECT * FROM memory_verses WHERE set_id = ? ORDER BY position').all(id);

let day = '2026-11-01';
jest.spyOn(recordKeeping, 'churchToday').mockImplementation(() => day);

let ADMIN, ANN, BOB;
const MINE = { title: 'Our VBS verses', category: 'Christian Living', difficulty: 'beginner', audience: 'children', tags: 'vbs, summer',
  verses: [{ reference: 'Psalm 56:3', text: 'When I am afraid, I will put my trust in You.' }, { reference: 'John 14:15', text: 'If you love Me, you will keep My commandments.' }] };

beforeEach(() => {
  day = '2026-11-01';
  for (const t of ['notifications', 'action_log', 'memory_scores', 'memory_class_students', 'memory_class_teachers', 'memory_classes', 'memory_practice_days', 'memory_progress', 'users', 'directory']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
  db.prepare('DELETE FROM memory_sets WHERE built_in = 0').run();
  ADMIN = addUser('Ada', { role: 'admin' });
  ANN = addUser('Ann');
  BOB = addUser('Bob');
});

describe('the built-in library', () => {
  test('every site starts with the default sets, in the NASB, with the Lockman notice', async () => {
    const res = await as(ANN).get('/api/memory-verses/sets');
    expect(res.body.sets.filter(s => s.builtIn)).toHaveLength(SETS.length);
    expect(SETS.length).toBeGreaterThanOrEqual(12);
    expect(new Set(res.body.sets.map(s => s.translation))).toEqual(new Set(['NASB 1995']));
    // Every difficulty and every age group has something.
    for (const d of ['beginner', 'intermediate', 'advanced']) expect(SETS.some(s => s.difficulty === d)).toBe(true);
    for (const a of ['children', 'youth', 'adults', 'everyone']) expect(SETS.some(s => s.audience === a)).toBe(true);
    const meta = (await as(ANN).get('/api/memory-verses/meta')).body;
    expect(meta.notice).toBe(NOTICE);
    expect(meta.notice).toMatch(/Lockman Foundation/);
    // Well inside the 500 verses Lockman allows without written permission.
    expect(db.prepare('SELECT COUNT(*) AS n FROM memory_verses v JOIN memory_sets s ON s.id = v.set_id WHERE s.built_in = 1').get().n).toBeLessThan(150);
  });

  test('is put in once: starting again adds nothing and keeps an admin\'s corrections', () => {
    const psalm = setId('psalm-23');
    db.prepare("UPDATE memory_sets SET title = 'Psalm 23 (corrected)' WHERE id = ?").run(psalm);
    const before = db.prepare('SELECT COUNT(*) AS n FROM memory_verses').get().n;
    initSchema(db);
    expect(db.prepare('SELECT COUNT(*) AS n FROM memory_sets WHERE built_in = 1').get().n).toBe(SETS.length);
    expect(db.prepare('SELECT COUNT(*) AS n FROM memory_verses').get().n).toBe(before);
    expect(db.prepare('SELECT title FROM memory_sets WHERE id = ?').get(psalm).title).toBe('Psalm 23 (corrected)');
    db.prepare("UPDATE memory_sets SET title = 'Psalm 23' WHERE id = ?").run(psalm);
  });

  test('every default verse has a reference and its words', () => {
    for (const set of SETS) {
      expect([set.slug, set.verses.length > 0]).toEqual([set.slug, true]);
      for (const v of set.verses) expect([v.reference, /^[1-3]? ?[A-Z][a-z]+( of [A-Z][a-z]+)? \d+:\d+(-\d+)?[ab]?$/.test(v.reference), v.text.length > 5]).toEqual([v.reference, true, true]);
    }
  });
});

describe('searching', () => {
  const search = (q = {}) => as(ANN).get('/api/memory-verses/sets').query(q).then(r => r.body.sets.map(s => s.title));

  test('finds a set by its verses\' words or references, as well as its title', async () => {
    expect(await search({ q: 'green pastures' })).toEqual(['Psalm 23']);
    expect(await search({ q: 'shepherd' })).toEqual(['Psalm 23', 'The Lord\'s Church']);   // Acts 20:28
    expect(await search({ q: 'John 3:16' })).toContain('First Verses');
    expect(await search({ q: 'baptized salvation' })).toContain('The Way of Salvation');
    expect(await search({ q: 'nothing like this anywhere' })).toEqual([]);
  });

  test('filters by difficulty, category and age group; "everyone" suits every age', async () => {
    expect(await search({ difficulty: 'advanced' })).toEqual(['Love Is Patient', 'The Beatitudes']);
    expect(await search({ category: 'Worship' })).toEqual(['In Spirit and Truth']);
    const children = await search({ audience: 'children' });
    expect(children).toContain('First Verses');
    expect(children).toContain('Psalm 23');
    expect(children).not.toContain('Comfort in Hard Times');
  });

  test('"my sets" is only the ones I made', async () => {
    await as(ANN).post('/api/memory-verses/sets').send(MINE);
    expect(await search({ mine: '1' })).toEqual(['Our VBS verses']);
    expect((await as(BOB).get('/api/memory-verses/sets?mine=1')).body.sets).toEqual([]);
  });
});

describe('members\' own sets', () => {
  test('any member can add a set; it is checked and tidied', async () => {
    const res = await as(ANN).post('/api/memory-verses/sets').send(MINE);
    expect(res.status).toBe(200);
    expect(res.body.set).toMatchObject({ title: 'Our VBS verses', tags: ['vbs', 'summer'], translation: 'NASB 1995', mine: true, canEdit: true, builtIn: false });
    expect(res.body.set.verses.map(v => v.reference)).toEqual(['Psalm 56:3', 'John 14:15']);
    expect(db.prepare('SELECT summary FROM action_log').get().summary).toBe('Added the memory verse set "Our VBS verses" (2 verses)');

    expect((await as(ANN).post('/api/memory-verses/sets').send({ ...MINE, title: 'x' })).body.error).toMatch(/title/);
    expect((await as(ANN).post('/api/memory-verses/sets').send({ ...MINE, verses: [] })).body.error).toMatch(/at least one verse/);
    expect((await as(ANN).post('/api/memory-verses/sets').send({ ...MINE, verses: [{ reference: 'Psalm 1:1', text: '' }] })).body.error).toMatch(/Verse 1 needs both/);
  });

  test('only whoever made it, or an admin, changes or removes it', async () => {
    const { id } = (await as(ANN).post('/api/memory-verses/sets').send(MINE)).body.set;
    expect((await as(BOB).put(`/api/memory-verses/sets/${id}`).send(MINE)).status).toBe(403);
    expect((await as(BOB).delete(`/api/memory-verses/sets/${id}`)).status).toBe(403);
    expect((await as(ADMIN).put(`/api/memory-verses/sets/${id}`).send({ ...MINE, title: 'VBS 2026' })).body.set.title).toBe('VBS 2026');
    expect((await as(ANN).delete(`/api/memory-verses/sets/${id}`)).status).toBe(200);
    expect(db.prepare('SELECT 1 FROM memory_sets WHERE id = ?').get(id)).toBeUndefined();
  });

  test('a built-in set is an admin\'s to correct, never removed, and anyone can copy it', async () => {
    const psalm = setId('psalm-23');
    const body = (await as(ANN).get(`/api/memory-verses/sets/${psalm}`)).body.set;
    expect(body.canEdit).toBe(false);
    expect((await as(ANN).put(`/api/memory-verses/sets/${psalm}`).send(body)).body.error).toMatch(/make a copy/);
    expect((await as(ADMIN).delete(`/api/memory-verses/sets/${psalm}`)).body.error).toMatch(/cannot be removed/);

    const copy = (await as(ANN).post(`/api/memory-verses/sets/${psalm}/copy`)).body.set;
    expect(copy).toMatchObject({ title: 'Psalm 23 (my copy)', builtIn: false, mine: true });
    expect(copy.verses).toHaveLength(6);
  });

  test('changing a set keeps practice on the verses that stayed', async () => {
    const { id, verses } = (await as(ANN).post('/api/memory-verses/sets').send(MINE)).body.set;
    await as(ANN).post('/api/memory-verses/practice').send({ verseId: verses[1].id, correct: true });
    const changed = (await as(ANN).put(`/api/memory-verses/sets/${id}`).send({
      ...MINE, verses: [{ reference: 'John 14:15', text: 'If you love Me, you will keep My commandments.' }, { reference: 'Psalm 136:1', text: 'Give thanks to the LORD, for He is good,' }],
    })).body.set;
    expect(changed.verses.map(v => v.reference)).toEqual(['John 14:15', 'Psalm 136:1']);
    expect(changed.verses[0].id).toBe(verses[1].id);
    expect(changed.verses[0].progress).toMatchObject({ box: 1 });
    expect(versesOf(id)).toHaveLength(2);
  });
});

describe('practice', () => {
  const verse = () => versesOf(setId('first-verses'))[0].id;
  const practise = (user, correct, v = verse()) => as(user).post('/api/memory-verses/practice').send({ verseId: v, correct });

  test('right moves a verse up the ladder and further off; wrong sends it back to today', async () => {
    expect((await practise(ANN, true)).body).toMatchObject({ box: 1, learned: false, dueOn: '2026-11-02' });
    expect((await practise(ANN, true)).body).toMatchObject({ box: 2, dueOn: '2026-11-04' });
    expect((await practise(ANN, true)).body).toMatchObject({ box: 3, learned: true, dueOn: '2026-11-08' });
    expect((await practise(ANN, false)).body).toMatchObject({ box: 0, learned: false, dueOn: '2026-11-01' });
    expect(db.prepare('SELECT attempts, correct FROM memory_progress WHERE user_id = ?').get(ANN.id)).toEqual({ attempts: 4, correct: 3 });
  });

  test('my practice: verses learned, what is due, and a streak not broken until a day is missed', async () => {
    const v = versesOf(setId('first-verses'));
    for (const d of ['2026-10-29', '2026-10-30', '2026-10-31']) { day = d; await practise(ANN, true, v[1].id); }
    day = '2026-11-01';
    let me = (await as(ANN).get('/api/memory-verses/me')).body.practice;
    expect(me.streak).toBe(3);                       // yesterday counts until today is over
    expect(me.practisedToday).toBe(false);
    expect(me.learned).toBe(1);
    await practise(ANN, false, v[2].id);
    me = (await as(ANN).get('/api/memory-verses/me')).body.practice;
    expect(me.streak).toBe(4);
    expect(me.due.map(d => d.reference)).toEqual([v[2].reference]);
    expect(me.sets[0]).toMatchObject({ title: 'First Verses', practiced: 2, learned: 1, verseCount: v.length });

    day = '2026-11-03';
    expect((await as(ANN).get('/api/memory-verses/me')).body.practice.streak).toBe(0);
    // Nobody else's.
    expect((await as(BOB).get('/api/memory-verses/me')).body.practice).toMatchObject({ practiced: 0, streak: 0 });
  });

  test('the library shows how much of each set I have learned', async () => {
    const v = versesOf(setId('psalm-23'));
    for (let i = 0; i < 3; i++) await practise(ANN, true, v[0].id);
    const psalm = (await as(ANN).get('/api/memory-verses/sets?q=shepherd')).body.sets[0];
    expect(psalm).toMatchObject({ verseCount: 6, learned: 1, practiced: 1 });
    expect((await as(BOB).get('/api/memory-verses/sets?q=shepherd')).body.sets[0]).toMatchObject({ learned: 0 });
  });
});

describe('classes and scores', () => {
  let classId, joey, parent, child, childId, typed;
  const verse = () => versesOf(setId('first-verses'))[0];

  beforeEach(async () => {
    const joeyId = addPerson('Joey Ward');
    joey = addUser('Joey', { directoryId: joeyId });
    // A child with no account, and the parent at the same address.
    childId = addPerson('Lily Bell', { address: '12 Oak St', zip: '35749' });
    parent = addUser('Mary', { directoryId: addPerson('Mary Bell', { address: '12 Oak St', zip: '35749' }) });
    classId = (await as(ANN).post('/api/memory-verses/classes').send({ name: 'Wednesday 3rd–5th' })).body.id;
    let cls = (await as(ANN).post(`/api/memory-verses/classes/${classId}/students`).send({ directoryId: joeyId })).body.class;
    cls = (await as(ANN).post(`/api/memory-verses/classes/${classId}/students`).send({ directoryId: childId })).body.class;
    cls = (await as(ANN).post(`/api/memory-verses/classes/${classId}/students`).send({ name: 'Ava (visitor)' })).body.class;
    child = cls.students.find(s => s.name === 'Lily Bell');
    typed = cls.students.find(s => s.name === 'Ava (visitor)');
  });

  const scoreOf = (student, stars, v = verse()) => as(ANN).post(`/api/memory-verses/classes/${classId}/scores`).send({ studentId: student.id, verseId: v.id, stars });

  test('any member can start one and teaches it; nobody else sees it', async () => {
    expect((await as(ANN).get('/api/memory-verses/me')).body.classes.map(c => c.name)).toEqual(['Wednesday 3rd–5th']);
    expect((await as(BOB).get(`/api/memory-verses/classes/${classId}`)).status).toBe(403);
    expect((await as(BOB).post(`/api/memory-verses/classes/${classId}/scores`).send({})).status).toBe(403);
    const cls = (await as(ANN).get(`/api/memory-verses/classes/${classId}`)).body.class;
    expect(cls.students.map(s => s.name)).toEqual(['Ava (visitor)', 'Joey Ward', 'Lily Bell']);
    expect(cls.teachers.map(t => t.name)).toEqual(['Ann']);
  });

  test('students come from the directory once each, or by a typed name', async () => {
    const again = await as(ANN).post(`/api/memory-verses/classes/${classId}/students`).send({ directoryId: childId });
    expect(again.body.error).toBe('Lily Bell is already in this class');
    expect((await as(ANN).post(`/api/memory-verses/classes/${classId}/students`).send({ name: ' ' })).body.error).toMatch(/type a name/);
    // A student with an account, or a household with one, is told.
    expect(bell(joey.id, 'memory-class')[0].title).toBe('Joey Ward was added to the memory verse class "Wednesday 3rd–5th"');
    expect(bell(parent.id, 'memory-class')[0].title).toBe('Lily Bell was added to the memory verse class "Wednesday 3rd–5th"');
  });

  test('a recitation gets 1, 2 or 3 stars, and the student — or a child\'s household — is told', async () => {
    const joeyStudent = (await as(ANN).get(`/api/memory-verses/classes/${classId}`)).body.class.students.find(s => s.name === 'Joey Ward');
    expect((await scoreOf(joeyStudent, 3)).status).toBe(200);
    expect(bell(joey.id, 'memory-score')).toEqual([{ title: 'Joey Ward: ★★★ on Genesis 1:1', body: 'Word-perfect — scored by Ann in "Wednesday 3rd–5th".' }]);
    await scoreOf(child, 2);
    expect(bell(parent.id, 'memory-score')[0].title).toBe('Lily Bell: ★★ on Genesis 1:1');
    expect((await scoreOf(typed, 1)).status).toBe(200);
    expect((await scoreOf(typed, 4)).body.error).toMatch(/1, 2 or 3 stars/);
    expect((await scoreOf(typed, 0)).body.error).toMatch(/1, 2 or 3 stars/);
    expect(db.prepare("SELECT summary FROM action_log WHERE entity = 'memory verse score' ORDER BY id").all().map(r => r.summary))
      .toContain('Scored Lily Bell ★★ on Genesis 1:1 in "Wednesday 3rd–5th"');
  });

  test('the board counts each student\'s best stars on each verse, highest first', async () => {
    const v = versesOf(setId('first-verses'));
    await scoreOf(child, 1, v[0]);
    await scoreOf(child, 3, v[0]);      // tried again later: the best counts
    await scoreOf(child, 2, v[1]);
    await scoreOf(typed, 3, v[0]);
    const { board } = (await as(ANN).get(`/api/memory-verses/classes/${classId}`)).body.class;
    expect(board.map(b => [b.name, b.points, b.verses, b.perfect])).toEqual([
      ['Lily Bell', 5, 2, 1], ['Ava (visitor)', 3, 1, 1], ['Joey Ward', 0, 0, 0],
    ]);
    const grid = (await as(ANN).get(`/api/memory-verses/classes/${classId}/sets/${setId('first-verses')}`)).body.grid;
    expect(grid).toContainEqual(expect.objectContaining({ studentId: child.id, verseId: v[0].id, stars: 3 }));
    // A term's board, by date.
    day = '2026-12-01';
    await scoreOf(typed, 3, v[1]);
    const december = (await as(ANN).get(`/api/memory-verses/classes/${classId}?from=2026-12-01`)).body.class.board;
    expect(december[0]).toMatchObject({ name: 'Ava (visitor)', points: 3 });
  });

  test('a student and their household see their own scores; nobody else does', async () => {
    await scoreOf(child, 3);
    const mine = (await as(parent).get('/api/memory-verses/me')).body.scores;
    expect(mine).toEqual([expect.objectContaining({ className: 'Wednesday 3rd–5th', student: 'Lily Bell', self: false, points: 3, verses: 1 })]);
    expect(mine[0].scores[0]).toMatchObject({ reference: 'Genesis 1:1', stars: 3, setTitle: 'First Verses' });
    expect((await as(joey).get('/api/memory-verses/me')).body.scores.map(s => [s.student, s.self])).toEqual([['Joey Ward', true]]);
    expect((await as(BOB).get('/api/memory-verses/me')).body.scores).toEqual([]);
  });

  test('a score can be taken back', async () => {
    const id = (await scoreOf(typed, 2)).body.id;
    await as(ANN).delete(`/api/memory-verses/classes/${classId}/scores/${id}`);
    expect(db.prepare('SELECT COUNT(*) AS n FROM memory_scores').get().n).toBe(0);
  });

  test('teachers can be added, are told, and the last one cannot leave', async () => {
    expect((await as(ANN).delete(`/api/memory-verses/classes/${classId}/teachers/${ANN.id}`)).body.error).toMatch(/at least one teacher/);
    await as(ANN).post(`/api/memory-verses/classes/${classId}/teachers`).send({ userId: BOB.id });
    expect(bell(BOB.id, 'memory-class')[0].title).toBe('Ann made you a teacher of the memory verse class "Wednesday 3rd–5th"');
    expect((await as(BOB).get(`/api/memory-verses/classes/${classId}`)).status).toBe(200);
    const left = (await as(ANN).delete(`/api/memory-verses/classes/${classId}/teachers/${ANN.id}`)).body;
    expect(left.class).toBeNull();
    expect((await as(ANN).get(`/api/memory-verses/classes/${classId}`)).status).toBe(403);
  });

  test('a class can be put away, and removed with its scores', async () => {
    await scoreOf(typed, 2);
    const away = (await as(ANN).put(`/api/memory-verses/classes/${classId}`).send({ archived: true })).body.class;
    expect(away.archived).toBe(true);
    await as(ANN).delete(`/api/memory-verses/classes/${classId}`);
    expect(db.prepare('SELECT COUNT(*) AS n FROM memory_scores').get().n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM memory_class_students').get().n).toBe(0);
  });

  test('finding people to add searches the directory and the accounts', async () => {
    const found = (await as(ANN).get('/api/memory-verses/people?q=bell')).body;
    expect(found.people.map(p => p.name)).toEqual(['Lily Bell', 'Mary Bell']);
    expect((await as(ANN).get('/api/memory-verses/people?q=bo')).body.accounts.map(a => a.name)).toEqual(['Bob']);
  });
});

test('an account still waiting for approval cannot use it', async () => {
  expect((await as(addUser('Pat', { role: 'pending' })).get('/api/memory-verses/sets')).status).toBe(403);
  expect((await as(null).get('/api/memory-verses/sets')).status).toBe(401);
});
