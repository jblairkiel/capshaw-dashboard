import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import JeopardyView from '../components/jeopardy/JeopardyView';
import BibleClassView from '../components/BibleClassView';

// Bible Jeopardy: the list of saved games, uploading a new one, and playing it
// on the classroom screen with teams, a Daily Double and Final Jeopardy.

const type = (input, value) => fireEvent.change(input, { target: { value } });

const BOARD = {
  categories: [
    { name: 'The Flood', clues: [
      { points: 100, clue: 'He built an ark of gopher wood.', answer: 'Who is Noah?', daily: false },
      { points: 200, clue: 'Days and nights it rained.', answer: 'What is 40?', daily: true },
    ] },
    { name: 'Kings', clues: [
      { points: 100, clue: 'The first king of Israel.', answer: 'Who is Saul?', daily: false },
    ] },
  ],
  final: { category: 'Apostles', clue: 'He replaced Judas.', answer: 'Who is Matthias?' },
};
const GAME = {
  id: 7, title: 'Genesis review', author: 'Brother Lee', createdByName: 'Maker', createdAt: '2026-10-18 10:00:00', updatedAt: '2026-10-18 10:00:00',
  categoryNames: ['The Flood', 'Kings'], clueCount: 3, hasFinal: true, canEdit: true, board: BOARD,
};

function mockApi(routes = {}) {
  const fetchMock = vi.fn((url, options = {}) => {
    const key = `${options.method || 'GET'} ${String(url).replace(/\?.*$/, '')}`;
    const body = routes[key]?.(url, options) ?? (
      key === 'GET /api/jeopardy' ? { success: true, games: [GAME], authors: [{ name: 'Brother Lee', games: 1 }] }
        : key === 'GET /api/jeopardy/7' ? { success: true, game: GAME }
          : { success: false, error: `unexpected ${key}` });
    return Promise.resolve({ json: () => Promise.resolve(body) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('the list of games', () => {
  test('shows each game with its categories, and searches as you type', async () => {
    const fetchMock = mockApi();
    render(<JeopardyView />);
    expect(await screen.findByRole('button', { name: /Genesis review/ })).toHaveTextContent('The Flood · Kings');
    expect(screen.getByRole('link', { name: /Download the template/ })).toHaveAttribute('href', '/api/jeopardy/template');

    type(screen.getByRole('searchbox', { name: 'Search games' }), 'noah');
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === '/api/jeopardy?q=noah')).toBe(true));
  });

  test('shows who wrote each game, and narrows the list to one author', async () => {
    const fetchMock = mockApi();
    render(<JeopardyView />);
    expect(await screen.findByRole('button', { name: /Genesis review/ })).toHaveTextContent('by Brother Lee');

    fireEvent.change(screen.getByRole('combobox', { name: 'Author' }), { target: { value: 'Brother Lee' } });
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === '/api/jeopardy?author=Brother+Lee')).toBe(true));
  });

  test("the author's name on a game shows all of their games", async () => {
    const fetchMock = mockApi();
    render(<JeopardyView initialGameId={7} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Brother Lee' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === '/api/jeopardy?author=Brother+Lee')).toBe(true));
    expect(screen.getByRole('combobox', { name: 'Author' })).toHaveValue('Brother Lee');
  });

  test('a new game is credited to whoever uploads it unless another author is named', async () => {
    const fetchMock = mockApi({ 'POST /api/jeopardy': () => ({ success: true, game: GAME }) });
    render(<JeopardyView user={{ id: 1, name: 'Maker' }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'New game' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText(/^Author/)).toHaveValue('Maker');
    type(within(dialog).getByLabelText(/^Author/), 'Brother Lee');
    type(within(dialog).getByLabelText(/Name of the game/), 'Genesis review');
    fireEvent.change(within(dialog).getByLabelText(/Filled-in template/), { target: { files: [new File(['x'], 'game.xlsx')] } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save the game' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, o]) => url === '/api/jeopardy' && o?.method === 'POST');
      expect(call[1].body.get('author')).toBe('Brother Lee');
    });
  });

  test('a template with mistakes says which rows to put right', async () => {
    mockApi({
      'POST /api/jeopardy': () => ({ success: false, error: 'The template needs a few things put right', errors: ['Row 2: "Day one." has no answer.'] }),
    });
    render(<JeopardyView user={{ id: 1, name: 'Maker' }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'New game' }));
    const dialog = screen.getByRole('dialog');
    type(within(dialog).getByLabelText(/Name of the game/), 'Creation');
    fireEvent.change(within(dialog).getByLabelText(/Filled-in template/), { target: { files: [new File(['x'], 'game.xlsx')] } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save the game' }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('Row 2: "Day one." has no answer.');
  });

  test('a saved game opens straight away, with the answers hidden until asked for', async () => {
    mockApi({ 'POST /api/jeopardy': () => ({ success: true, game: GAME }) });
    render(<JeopardyView user={{ id: 1, name: 'Maker' }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'New game' }));
    const dialog = screen.getByRole('dialog');
    type(within(dialog).getByLabelText(/Name of the game/), 'Genesis review');
    fireEvent.change(within(dialog).getByLabelText(/Filled-in template/), { target: { files: [new File(['x'], 'game.xlsx')] } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save the game' }));

    expect(await screen.findByRole('button', { name: 'Play this game' })).toBeInTheDocument();
    expect(screen.getByText(/2 categories · 3 clues · 1 Daily Double · Final Jeopardy/)).toBeInTheDocument();
    expect(screen.queryByText(/Who is Noah\?/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show the clues and answers' }));
    expect(screen.getByText(/Who is Noah\?/)).toBeInTheDocument();
  });

  test("a game's permanent link opens it from the Bible Class page", async () => {
    mockApi();
    render(<BibleClassView initialGameId={7} />);
    expect(await screen.findByRole('button', { name: 'Play this game' })).toBeInTheDocument();
    expect(screen.getByText('Genesis review')).toBeInTheDocument();
  });
});

describe('playing a game', () => {
  async function startGame() {
    mockApi();
    render(<JeopardyView initialGameId={7} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Play this game' }));
    type(screen.getByLabelText('Team 1 name'), 'Lions');
    type(screen.getByLabelText('Team 2 name'), 'Eagles');
    fireEvent.click(screen.getByRole('button', { name: 'Start the game' }));
  }
  const score = name => within(screen.getByLabelText('Scores')).getByText(name).nextSibling;

  test('a clue is read, its answer shown, the points given, and its square used up', async () => {
    await startGame();
    fireEvent.click(screen.getByRole('button', { name: 'The Flood for 100' }));
    expect(screen.getByText('He built an ark of gopher wood.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Answer')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show the answer' }));
    expect(screen.getByLabelText('Answer')).toHaveTextContent('Who is Noah?');
    fireEvent.click(screen.getByRole('button', { name: 'Eagles wrong' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lions right' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to the board' }));

    expect(score('Lions')).toHaveTextContent('100');
    expect(score('Eagles')).toHaveTextContent('-100');
    expect(screen.getByRole('button', { name: 'The Flood for 100 (played)' })).toBeInTheDocument();
    expect(screen.getByText('1 of 3 played')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Undo last score' }));
    expect(score('Lions')).toHaveTextContent('0');
  });

  test('a Daily Double takes a bet from the team that chose it before the clue shows', async () => {
    await startGame();
    fireEvent.click(screen.getByRole('button', { name: 'The Flood for 200' }));
    expect(screen.getByText('DAILY DOUBLE!')).toBeInTheDocument();
    expect(screen.queryByText('Days and nights it rained.')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Which team chose it?'), { target: { value: '1' } });
    // A team with nothing may bet up to the board's top clue.
    expect(screen.getByText('Their bet (up to 200)')).toBeInTheDocument();
    type(screen.getByLabelText(/Their bet/), '500');
    expect(screen.getByRole('button', { name: 'Show the clue' })).toBeDisabled();
    type(screen.getByLabelText(/Their bet/), '150');
    fireEvent.click(screen.getByRole('button', { name: 'Show the clue' }));

    fireEvent.click(screen.getByRole('button', { name: 'Show the answer' }));
    expect(screen.queryByRole('button', { name: 'Lions right' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Eagles right' }));
    expect(score('Eagles')).toHaveTextContent('150');
  });

  test('Final Jeopardy takes each bet, marks each team, and names the winner', async () => {
    await startGame();
    fireEvent.click(screen.getByRole('button', { name: 'Kings for 100' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show the answer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lions right' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to the board' }));

    fireEvent.click(screen.getByRole('button', { name: 'Final Jeopardy' }));
    expect(screen.getByText('Apostles')).toBeInTheDocument();
    type(screen.getByLabelText('Lions bet'), '100');
    fireEvent.click(screen.getByRole('button', { name: 'Show the clue' }));   // Eagles have nothing to bet
    expect(screen.getByText('He replaced Judas.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show the answer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lions right' }));
    fireEvent.click(screen.getByRole('button', { name: 'Eagles wrong' }));
    fireEvent.click(screen.getByRole('button', { name: 'See the final scores' }));

    expect(screen.getByText('The winner is')).toBeInTheDocument();
    expect(screen.getByText('Lions', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('200')).toBeInTheDocument();
  });

  test('a game in progress survives the page being refreshed', async () => {
    await startGame();
    fireEvent.click(screen.getByRole('button', { name: 'Kings for 100' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show the answer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lions right' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to the board' }));

    // Close and play again, as a refresh would.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Play this game' }));
    expect(score('Lions')).toHaveTextContent('100');
    expect(screen.getByRole('button', { name: 'Kings for 100 (played)' })).toBeInTheDocument();
  });
});
