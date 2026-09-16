// /api/lesson-planner writes a full Sunday School lesson plan with Claude and
// keeps the ones a teacher saves. The model call is mocked throughout.
jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());
jest.mock('@anthropic-ai/sdk', () => require('./helpers/anthropicMock').createAnthropicMock());

const request   = require('supertest');
const express   = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const db        = require('../db');
const router    = require('../routes/lessonPlanner');
const { reply } = require('./helpers/anthropicMock');

const messagesCreate = Anthropic.__messagesCreate;

function buildApp(user = null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/lesson-planner', router);
  return app;
}

const MEMBER  = { id: 1, role: 'approved' };
const PENDING = { id: 2, role: 'pending' };

const PLAN = {
  title: 'Noah Trusts and Obeys',
  objectives: ['Students will retell the flood account'],
  materials: ['Bibles'],
  memoryVerse: { reference: 'Genesis 6:22', text: 'Noah did everything just as God commanded him.' },
  sections: [
    { title: 'Warm-up', duration: 5,  type: 'opener',   content: 'Ask…', items: ['Q1'], teacherNote: '' },
    { title: 'Read it', duration: 35, type: 'scripture', content: 'Read…', items: ['Gen 6'], teacherNote: '' },
    { title: 'Send-off', duration: 5, type: 'closing',  content: 'Pray…', items: ['Verse'], teacherNote: '' },
  ],
};

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  db.prepare('DELETE FROM lesson_plans').run();
  messagesCreate.mockReset();
  Anthropic.mockClear();
  process.env = { ...ORIGINAL_ENV, ANTHROPIC_API_KEY: 'test-key' };
});

afterAll(() => { process.env = ORIGINAL_ENV; });

function savePlan(overrides = {}) {
  return request(buildApp(MEMBER)).post('/api/lesson-planner/save').send({
    passage: 'Genesis 6-9', gradeLevel: 'upper-elementary', duration: 45, focuses: ['scripture'], plan: PLAN,
    ...overrides,
  });
}

// ─── POST /generate ───────────────────────────────────────────────────────────

describe('POST /api/lesson-planner/generate', () => {
  const body = { passage: 'Genesis 6-9', gradeLevel: 'upper-elementary', duration: 45 };

  test('401 signed out, 403 while pending', async () => {
    expect((await request(buildApp(null)).post('/api/lesson-planner/generate').send(body)).status).toBe(401);
    expect((await request(buildApp(PENDING)).post('/api/lesson-planner/generate').send(body)).status).toBe(403);
  });

  test('400 when the passage is blank', async () => {
    for (const passage of [undefined, '', '   ']) {
      const res = await request(buildApp(MEMBER)).post('/api/lesson-planner/generate').send({ passage });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('passage is required');
    }
  });

  test('500 when no API key is configured, without calling the model', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await request(buildApp(MEMBER)).post('/api/lesson-planner/generate').send(body);
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/ANTHROPIC_API_KEY/);
    expect(messagesCreate).not.toHaveBeenCalled();
  });

  test('returns the parsed plan', async () => {
    messagesCreate.mockResolvedValue(reply(JSON.stringify(PLAN)));
    const res = await request(buildApp(MEMBER)).post('/api/lesson-planner/generate').send(body);
    expect(res.status).toBe(200);
    expect(res.body.plan.title).toBe('Noah Trusts and Obeys');
    expect(res.body.plan.sections).toHaveLength(3);
  });

  test('strips markdown fences around the JSON', async () => {
    messagesCreate.mockResolvedValue(reply('```json\n' + JSON.stringify(PLAN) + '\n```'));
    const res = await request(buildApp(MEMBER)).post('/api/lesson-planner/generate').send(body);
    expect(res.status).toBe(200);
    expect(res.body.plan.title).toBe('Noah Trusts and Obeys');
  });

  test('carries the passage, duration, grade and emphases into the prompt', async () => {
    messagesCreate.mockResolvedValue(reply('{}'));
    await request(buildApp(MEMBER)).post('/api/lesson-planner/generate').send({
      passage: 'Psalm 23', gradeLevel: 'preschool', duration: 30, focuses: ['craft', 'song'],
    });

    const prompt = messagesCreate.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain('Passage or topic: "Psalm 23"');
    expect(prompt).toContain('Class duration: 30 minutes');
    expect(prompt).toContain('Emphasis areas: craft, song');
    expect(prompt).toContain('Preschool (ages 3–5)');
    // The grade-specific coaching block is spliced in too
    expect(prompt).toContain('attention spans are very short');
    expect(prompt).toContain('MUST sum to exactly 30 minutes');
  });

  test('defaults to a 45-minute upper-elementary lesson with the usual emphases', async () => {
    messagesCreate.mockResolvedValue(reply('{}'));
    await request(buildApp(MEMBER)).post('/api/lesson-planner/generate').send({ passage: 'Psalm 23' });

    const prompt = messagesCreate.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain('Class duration: 45 minutes');
    expect(prompt).toContain('Upper Elementary (grades 4–6, ages 9–11)');
    expect(prompt).toContain('Emphasis areas: scripture, discussion, application');
  });

  test('an unrecognised grade level is named in the prompt with no coaching block', async () => {
    messagesCreate.mockResolvedValue(reply('{}'));
    await request(buildApp(MEMBER)).post('/api/lesson-planner/generate')
      .send({ passage: 'Psalm 23', gradeLevel: 'college' });
    expect(messagesCreate.mock.calls[0][0].messages[0].content)
      .toContain('Grade-level requirements for college:');
  });

  test('500 when the model returns something that is not JSON', async () => {
    messagesCreate.mockResolvedValue(reply('Here is a lesson plan!'));
    const res = await request(buildApp(MEMBER)).post('/api/lesson-planner/generate').send(body);
    expect(res.status).toBe(500);
  });

  test('500 when the model call itself fails', async () => {
    messagesCreate.mockRejectedValue(new Error('timed out'));
    const res = await request(buildApp(MEMBER)).post('/api/lesson-planner/generate').send(body);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('timed out');
  });
});

// ─── POST /save ───────────────────────────────────────────────────────────────

describe('POST /api/lesson-planner/save', () => {
  test('401 signed out, 403 while pending', async () => {
    const body = { passage: 'Genesis 6', gradeLevel: 'adult', duration: 45, plan: PLAN };
    expect((await request(buildApp(null)).post('/api/lesson-planner/save').send(body)).status).toBe(401);
    expect((await request(buildApp(PENDING)).post('/api/lesson-planner/save').send(body)).status).toBe(403);
  });

  test('stores the plan with its title, trimmed passage and joined emphases', async () => {
    const res = await savePlan({ passage: '  Genesis 6-9  ', focuses: ['scripture', 'craft'] });
    expect(res.status).toBe(200);

    const row = db.prepare('SELECT * FROM lesson_plans WHERE id = ?').get(res.body.id);
    expect(row).toMatchObject({
      title: 'Noah Trusts and Obeys', passage: 'Genesis 6-9',
      grade: 'upper-elementary', duration: 45, focuses: 'scripture,craft',
    });
    expect(JSON.parse(row.plan_json).sections).toHaveLength(3);
  });

  test('falls back to the passage when the plan has no title', async () => {
    const res = await savePlan({ plan: { ...PLAN, title: '' } });
    expect(db.prepare('SELECT title FROM lesson_plans WHERE id = ?').get(res.body.id).title)
      .toBe('Genesis 6-9');
  });

  test('defaults to no emphases when none are given', async () => {
    const res = await savePlan({ focuses: undefined });
    expect(db.prepare('SELECT focuses FROM lesson_plans WHERE id = ?').get(res.body.id).focuses).toBe('');
  });

  test('400 for each missing part of the request', async () => {
    const bad = [
      { passage: '  ' }, { passage: 'Genesis 6' },
      { passage: 'Genesis 6', gradeLevel: 'adult' },
      { passage: 'Genesis 6', gradeLevel: 'adult', duration: 45 },
      { passage: 'Genesis 6', gradeLevel: 'adult', duration: 0, plan: PLAN },
    ];
    for (const body of bad) {
      const res = await request(buildApp(MEMBER)).post('/api/lesson-planner/save').send(body);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/required/);
    }
  });
});

// ─── GET / and GET /:id ───────────────────────────────────────────────────────

describe('GET /api/lesson-planner', () => {
  test('401 when signed out', async () => {
    expect((await request(buildApp(null)).get('/api/lesson-planner')).status).toBe(401);
  });

  test('a pending account may browse the saved plans', async () => {
    await savePlan();
    const res = await request(buildApp(PENDING)).get('/api/lesson-planner');
    expect(res.status).toBe(200);
    expect(res.body.plans).toHaveLength(1);
  });

  test('lists the summary of each plan without the full body', async () => {
    await savePlan();
    const res = await request(buildApp(MEMBER)).get('/api/lesson-planner');
    expect(res.body.plans[0]).toMatchObject({ title: 'Noah Trusts and Obeys', grade: 'upper-elementary' });
    expect(res.body.plans[0].plan_json).toBeUndefined();
  });
});

describe('GET /api/lesson-planner/:id', () => {
  test('401 when signed out', async () => {
    expect((await request(buildApp(null)).get('/api/lesson-planner/1')).status).toBe(401);
  });

  test('returns the stored plan with its JSON parsed back out', async () => {
    const { body: { id } } = await savePlan();
    const res = await request(buildApp(MEMBER)).get(`/api/lesson-planner/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.plan.plan.memoryVerse.reference).toBe('Genesis 6:22');
    expect(res.body.plan.passage).toBe('Genesis 6-9');
  });

  test('404 for a plan that is not there', async () => {
    const res = await request(buildApp(MEMBER)).get('/api/lesson-planner/999999');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

// ─── DELETE /:id ──────────────────────────────────────────────────────────────

describe('DELETE /api/lesson-planner/:id', () => {
  test('401 signed out, 403 while pending', async () => {
    expect((await request(buildApp(null)).delete('/api/lesson-planner/1')).status).toBe(401);
    expect((await request(buildApp(PENDING)).delete('/api/lesson-planner/1')).status).toBe(403);
  });

  test('removes the plan', async () => {
    const { body: { id } } = await savePlan();
    const res = await request(buildApp(MEMBER)).delete(`/api/lesson-planner/${id}`);
    expect(res.status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) AS n FROM lesson_plans').get().n).toBe(0);
  });

  test('deleting a plan that is not there still reports success', async () => {
    expect((await request(buildApp(MEMBER)).delete('/api/lesson-planner/999999')).status).toBe(200);
  });
});
