// ─── Flagging a Bible Quiz question ───────────────────────────────────────────
//
// A member who thinks a question is wrong flags it — from a single-player game
// (against the answer they gave) or from the classroom game (against the
// question alone). Whoever holds the Bible Quiz Keeper area decides:
//
//   credit   the answer should have counted: every answer to that question
//            that reads the same is marked right, with its points, in every
//            game it was given in (so the leaderboard moves too); for a short
//            answer it also counts from now on;
//   retire   take the question out of play until it is fixed in the bank;
//   fixed    noted — the question will be corrected in the bank;
//   dismiss  the question stands.
//
// The member who flagged it is told what was decided.

const db = require('../../db');
const bank = require('./bank');
const { normalize } = require('./grade');
const notifications = require('../notifications');
const actionLog = require('../actionLog');

const AREA = 'bible-quiz';
const REASONS = {
  'answer-wrong': 'The answer key is wrong',
  'my-answer':    'My answer should have counted',
  unclear:        'The question is unclear',
  other:          'Something else',
};
const ACTIONS = ['credit', 'retire', 'fixed', 'dismiss'];
const NOTE_MAX = 500;

const clean = (value, max) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');

function retiredIds() {
  return new Set(db.prepare('SELECT question_id FROM bible_quiz_retired').all().map(r => r.question_id));
}

function extraAccepts(questionId) {
  return db.prepare('SELECT answer FROM bible_quiz_accepts WHERE question_id = ?').all(questionId).map(r => r.answer);
}

// Who to tell about a new flag: whoever keeps the quiz, or the admins when
// nobody does.
function keepers() {
  const holders = db.prepare(`
    SELECT u.id FROM users u JOIN user_areas a ON a.user_id = u.id
     WHERE a.area = ? AND u.role = 'approved'
  `).all(AREA);
  return holders.length ? holders : db.prepare("SELECT id FROM users WHERE role = 'admin'").all();
}

const short = text => (text.length > 70 ? `${text.slice(0, 67)}…` : text);

function flag(user, { questionId, reason, note, answerId } = {}) {
  const q = typeof questionId === 'string' ? bank.byId(questionId) : null;
  if (!q) return { error: 'That question is not in the quiz' };
  if (typeof reason !== 'string' || !REASONS[reason]) return { error: 'Say what is wrong with it' };
  const text = clean(note, NOTE_MAX);
  if (reason === 'other' && !text) return { error: 'Say what is wrong with it' };

  let answer = null;
  if (answerId !== undefined && answerId !== null) {
    answer = db.prepare('SELECT * FROM bible_quiz_answers WHERE id = ?').get(Number(answerId));
    if (!answer || answer.user_id !== user.id || answer.question_id !== q.id) return { error: 'That is not one of your answers', status: 404 };
  }
  if (reason === 'my-answer' && (!answer || answer.correct)) {
    return { error: 'Only an answer that was marked wrong can be flagged as one that should have counted' };
  }
  const open = db.prepare("SELECT id FROM bible_quiz_flags WHERE question_id = ? AND user_id = ? AND status = 'open'").get(q.id, user.id);
  if (open) return { error: 'You have already flagged this question — it is waiting for the Bible Quiz Keeper', status: 409 };

  const { lastInsertRowid: id } = db.prepare(`
    INSERT INTO bible_quiz_flags (question_id, user_id, user_name, answer_id, given, source, reason, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(q.id, user.id, user.name || '', answer?.id ?? null, answer?.given ?? '', answer ? 'solo' : 'classroom', reason, text);

  notifications.notify({
    users: keepers(), actor: user, kind: 'bible-quiz-flagged',
    title: `${user.name || 'A member'} flagged a Bible Quiz question`,
    body: `${REASONS[reason]}: "${short(q.question)}"`,
    subjectType: 'bible-quiz-flag', subjectId: Number(id),
  });
  return { flag: flagRow(id) };
}

const flagRow = id => db.prepare('SELECT * FROM bible_quiz_flags WHERE id = ?').get(id);

// A flag as the keeper sees it: the question in full, with its answer and
// every answer that counts, and what the member said.
function view(f) {
  const q = bank.byId(f.question_id);
  const answer = f.answer_id ? db.prepare('SELECT correct FROM bible_quiz_answers WHERE id = ?').get(f.answer_id) : null;
  return {
    id: f.id, status: f.status, reason: f.reason, reasonLabel: REASONS[f.reason] || f.reason,
    note: f.note, given: f.given, source: f.source, by: f.user_name, createdAt: f.created_at,
    response: f.response, decidedBy: f.decided_by_name, decidedAt: f.decided_at, credited: f.credited,
    wasCorrect: answer ? !!answer.correct : null,
    creditable: f.status === 'open' && !!answer && !answer.correct,
    retired: retiredIds().has(f.question_id),
    question: q && {
      id: q.id, question: q.question, type: q.type, difficulty: q.difficulty, ref: q.ref,
      section: bank.SECTIONS.find(s => s.id === q.section)?.label || q.section,
      options: q.options || null, answer: q.answer,
      accept: q.type === 'short' ? [...q.accept, ...extraAccepts(q.id)] : null,
    },
  };
}

function list({ status = 'open' } = {}) {
  const rows = status === 'open'
    ? db.prepare("SELECT * FROM bible_quiz_flags WHERE status = 'open' ORDER BY created_at, id").all()
    : db.prepare("SELECT * FROM bible_quiz_flags WHERE status <> 'open' ORDER BY decided_at DESC, id DESC LIMIT 100").all();
  return rows.map(view);
}

const openCount = () => db.prepare("SELECT COUNT(*) AS n FROM bible_quiz_flags WHERE status = 'open'").get().n;

// Mark right every wrong answer to this question that reads the same as
// `given`, fixing each game's score. Returns how many were changed.
function creditAnswers(q, given) {
  const said = normalize(given);
  const wrong = db.prepare('SELECT * FROM bible_quiz_answers WHERE question_id = ? AND correct = 0').all(q.id)
    .filter(a => normalize(a.given) === said);
  const points = bank.POINTS[q.difficulty];
  const mark = db.prepare('UPDATE bible_quiz_answers SET correct = 1, points = ? WHERE id = ?');
  const game = db.prepare('UPDATE bible_quiz_games SET score = score + ?, correct = correct + 1 WHERE id = ?');
  for (const a of wrong) { mark.run(points, a.id); game.run(points, a.game_id); }
  return wrong;
}

const OUTCOME = {
  credit:  'credited',
  retire:  'retired',
  fixed:   'fixed',
  dismiss: 'dismissed',
};
const TOLD = {
  credited:  'Your answer now counts, and your score has been put right.',
  retired:   'The question has been taken out of play until it is corrected.',
  fixed:     'The question is being corrected.',
  dismissed: 'The question stays as it is.',
};

function decide(user, id, { action, response } = {}) {
  const f = flagRow(Number(id));
  if (!f) return { error: 'That flag is not here', status: 404 };
  if (f.status !== 'open') return { error: 'That flag has already been decided', status: 409 };
  if (typeof action !== 'string' || !ACTIONS.includes(action)) return { error: 'Choose credit, retire, fixed or dismiss' };
  const q = bank.byId(f.question_id);
  if (!q) return { error: 'That question is no longer in the quiz', status: 404 };
  const said = clean(response, NOTE_MAX);
  const status = OUTCOME[action];
  const answer = f.answer_id ? db.prepare('SELECT * FROM bible_quiz_answers WHERE id = ?').get(f.answer_id) : null;
  if (action === 'credit' && (!answer || answer.correct)) return { error: 'Only an answer that was marked wrong can be credited' };

  let closed = [];
  let credited = [];
  db.transaction(() => {
    const close = db.prepare(`
      UPDATE bible_quiz_flags SET status = ?, response = ?, credited = ?, decided_by_name = ?, decided_at = datetime('now')
       WHERE id = ? AND status = 'open'
    `);
    if (action === 'credit') {
      credited = creditAnswers(q, f.given);
      if (q.type === 'short') {
        db.prepare(`INSERT OR IGNORE INTO bible_quiz_accepts (question_id, answer, normalized, added_by_name) VALUES (?, ?, ?, ?)`)
          .run(q.id, f.given, normalize(f.given), user.name || '');
      }
      // Everybody else who flagged the same answer to this question is
      // answered by this too.
      const same = db.prepare("SELECT * FROM bible_quiz_flags WHERE question_id = ? AND status = 'open'").all(q.id)
        .filter(x => x.id === f.id || (x.given && normalize(x.given) === normalize(f.given)));
      for (const x of same) close.run(status, said, x.id === f.id ? credited.length : 0, user.name || '', x.id);
      closed = same;
    } else if (action === 'retire') {
      db.prepare('INSERT OR IGNORE INTO bible_quiz_retired (question_id, reason, retired_by_name) VALUES (?, ?, ?)').run(q.id, said, user.name || '');
      closed = db.prepare("SELECT * FROM bible_quiz_flags WHERE question_id = ? AND status = 'open'").all(q.id);
      for (const x of closed) close.run(status, said, 0, user.name || '', x.id);
    } else {
      close.run(status, said, 0, user.name || '', f.id);
      closed = [f];
    }
  })();

  for (const x of closed) {
    notifications.notify({
      users: [x.user_id].filter(Boolean), actor: user, kind: 'bible-quiz-flag-answered',
      title: 'A Bible Quiz question you flagged was looked at',
      body: `"${short(q.question)}" — ${TOLD[status]}${said ? ` ${said}` : ''}`,
      subjectType: 'bible-quiz-flag', subjectId: x.id,
    });
  }
  actionLog.record(user, {
    area: AREA, action: 'update', entity: 'Bible Quiz question', entityId: q.id,
    summary: {
      credit:  `Credited "${f.given}" for "${short(q.question)}" (${credited.length} answer${credited.length === 1 ? '' : 's'})`,
      retire:  `Took "${short(q.question)}" out of play`,
      fixed:   `Marked a flag on "${short(q.question)}" fixed`,
      dismiss: `Dismissed a flag on "${short(q.question)}"`,
    }[action],
    details: { flag: f.id, reason: f.reason, response: said },
  });
  return { flag: view(flagRow(f.id)), credited: credited.length, closed: closed.length };
}

function retiredList() {
  return db.prepare('SELECT * FROM bible_quiz_retired ORDER BY created_at DESC').all().map(r => {
    const q = bank.byId(r.question_id);
    return { questionId: r.question_id, question: q?.question || r.question_id, ref: q?.ref || '', reason: r.reason, by: r.retired_by_name, at: r.created_at };
  });
}

function restore(user, questionId) {
  const q = typeof questionId === 'string' ? bank.byId(questionId) : null;
  const done = q ? db.prepare('DELETE FROM bible_quiz_retired WHERE question_id = ?').run(q.id).changes : 0;
  if (!done) return { error: 'That question is not out of play', status: 404 };
  actionLog.record(user, { area: AREA, action: 'update', entity: 'Bible Quiz question', entityId: q.id, summary: `Put "${short(q.question)}" back into play` });
  return { ok: true };
}

module.exports = { AREA, REASONS, ACTIONS, retiredIds, extraAccepts, flag, list, openCount, decide, retiredList, restore };
