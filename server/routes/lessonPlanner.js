const express   = require('express');
const router    = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const db        = require('../db');

const GRADE_NAMES = {
  'preschool':        'Preschool (ages 3–5)',
  'early-elementary': 'Early Elementary (grades 1–3, ages 6–8)',
  'upper-elementary': 'Upper Elementary (grades 4–6, ages 9–11)',
  'middle-school':    'Middle School (grades 7–8, ages 12–14)',
  'high-school':      'High School (grades 9–12, ages 15–18)',
  'adult':            'Adult',
};

const GRADE_INSTRUCTIONS = {
  'preschool': `
- Use sentences no longer than 5–6 words when speaking to the class.
- Change activities every 3–5 minutes — attention spans are very short.
- Include at least one song, fingerplay, or physical movement activity.
- Crafts must use large motor skills only (tearing, gluing big pieces, simple coloring).
- Repeat the single main truth at least 3 times throughout the lesson.
- Avoid abstract concepts — use only concrete, sensory examples.`,

  'early-elementary': `
- Keep vocabulary simple; define any unfamiliar Bible words immediately.
- Include at least one hands-on craft or activity with clear, step-by-step instructions.
- Use storytelling with character voices, drama, and vivid descriptions.
- Repeat and review key facts multiple times using call-and-response or games.
- Change activities every 5–8 minutes.
- Tie the lesson to familiar experiences (home, family, school, friends).`,

  'upper-elementary': `
- Students can read scripture aloud — assign specific verses to volunteers.
- Include both factual recall and 1–2 critical-thinking questions.
- Activities can include writing, drawing, or small-group work.
- Connect directly to their daily life (peer pressure, school, friendships).
- Sustain a single activity for 8–12 minutes.
- Acknowledge that they may have heard the story before and go deeper.`,

  'middle-school': `
- Treat students as emerging adults — avoid condescension.
- Include honest, challenging questions and real-world application scenarios.
- Small-group peer discussion is very effective at this age.
- Address doubts and hard questions directly and honestly.
- Sustain focused discussion for 12–15 minutes.
- Connect to identity, belonging, and decision-making themes.`,

  'high-school': `
- Engage with theological nuance and complexity — they can handle it.
- Include genuine debate questions and wrestling with difficult passages.
- Personal testimony examples are highly effective.
- Connect to college prep, dating, career, and life decisions.
- Allow 15–20 minutes for substantive discussion.
- Avoid oversimplifying; respect their capacity for critical thinking.`,

  'adult': `
- Provide full theological and historical/cultural context where relevant.
- Draw on life experience — include examples for different life stages (parents, singles, retirees, etc.).
- Allow extended discussion; build in 20+ minutes for group conversation.
- Include application questions specific to work, family, and community.
- Reference cross-passages or broader biblical themes when helpful.
- Teacher notes should suggest follow-up resources or deeper study options.`,
};

// ─── Generate ─────────────────────────────────────────────────────────────────

router.post('/generate', async (req, res) => {
  const { passage, gradeLevel = 'upper-elementary', duration = 45, focuses = [] } = req.body;

  if (!passage?.trim())
    return res.status(400).json({ success: false, error: 'passage is required' });
  if (!process.env.ANTHROPIC_API_KEY)
    return res.status(500).json({ success: false, error: 'ANTHROPIC_API_KEY is not configured' });

  const client    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const gradeName = GRADE_NAMES[gradeLevel] || gradeLevel;
  const gradeInst = GRADE_INSTRUCTIONS[gradeLevel] || '';
  const focusText = focuses.length ? focuses.join(', ') : 'scripture, discussion, application';

  const prompt = `You are an expert Sunday School curriculum designer for Churches of Christ congregations.

Create a complete, detailed, and immediately usable lesson plan for ${gradeName}.

Lesson parameters:
- Passage or topic: "${passage}"
- Class duration: ${duration} minutes
- Emphasis areas: ${focusText}

This plan will be used by volunteer teachers with no seminary training, so every instruction must be concrete and step-by-step.

Return ONLY a valid JSON object — no markdown fences, no explanation, nothing else:
{
  "title": "Creative and specific lesson title (not generic like 'Bible Story Time')",
  "objectives": [
    "By the end of class, students will be able to [specific measurable verb + content]",
    "Students will understand [key theological concept from this passage]",
    "Students will connect [biblical truth] to [concrete age-appropriate life situation]"
  ],
  "materials": [
    "Bibles (one per student if possible)",
    "...any other materials needed — be specific about paper type, marker color, etc."
  ],
  "memoryVerse": {
    "reference": "Book Chapter:Verse",
    "text": "Complete verse text exactly as it should appear"
  },
  "sections": [
    {
      "title": "Descriptive and specific section name",
      "duration": 5,
      "type": "opener",
      "content": "Detailed teacher script and step-by-step instructions. Include exact phrases to say, physical setup directions, and how to handle student responses. Long enough that a brand-new teacher could follow without any preparation.",
      "items": [
        "Specific discussion question, activity instruction, or key talking point",
        "..."
      ],
      "teacherNote": "Private tip for the teacher: differentiation ideas, common misconceptions to address, classroom management advice, or important theological background. Use empty string if not needed."
    }
  ]
}

Section type definitions:
- "opener": Hook activity or attention-getter. Always the first section (3–7 min).
- "scripture": Bible reading, text exploration, or story time. Required.
- "discussion": Guided questions and group conversation.
- "activity": Hands-on project, game, craft, or movement exercise.
- "closing": Memory verse, prayer, review, and send-home message. Always the last section (3–7 min).

Grade-level requirements for ${gradeName}:
${gradeInst}

HARD CONSTRAINTS:
1. All section durations MUST sum to exactly ${duration} minutes. Check this before responding.
2. The plan MUST begin with an "opener" section and end with a "closing" section.
3. Memory verse must come directly from or be closely related to the passage.
4. Every activity must require only common classroom/church supplies.
5. Content must be theologically sound within Churches of Christ tradition.
6. Every section's "content" field must be at least 3 sentences of actionable teacher instructions.
7. "items" arrays should have 2–5 specific, concrete entries each.`;

  try {
    const message = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 8096,
      messages:   [{ role: 'user', content: prompt }],
    });

    let raw = message.content[0].text.trim()
      .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

    const plan = JSON.parse(raw);
    res.json({ success: true, plan });
  } catch (err) {
    console.error('[lesson-planner] generate error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Save ─────────────────────────────────────────────────────────────────────

router.post('/save', (req, res) => {
  const { passage, gradeLevel, duration, focuses = [], plan } = req.body;
  if (!passage?.trim() || !gradeLevel || !duration || !plan)
    return res.status(400).json({ success: false, error: 'passage, gradeLevel, duration, and plan are required' });

  try {
    const { lastInsertRowid: id } = db
      .prepare('INSERT INTO lesson_plans (title, passage, grade, duration, focuses, plan_json) VALUES (?,?,?,?,?,?)')
      .run(plan.title || passage, passage.trim(), gradeLevel, duration, focuses.join(','), JSON.stringify(plan));
    res.json({ success: true, id });
  } catch (err) {
    console.error('[lesson-planner] save error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── List ─────────────────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const rows = db.prepare(
    'SELECT id, title, passage, grade, duration, focuses, created_at FROM lesson_plans ORDER BY created_at DESC'
  ).all();
  res.json({ success: true, plans: rows });
});

// ─── Get one ──────────────────────────────────────────────────────────────────

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM lesson_plans WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ success: false, error: 'Not found' });
  res.json({ success: true, plan: { ...row, plan: JSON.parse(row.plan_json) } });
});

// ─── Delete ───────────────────────────────────────────────────────────────────

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM lesson_plans WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
