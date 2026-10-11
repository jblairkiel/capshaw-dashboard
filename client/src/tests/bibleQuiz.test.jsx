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
    expect(sent(fetchMock, '/api/bible-quiz/solo')).toEqual({ difficulty: 'hard', length: 20, sections: ['jesus'] });
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
