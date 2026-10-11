// The Bible quiz: the classroom bank, a single-player game marked on the
// server, and the members' leaderboard that adds those games up.
jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const request = require('supertest');
const express = require('express');
const db = require('../db');
const recordKeeping = require('../lib/recordKeeping');
const bank = require('../lib/bibleQuiz/bank');
const router = require('../routes/bibleQuiz');

function buildApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/bible-quiz', router);
  return app;
}

function addUser(name, { role = 'approved', directoryName = null, areas = [] } = {}) {
  const dir = directoryName ? db.prepare('INSERT INTO directory (name) VALUES (?)').run(directoryName).lastInsertRowid : null;
  const id = db.prepare('INSERT INTO users (provider, provider_id, email, name, role, directory_id) VALUES (?,?,?,?,?,?)')
    .run('google', `${name}-id`, `${name.toLowerCase()}@example.com`, name, role, dir).lastInsertRowid;
  for (const a of areas) db.prepare('INSERT INTO user_areas (user_id, area) VALUES (?, ?)').run(id, a);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

// The right answer to whatever the game is asking, read from the bank — what
// a player who knows their Bible would send.
const rightAnswer = q => bank.byId(q.id).answer;
const wrongAnswer = q => (q.type === 'mc' ? q.options.find(o => o !== bank.byId(q.id).answer) : q.type === 'tf' ? (bank.byId(q.id).answer === 'true' ? 'false' : 'true') : 'not this');

let ANN, BEN, PAT;
beforeEach(() => {
  for (const t of ['bible_quiz_flags', 'bible_quiz_accepts', 'bible_quiz_retired', 'notifications', 'action_log', 'user_areas', 'bible_quiz_answers', 'bible_quiz_games', 'users', 'directory']) db.prepare(`DELETE FROM ${t}`).run();
  jest.spyOn(recordKeeping, 'churchToday').mockReturnValue('2026-10-11');
  ANN = addUser('Ann', { directoryName: 'Ann Adams' });
  BEN = addUser('Ben');
  PAT = addUser('Pat', { role: 'pending' });
});
afterEach(() => jest.restoreAllMocks());

const startGame = (user, body) => request(buildApp(user)).post('/api/bible-quiz/solo').send(body);
async function play(user, game, answerFor) {
  let g = game;
  while (!g.finished) {
    const res = await request(buildApp(user)).post(`/api/bible-quiz/solo/${g.id}/answer`).send({ questionId: g.question.id, answer: answerFor(g.question, g.position) });
    expect(res.status).toBe(200);
    g = res.body.game;
  }
  return g;
}

describe('the classroom bank', () => {
  test('tells how the 500 questions divide up, and hands them out filtered, with answers', async () => {
    const summary = (await request(buildApp(ANN)).get('/api/bible-quiz/bank')).body;
    expect(summary).toMatchObject({ total: 1000, points: { easy: 1, medium: 2, hard: 3 }, lengths: [10, 20] });
    expect(summary.sections).toHaveLength(23);

    const res = await request(buildApp(ANN)).get('/api/bible-quiz/questions?difficulty=easy&sections=jesus,acts&types=mc,tf');
    expect(res.body.questions.length).toBeGreaterThan(10);
    expect(res.body.questions.every(q => q.difficulty === 'easy' && ['jesus', 'acts'].includes(q.section) && ['mc', 'tf'].includes(q.type) && q.answer)).toBe(true);
  });

  test('an account still waiting for approval gets nothing', async () => {
    expect((await request(buildApp(PAT)).get('/api/bible-quiz/questions')).status).toBe(403);
    expect((await startGame(PAT, {})).status).toBe(403);
  });
});

describe('a single-player game', () => {
  test('deals the questions asked for, one at a time and never with the answer', async () => {
    const res = await startGame(ANN, { difficulty: 'hard', count: 20 });
    expect(res.status).toBe(201);
    const { game } = res.body;
    expect(game).toMatchObject({ length: 20, position: 0, score: 0, finished: false, difficulty: 'hard' });
    expect(game.question.difficulty).toBe('hard');
    expect(game.question.answer).toBeUndefined();
    expect(game.question.accept).toBeUndefined();
    const ids = JSON.parse(db.prepare('SELECT question_ids FROM bible_quiz_games WHERE id = ?').get(game.id).question_ids);
    expect(new Set(ids).size).toBe(20);
    expect(ids.every(id => bank.byId(id).difficulty === 'hard')).toBe(true);
  });

  test('marks each answer, scores right answers by difficulty, and says where the answer is found', async () => {
    const { game } = (await startGame(ANN, { difficulty: 'mixed', count: 10 })).body;
    const first = game.question;
    const res = await request(buildApp(ANN)).post(`/api/bible-quiz/solo/${game.id}/answer`).send({ questionId: first.id, answer: rightAnswer(first) });
    expect(res.body.result).toMatchObject({ correct: true, points: bank.POINTS[first.difficulty], answer: bank.byId(first.id).answer, ref: bank.byId(first.id).ref, answerId: expect.any(Number) });
    expect(res.body.game).toMatchObject({ position: 1, score: bank.POINTS[first.difficulty], correct: 1, streak: 1 });

    const second = res.body.game.question;
    const wrong = await request(buildApp(ANN)).post(`/api/bible-quiz/solo/${game.id}/answer`).send({ questionId: second.id, answer: wrongAnswer(second) });
    expect(wrong.body.result).toMatchObject({ correct: false, points: 0 });
    expect(wrong.body.game).toMatchObject({ position: 2, correct: 1, streak: 0, bestStreak: 1 });
  });

  test('answers only the question being asked, once, and only in your own game', async () => {
    const { game } = (await startGame(ANN, { count: 10 })).body;
    const q = game.question;
    const ids = JSON.parse(db.prepare('SELECT question_ids FROM bible_quiz_games WHERE id = ?').get(game.id).question_ids);
    // Skipping ahead to a later question is refused.
    expect((await request(buildApp(ANN)).post(`/api/bible-quiz/solo/${game.id}/answer`).send({ questionId: ids[3], answer: 'x' })).status).toBe(409);
    // Somebody else cannot see or answer it.
    expect((await request(buildApp(BEN)).get(`/api/bible-quiz/solo/${game.id}`)).status).toBe(404);
    expect((await request(buildApp(BEN)).post(`/api/bible-quiz/solo/${game.id}/answer`).send({ questionId: q.id, answer: rightAnswer(q) })).status).toBe(404);
    // A blank answer is not an answer.
    expect((await request(buildApp(ANN)).post(`/api/bible-quiz/solo/${game.id}/answer`).send({ questionId: q.id, answer: '  ' })).status).toBe(400);
    await request(buildApp(ANN)).post(`/api/bible-quiz/solo/${game.id}/answer`).send({ questionId: q.id, answer: rightAnswer(q) });
    // The same question twice is not.
    expect((await request(buildApp(ANN)).post(`/api/bible-quiz/solo/${game.id}/answer`).send({ questionId: q.id, answer: rightAnswer(q) })).status).toBe(409);
  });

  test('finishes after the last question, and takes no more answers', async () => {
    const { game } = (await startGame(ANN, { difficulty: 'easy', count: 10 })).body;
    const done = await play(ANN, game, rightAnswer);
    expect(done).toMatchObject({ finished: true, position: 10, correct: 10, score: 10, bestStreak: 10, question: null });
    expect((await request(buildApp(ANN)).post(`/api/bible-quiz/solo/${game.id}/answer`).send({ questionId: 'genesis-1', answer: 'Noah' })).status).toBe(409);
  });

  test('a short answer is marked kindly: case, punctuation and number words do not matter', async () => {
    const shortHard = bank.filter({ types: ['short'] }).find(q => q.id === 'jesus-14');
    expect(shortHard.answer).toBe('Forty');
    // Deal a game, then point its first question at this one.
    const { game } = (await startGame(BEN, { count: 10 })).body;
    const ids = JSON.parse(db.prepare('SELECT question_ids FROM bible_quiz_games WHERE id = ?').get(game.id).question_ids);
    ids[0] = 'jesus-14';
    db.prepare('UPDATE bible_quiz_games SET question_ids = ? WHERE id = ?').run(JSON.stringify(ids), game.id);
    const res = await request(buildApp(BEN)).post(`/api/bible-quiz/solo/${game.id}/answer`).send({ questionId: 'jesus-14', answer: '40.' });
    expect(res.body.result).toMatchObject({ correct: true, answer: 'Forty', given: '40.' });
  });

  test('refuses a game that cannot be dealt, or an odd length', async () => {
    expect((await startGame(ANN, { count: 7 })).status).toBe(400);
    // A body that is not a settings object is no settings: the defaults apply.
    const list = await request(buildApp(ANN)).post('/api/bible-quiz/solo').send([20, 'hard']);
    expect(list.status).toBe(201);
    expect(list.body.game).toMatchObject({ length: 10, difficulty: 'mixed' });
    expect((await startGame(ANN, { difficulty: 'impossible' })).status).toBe(400);
    // Values of the wrong type are refused or ignored, never matched.
    expect((await startGame(ANN, { difficulty: ['hard'] })).status).toBe(400);
    expect((await startGame(ANN, { difficulty: { hard: true } })).status).toBe(400);
    const odd = await startGame(ANN, { sections: [['jesus'], { id: 'jesus' }, 'jesus'], count: 10 });
    expect(odd.status).toBe(201);
    expect(odd.body.game.sections).toEqual(['jesus']);
    // Who Said It? has only a handful of hard questions.
    const res = await startGame(ANN, { difficulty: 'hard', sections: ['sayings'], count: 20 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Only \d+ questions match/);
  });

  test('a regular player meets questions they have not seen before repeats', async () => {
    const seen = new Set();
    for (let i = 0; i < 5; i++) {
      const { game } = (await startGame(BEN, { difficulty: 'medium', count: 20 })).body;
      const done = await play(BEN, game, wrongAnswer);
      expect(done.finished).toBe(true);
      JSON.parse(db.prepare('SELECT question_ids FROM bible_quiz_games WHERE id = ?').get(game.id).question_ids).forEach(id => {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      });
    }
  });
});

describe('the leaderboard', () => {
  test('ranks every member who has played by points, then hit rate, by their directory name', async () => {
    const annGame = (await startGame(ANN, { difficulty: 'hard', count: 10 })).body.game;
    await play(ANN, annGame, (q, i) => (i < 5 ? rightAnswer(q) : wrongAnswer(q))); // 15 points
    const benGame = (await startGame(BEN, { difficulty: 'easy', count: 10 })).body.game;
    await play(BEN, benGame, rightAnswer); // 10 points
    // Ben starts another and quits after one right answer: it still counts.
    const quit = (await startGame(BEN, { difficulty: 'easy', count: 10 })).body.game;
    await request(buildApp(BEN)).post(`/api/bible-quiz/solo/${quit.id}/answer`).send({ questionId: quit.question.id, answer: rightAnswer(quit.question) });

    const res = await request(buildApp(BEN)).get('/api/bible-quiz/leaderboard');
    expect(res.body.leaders.map(l => [l.rank, l.name, l.points, l.accuracy, l.games, l.bestGame])).toEqual([
      [1, 'Ann Adams', 15, 50, 1, 15],
      [2, 'Ben', 11, 100, 2, 10],
    ]);
    expect(res.body.me).toMatchObject({ rank: 2, name: 'Ben', points: 11 });
  });

  test('this month counts only this month\'s answers', async () => {
    const g = (await startGame(ANN, { difficulty: 'easy', count: 10 })).body.game;
    await play(ANN, g, rightAnswer);
    db.prepare("UPDATE bible_quiz_answers SET answered_on = '2026-09-28'").run();
    db.prepare("UPDATE bible_quiz_games SET started_at = '2026-09-28 10:00:00'").run();
    const g2 = (await startGame(BEN, { difficulty: 'easy', count: 10 })).body.game;
    await play(BEN, g2, (q, i) => (i < 3 ? rightAnswer(q) : wrongAnswer(q)));

    const month = (await request(buildApp(ANN)).get('/api/bible-quiz/leaderboard?period=month')).body;
    expect(month.leaders.map(l => [l.name, l.points])).toEqual([['Ben', 3]]);
    expect(month.me).toBeNull();
    const all = (await request(buildApp(ANN)).get('/api/bible-quiz/leaderboard?period=all')).body;
    expect(all.leaders.map(l => [l.name, l.points])).toEqual([['Ann Adams', 10], ['Ben', 3]]);
  });
});

describe('flagging a question', () => {
  let KEEPER;
  beforeEach(() => { KEEPER = addUser('Kit', { areas: ['bible-quiz'] }); });

  // Deal Ann a game whose first question is `qid`, and answer it.
  async function answered(user, qid, given) {
    const { game } = (await startGame(user, { count: 10 })).body;
    const ids = JSON.parse(db.prepare('SELECT question_ids FROM bible_quiz_games WHERE id = ?').get(game.id).question_ids);
    const rest = ids.filter(id => id !== qid);
    db.prepare('UPDATE bible_quiz_games SET question_ids = ? WHERE id = ?').run(JSON.stringify([qid, ...rest].slice(0, 10)), game.id);
    const res = await request(buildApp(user)).post(`/api/bible-quiz/solo/${game.id}/answer`).send({ questionId: qid, answer: given });
    const answerId = db.prepare('SELECT id FROM bible_quiz_answers WHERE game_id = ? AND question_id = ?').get(game.id, qid).id;
    return { gameId: game.id, answerId, result: res.body.result };
  }
  const flagIt = (user, body) => request(buildApp(user)).post('/api/bible-quiz/flags').send(body);
  const decide = (user, id, body) => request(buildApp(user)).post(`/api/bible-quiz/flags/${id}/decide`).send(body);

  test('a game\'s answered questions can be looked back over, with the right answers', async () => {
    const { gameId } = await answered(ANN, 'jesus-14', '30');
    const res = await request(buildApp(ANN)).get(`/api/bible-quiz/solo/${gameId}/review`);
    expect(res.body.answers).toEqual([expect.objectContaining({ questionId: 'jesus-14', given: '30', correct: false, answer: 'Forty', ref: 'Matthew 4:2', flag: null })]);
    expect((await request(buildApp(BEN)).get(`/api/bible-quiz/solo/${gameId}/review`)).status).toBe(404);
  });

  test('a member flags an earlier answer that should have counted; the keeper is told', async () => {
    const { answerId, gameId } = await answered(ANN, 'jesus-14', 'forty days');
    const res = await flagIt(ANN, { questionId: 'jesus-14', reason: 'my-answer', note: 'I wrote forty days', answerId });
    expect(res.status).toBe(201);
    expect(db.prepare("SELECT user_id, kind FROM notifications WHERE kind = 'bible-quiz-flagged'").all()).toEqual([{ user_id: KEEPER.id, kind: 'bible-quiz-flagged' }]);
    // The review shows it flagged, and a second flag is refused.
    expect((await request(buildApp(ANN)).get(`/api/bible-quiz/solo/${gameId}/review`)).body.answers[0].flag).toBe('open');
    expect((await flagIt(ANN, { questionId: 'jesus-14', reason: 'unclear' })).status).toBe(409);
  });

  test('only your own answer, only a wrong one for "should have counted", and "something else" needs a note', async () => {
    const { answerId } = await answered(ANN, 'genesis-1', 'Noah');
    expect((await flagIt(BEN, { questionId: 'genesis-1', reason: 'my-answer', answerId })).status).toBe(404);
    expect((await flagIt(ANN, { questionId: 'genesis-1', reason: 'my-answer', answerId })).status).toBe(400);
    expect((await flagIt(ANN, { questionId: 'genesis-1', reason: 'other' })).status).toBe(400);
    expect((await flagIt(ANN, { questionId: 'nowhere-1', reason: 'unclear' })).status).toBe(400);
    expect((await flagIt(ANN, { questionId: ['genesis-1'], reason: 'unclear' })).status).toBe(400);
    expect((await flagIt(ANN, { questionId: 'genesis-1', reason: 'unclear', note: 'Which ark?' })).status).toBe(201);
    // From the classroom, with no answer behind it.
    expect((await flagIt(BEN, { questionId: 'genesis-1', reason: 'answer-wrong' })).status).toBe(201);
  });

  test('crediting an answer marks it right for everyone who gave it, fixes their scores, and counts from then on', async () => {
    const ann = await answered(ANN, 'jesus-14', 'forty days');
    const ben = await answered(BEN, 'jesus-14', 'Forty days.');
    expect(ann.result.correct).toBe(false);
    const flagged = (await flagIt(ANN, { questionId: 'jesus-14', reason: 'my-answer', answerId: ann.answerId })).body.flag;

    // Only the keeper decides.
    expect((await request(buildApp(ANN)).get('/api/bible-quiz/flags')).status).toBe(403);
    expect((await decide(ANN, flagged.id, { action: 'credit' })).status).toBe(403);
    const list = (await request(buildApp(KEEPER)).get('/api/bible-quiz/flags')).body;
    expect(list.openFlags).toBe(1);
    expect(list.flags[0]).toMatchObject({ reason: 'my-answer', given: 'forty days', by: 'Ann', creditable: true, question: { id: 'jesus-14', answer: 'Forty' } });

    const res = await decide(KEEPER, flagged.id, { action: 'credit', response: 'Fair enough.' });
    expect(res.body).toMatchObject({ credited: 2, openFlags: 0, flag: { status: 'credited' } });
    for (const { gameId } of [ann, ben]) {
      expect(db.prepare('SELECT score, correct FROM bible_quiz_games WHERE id = ?').get(gameId)).toEqual({ score: 1, correct: 1 });
    }
    // The leaderboard moves with it.
    const leaders = (await request(buildApp(BEN)).get('/api/bible-quiz/leaderboard')).body.leaders;
    expect(leaders.map(l => [l.name, l.points])).toEqual([['Ann Adams', 1], ['Ben', 1]]);
    // Ann is told.
    expect(db.prepare("SELECT user_id, body FROM notifications WHERE kind = 'bible-quiz-flag-answered'").all())
      .toEqual([{ user_id: ANN.id, body: expect.stringMatching(/now counts.*Fair enough\./) }]);
    // And from now on the same answer counts.
    const next = await answered(addUser('Cy'), 'jesus-14', 'FORTY DAYS');
    expect(next.result.correct).toBe(true);
    // A decided flag stays decided.
    expect((await decide(KEEPER, flagged.id, { action: 'dismiss' })).status).toBe(409);
  });

  test('taking a question out of play keeps it out of every game and the classroom, until it is put back', async () => {
    const f = (await flagIt(ANN, { questionId: 'genesis-1', reason: 'answer-wrong' })).body.flag;
    await flagIt(BEN, { questionId: 'genesis-1', reason: 'unclear' });
    const res = await decide(KEEPER, f.id, { action: 'retire', response: 'Being reworded' });
    expect(res.body).toMatchObject({ closed: 2, flag: { status: 'retired', retired: true } });
    const classroom = (await request(buildApp(ANN)).get('/api/bible-quiz/questions?sections=genesis')).body.questions;
    expect(classroom.some(q => q.id === 'genesis-1')).toBe(false);
    expect((await request(buildApp(KEEPER)).get('/api/bible-quiz/retired')).body.retired).toEqual([expect.objectContaining({ questionId: 'genesis-1', reason: 'Being reworded', by: 'Kit' })]);
    for (let i = 0; i < 5; i++) {
      const { game } = (await startGame(ANN, { difficulty: 'easy', sections: ['genesis'], count: 10 })).body;
      expect(JSON.parse(db.prepare('SELECT question_ids FROM bible_quiz_games WHERE id = ?').get(game.id).question_ids)).not.toContain('genesis-1');
    }
    expect((await request(buildApp(KEEPER)).delete('/api/bible-quiz/retired/genesis-1')).status).toBe(200);
    expect((await request(buildApp(ANN)).get('/api/bible-quiz/questions?sections=genesis')).body.questions.some(q => q.id === 'genesis-1')).toBe(true);
    expect(db.prepare("SELECT COUNT(*) n FROM action_log WHERE area = 'bible-quiz'").get().n).toBe(2);
  });

  test('a flag can be marked fixed or dismissed, and only a wrong answer can be credited', async () => {
    const a = (await flagIt(ANN, { questionId: 'genesis-2', reason: 'unclear' })).body.flag;
    expect((await decide(KEEPER, a.id, { action: 'credit' })).status).toBe(400);
    expect((await decide(KEEPER, a.id, { action: 'fixed', response: 'Reworded' })).body.flag.status).toBe('fixed');
    const b = (await flagIt(BEN, { questionId: 'genesis-2', reason: 'answer-wrong' })).body.flag;
    expect((await decide(KEEPER, b.id, { action: 'dismiss' })).body.flag.status).toBe('dismissed');
    expect((await decide(KEEPER, b.id, { action: 'bogus' })).status).toBe(409);
    const decided = (await request(buildApp(KEEPER)).get('/api/bible-quiz/flags?status=decided')).body.flags;
    expect(decided.map(d => d.status).sort()).toEqual(['dismissed', 'fixed']);
  });

  test('the bank tells a keeper how many flags are waiting', async () => {
    await flagIt(ANN, { questionId: 'genesis-2', reason: 'unclear' });
    expect((await request(buildApp(KEEPER)).get('/api/bible-quiz/bank')).body).toMatchObject({ canReview: true, openFlags: 1 });
    expect((await request(buildApp(ANN)).get('/api/bible-quiz/bank')).body).toMatchObject({ canReview: false, openFlags: 0 });
  });
});
