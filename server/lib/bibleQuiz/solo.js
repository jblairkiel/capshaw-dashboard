// ─── Bible quiz, single player ────────────────────────────────────────────────
//
// A member starts a game of 10 or 20 questions at a difficulty (or mixed),
// optionally from chosen sections. The questions are dealt when the game
// starts, favoring ones this member has seen least, and handed out one at a
// time without the answer. Each answer is marked here, kept, and worth the
// question's points if right (easy 1, medium 2, hard 3); the leaderboard is the
// sum of a member's points, over all time or this month.

const db = require('../../db');
const bank = require('./bank');
const { isCorrect } = require('./grade');

const LENGTHS = [10, 20];
const DIFFICULTY_CHOICES = ['mixed', ...bank.DIFFICULTIES];

function shuffle(list, random = Math.random) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const ids = game => JSON.parse(game.question_ids);

// The game as its player sees it: where they are, and the question in front of
// them (its choices shuffled), never its answer.
function view(game) {
  const list = ids(game);
  const current = game.finished_at ? null : bank.byId(list[game.position]);
  const shown = current ? bank.forPlayer(current) : null;
  if (shown?.options) shown.options = shuffle(shown.options);
  return {
    id: game.id,
    difficulty: game.difficulty,
    sections: JSON.parse(game.sections),
    length: list.length,
    position: game.position,
    score: game.score,
    correct: game.correct,
    streak: game.streak,
    bestStreak: game.best_streak,
    finished: !!game.finished_at,
    question: shown,
  };
}

function start(user, { difficulty = 'mixed', length = 10, sections = [] } = {}) {
  if (!DIFFICULTY_CHOICES.includes(difficulty)) return { error: 'Choose easy, medium, hard or mixed' };
  const n = Number(length);
  if (!LENGTHS.includes(n)) return { error: `A game is ${LENGTHS.join(' or ')} questions` };
  const secs = (Array.isArray(sections) ? sections : []).filter(s => bank.SECTIONS.some(x => x.id === s));

  const pool = bank.filter({ difficulty: difficulty === 'mixed' ? null : difficulty, sections: secs });
  if (pool.length < n) return { error: `Only ${pool.length} questions match that — choose more sections or a shorter game` };

  // Least seen first, at random among equals, so a regular player works
  // through the bank rather than meeting the same favorites.
  const seen = new Map(db.prepare('SELECT question_id, COUNT(*) AS n FROM bible_quiz_answers WHERE user_id = ? GROUP BY question_id')
    .all(user.id).map(r => [r.question_id, r.n]));
  const dealt = shuffle(pool)
    .sort((a, b) => (seen.get(a.id) || 0) - (seen.get(b.id) || 0))
    .slice(0, n);
  const chosen = shuffle(dealt).map(q => q.id);

  const { lastInsertRowid } = db.prepare(`
    INSERT INTO bible_quiz_games (user_id, difficulty, sections, question_ids) VALUES (?, ?, ?, ?)
  `).run(user.id, difficulty, JSON.stringify(secs), JSON.stringify(chosen));
  return { game: view(gameRow(lastInsertRowid)) };
}

const gameRow = id => db.prepare('SELECT * FROM bible_quiz_games WHERE id = ?').get(id);

function mine(user, id) {
  const game = gameRow(Number(id));
  return game && game.user_id === user.id ? game : null;
}

function get(user, id) {
  const game = mine(user, id);
  return game ? { game: view(game) } : { error: 'That game is not here', status: 404 };
}

// Mark the answer to the question in front of the player, and move on.
function answer(user, id, { questionId, answer: given } = {}, today) {
  const game = mine(user, id);
  if (!game) return { error: 'That game is not here', status: 404 };
  if (game.finished_at) return { error: 'That game is over', status: 409 };
  const list = ids(game);
  const q = bank.byId(list[game.position]);
  if (!q || String(questionId) !== q.id) return { error: 'That is not the question being asked', status: 409 };
  if (given === undefined || given === null || String(given).trim() === '') return { error: 'Give an answer' };

  const right = isCorrect(q, given);
  const points = right ? bank.POINTS[q.difficulty] : 0;
  const streak = right ? game.streak + 1 : 0;
  const position = game.position + 1;
  const done = position >= list.length;

  db.transaction(() => {
    db.prepare(`
      INSERT INTO bible_quiz_answers (game_id, user_id, question_id, given, correct, points, answered_on)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(game.id, user.id, q.id, String(given).slice(0, 200), right ? 1 : 0, points, today);
    db.prepare(`
      UPDATE bible_quiz_games
         SET position = ?, score = score + ?, correct = correct + ?, streak = ?,
             best_streak = MAX(best_streak, ?), finished_at = CASE WHEN ? THEN datetime('now') ELSE NULL END
       WHERE id = ?
    `).run(position, points, right ? 1 : 0, streak, streak, done ? 1 : 0, game.id);
  })();

  return {
    result: {
      correct: right,
      points,
      answer: q.answer,
      ref: q.ref,
      ...(q.type === 'short' ? { given: String(given) } : {}),
    },
    game: view(gameRow(game.id)),
  };
}

// ─── The leaderboard ──────────────────────────────────────────────────────────

const monthStart = today => `${today.slice(0, 7)}-01`;

// Every member who has answered anything in the period, best first: points,
// then the better hit rate, then name.
function leaderboard({ period = 'all', today, limit = 100 } = {}) {
  const since = period === 'month' ? monthStart(today) : '0000-00-00';
  const rows = db.prepare(`
    SELECT a.user_id AS userId,
           COALESCE(NULLIF(trim(d.name), ''), u.name) AS name,
           SUM(a.points) AS points, COUNT(*) AS answered, SUM(a.correct) AS correct,
           COUNT(DISTINCT a.game_id) AS games
      FROM bible_quiz_answers a
      JOIN users u ON u.id = a.user_id
      LEFT JOIN directory d ON d.id = u.directory_id
     WHERE a.answered_on >= ?
     GROUP BY a.user_id
  `).all(since);
  const best = new Map(db.prepare(`
    SELECT user_id, MAX(score) AS best FROM bible_quiz_games
     WHERE finished_at IS NOT NULL AND date(started_at) >= ? GROUP BY user_id
  `).all(since).map(r => [r.user_id, r.best]));

  const ranked = rows
    .map(r => ({ ...r, accuracy: Math.round((r.correct / r.answered) * 100), bestGame: best.get(r.userId) ?? null }))
    .sort((a, b) => b.points - a.points || b.accuracy - a.accuracy || a.name.localeCompare(b.name));
  let rank = 0;
  ranked.forEach((r, i) => {
    if (i === 0 || r.points !== ranked[i - 1].points || r.accuracy !== ranked[i - 1].accuracy) rank = i + 1;
    r.rank = rank;
  });
  return ranked.slice(0, limit);
}

function standing(user, { period = 'all', today } = {}) {
  return leaderboard({ period, today, limit: Infinity }).find(r => r.userId === user.id) || null;
}

module.exports = { LENGTHS, DIFFICULTY_CHOICES, start, get, answer, leaderboard, standing };
