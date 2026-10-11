// ─── Writing questions for the Bible quiz ─────────────────────────────────────
//
// Each section file is a list of one-line questions built with these three:
//
//   mc(difficulty, ref, question, rightAnswer, [three wrong answers])
//   tf(difficulty, ref, statement, true | false)
//   sa(difficulty, ref, question, answer, [other answers that also count])
//
// Difficulty is 'E', 'M' or 'H'. `ref` is where the answer is found, shown to
// the player once they have answered. A question's id is its section and its
// place in the section's list, so a new question goes at the END of a list —
// slotting one in earlier would renumber the rest and muddle anyone's history.

const DIFFICULTY = { E: 'easy', M: 'medium', H: 'hard' };

function level(d) {
  if (!DIFFICULTY[d]) throw new Error(`Unknown difficulty ${d}`);
  return DIFFICULTY[d];
}

const mc = (d, ref, question, answer, wrong) => ({
  type: 'mc', difficulty: level(d), ref, question, answer, options: [answer, ...wrong],
});

const tf = (d, ref, question, truth) => ({
  type: 'tf', difficulty: level(d), ref, question, answer: truth ? 'true' : 'false',
});

const sa = (d, ref, question, answer, accept = []) => ({
  type: 'short', difficulty: level(d), ref, question, answer, accept: [answer, ...accept],
});

module.exports = { mc, tf, sa, DIFFICULTY };
