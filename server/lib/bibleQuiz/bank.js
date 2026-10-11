// ─── The Bible quiz question bank ─────────────────────────────────────────────
//
// A thousand questions in twenty-three sections, each multiple choice, true/false
// or short answer, and easy, medium or hard. The classroom game reads them with
// their answers (the teacher is running it); the single-player game hands them
// out one at a time without the answer and grades on the server, so the
// members' leaderboard counts only what was really answered.

const SECTION_FILES = [
  'genesis', 'exodus', 'conquest', 'kings', 'prophets', 'wisdom',
  'jesus', 'teachings', 'acts', 'letters', 'books', 'sayings',
  // The second five hundred.
  'women', 'miracles', 'places', 'numbers', 'divided', 'families',
  'paul', 'words', 'passion', 'hebrews', 'memory',
];

const TYPES = ['mc', 'tf', 'short'];
const DIFFICULTIES = ['easy', 'medium', 'hard'];
// Points a right answer is worth in the single-player game, and squares moved
// in the classroom game: harder questions are worth more.
const POINTS = { easy: 1, medium: 2, hard: 3 };

const SECTIONS = [];
const QUESTIONS = [];

for (const file of SECTION_FILES) {
  const section = require(`./sections/${file}`);
  SECTIONS.push({ id: section.id, label: section.label });
  section.questions.forEach((q, i) => {
    QUESTIONS.push({ id: `${section.id}-${i + 1}`, section: section.id, ...q });
  });
}

const BY_ID = new Map(QUESTIONS.map(q => [q.id, q]));

const byId = id => BY_ID.get(String(id)) || null;

// Which questions match a choice of difficulty, sections and types. Anything
// not chosen means "all of them".
function filter({ difficulty, sections, types } = {}) {
  const diffs = typeof difficulty === 'string' && DIFFICULTIES.includes(difficulty) ? [difficulty] : DIFFICULTIES;
  const secs = (Array.isArray(sections) ? sections : []).filter(s => typeof s === 'string' && SECTIONS.some(x => x.id === s));
  const kinds = (Array.isArray(types) ? types : []).filter(t => typeof t === 'string' && TYPES.includes(t));
  return QUESTIONS.filter(q =>
    diffs.includes(q.difficulty)
    && (!secs.length || secs.includes(q.section))
    && (!kinds.length || kinds.includes(q.type)));
}

// What a player sees before answering: never the answer.
function forPlayer(q) {
  return {
    id: q.id, section: q.section, type: q.type, difficulty: q.difficulty,
    question: q.question, points: POINTS[q.difficulty],
    ...(q.type === 'mc' ? { options: q.options } : {}),
  };
}

// How many of each there are, for the setup screens.
function summary() {
  const count = list => ({
    total: list.length,
    byDifficulty: Object.fromEntries(DIFFICULTIES.map(d => [d, list.filter(q => q.difficulty === d).length])),
    byType: Object.fromEntries(TYPES.map(t => [t, list.filter(q => q.type === t).length])),
  });
  return {
    ...count(QUESTIONS),
    sections: SECTIONS.map(s => ({ ...s, ...count(QUESTIONS.filter(q => q.section === s.id)) })),
  };
}

module.exports = { SECTIONS, QUESTIONS, TYPES, DIFFICULTIES, POINTS, byId, filter, forPlayer, summary };
