// Bible Class → Memory Verses: the rules behind the games, the how-to at the
// front, the library, practising (and Present mode, which records nothing),
// making a set, and a teacher scoring a class.
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import MemoryVersesView from '../components/memoryVerses/MemoryVersesView';
import { firstLetters, bare, gradeTyped, hiddenAt, practiceOrder, parsePasted, shuffled, wordsOf, PASS } from '../components/memoryVerses/games';

const ME = { id: 7, name: 'Ann', role: 'approved' };
const META = {
  success: true,
  categories: ['Salvation', 'Psalms & Wisdom', 'Christian Living', 'Other'],
  difficulties: ['beginner', 'intermediate', 'advanced'],
  audiences: ['children', 'youth', 'adults', 'everyone'],
  translations: ['NASB 1995'],
  defaultTranslation: 'NASB 1995',
  notice: 'Scripture quotations taken from the New American Standard Bible® (NASB) … The Lockman Foundation.',
  stars: { 3: 'Word-perfect', 2: 'One or two helps', 1: 'Needed a lot of help' },
  isAdmin: false,
};
const PSALM = {
  id: 3, title: 'Psalm 23', description: 'The Shepherd Psalm', category: 'Psalms & Wisdom', difficulty: 'intermediate', audience: 'everyone',
  translation: 'NASB 1995', tags: ['psalms'], builtIn: true, createdBy: 'Built in', mine: false, canEdit: false, canRemove: false,
  verses: [
    { id: 31, reference: 'Psalm 23:1', text: 'The LORD is my shepherd, I shall not want.', progress: null },
    { id: 32, reference: 'Psalm 23:2', text: 'He makes me lie down in green pastures;', progress: { box: 1, learned: false, due: true, dueOn: '2026-11-01' } },
  ],
};
const LIST = [
  { ...PSALM, verseCount: 6, learned: 1, practiced: 2, preview: 'Psalm 23:1 · Psalm 23:2' },
  { id: 4, title: 'First Verses', category: 'Christian Living', difficulty: 'beginner', audience: 'children', translation: 'NASB 1995', tags: [], builtIn: true, verseCount: 8, learned: 0, practiced: 0, preview: 'Genesis 1:1' },
];
const ME_DATA = {
  success: true,
  practice: { practiced: 2, learned: 1, streak: 3, practisedToday: false, due: [{ verseId: 32, reference: 'Psalm 23:2', setId: 3, setTitle: 'Psalm 23', box: 1 }], sets: [{ id: 3, title: 'Psalm 23', practiced: 2, learned: 1, verseCount: 6 }] },
  scores: [{ classId: 9, className: 'Wednesday 3rd–5th', student: 'Lily Bell', self: false, points: 5, verses: 2, perfect: 1, scores: [{ reference: 'Genesis 1:1', stars: 3, scoredOn: '2026-10-28', setTitle: 'First Verses' }] }],
  classes: [{ id: 9, name: 'Wednesday 3rd–5th', description: '', archived: false, students: 2, lastScored: '2026-10-28' }],
};
const CLASS = {
  id: 9, name: 'Wednesday 3rd–5th', description: '', archived: false,
  teachers: [{ id: 7, name: 'Ann' }],
  students: [{ id: 1, directoryId: 50, name: 'Lily Bell' }, { id: 2, directoryId: null, name: 'Ava (visitor)' }],
  board: [{ id: 1, name: 'Lily Bell', points: 5, verses: 2, perfect: 1 }, { id: 2, name: 'Ava (visitor)', points: 0, verses: 0, perfect: 0 }],
  recent: [],
};

function mockApi(extra = {}) {
  const calls = [];
  const fetchMock = vi.fn((url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url: u, method, body });
    const answer = (() => {
      for (const [key, fn] of Object.entries(extra)) if (u.includes(key)) return fn(u, method, body);
      if (u.endsWith('/meta')) return META;
      if (u.endsWith('/me')) return ME_DATA;
      if (/\/classes\/9\/sets\/4/.test(u)) return { success: true, set: { ...LIST[1], verses: [{ id: 41, reference: 'Genesis 1:1', text: 'In the beginning…' }] }, grid: [], students: CLASS.students };
      if (u.includes('/classes/9/scores')) return { success: true, id: 1, grid: [{ studentId: body.studentId, verseId: body.verseId, stars: body.stars }], class: CLASS };
      if (u.includes('/classes/9')) return { success: true, class: CLASS };
      if (u.endsWith('/classes') && method === 'POST') return { success: true, id: 9, classes: ME_DATA.classes };
      if (u.includes('/practice')) return { success: true, box: 1 };
      if (/\/sets\/3$/.test(u)) return { success: true, set: PSALM };
      if (u.includes('/sets') && method === 'POST') return { success: true, set: { ...PSALM, id: 99, title: body.title, builtIn: false, mine: true, canEdit: true, canRemove: true } };
      if (/\/sets\/99$/.test(u)) return { success: true, set: { ...PSALM, id: 99, title: 'Our VBS verses', builtIn: false } };
      if (u.includes('/sets')) return { success: true, sets: LIST };
      return { success: true };
    })();
    return Promise.resolve({ json: () => Promise.resolve(answer) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

const posted = (calls, part) => calls.filter(c => c.method === 'POST' && c.url.includes(part)).map(c => c.body);

beforeEach(() => { try { localStorage.clear(); } catch { /* none */ } });
afterEach(() => { vi.unstubAllGlobals(); });

// ─── The rules ────────────────────────────────────────────────────────────────

describe('the games\' rules', () => {
  test('first letters keep punctuation and capitals', () => {
    expect(firstLetters('The LORD is my shepherd, I shall not want.')).toBe('T L i m s, I s n w.');
    expect(firstLetters('"Go into all the world"')).toBe('"G i a t w"');
  });

  test('words compare without capitals or punctuation', () => {
    expect(bare('Shepherd,')).toBe('shepherd');
    expect(bare("name's")).toBe("name's");
    expect(bare('—')).toBe('');
  });

  test('typing it out: a missed word does not mark every word after it wrong', () => {
    const verse = 'Jesus wept.';
    expect(gradeTyped(verse, 'jesus wept').score).toBe(1);
    const missed = gradeTyped('The LORD is my shepherd, I shall not want.', 'The Lord is shepherd I shall not want');
    expect(missed.words.filter(w => !w.ok).map(w => w.word)).toEqual(['my']);
    expect(missed.score).toBeCloseTo(8 / 9, 2);
    expect(missed.score).toBeLessThan(PASS);
    // Extra words count against it too.
    expect(gradeTyped(verse, 'Jesus wept and wept and wept').score).toBeLessThan(1);
    expect(gradeTyped(verse, '').score).toBe(0);
  });

  test('fill in the blanks hides an even share, never a word with nothing to say', () => {
    const text = 'one two three four — five six seven eight';
    const fixed = () => 0.5;
    expect(hiddenAt(text, 0, fixed).size).toBe(0);
    expect(hiddenAt(text, 2, fixed).size).toBe(4);
    const all = hiddenAt(text, 4, fixed);
    expect(all.size).toBe(8);
    expect(all.has(wordsOf(text).indexOf('—'))).toBe(false);
  });

  test('practice starts with what is due, then what is new, then the rest', () => {
    const v = (id, progress) => ({ id, progress });
    expect(practiceOrder([v(1, { due: false }), v(2, null), v(3, { due: true }), v(4, null)]).map(x => x.id)).toEqual([3, 2, 4, 1]);
  });

  test('a shuffle keeps every word', () => {
    const words = wordsOf('a b c d e f');
    expect(shuffled(words).sort()).toEqual([...words].sort());
  });

  test('pasted verses split at each reference', () => {
    expect(parsePasted('John 3:16\nFor God so loved\nthe world\n\n1 John 4:19\nWe love, because He first loved us.\nnot a verse')).toEqual([
      { reference: 'John 3:16', text: 'For God so loved the world' },
      { reference: '1 John 4:19', text: 'We love, because He first loved us. not a verse' },
    ]);
    expect(parsePasted('Romans 10:9–10\nthat if you confess')[0].reference).toBe('Romans 10:9-10');
  });
});

// ─── The app ──────────────────────────────────────────────────────────────────

describe('Memory Verses', () => {
  test('the how-to is open at the front, and closing it is remembered', async () => {
    mockApi();
    const { unmount } = render(<MemoryVersesView user={ME} />);
    const howTo = await screen.findByRole('region', { name: 'How to use Memory Verses' });
    expect(within(howTo).getByText('Practise with the games')).toBeInTheDocument();
    expect(within(howTo).getByText('Teachers: score recitations')).toBeInTheDocument();
    expect(within(howTo).getByText('Practise at home')).toBeInTheDocument();
    fireEvent.click(within(howTo).getByRole('button', { name: /How to use Memory Verses/ }));
    expect(within(howTo).queryByText('Practise with the games')).not.toBeInTheDocument();
    unmount();
    render(<MemoryVersesView user={ME} />);
    const again = await screen.findByRole('region', { name: 'How to use Memory Verses' });
    expect(within(again).getByRole('button', { name: /How to use Memory Verses/ })).toHaveAttribute('aria-expanded', 'false');
  });

  test('the library lists sets with how they are filed and how much is learned, and searches as you type', async () => {
    const calls = mockApi();
    render(<MemoryVersesView user={ME} />);
    const sets = await screen.findByRole('list', { name: 'Sets' });
    const psalm = within(sets).getByText('Psalm 23').closest('button');
    expect(psalm).toHaveTextContent('Intermediate');
    expect(psalm).toHaveTextContent('1 of 6 learned');
    expect(screen.getByText(/Lockman Foundation/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search the library'), { target: { value: 'shepherd' } });
    fireEvent.change(screen.getByLabelText('Difficulty'), { target: { value: 'beginner' } });
    fireEvent.change(screen.getByLabelText('Age group'), { target: { value: 'children' } });
    await waitFor(() => expect(calls.some(c => c.url.includes('q=shepherd') && c.url.includes('difficulty=beginner') && c.url.includes('audience=children'))).toBe(true));
  });

  test('practising with flash cards saves each verse, due ones first', async () => {
    const calls = mockApi();
    render(<MemoryVersesView user={ME} />);
    fireEvent.click(await screen.findByText('Psalm 23', { selector: 'span' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Practise' }));
    // Psalm 23:2 is due, so it comes first.
    expect(screen.getByText('Psalm 23:2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Turn the card over' }));
    expect(screen.getByText('He makes me lie down in green pastures;')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'I knew it' }));
    fireEvent.click(screen.getByRole('button', { name: 'Turn the card over' }));
    fireEvent.click(screen.getByRole('button', { name: 'Not yet' }));
    expect(screen.getByText('1 of 2 right')).toBeInTheDocument();
    await waitFor(() => expect(posted(calls, '/practice')).toEqual([{ verseId: 32, correct: true }, { verseId: 31, correct: false }]));
  });

  test('word order is marked by wrong taps, and type it out shows what was missed', async () => {
    const calls = mockApi();
    render(<MemoryVersesView user={ME} />);
    fireEvent.click(await screen.findByText('Psalm 23', { selector: 'span' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Practise' }));
    fireEvent.click(screen.getByRole('button', { name: 'Word order' }));
    const pool = () => within(screen.getByRole('group', { name: 'Words to place' }));
    fireEvent.click(pool().getByRole('button', { name: 'pastures;' }));          // wrong first
    expect(screen.getByText('1 wrong tap')).toBeInTheDocument();
    for (const w of ['He', 'makes', 'me', 'lie', 'down', 'in', 'green', 'pastures;']) fireEvent.click(pool().getByRole('button', { name: w }));
    expect(screen.getByText('Well done!')).toBeInTheDocument();                   // one slip allowed
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    fireEvent.click(screen.getByRole('button', { name: 'Type it out' }));
    fireEvent.change(screen.getByLabelText('Type the verse'), { target: { value: 'The Lord is shepherd I shall not want' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(screen.getByText(/89% right/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(posted(calls, '/practice')).toEqual([{ verseId: 32, correct: true }, { verseId: 31, correct: false }]));
  });

  test('Present mode fills the screen and saves nobody\'s practice', async () => {
    const calls = mockApi();
    render(<MemoryVersesView user={ME} />);
    fireEvent.click(await screen.findByText('Psalm 23', { selector: 'span' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Present' }));
    const stage = screen.getByRole('dialog', { name: 'Present: Psalm 23' });
    fireEvent.click(within(stage).getByRole('button', { name: 'First letters' }));
    expect(within(stage).getByText('H m m l d i g p;')).toBeInTheDocument();
    fireEvent.click(within(stage).getByRole('button', { name: 'I knew it' }));
    fireEvent.click(within(stage).getByRole('button', { name: 'I knew it' }));
    expect(within(stage).getByText(/not saved to anyone's progress/)).toBeInTheDocument();
    expect(posted(calls, '/practice')).toEqual([]);
  });

  test('a built-in set can be copied but not changed', async () => {
    mockApi();
    render(<MemoryVersesView user={ME} />);
    fireEvent.click(await screen.findByText('Psalm 23', { selector: 'span' }));
    await screen.findByRole('button', { name: 'Make a copy' });
    expect(screen.queryByRole('button', { name: 'Change' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });

  test('making a set: filed by category, difficulty and age, verses typed or pasted', async () => {
    const calls = mockApi();
    render(<MemoryVersesView user={ME} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Make a new set' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByPlaceholderText('e.g. Verses for VBS week'), { target: { value: 'Our VBS verses' } });
    const [category, difficulty, audience] = within(dialog).getAllByRole('combobox');
    fireEvent.change(category, { target: { value: 'Christian Living' } });
    fireEvent.change(difficulty, { target: { value: 'beginner' } });
    fireEvent.change(audience, { target: { value: 'children' } });
    fireEvent.change(within(dialog).getByLabelText('Verse 1 reference'), { target: { value: 'Psalm 56:3' } });
    fireEvent.change(within(dialog).getByLabelText('Verse 1 words'), { target: { value: 'When I am afraid, I will put my trust in You.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Paste several at once' }));
    fireEvent.change(within(dialog).getByLabelText('Verses to paste'), { target: { value: 'John 14:15\nIf you love Me, you will keep My commandments.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add these verses' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add to the library' }));
    await waitFor(() => expect(posted(calls, '/sets')[0]).toMatchObject({
      title: 'Our VBS verses', category: 'Christian Living', difficulty: 'beginner', audience: 'children', translation: 'NASB 1995',
      verses: [{ reference: 'Psalm 56:3', text: 'When I am afraid, I will put my trust in You.' }, { reference: 'John 14:15', text: 'If you love Me, you will keep My commandments.' }],
    }));
  });

  test('my practice shows what is due, verses learned and the streak', async () => {
    mockApi();
    render(<MemoryVersesView user={ME} />);
    fireEvent.click(await screen.findByRole('tab', { name: /My practice/ }));
    expect(screen.getByText('Day streak').previousSibling).toHaveTextContent('3');
    expect(screen.getByText('Verses learned').previousSibling).toHaveTextContent('1');
    expect(screen.getByText(/keep your 3-day streak/)).toBeInTheDocument();
    expect(screen.getByText(/Psalm 23:2/)).toBeInTheDocument();
  });

  test('my scores show a child\'s scores to the household', async () => {
    mockApi();
    render(<MemoryVersesView user={ME} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'My scores' }));
    const lily = screen.getByRole('region', { name: 'Lily Bell in Wednesday 3rd–5th' });
    expect(lily).toHaveTextContent('5 points · 2 verses · 1 word-perfect');
    expect(lily).toHaveTextContent('★★★ Genesis 1:1');
  });

  test('a teacher scores a recitation with a tap on the stars, and sees the board', async () => {
    const calls = mockApi();
    render(<MemoryVersesView user={ME} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'My classes' }));
    fireEvent.click(await screen.findByText('Wednesday 3rd–5th'));
    const board = await screen.findByRole('region', { name: 'Class board' });
    expect(within(board).getByText(/Lily Bell/).closest('tr')).toHaveTextContent('Lily Bell521');
    fireEvent.change(screen.getByLabelText('Set to score'), { target: { value: '4' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Ava (visitor), Genesis 1:1: 2 stars' }));
    await waitFor(() => expect(posted(calls, '/classes/9/scores')).toEqual([{ studentId: 2, verseId: 41, stars: 2 }]));
    expect(screen.getByRole('button', { name: 'Ava (visitor), Genesis 1:1: 2 stars' })).toHaveClass('text-church-gold');
  });

  test('starting a class opens it', async () => {
    const calls = mockApi();
    render(<MemoryVersesView user={ME} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'My classes' }));
    fireEvent.change(screen.getByPlaceholderText('e.g. Wednesday 3rd–5th grade'), { target: { value: 'Sunday Teens' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(posted(calls, '/classes')).toEqual([{ name: 'Sunday Teens' }]));
    expect(await screen.findByRole('region', { name: 'Score recitations' })).toBeInTheDocument();
  });
});
