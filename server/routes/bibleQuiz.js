// ─── Bible quiz ───────────────────────────────────────────────────────────────
// The 500-question bank (lib/bibleQuiz), for the classroom game a teacher runs
// for teams, and the single-player game whose scores make the members'
// leaderboard. A game, like Member Match, so no area: anyone approved plays.
const express = require('express');
const router  = express.Router();
const { requireApproved } = require('../middleware/auth');
const bank = require('../lib/bibleQuiz/bank');
const solo = require('../lib/bibleQuiz/solo');
// Read through the module, so a test can say what day it is.
const recordKeeping = require('../lib/recordKeeping');
const today = () => recordKeeping.churchToday();

router.use(requireApproved);

const fail = (res, result) => res.status(result.status || 400).json({ success: false, error: result.error });
const list = value => String(value || '').split(',').map(s => s.trim()).filter(Boolean);

// GET /api/bible-quiz/bank — the sections, and how many questions of each kind.
router.get('/bank', (req, res) => {
  res.json({
    success: true, ...bank.summary(),
    points: bank.POINTS, lengths: solo.LENGTHS, difficulties: solo.DIFFICULTY_CHOICES,
  });
});

// GET /api/bible-quiz/questions?difficulty=&sections=a,b&types=mc,tf
// The questions with their answers, for the classroom game: the teacher runs
// it on the screen and marks the short answers.
router.get('/questions', (req, res) => {
  const questions = bank.filter({
    difficulty: req.query.difficulty, sections: list(req.query.sections), types: list(req.query.types),
  });
  res.json({ success: true, questions });
});

// POST /api/bible-quiz/solo { difficulty, length, sections } — start a game.
router.post('/solo', (req, res) => {
  const result = solo.start(req.user, req.body || {});
  if (result.error) return fail(res, result);
  res.status(201).json({ success: true, game: result.game });
});

// GET /api/bible-quiz/solo/:id — where a game stands, to carry on with it.
router.get('/solo/:id(\\d+)', (req, res) => {
  const result = solo.get(req.user, req.params.id);
  if (result.error) return fail(res, result);
  res.json({ success: true, game: result.game });
});

// POST /api/bible-quiz/solo/:id/answer { questionId, answer }
router.post('/solo/:id(\\d+)/answer', (req, res) => {
  const result = solo.answer(req.user, req.params.id, req.body || {}, today());
  if (result.error) return fail(res, result);
  res.json({ success: true, result: result.result, game: result.game });
});

// GET /api/bible-quiz/leaderboard?period=all|month
router.get('/leaderboard', (req, res) => {
  const period = req.query.period === 'month' ? 'month' : 'all';
  res.json({
    success: true, period,
    leaders: solo.leaderboard({ period, today: today() }),
    me: solo.standing(req.user, { period, today: today() }),
  });
});

module.exports = router;
