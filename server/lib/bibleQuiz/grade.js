// ─── Marking an answer ────────────────────────────────────────────────────────
//
// Multiple choice and true/false are exact. A short answer is compared after
// tidying both sides: case, punctuation and accents ignored, a leading "the",
// "a" or "an" dropped, and a number written as a word counted the same as its
// digits — so "the Jordan", "Jordan" and "jordan." are one answer, as are
// "forty" and "40".

const WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90,
};

// "one hundred fifty", "one hundred and fifty", "a hundred" → 150, 150, 100.
function wordsToNumber(text) {
  const parts = text.split(' ').filter(w => w !== 'and');
  if (!parts.length) return null;
  let total = 0;
  let current = 0;
  for (const w of parts) {
    if (w in WORDS) current += WORDS[w];
    else if (w === 'hundred') current = (current || 1) * 100;
    else if (w === 'thousand') { total += (current || 1) * 1000; current = 0; }
    else return null;
  }
  return String(total + current);
}

function normalize(value) {
  let s = String(value ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^(the|a|an) /, '');
  const asNumber = wordsToNumber(s.replace(/-/g, ' '));
  if (asNumber !== null) s = asNumber;
  return s;
}

function isCorrect(question, given) {
  if (question.type === 'mc') return String(given) === question.answer;
  if (question.type === 'tf') return String(given).toLowerCase() === question.answer;
  const said = normalize(given);
  if (!said) return false;
  return question.accept.some(a => normalize(a) === said);
}

module.exports = { normalize, isCorrect };
