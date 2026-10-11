// The Bible quiz question bank: a thousand questions, every type at every
// difficulty, and each one well formed — a malformed question would only show
// up in front of a class.
const bank = require('../lib/bibleQuiz/bank');
const { normalize, isCorrect } = require('../lib/bibleQuiz/grade');

describe('the question bank', () => {
  test('has a thousand questions, each with its own id and its own wording', () => {
    expect(bank.QUESTIONS).toHaveLength(1000);
    expect(new Set(bank.QUESTIONS.map(q => q.id)).size).toBe(1000);
    expect(new Set(bank.QUESTIONS.map(q => normalize(q.question))).size).toBe(1000);
  });

  test('every type at every difficulty, enough of each difficulty for a full game', () => {
    for (const d of bank.DIFFICULTIES) {
      const at = bank.QUESTIONS.filter(q => q.difficulty === d);
      expect(at.length).toBeGreaterThanOrEqual(100);
      for (const t of bank.TYPES) expect(at.filter(q => q.type === t).length).toBeGreaterThanOrEqual(15);
    }
  });

  test('every section has questions at every difficulty', () => {
    expect(bank.SECTIONS).toHaveLength(23);
    for (const s of bank.SECTIONS) {
      for (const d of bank.DIFFICULTIES) {
        expect([s.id, d, bank.QUESTIONS.some(q => q.section === s.id && q.difficulty === d)]).toEqual([s.id, d, true]);
      }
    }
  });

  test('every question is well formed, says where its answer is found, and its own answer is marked right', () => {
    for (const q of bank.QUESTIONS) {
      const where = `${q.id}: ${q.question}`;
      expect([where, typeof q.ref === 'string' && q.ref.length > 2]).toEqual([where, true]);
      expect(bank.TYPES).toContain(q.type);
      expect(bank.DIFFICULTIES).toContain(q.difficulty);
      if (q.type === 'mc') {
        expect([where, q.options.length]).toEqual([where, 4]);
        expect([where, new Set(q.options.map(normalize)).size]).toEqual([where, 4]);
        expect(q.options).toContain(q.answer);
      }
      if (q.type === 'tf') expect(['true', 'false']).toContain(q.answer);
      if (q.type === 'short') {
        expect([where, q.accept.every(a => normalize(a).length > 0)]).toEqual([where, true]);
      }
      expect([where, isCorrect(q, q.answer)]).toEqual([where, true]);
    }
  });

  test('a player is never handed the answer', () => {
    for (const q of bank.QUESTIONS) {
      const shown = bank.forPlayer(q);
      expect(shown.answer).toBeUndefined();
      expect(shown.accept).toBeUndefined();
      expect(shown.points).toBe(bank.POINTS[q.difficulty]);
    }
  });

  test('filters by difficulty, section and type, and "all" when nothing is chosen', () => {
    expect(bank.filter()).toHaveLength(1000);
    const hardJesus = bank.filter({ difficulty: 'hard', sections: ['jesus'] });
    expect(hardJesus.length).toBeGreaterThan(0);
    expect(hardJesus.every(q => q.difficulty === 'hard' && q.section === 'jesus')).toBe(true);
    expect(bank.filter({ types: ['tf'] }).every(q => q.type === 'tf')).toBe(true);
    // Nonsense in a filter is ignored rather than matching nothing.
    expect(bank.filter({ difficulty: 'impossible', sections: ['nowhere'], types: ['essay'] })).toHaveLength(1000);
  });
});

describe('marking a short answer', () => {
  const q = bank.QUESTIONS.find(x => x.id === 'jesus-14'); // forty days
  test('ignores case, punctuation, a leading article, and numbers written as words', () => {
    expect(q.question).toMatch(/fast/);
    for (const said of ['Forty', 'forty.', '40', ' FORTY ']) expect([said, isCorrect(q, said)]).toEqual([said, true]);
    expect(isCorrect(q, '30')).toBe(false);
    expect(isCorrect(q, '')).toBe(false);
    const garden = bank.QUESTIONS.find(x => x.type === 'short' && x.answer === 'Gethsemane');
    expect(isCorrect(garden, 'the Garden of Gethsemane')).toBe(true);
    expect(normalize('one hundred and fifty')).toBe('150');
    expect(normalize('Fifty-two')).toBe('52');
  });
});
