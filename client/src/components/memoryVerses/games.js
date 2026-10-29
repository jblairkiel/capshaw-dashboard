// The rules behind the Memory Verses games, kept apart from the screens so
// each can be checked on its own.
//
// A verse is split into words, each keeping the punctuation that follows it
// for display; comparing words ignores capitals and punctuation, so "Lord,"
// and "lord" are the same word.

export const GAMES = [
  { id: 'flash',   label: 'Flash cards',        blurb: 'See the reference, say the verse, then turn the card over to check.' },
  { id: 'blanks',  label: 'Fill in the blanks', blurb: 'Words disappear a few at a time — tap a blank to check it.' },
  { id: 'letters', label: 'First letters',      blurb: 'Only the first letter of each word is shown. Say the verse from them.' },
  { id: 'order',   label: 'Word order',         blurb: 'The words are shuffled. Tap them back into the right order.' },
  { id: 'type',    label: 'Type it out',        blurb: 'Type the whole verse from memory and see what you missed.' },
];

// Words with their punctuation, as shown: ["In", "the", "beginning", …].
export function wordsOf(text) {
  return String(text || '').split(/\s+/).filter(Boolean);
}

// A word reduced to what is compared: letters and digits, lower case.
export function bare(word) {
  return String(word || '').toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9']/g, '').replace(/^'+|'+$/g, '');
}

// "In the beginning God created…" → "I. t. b. G. c…", keeping punctuation.
export function firstLetters(text) {
  return wordsOf(text).map(w => {
    const m = w.match(/^([^A-Za-z0-9]*)([A-Za-z0-9])[A-Za-z0-9'’-]*(.*)$/);
    return m ? `${m[1]}${m[2]}${m[3]}` : w;
  }).join(' ');
}

// A small seeded shuffle, so a round can be replayed the same way in a test.
export function shuffled(list, random = Math.random) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Which words to hide at a level from 0 (none) to 4 (all): an even spread,
// so a verse is never left with a long run of blanks while its start is
// still whole. Words with nothing to compare (a lone dash) are never hidden.
export function hiddenAt(text, level, random = Math.random) {
  const words = wordsOf(text);
  const candidates = words.map((w, i) => (bare(w) ? i : -1)).filter(i => i >= 0);
  const share = [0, 0.25, 0.5, 0.75, 1][Math.max(0, Math.min(4, level))];
  const n = Math.round(candidates.length * share);
  return new Set(shuffled(candidates, random).slice(0, n));
}

// A typed attempt against the verse, word by word (a longest-common-subsequence
// alignment, so one missed word does not mark every word after it wrong).
// Returns each verse word as { word, ok } and the share right, 0–1.
export function gradeTyped(text, typed) {
  const want = wordsOf(text);
  const got = wordsOf(typed).map(bare).filter(Boolean);
  const a = want.map(bare);
  const rows = a.length + 1, cols = got.length + 1;
  const L = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = got.length - 1; j >= 0; j--) {
      L[i][j] = a[i] && a[i] === got[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
  }
  const ok = new Array(a.length).fill(false);
  let i = 0, j = 0;
  while (i < a.length && j < got.length) {
    if (a[i] && a[i] === got[j]) { ok[i] = true; i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) i++;
    else j++;
  }
  const counted = a.filter(Boolean).length || 1;
  const right = ok.filter((v, k) => v && a[k]).length;
  // Extra words typed that are not in the verse count against it too.
  const extra = Math.max(0, got.length - right);
  const score = Math.max(0, right - extra / 2) / counted;
  return { words: want.map((word, k) => ({ word, ok: ok[k] || !a[k] })), score: Math.round(score * 100) / 100 };
}

// A round counts as right — and the verse moves up the review ladder — at 90%
// or better in the games that are marked.
export const PASS = 0.9;

// The order to practise a set in: verses due for review first, then ones not
// yet started, then the rest, each group in the set's own order.
export function practiceOrder(verses) {
  const rank = v => (!v.progress ? 1 : v.progress.due ? 0 : 2);
  return [...verses].map((v, i) => ({ v, i })).sort((x, y) => rank(x.v) - rank(y.v) || x.i - y.i).map(x => x.v);
}

export const DIFFICULTY_LABEL = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' };
export const AUDIENCE_LABEL = { children: 'Children', youth: 'Youth', adults: 'Adults', everyone: 'Everyone' };
export const DIFFICULTY_TONE = {
  beginner: 'bg-emerald-100 text-emerald-800',
  intermediate: 'bg-amber-100 text-amber-800',
  advanced: 'bg-red-100 text-red-800',
};
export const starsOf = n => '★'.repeat(n) + '☆'.repeat(Math.max(0, 3 - n));

// "John 3:16\nFor God so loved…\n\nRomans 3:23\nfor all have sinned…" →
// verses. A line that looks like a reference starts a new verse.
export function parsePasted(block) {
  const out = [];
  for (const line of String(block || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)) {
    if (/^([1-3] ?)?[A-Za-z][A-Za-z ]+\.? \d+:\d+([-–]\d+)?[ab]?$/.test(line)) out.push({ reference: line.replace('–', '-'), text: '' });
    else if (out.length) out[out.length - 1].text = `${out[out.length - 1].text} ${line}`.trim();
  }
  return out.filter(v => v.text);
}
