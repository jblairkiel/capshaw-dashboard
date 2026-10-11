// ─── Bible quiz ───────────────────────────────────────────────────────────────
// The 500-question bank (lib/bibleQuiz), for the classroom game a teacher runs
// for teams, and the single-player game whose scores make the members'
// leaderboard. A game, like Member Match, so no area: anyone approved plays.
const express = require('express');
const router  = express.Router();
const { requireApproved, requireArea, holdsArea } = require('../middleware/auth');
const bank = require('../lib/bibleQuiz/bank');
const solo = require('../lib/bibleQuiz/solo');
const review = require('../lib/bibleQuiz/review');
const keeperOnly = requireArea(review.AREA);
// Read through the module, so a test can say what day it is.
const recordKeeping = require('../lib/recordKeeping');
const today = () => recordKeeping.churchToday();

router.use(requireApproved);

const fail = (res, result) => res.status(result.status || 400).json({ success: false, error: result.error });
const list = value => String(value || '').split(',').map(s => s.trim()).filter(Boolean);

// GET /api/bible-quiz/bank — the sections, and how many questions of each kind.
router.get('/bank', (req, res) => {
  const canReview = holdsArea(req.user, review.AREA);
  res.json({
    success: true, ...bank.summary(),
    points: bank.POINTS, lengths: solo.LENGTHS, difficulties: solo.DIFFICULTY_CHOICES,
    reasons: review.REASONS, canReview, openFlags: canReview ? review.openCount() : 0,
  });
});

// GET /api/bible-quiz/questions?difficulty=&sections=a,b&types=mc,tf
// The questions with their answers, for the classroom game: the teacher runs
// it on the screen and marks the short answers.
router.get('/questions', (req, res) => {
  const retired = review.retiredIds();
  const questions = bank.filter({
    difficulty: req.query.difficulty, sections: list(req.query.sections), types: list(req.query.types),
  }).filter(q => !retired.has(q.id))
    .map(q => (q.type === 'short' ? { ...q, accept: [...q.accept, ...review.extraAccepts(q.id)] } : q));
  res.json({ success: true, questions });
});

// POST /api/bible-quiz/solo { difficulty, count, sections } — start a game.
router.post('/solo', (req, res) => {
  // Only a settings object, and only the three settings: a body that is an
  // array or anything else is no settings at all.
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const result = solo.start(req.user, { difficulty: body.difficulty, count: body.count, sections: body.sections });
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

// GET /api/bible-quiz/solo/:id/review — the questions answered so far.
router.get('/solo/:id(\\d+)/review', (req, res) => {
  const result = solo.reviewGame(req.user, req.params.id);
  if (result.error) return fail(res, result);
  res.json({ success: true, answers: result.answers });
});

// ─── Flags ────────────────────────────────────────────────────────────────────

const plain = body => (body && typeof body === 'object' && !Array.isArray(body) ? body : {});

// POST /api/bible-quiz/flags { questionId, reason, note, answerId? }
router.post('/flags', (req, res) => {
  const body = plain(req.body);
  const result = review.flag(req.user, { questionId: body.questionId, reason: body.reason, note: body.note, answerId: body.answerId });
  if (result.error) return fail(res, result);
  res.status(201).json({ success: true, flag: { id: result.flag.id, status: result.flag.status } });
});

// GET /api/bible-quiz/flags?status=open|decided — for the Bible Quiz Keeper.
router.get('/flags', keeperOnly, (req, res) => {
  const status = req.query.status === 'decided' ? 'decided' : 'open';
  res.json({ success: true, status, flags: review.list({ status }), openFlags: review.openCount() });
});

// POST /api/bible-quiz/flags/:id/decide { action: credit|retire|fixed|dismiss, response }
router.post('/flags/:id(\\d+)/decide', keeperOnly, (req, res) => {
  const body = plain(req.body);
  const result = review.decide(req.user, req.params.id, { action: body.action, response: body.response });
  if (result.error) return fail(res, result);
  res.json({ success: true, flag: result.flag, credited: result.credited, closed: result.closed, openFlags: review.openCount() });
});

// GET /api/bible-quiz/retired — questions out of play; DELETE one to restore it.
router.get('/retired', keeperOnly, (req, res) => {
  res.json({ success: true, retired: review.retiredList() });
});
router.delete('/retired/:questionId', keeperOnly, (req, res) => {
  const result = review.restore(req.user, req.params.questionId);
  if (result.error) return fail(res, result);
  res.json({ success: true });
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
