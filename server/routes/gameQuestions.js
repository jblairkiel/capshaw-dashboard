const express   = require('express');
const router    = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const db        = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const GRADE_DESCRIPTIONS = {
  'preschool':        'preschool children ages 3–5. Use very simple words and focus on basic who/what facts.',
  'early-elementary': 'early elementary students grades 1–3 (ages 6–8). Simple vocabulary, concrete story facts.',
  'upper-elementary': 'upper elementary students grades 4–6 (ages 9–11). Age-appropriate vocabulary, some inference.',
  'middle-school':    'middle school students grades 7–8 (ages 12–14). Moderate complexity, some theological context.',
  'high-school':      'high school students grades 9–12 (ages 15–18). Full vocabulary, deeper meaning allowed.',
  'adult':            'adult learners. Full theological and textual depth.',
};

const parse = row => ({ ...row, options: row.options ? JSON.parse(row.options) : null });

router.get('/', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM custom_game_questions ORDER BY created_at ASC').all();
  res.json({ success: true, questions: rows.map(parse) });
});

router.post('/', requireAdmin, (req, res) => {
  const { type, question, options, answer, hint = '' } = req.body;
  if (!type || !question?.trim() || answer == null)
    return res.status(400).json({ success: false, error: 'type, question, and answer are required' });

  const optJson = options ? JSON.stringify(options) : null;
  const { lastInsertRowid: id } = db
    .prepare('INSERT INTO custom_game_questions (type, question, options, answer, hint) VALUES (?,?,?,?,?)')
    .run(type, question.trim(), optJson, String(answer), hint.trim());

  res.json({ success: true, question: { id, type, question: question.trim(), options: options ?? null, answer: String(answer), hint: hint.trim() } });
});

router.put('/:id', requireAdmin, (req, res) => {
  const { type, question, options, answer, hint = '' } = req.body;
  if (!type || !question?.trim() || answer == null)
    return res.status(400).json({ success: false, error: 'type, question, and answer are required' });

  const optJson = options ? JSON.stringify(options) : null;
  db.prepare('UPDATE custom_game_questions SET type=?,question=?,options=?,answer=?,hint=? WHERE id=?')
    .run(type, question.trim(), optJson, String(answer), hint.trim(), req.params.id);

  res.json({ success: true });
});

router.delete('/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM custom_game_questions WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ─── AI generation ────────────────────────────────────────────────────────────

router.post('/generate', requireAdmin, async (req, res) => {
  const { passage, gradeLevel = 'upper-elementary', questionCount = 10 } = req.body;

  if (!passage?.trim())
    return res.status(400).json({ success: false, error: 'passage or topic is required' });
  if (!process.env.ANTHROPIC_API_KEY)
    return res.status(500).json({ success: false, error: 'ANTHROPIC_API_KEY is not configured on the server' });

  const client    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const gradeDesc = GRADE_DESCRIPTIONS[gradeLevel] || gradeLevel;

  const prompt = `You are a Bible Bowl game designer for a Church of Christ Sunday School program.

Create exactly ${questionCount} game-ready quiz questions suitable for ${gradeDesc}

Bible passage or topic: "${passage}"

Generate a balanced mix of question types:
- "mc" (multiple choice): ~50% of questions. Four options, exactly one correct answer, three wrong options that are plausible but clearly incorrect. Wrong options should not be obviously silly.
- "true-false": ~25% of questions. A clear statement that is definitively true or false based on Scripture — no ambiguity or trick wording.
- "open": ~25% of questions. Short factual question with a specific, brief answer a teacher can quickly judge in a game setting.

Strict rules:
- Every question must be answerable directly from the passage or topic — no outside knowledge required.
- Keep each question short and game-friendly (one sentence max). No multi-part questions.
- Vary the difficulty slightly — include some easy, some medium.
- Do NOT generate discussion or reflection questions — this is a competitive game.

Return ONLY a valid JSON array with no markdown fences, no explanation, nothing else:
[
  { "type": "mc", "question": "...", "options": ["option A", "option B", "option C", "option D"], "answer": "0", "hint": "" },
  { "type": "true-false", "question": "...", "options": null, "answer": "true", "hint": "" },
  { "type": "open", "question": "...", "options": null, "answer": "expected short answer", "hint": "optional teacher hint or empty string" }
]

"answer" field rules:
- mc → the string index "0", "1", "2", or "3" of the correct option in the options array
- true-false → "true" or "false"
- open → the expected answer text`;

  try {
    const message = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 4096,
      messages:   [{ role: 'user', content: prompt }],
    });

    let raw = message.content[0].text.trim()
      .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

    const generated = JSON.parse(raw);

    const insert = db.prepare(
      'INSERT INTO custom_game_questions (type, question, options, answer, hint) VALUES (?,?,?,?,?)'
    );

    const saved = db.transaction(() =>
      generated.map(q => {
        const optJson = q.options ? JSON.stringify(q.options) : null;
        const { lastInsertRowid: id } = insert.run(
          q.type, q.question.trim(), optJson, String(q.answer), q.hint?.trim() || ''
        );
        return { id, type: q.type, question: q.question.trim(), options: q.options ?? null, answer: String(q.answer), hint: q.hint?.trim() || '' };
      })
    )();

    res.json({ success: true, questions: saved });
  } catch (err) {
    console.error('[game-questions] generate error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
