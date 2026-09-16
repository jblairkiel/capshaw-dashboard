// /api/game-questions is the custom question bank behind the Bible Bowl game:
// a small CRUD surface plus a generate endpoint that saves what Claude returns.
jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());
jest.mock('@anthropic-ai/sdk', () => require('./helpers/anthropicMock').createAnthropicMock());

const request   = require('supertest');
const express   = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const db        = require('../db');
const router    = require('../routes/gameQuestions');
const { reply } = require('./helpers/anthropicMock');

const messagesCreate = Anthropic.__messagesCreate;

function buildApp(user = null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/game-questions', router);
  return app;
}

const MEMBER  = { id: 1, role: 'approved' };
const PENDING = { id: 2, role: 'pending' };

const MC   = { type: 'mc', question: 'Who built the ark?', options: ['Noah', 'Moses', 'David', 'Paul'], answer: '0', hint: '' };
const TF   = { type: 'true-false', question: 'Jonah was swallowed by a whale.', options: null, answer: 'true', hint: '' };
const OPEN = { type: 'open', question: 'How many days did it rain?', options: null, answer: '40', hint: 'Genesis 7' };

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  db.prepare('DELETE FROM custom_game_questions').run();
  messagesCreate.mockReset();
  Anthropic.mockClear();
  process.env = { ...ORIGINAL_ENV, ANTHROPIC_API_KEY: 'test-key' };
});

afterAll(() => { process.env = ORIGINAL_ENV; });

// ─── GET / ────────────────────────────────────────────────────────────────────

describe('GET /api/game-questions', () => {
  test('401 when signed out', async () => {
    expect((await request(buildApp(null)).get('/api/game-questions')).status).toBe(401);
  });

  test('a pending account may read the bank even though it cannot edit it', async () => {
    const res = await request(buildApp(PENDING)).get('/api/game-questions');
    expect(res.status).toBe(200);
    expect(res.body.questions).toEqual([]);
  });

  test('parses stored options back into an array, and leaves a question without them null', async () => {
    await request(buildApp(MEMBER)).post('/api/game-questions').send(MC);
    await request(buildApp(MEMBER)).post('/api/game-questions').send(TF);

    const res = await request(buildApp(MEMBER)).get('/api/game-questions');
    expect(res.status).toBe(200);
    const [mc, tf] = res.body.questions;
    expect(mc.options).toEqual(['Noah', 'Moses', 'David', 'Paul']);
    expect(tf.options).toBeNull();
  });
});

// ─── POST / ───────────────────────────────────────────────────────────────────

describe('POST /api/game-questions', () => {
  test('401 signed out, 403 while pending', async () => {
    expect((await request(buildApp(null)).post('/api/game-questions').send(MC)).status).toBe(401);
    expect((await request(buildApp(PENDING)).post('/api/game-questions').send(MC)).status).toBe(403);
  });

  test('stores the question and echoes it back with an id', async () => {
    const res = await request(buildApp(MEMBER)).post('/api/game-questions').send(MC);
    expect(res.status).toBe(200);
    expect(res.body.question).toMatchObject({ type: 'mc', question: 'Who built the ark?', answer: '0' });
    expect(typeof res.body.question.id).toBe('number');
    expect(db.prepare('SELECT COUNT(*) AS n FROM custom_game_questions').get().n).toBe(1);
  });

  test('trims the question text and the hint', async () => {
    const res = await request(buildApp(MEMBER))
      .post('/api/game-questions')
      .send({ ...OPEN, question: '  How many days?  ', hint: '  Genesis 7  ' });
    expect(res.body.question.question).toBe('How many days?');
    expect(res.body.question.hint).toBe('Genesis 7');
  });

  test('stores an answer of any type as a string, so "0" and 0 behave alike', async () => {
    const res = await request(buildApp(MEMBER)).post('/api/game-questions').send({ ...MC, answer: 0 });
    expect(res.body.question.answer).toBe('0');
  });

  test('400 when type, question or answer is missing', async () => {
    const bad = [
      { ...MC, type: undefined },
      { ...MC, question: '   ' },
      { ...MC, answer: undefined },
      { ...MC, answer: null },
    ];
    for (const body of bad) {
      const res = await request(buildApp(MEMBER)).post('/api/game-questions').send(body);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/required/);
    }
  });
});

// ─── PUT /:id ─────────────────────────────────────────────────────────────────

describe('PUT /api/game-questions/:id', () => {
  let id;
  beforeEach(async () => {
    id = (await request(buildApp(MEMBER)).post('/api/game-questions').send(MC)).body.question.id;
  });

  test('401 signed out, 403 while pending', async () => {
    expect((await request(buildApp(null)).put(`/api/game-questions/${id}`).send(MC)).status).toBe(401);
    expect((await request(buildApp(PENDING)).put(`/api/game-questions/${id}`).send(MC)).status).toBe(403);
  });

  test('replaces every field of the question', async () => {
    const res = await request(buildApp(MEMBER)).put(`/api/game-questions/${id}`).send(OPEN);
    expect(res.status).toBe(200);

    const row = db.prepare('SELECT * FROM custom_game_questions WHERE id = ?').get(id);
    expect(row).toMatchObject({ type: 'open', question: 'How many days did it rain?', answer: '40', hint: 'Genesis 7' });
    // Dropping the options clears the stored JSON rather than leaving the old set
    expect(row.options).toBeNull();
  });

  test('400 when the replacement is incomplete', async () => {
    const res = await request(buildApp(MEMBER)).put(`/api/game-questions/${id}`).send({ type: 'mc' });
    expect(res.status).toBe(400);
  });

  test('updating a question that is not there still reports success', async () => {
    const res = await request(buildApp(MEMBER)).put('/api/game-questions/999999').send(OPEN);
    expect(res.status).toBe(200);
  });
});

// ─── DELETE /:id ──────────────────────────────────────────────────────────────

describe('DELETE /api/game-questions/:id', () => {
  test('401 signed out, 403 while pending', async () => {
    expect((await request(buildApp(null)).delete('/api/game-questions/1')).status).toBe(401);
    expect((await request(buildApp(PENDING)).delete('/api/game-questions/1')).status).toBe(403);
  });

  test('removes the question', async () => {
    const id = (await request(buildApp(MEMBER)).post('/api/game-questions').send(MC)).body.question.id;
    const res = await request(buildApp(MEMBER)).delete(`/api/game-questions/${id}`);
    expect(res.status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) AS n FROM custom_game_questions').get().n).toBe(0);
  });
});

// ─── POST /generate ───────────────────────────────────────────────────────────

describe('POST /api/game-questions/generate', () => {
  const body = { passage: 'Genesis 6-9', gradeLevel: 'upper-elementary', questionCount: 3 };

  test('401 signed out, 403 while pending', async () => {
    expect((await request(buildApp(null)).post('/api/game-questions/generate').send(body)).status).toBe(401);
    expect((await request(buildApp(PENDING)).post('/api/game-questions/generate').send(body)).status).toBe(403);
  });

  test('400 when the passage or topic is blank', async () => {
    for (const passage of [undefined, '', '  ']) {
      const res = await request(buildApp(MEMBER)).post('/api/game-questions/generate').send({ passage });
      expect(res.status).toBe(400);
    }
  });

  test('500 when no API key is configured, without calling the model', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await request(buildApp(MEMBER)).post('/api/game-questions/generate').send(body);
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/ANTHROPIC_API_KEY/);
    expect(messagesCreate).not.toHaveBeenCalled();
  });

  test('saves everything the model returns and hands back the saved rows', async () => {
    messagesCreate.mockResolvedValue(reply(JSON.stringify([MC, TF, OPEN])));

    const res = await request(buildApp(MEMBER)).post('/api/game-questions/generate').send(body);
    expect(res.status).toBe(200);
    expect(res.body.questions).toHaveLength(3);
    expect(res.body.questions.every(q => typeof q.id === 'number')).toBe(true);
    expect(res.body.questions[0].options).toEqual(['Noah', 'Moses', 'David', 'Paul']);
    expect(db.prepare('SELECT COUNT(*) AS n FROM custom_game_questions').get().n).toBe(3);
  });

  test('strips markdown fences around the JSON', async () => {
    messagesCreate.mockResolvedValue(reply('```json\n' + JSON.stringify([TF]) + '\n```'));
    const res = await request(buildApp(MEMBER)).post('/api/game-questions/generate').send(body);
    expect(res.status).toBe(200);
    expect(res.body.questions).toHaveLength(1);
  });

  test('a question with no hint is saved with an empty one', async () => {
    messagesCreate.mockResolvedValue(reply(JSON.stringify([{ ...TF, hint: undefined }])));
    const res = await request(buildApp(MEMBER)).post('/api/game-questions/generate').send(body);
    expect(res.body.questions[0].hint).toBe('');
  });

  test('builds the prompt from the count, grade and passage', async () => {
    messagesCreate.mockResolvedValue(reply('[]'));
    await request(buildApp(MEMBER)).post('/api/game-questions/generate')
      .send({ passage: 'Psalm 23', gradeLevel: 'preschool', questionCount: 6 });

    const prompt = messagesCreate.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain('Create exactly 6 game-ready quiz questions');
    expect(prompt).toContain('preschool children ages 3–5');
    expect(prompt).toContain('Bible passage or topic: "Psalm 23"');
  });

  test('defaults to ten upper-elementary questions', async () => {
    messagesCreate.mockResolvedValue(reply('[]'));
    await request(buildApp(MEMBER)).post('/api/game-questions/generate').send({ passage: 'Psalm 23' });

    const prompt = messagesCreate.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain('Create exactly 10 game-ready quiz questions');
    expect(prompt).toContain('upper elementary students grades 4–6');
  });

  test('500 when the model returns something that is not JSON, and nothing is saved', async () => {
    messagesCreate.mockResolvedValue(reply('I cannot do that.'));
    const res = await request(buildApp(MEMBER)).post('/api/game-questions/generate').send(body);
    expect(res.status).toBe(500);
    expect(db.prepare('SELECT COUNT(*) AS n FROM custom_game_questions').get().n).toBe(0);
  });

  test('one unusable question in the batch saves none of them', async () => {
    messagesCreate.mockResolvedValue(reply(JSON.stringify([MC, { type: 'open' /* no question text */ }])));
    const res = await request(buildApp(MEMBER)).post('/api/game-questions/generate').send(body);
    expect(res.status).toBe(500);
    expect(db.prepare('SELECT COUNT(*) AS n FROM custom_game_questions').get().n).toBe(0);
  });

  test('500 when the model call itself fails', async () => {
    messagesCreate.mockRejectedValue(new Error('rate limited'));
    const res = await request(buildApp(MEMBER)).post('/api/game-questions/generate').send(body);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('rate limited');
  });
});
