// /api/bible-class generates Sunday School questions with Claude and keeps the
// ones a teacher saves. The model call is mocked throughout: these tests are
// about what the route does with a reply, not about the reply itself.
jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

jest.mock('@anthropic-ai/sdk', () => require('./helpers/anthropicMock').createAnthropicMock());

const request   = require('supertest');
const express   = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const db        = require('../db');
const router    = require('../routes/bibleClass');
const { reply } = require('./helpers/anthropicMock');

const messagesCreate = Anthropic.__messagesCreate;

function buildApp(user = null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/bible-class', router);
  return app;
}

const ADMIN   = { id: 1, role: 'admin' };
const MEMBER  = { id: 2, role: 'approved' };
const PENDING = { id: 3, role: 'pending' };

const SAMPLE = [
  { question: 'Who built the ark?',      answer: 'Noah', type: 'comprehension', hint: '' },
  { question: 'When have you obeyed?',   answer: 'Varies', type: 'application', hint: 'Personal' },
];

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  db.prepare('DELETE FROM questions').run();
  db.prepare('DELETE FROM question_sets').run();
  messagesCreate.mockReset();
  Anthropic.mockClear();
  process.env = { ...ORIGINAL_ENV, ANTHROPIC_API_KEY: 'test-key' };
});

afterAll(() => { process.env = ORIGINAL_ENV; });

function seedSet(passage, grade, questions = SAMPLE) {
  const setId = db.prepare('INSERT INTO question_sets (passage, grade) VALUES (?,?)').run(passage, grade).lastInsertRowid;
  const ins = db.prepare('INSERT INTO questions (set_id, question, answer, type, hint) VALUES (?,?,?,?,?)');
  for (const q of questions) ins.run(setId, q.question, q.answer, q.type, q.hint || '');
  return setId;
}

// ─── POST /generate-questions ─────────────────────────────────────────────────

describe('POST /api/bible-class/generate-questions', () => {
  const body = { passage: 'Genesis 6', gradeLevel: 'early-elementary' };

  test('401 signed out, 403 while pending', async () => {
    expect((await request(buildApp(null)).post('/api/bible-class/generate-questions').send(body)).status).toBe(401);
    expect((await request(buildApp(PENDING)).post('/api/bible-class/generate-questions').send(body)).status).toBe(403);
  });

  test('400 when the passage is missing or only whitespace', async () => {
    for (const passage of [undefined, '', '   ']) {
      const res = await request(buildApp(MEMBER))
        .post('/api/bible-class/generate-questions')
        .send({ passage, gradeLevel: 'adult' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('passage is required');
    }
  });

  test('400 when the grade level is missing', async () => {
    const res = await request(buildApp(MEMBER))
      .post('/api/bible-class/generate-questions')
      .send({ passage: 'Genesis 6' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('gradeLevel is required');
  });

  test('500 with a clear message when no API key is configured', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await request(buildApp(MEMBER)).post('/api/bible-class/generate-questions').send(body);
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/ANTHROPIC_API_KEY/);
    expect(messagesCreate).not.toHaveBeenCalled();
  });

  test('returns the parsed questions on a clean reply', async () => {
    messagesCreate.mockResolvedValue(reply(JSON.stringify(SAMPLE)));
    const res = await request(buildApp(MEMBER)).post('/api/bible-class/generate-questions').send(body);
    expect(res.status).toBe(200);
    expect(res.body.questions).toEqual(SAMPLE);
  });

  test('strips markdown fences the model wraps the JSON in', async () => {
    messagesCreate.mockResolvedValue(reply('```json\n' + JSON.stringify(SAMPLE) + '\n```'));
    const res = await request(buildApp(MEMBER)).post('/api/bible-class/generate-questions').send(body);
    expect(res.status).toBe(200);
    expect(res.body.questions).toHaveLength(2);
  });

  test('strips an unlabelled fence too', async () => {
    messagesCreate.mockResolvedValue(reply('```\n' + JSON.stringify(SAMPLE) + '\n```'));
    expect((await request(buildApp(MEMBER)).post('/api/bible-class/generate-questions').send(body)).status).toBe(200);
  });

  test('builds the prompt from the requested count, grade and types', async () => {
    messagesCreate.mockResolvedValue(reply('[]'));
    await request(buildApp(MEMBER)).post('/api/bible-class/generate-questions').send({
      passage: 'Psalm 23', gradeLevel: 'preschool', questionCount: 4, questionTypes: ['true-false'],
    });

    const prompt = messagesCreate.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain('Generate exactly 4 Bible study questions');
    expect(prompt).toContain('preschool children ages 3–5');
    expect(prompt).toContain('Psalm 23');
    expect(prompt).toContain('mix them proportionally): true-false');
  });

  test('defaults to ten questions across the three usual types', async () => {
    messagesCreate.mockResolvedValue(reply('[]'));
    await request(buildApp(MEMBER)).post('/api/bible-class/generate-questions')
      .send({ passage: 'Psalm 23', gradeLevel: 'adult' });

    const prompt = messagesCreate.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain('Generate exactly 10 Bible study questions');
    expect(prompt).toContain('comprehension, application, discussion');
  });

  test('describes an unrecognised grade level rather than dropping it', async () => {
    messagesCreate.mockResolvedValue(reply('[]'));
    await request(buildApp(MEMBER)).post('/api/bible-class/generate-questions')
      .send({ passage: 'Psalm 23', gradeLevel: 'college' });
    expect(messagesCreate.mock.calls[0][0].messages[0].content).toContain('college students');
  });

  test('passes the API key through to the client', async () => {
    messagesCreate.mockResolvedValue(reply('[]'));
    await request(buildApp(MEMBER)).post('/api/bible-class/generate-questions').send(body);
    expect(Anthropic).toHaveBeenCalledWith({ apiKey: 'test-key' });
  });

  test('500 when the model returns something that is not JSON', async () => {
    messagesCreate.mockResolvedValue(reply('Sorry, I cannot help with that.'));
    const res = await request(buildApp(MEMBER)).post('/api/bible-class/generate-questions').send(body);
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });

  test('500 when the model call itself fails', async () => {
    messagesCreate.mockRejectedValue(new Error('upstream overloaded'));
    const res = await request(buildApp(MEMBER)).post('/api/bible-class/generate-questions').send(body);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('upstream overloaded');
  });
});

// ─── POST /questions/save ─────────────────────────────────────────────────────

describe('POST /api/bible-class/questions/save', () => {
  const good = { passage: 'Genesis 6', gradeLevel: 'adult', questions: SAMPLE };

  test('401 signed out, 403 while pending', async () => {
    expect((await request(buildApp(null)).post('/api/bible-class/questions/save').send(good)).status).toBe(401);
    expect((await request(buildApp(PENDING)).post('/api/bible-class/questions/save').send(good)).status).toBe(403);
  });

  test('saves the set and its questions together', async () => {
    const res = await request(buildApp(MEMBER)).post('/api/bible-class/questions/save').send(good);
    expect(res.status).toBe(200);
    expect(typeof res.body.setId).toBe('number');

    const saved = db.prepare('SELECT * FROM questions WHERE set_id = ?').all(res.body.setId);
    expect(saved).toHaveLength(2);
    expect(saved[0].question).toBe('Who built the ark?');
    // A question with no hint is stored as an empty string, never null
    expect(saved[0].hint).toBe('');
  });

  test('trims the passage before storing it', async () => {
    const res = await request(buildApp(MEMBER))
      .post('/api/bible-class/questions/save')
      .send({ ...good, passage: '  Genesis 6  ' });
    expect(db.prepare('SELECT passage FROM question_sets WHERE id = ?').get(res.body.setId).passage)
      .toBe('Genesis 6');
  });

  test('400 for each missing or empty part of the request', async () => {
    const bad = [
      { ...good, passage: '   ' },
      { ...good, gradeLevel: undefined },
      { ...good, questions: [] },
      { ...good, questions: 'not an array' },
    ];
    for (const body of bad) {
      const res = await request(buildApp(MEMBER)).post('/api/bible-class/questions/save').send(body);
      expect(res.status).toBe(400);
    }
  });

  test('a question the database rejects saves nothing at all', async () => {
    const res = await request(buildApp(MEMBER)).post('/api/bible-class/questions/save').send({
      ...good,
      questions: [SAMPLE[0], { question: 'No answer', answer: null, type: 'comprehension' }],
    });
    expect(res.status).toBe(500);
    // The insert runs in a transaction, so the half-written set is rolled back
    expect(db.prepare('SELECT COUNT(*) AS n FROM question_sets').get().n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM questions').get().n).toBe(0);
  });
});

// ─── GET /questions ───────────────────────────────────────────────────────────

describe('GET /api/bible-class/questions', () => {
  beforeEach(() => {
    seedSet('Genesis 6', 'adult');
    seedSet('Psalm 23', 'preschool', [{ question: 'Who is my shepherd?', answer: 'The Lord', type: 'comprehension', hint: '' }]);
  });

  test('groups the questions under their set', async () => {
    const res = await request(buildApp(MEMBER)).get('/api/bible-class/questions');
    expect(res.status).toBe(200);
    expect(res.body.sets).toHaveLength(2);

    const genesis = res.body.sets.find(s => s.passage === 'Genesis 6');
    expect(genesis.grade).toBe('adult');
    expect(genesis.questions.map(q => q.question)).toEqual(['Who built the ark?', 'When have you obeyed?']);
  });

  test('filters by grade', async () => {
    const res = await request(buildApp(MEMBER)).get('/api/bible-class/questions?grade=preschool');
    expect(res.body.sets).toHaveLength(1);
    expect(res.body.sets[0].passage).toBe('Psalm 23');
  });

  test('searches the passage, the question and the answer', async () => {
    for (const [term, passage] of [['Psalm', 'Psalm 23'], ['ark', 'Genesis 6'], ['shepherd', 'Psalm 23']]) {
      const res = await request(buildApp(MEMBER)).get(`/api/bible-class/questions?search=${term}`);
      expect(res.body.sets.map(s => s.passage)).toEqual([passage]);
    }
  });

  test('combines a search with a grade filter', async () => {
    const res = await request(buildApp(MEMBER)).get('/api/bible-class/questions?search=ark&grade=preschool');
    expect(res.body.sets).toEqual([]);
  });

  test('a set with no questions is not listed — there would be nothing to show', async () => {
    db.prepare('DELETE FROM questions').run();
    const res = await request(buildApp(MEMBER)).get('/api/bible-class/questions');
    expect(res.body.sets).toEqual([]);
  });
});

// ─── DELETE /questions/set/:id ────────────────────────────────────────────────

describe('DELETE /api/bible-class/questions/set/:id', () => {
  test('401 signed out, 403 while pending', async () => {
    const id = seedSet('Genesis 6', 'adult');
    expect((await request(buildApp(null)).delete(`/api/bible-class/questions/set/${id}`)).status).toBe(401);
    expect((await request(buildApp(PENDING)).delete(`/api/bible-class/questions/set/${id}`)).status).toBe(403);
  });

  test('removes the set and cascades to its questions', async () => {
    const id = seedSet('Genesis 6', 'adult');
    const res = await request(buildApp(ADMIN)).delete(`/api/bible-class/questions/set/${id}`);
    expect(res.status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) AS n FROM question_sets').get().n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM questions').get().n).toBe(0);
  });

  test('deleting a set that is not there still reports success', async () => {
    const res = await request(buildApp(MEMBER)).delete('/api/bible-class/questions/set/999999');
    expect(res.status).toBe(200);
  });
});
