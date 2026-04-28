const express  = require('express');
const router    = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const db        = require('../db');
const { requireAdmin } = require('../middleware/auth');

const GRADE_DESCRIPTIONS = {
  'preschool':        'preschool children ages 3–5. Use very simple language, yes/no questions, and focus on basic story facts like names and simple actions.',
  'early-elementary': 'early elementary students in grades 1–3 (ages 6–8). Use simple vocabulary, short answers, and focus on who/what/where story facts.',
  'upper-elementary': 'upper elementary students in grades 4–6 (ages 9–11). Include comprehension and basic application questions with grade-appropriate vocabulary.',
  'middle-school':    'middle school students in grades 7–8 (ages 12–14). Include deeper meaning, personal application, and some discussion questions.',
  'high-school':      'high school students in grades 9–12 (ages 15–18). Include theological reflection, personal application, and open-ended discussion questions.',
  'adult':            'adults. Include full theological depth, application to daily life, and rich discussion questions.',
};

router.post('/generate-questions', requireAdmin, async (req, res) => {
  const {
    passage,
    gradeLevel,
    questionCount = 10,
    questionTypes  = ['comprehension', 'application', 'discussion'],
  } = req.body;

  if (!passage?.trim())
    return res.status(400).json({ success: false, error: 'passage is required' });
  if (!gradeLevel)
    return res.status(400).json({ success: false, error: 'gradeLevel is required' });
  if (!process.env.ANTHROPIC_API_KEY)
    return res.status(500).json({ success: false, error: 'ANTHROPIC_API_KEY is not set in .env' });

  const client    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const gradeDesc = GRADE_DESCRIPTIONS[gradeLevel] || `${gradeLevel} students`;

  const prompt = `You are a Sunday School curriculum assistant for a Church of Christ congregation.

Generate exactly ${questionCount} Bible study questions for ${gradeDesc}

Bible passage:
"""
${passage}
"""

Question types to include (mix them proportionally): ${questionTypes.join(', ')}

Type definitions:
- comprehension: factual, answered directly from the text
- application: how the passage applies to the student's daily life
- discussion: open-ended, for group conversation
- true-false: a statement the student marks true or false (include the correct answer)

Rules:
- Language and complexity must match the specified grade level
- Every question must be answerable from the provided passage or reference
- For preschool/early-elementary: very simple sentences, concrete ideas only
- For high-school/adult: include theological depth and life reflection

Return ONLY a valid JSON array — no markdown fences, no explanation. Schema:
[
  {
    "question": "...",
    "answer": "...",
    "type": "comprehension|application|discussion|true-false",
    "hint": "optional short teacher hint, or empty string"
  }
]`;

  try {
    const message = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 4096,
      messages:   [{ role: 'user', content: prompt }],
    });

    let raw = message.content[0].text.trim();
    // Strip markdown code fences if the model wraps the JSON
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

    const questions = JSON.parse(raw);
    res.json({ success: true, questions });
  } catch (err) {
    console.error('[bible-class] error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Library: save a generated set ───────────────────────────────────────────

router.post('/questions/save', requireAdmin, (req, res) => {
  const { passage, gradeLevel, questions } = req.body;
  if (!passage?.trim() || !gradeLevel || !Array.isArray(questions) || !questions.length)
    return res.status(400).json({ success: false, error: 'passage, gradeLevel, and questions required' });

  const save = db.transaction(() => {
    const { lastInsertRowid: setId } = db
      .prepare('INSERT INTO question_sets (passage, grade) VALUES (?, ?)')
      .run(passage.trim(), gradeLevel);

    const insertQ = db.prepare(
      'INSERT INTO questions (set_id, question, answer, type, hint) VALUES (?, ?, ?, ?, ?)'
    );
    for (const q of questions)
      insertQ.run(setId, q.question, q.answer, q.type, q.hint || '');

    return setId;
  });

  try {
    res.json({ success: true, setId: save() });
  } catch (err) {
    console.error('[bible-class] save error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Library: search / list saved sets ───────────────────────────────────────

router.get('/questions', (req, res) => {
  const { search = '', grade = '' } = req.query;

  const conditions = ['1=1'];
  const params     = [];

  if (grade)  { conditions.push('s.grade = ?');                                              params.push(grade); }
  if (search) { conditions.push('(s.passage LIKE ? OR q.question LIKE ? OR q.answer LIKE ?)'); params.push(...Array(3).fill(`%${search}%`)); }

  const rows = db.prepare(`
    SELECT s.id AS set_id, s.passage, s.grade, s.created_at,
           q.id, q.question, q.answer, q.type, q.hint
    FROM   question_sets s
    JOIN   questions q ON q.set_id = s.id
    WHERE  ${conditions.join(' AND ')}
    ORDER  BY s.created_at DESC, q.id ASC
  `).all(...params);

  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.set_id))
      map.set(r.set_id, { id: r.set_id, passage: r.passage, grade: r.grade, createdAt: r.created_at, questions: [] });
    map.get(r.set_id).questions.push({ id: r.id, question: r.question, answer: r.answer, type: r.type, hint: r.hint });
  }

  res.json({ success: true, sets: [...map.values()] });
});

// ─── Library: delete a set (cascades to questions) ────────────────────────────

router.delete('/questions/set/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM question_sets WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
