import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import BibleQuizView from '../components/BibleQuizView';

const BANK = {
  success: true, total: 500, points: { easy: 1, medium: 2, hard: 3 }, lengths: [10, 20],
  sections: [{ id: 'genesis', label: 'Creation & the Patriarchs' }, { id: 'jesus', label: 'The Life of Jesus' }],
};
const Q1 = { id: 'genesis-1', section: 'genesis', type: 'mc', difficulty: 'easy', points: 1, question: 'Who built an ark?', options: ['Moses', 'Noah', 'Abraham', 'Jacob'] };
const Q2 = { id: 'jesus-14', section: 'jesus', type: 'short', difficulty: 'easy', points: 1, question: 'How many days did Jesus fast in the wilderness?' };
const game = over => ({ id: 7, difficulty: 'easy', sections: [], length: 2, position: 0, score: 0, correct: 0, streak: 0, bestStreak: 0, finished: false, question: Q1, ...over });
const LEADERS = {
  success: true, period: 'all',
  leaders: [
    { userId: 2, rank: 1, name: 'Ann Adams', points: 42, accuracy: 80, games: 4, bestGame: 18, answered: 40, correct: 32 },
    { userId: 1, rank: 2, name: 'Joe Carter', points: 12, accuracy: 60, games: 1, bestGame: 12, answered: 10, correct: 6 },
  ],
  me: { userId: 1, rank: 2, name: 'Joe Carter', points: 12 },
};

// Answers by the first route whose test matches; records every call.
function mockApi(routes) {
  const fetchMock = vi.fn((url, opts = {}) => {
    const method = opts.method || 'GET';
    const hit = routes.find(r => r.match(String(url), method));
    const body = hit ? (typeof hit.body === 'function' ? hit.body(opts) : hit.body) : { success: false, error: `no route ${method} ${url}` };
    return Promise.resolve({ json: () => Promise.resolve(body) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
const route = (path, method, body) => ({ match: (u, m) => u.startsWith(path) && m === method, body });
const bankRoute = route('/api/bible-quiz/bank', 'GET', BANK);
const sent = (fetchMock, path) => JSON.parse(fetchMock.mock.calls.find(([u, o]) => String(u) === path && o?.method === 'POST')[1].body);

beforeEach(() => { try { localStorage.clear(); } catch { /* none */ } });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Bible Quiz — single player', () => {
  test('starts a game at the chosen difficulty and length', async () => {
    const fetchMock = mockApi([bankRoute, route('/api/bible-quiz/solo', 'POST', { success: true, game: game() })]);
    render(<BibleQuizView user={{ role: 'approved' }} />);
    expect(await screen.findByText(/500 questions from Genesis/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hard' }));
    fireEvent.click(screen.getByRole('button', { name: '20 questions' }));
    fireEvent.click(screen.getByRole('button', { name: 'The Life of Jesus' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(await screen.findByText('Who built an ark?')).toBeInTheDocument();
    expect(sent(fetchMock, '/api/bible-quiz/solo')).toEqual({ difficulty: 'hard', count: 20, sections: ['jesus'] });
  });

  test('says why a game could not be dealt', async () => {
    mockApi([bankRoute, route('/api/bible-quiz/solo', 'POST', { success: false, error: 'Only 3 questions match that' })]);
    render(<BibleQuizView user={{ role: 'approved' }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Only 3 questions match that');
  });

  test('marks an answer, shows the right one and where it is found, then moves on to a short answer', async () => {
    const fetchMock = mockApi([
      bankRoute,
      route('/api/bible-quiz/solo/7/answer', 'POST', opts => (JSON.parse(opts.body).questionId === 'genesis-1'
        ? { success: true, result: { correct: false, points: 0, answer: 'Noah', ref: 'Genesis 6:14' }, game: game({ position: 1, question: Q2 }) }
        : { success: true, result: { correct: true, points: 1, answer: 'Forty', ref: 'Matthew 4:2', given: '40' }, game: game({ position: 2, score: 1, correct: 1, finished: true, question: null, bestStreak: 1 }) })),
      route('/api/bible-quiz/solo', 'POST', { success: true, game: game() }),
      route('/api/bible-quiz/leaderboard', 'GET', LEADERS),
    ]);
    render(<BibleQuizView user={{ role: 'approved' }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }));
    expect(await screen.findByText('Question 1 of 2')).toBeInTheDocument();
    expect(screen.getByText('Easy · 1 point')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Moses' }));
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Not quite.');
    expect(status).toHaveTextContent('Answer: Noah');
    expect(status).toHaveTextContent('Genesis 6:14');
    expect(screen.getByRole('button', { name: 'Noah' })).toHaveClass('bg-emerald-50');
    expect(screen.getByRole('button', { name: 'Moses' })).toHaveClass('bg-red-50');
    expect(sent(fetchMock, '/api/bible-quiz/solo/7/answer')).toEqual({ questionId: 'genesis-1', answer: 'Moses' });

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    const box = await screen.findByRole('textbox', { name: 'Your answer' });
    expect(screen.getByRole('button', { name: 'Answer' })).toBeDisabled();
    fireEvent.change(box, { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
    expect(await screen.findByText('Right! +1 point')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Answer: Forty');

    fireEvent.click(screen.getByRole('button', { name: 'See how you did' }));
    expect(await screen.findByText('1 point')).toBeInTheDocument();
    expect(screen.getByText(/1 of 2 right/)).toBeInTheDocument();
    expect(await screen.findByText(/#2/)).toBeInTheDocument();
  });

  test('carries on with a game left part way through', async () => {
    localStorage.setItem('bibleQuiz.soloGame', '7');
    mockApi([bankRoute, route('/api/bible-quiz/solo/7', 'GET', { success: true, game: game({ position: 1, score: 3, correct: 1, question: Q2 }) })]);
    render(<BibleQuizView user={{ role: 'approved' }} />);
    expect(await screen.findByText('Question 2 of 2')).toBeInTheDocument();
    expect(screen.getByText('3 points')).toBeInTheDocument();
  });

  test('a finished or missing saved game starts fresh', async () => {
    localStorage.setItem('bibleQuiz.soloGame', '7');
    mockApi([bankRoute, route('/api/bible-quiz/solo/7', 'GET', { success: false, error: 'That game is not here' })]);
    render(<BibleQuizView user={{ role: 'approved' }} />);
    expect(await screen.findByRole('button', { name: 'Start' })).toBeInTheDocument();
    expect(localStorage.getItem('bibleQuiz.soloGame')).toBeNull();
  });
});

describe('Bible Quiz — leaderboard', () => {
  test('lists every member who has played, best first, with you marked; this month asks again', async () => {
    const fetchMock = mockApi([bankRoute, route('/api/bible-quiz/leaderboard', 'GET', LEADERS)]);
    render(<BibleQuizView user={{ role: 'approved' }} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Leaderboard' }));
    const table = await screen.findByRole('table', { name: 'Leaderboard' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('🥇');
    expect(rows[0]).toHaveTextContent('Ann Adams');
    expect(rows[0]).toHaveTextContent('42');
    expect(rows[1]).toHaveTextContent('Joe Carter (you)');

    fireEvent.click(screen.getByRole('button', { name: 'This month' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u) === '/api/bible-quiz/leaderboard?period=month')).toBe(true));
  });

  test('says so when nobody has played', async () => {
    mockApi([bankRoute, route('/api/bible-quiz/leaderboard', 'GET', { success: true, leaders: [], me: null })]);
    render(<BibleQuizView user={{ role: 'approved' }} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Leaderboard' }));
    expect(await screen.findByText(/Nobody has played yet/)).toBeInTheDocument();
  });
});

describe('Bible Quiz — classroom', () => {
  test('opens the team game', async () => {
    mockApi([bankRoute, { match: () => true, body: { success: true, questions: [], sets: [] } }]);
    render(<BibleQuizView user={{ role: 'approved' }} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Classroom (teams)' }));
    expect(await screen.findByText('Bible Bowl Stadium')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '6 teams' })).toBeInTheDocument();
  });
});

describe('Bible Quiz — flagging a question', () => {
  const wrongOnQ1 = { success: true, result: { answerId: 41, correct: false, points: 0, answer: 'Noah', ref: 'Genesis 6:14' }, game: game({ position: 1, question: Q2 }) };

  test('after a wrong answer, it can be flagged as one that should have counted', async () => {
    const fetchMock = mockApi([
      bankRoute,
      route('/api/bible-quiz/solo/7/answer', 'POST', wrongOnQ1),
      route('/api/bible-quiz/solo', 'POST', { success: true, game: game() }),
      route('/api/bible-quiz/flags', 'POST', { success: true, flag: { id: 3, status: 'open' } }),
    ]);
    render(<BibleQuizView user={{ role: 'approved' }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Moses' }));
    fireEvent.click(await screen.findByRole('button', { name: /Flag this question/ }));
    const form = screen.getByRole('group', { name: 'Flag this question' });
    fireEvent.click(within(form).getByRole('radio', { name: 'My answer should have counted' }));
    fireEvent.change(within(form).getByRole('textbox'), { target: { value: 'Moses built one too?' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Send flag' }));
    expect(await screen.findByText(/Flagged — the Bible Quiz Keeper will look at it/)).toBeInTheDocument();
    expect(sent(fetchMock, '/api/bible-quiz/flags')).toEqual({ questionId: 'genesis-1', reason: 'my-answer', note: 'Moses built one too?', answerId: 41 });
  });

  test('a right answer can be flagged, but not as one that should have counted', async () => {
    mockApi([
      bankRoute,
      route('/api/bible-quiz/solo/7/answer', 'POST', { ...wrongOnQ1, result: { ...wrongOnQ1.result, correct: true, points: 1 } }),
      route('/api/bible-quiz/solo', 'POST', { success: true, game: game() }),
    ]);
    render(<BibleQuizView user={{ role: 'approved' }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Noah' }));
    fireEvent.click(await screen.findByRole('button', { name: /Flag this question/ }));
    expect(screen.queryByRole('radio', { name: 'My answer should have counted' })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'The answer key is wrong' })).toBeChecked();
    // "Something else" needs a note before it can be sent.
    fireEvent.click(screen.getByRole('radio', { name: 'Something else' }));
    expect(screen.getByRole('button', { name: 'Send flag' })).toBeDisabled();
  });

  test('a finished game lists every answer, and an earlier one can still be flagged', async () => {
    const fetchMock = mockApi([
      bankRoute,
      route('/api/bible-quiz/solo/7/review', 'GET', { success: true, answers: [
        { answerId: 41, questionId: 'genesis-1', question: 'Who built an ark?', type: 'mc', given: 'Moses', correct: false, points: 0, answer: 'Noah', ref: 'Genesis 6:14', flag: null },
        { answerId: 42, questionId: 'jesus-14', question: 'How many days did Jesus fast in the wilderness?', type: 'short', given: '40', correct: true, points: 1, answer: 'Forty', ref: 'Matthew 4:2', flag: 'open' },
      ] }),
      route('/api/bible-quiz/solo/7', 'GET', { success: true, game: game({ position: 2, finished: false, question: Q2 }) }),
      route('/api/bible-quiz/leaderboard', 'GET', LEADERS),
      route('/api/bible-quiz/flags', 'POST', { success: true, flag: { id: 4, status: 'open' } }),
      route('/api/bible-quiz/solo/7/answer', 'POST', { success: true, result: { answerId: 43, correct: true, points: 1, answer: 'Forty', ref: 'Matthew 4:2' }, game: game({ position: 2, finished: true, question: null, score: 1, correct: 1 }) }),
    ]);
    localStorage.setItem('bibleQuiz.soloGame', '7');
    render(<BibleQuizView user={{ role: 'approved' }} />);
    fireEvent.change(await screen.findByRole('textbox', { name: 'Your answer' }), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
    fireEvent.click(await screen.findByRole('button', { name: 'See how you did' }));

    const review = await screen.findByRole('region', { name: 'Your answers' });
    const items = within(review).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('✗ You said: Moses');
    expect(items[0]).toHaveTextContent('Answer: Noah');
    expect(items[0]).toHaveTextContent('Genesis 6:14');
    // One already flagged says so.
    expect(within(items[1]).getByText(/Flagged/)).toBeInTheDocument();
    fireEvent.click(within(items[0]).getByRole('button', { name: /Flag this question/ }));
    fireEvent.click(within(items[0]).getByRole('button', { name: 'Send flag' }));
    await waitFor(() => expect(sent(fetchMock, '/api/bible-quiz/flags')).toEqual({ questionId: 'genesis-1', reason: 'answer-wrong', note: '', answerId: 41 }));
  });
});

describe('Bible Quiz — the Bible Quiz Keeper', () => {
  const FLAG = {
    id: 9, status: 'open', reason: 'my-answer', reasonLabel: 'My answer should have counted', note: 'I wrote forty days',
    given: 'forty days', source: 'solo', by: 'Ann Adams', wasCorrect: false, creditable: true, retired: false,
    question: { id: 'jesus-14', question: 'How many days did Jesus fast in the wilderness?', type: 'short', difficulty: 'easy', ref: 'Matthew 4:2', section: 'The Life of Jesus', options: null, answer: 'Forty', accept: ['Forty', '40'] },
  };

  test('only a keeper has the Flags tab, with how many are waiting', async () => {
    mockApi([bankRoute]);
    render(<BibleQuizView user={{ role: 'approved' }} />);
    await screen.findByText(/500 questions/);
    expect(screen.queryByRole('tab', { name: /Flags/ })).not.toBeInTheDocument();
  });

  test('sees each flag in full and credits an answer, with a word back', async () => {
    const fetchMock = mockApi([
      route('/api/bible-quiz/bank', 'GET', { ...BANK, canReview: true, openFlags: 1 }),
      route('/api/bible-quiz/flags/9/decide', 'POST', { success: true, credited: 2, closed: 1, openFlags: 0, flag: { ...FLAG, status: 'credited' } }),
      { match: (u, m) => u.startsWith('/api/bible-quiz/flags?status=open') && m === 'GET', body: () => ({ success: true, flags: fetchMock.mock.calls.some(([u]) => String(u).includes('/decide')) ? [] : [FLAG], openFlags: fetchMock.mock.calls.some(([u]) => String(u).includes('/decide')) ? 0 : 1 }) },
    ]);
    render(<BibleQuizView user={{ role: 'approved' }} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Flags (1)' }));
    const card = await screen.findByRole('listitem', { name: /Flag on How many days/ });
    expect(card).toHaveTextContent('Answer key: Forty');
    expect(card).toHaveTextContent('also counts: 40');
    expect(card).toHaveTextContent('My answer should have counted');
    expect(card).toHaveTextContent('Their answer: forty days (marked wrong)');
    expect(card).toHaveTextContent('I wrote forty days');
    fireEvent.change(within(card).getByRole('textbox', { name: /Reply to the member/ }), { target: { value: 'Fair enough.' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Credit this answer' }));
    expect(await screen.findByText('Credited — 2 answers put right.')).toBeInTheDocument();
    expect(sent(fetchMock, '/api/bible-quiz/flags/9/decide')).toEqual({ action: 'credit', response: 'Fair enough.' });
    expect(await screen.findByText('Nothing flagged right now.')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Flags' })).toBeInTheDocument();
  });

  test('can put a question taken out of play back', async () => {
    const fetchMock = mockApi([
      route('/api/bible-quiz/bank', 'GET', { ...BANK, canReview: true, openFlags: 0 }),
      route('/api/bible-quiz/flags', 'GET', { success: true, flags: [], openFlags: 0 }),
      route('/api/bible-quiz/retired/genesis-1', 'DELETE', { success: true }),
      route('/api/bible-quiz/retired', 'GET', { success: true, retired: [{ questionId: 'genesis-1', question: 'Who built an ark?', ref: 'Genesis 6:14', reason: 'Rewording', by: 'Kit', at: '2026-10-11' }] }),
    ]);
    render(<BibleQuizView user={{ role: 'approved' }} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Flags' }));
    fireEvent.click(screen.getByRole('button', { name: 'Out of play' }));
    expect(await screen.findByText('Who built an ark?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Put back' }));
    expect(await screen.findByText('Put back into play.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u, o]) => String(u) === '/api/bible-quiz/retired/genesis-1' && o?.method === 'DELETE')).toBe(true);
  });
});
