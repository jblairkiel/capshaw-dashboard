import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import StadiumGame from '../components/StadiumGame';

const APPROVED = { id: 1, role: 'approved' };
const PENDING  = { id: 2, role: 'pending' };

function mockApi(overrides = {}) {
  const routes = {
    customQuestions: { success: true, questions: [] },
    librarySets:      { success: true, sets: [] },
    generate:         { success: true, questions: [] },
    save:             { success: true, question: { id: 9 } },
    remove:           { success: true },
    ...overrides,
  };
  const fetchMock = vi.fn((url, opts = {}) => {
    const method = opts.method || 'GET';
    let body;
    if (url.includes('/game-questions/generate'))       body = routes.generate;
    else if (url === '/api/game-questions' && method === 'GET') body = routes.customQuestions;
    else if (method === 'DELETE')                        body = routes.remove;
    else if (method === 'POST' || method === 'PUT')      body = routes.save;
    else if (url.includes('/bible-class/questions'))     body = routes.librarySets;
    else                                                  body = routes.customQuestions;
    return Promise.resolve({ json: () => Promise.resolve(body) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.stubGlobal('confirm', vi.fn(() => true));
  // Games use Math.random() to size a correct answer's move (2-4 spaces) and
  // to pick the next question; pinning it keeps outcomes deterministic.
  vi.spyOn(Math, 'random').mockReturnValue(0);
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// ─── Setup screen ─────────────────────────────────────────────────────────────

describe('StadiumGame — setup', () => {
  test('starts with two teams named after the presets', () => {
    mockApi();
    render(<StadiumGame user={APPROVED} />);
    expect(screen.getByDisplayValue('Red Eagles')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Blue Lions')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Green Sharks')).not.toBeInTheDocument();
  });

  test('choosing more teams reveals more name fields', () => {
    mockApi();
    render(<StadiumGame user={APPROVED} />);
    fireEvent.click(screen.getByRole('button', { name: '4' }));
    expect(screen.getByDisplayValue('Green Sharks')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Gold Bears')).toBeInTheDocument();
  });

  test('a custom team name is used once the game starts', () => {
    mockApi();
    render(<StadiumGame user={APPROVED} />);
    fireEvent.change(screen.getByDisplayValue('Red Eagles'), { target: { value: 'Sunday School Stars' } });
    fireEvent.click(screen.getByRole('button', { name: /Start the Game/i }));
    expect(screen.getByText(/Sunday School Stars.*Turn/)).toBeInTheDocument();
  });

  test('built-in trivia can start immediately', () => {
    mockApi();
    render(<StadiumGame user={APPROVED} />);
    expect(screen.getByRole('button', { name: /Start the Game/i })).not.toBeDisabled();
  });

  test('the library source is disabled to start until a set is available', async () => {
    mockApi({ librarySets: { success: true, sets: [] } });
    render(<StadiumGame user={APPROVED} />);
    fireEvent.click(screen.getByRole('button', { name: /Library/i }));
    expect(await screen.findByText(/No question sets saved yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start the Game/i })).toBeDisabled();
  });

  test('a library set can be chosen and used to start', async () => {
    mockApi({ librarySets: { success: true, sets: [
      { id: 1, passage: 'Genesis 6', questions: [{ id: 1, question: 'Who built the ark?', answer: 'Noah', type: 'comprehension', hint: '' }] },
    ] } });
    render(<StadiumGame user={APPROVED} />);
    fireEvent.click(screen.getByRole('button', { name: /Library/i }));
    expect(await screen.findByText(/Genesis 6 — 1 Qs/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start the Game/i })).not.toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /Start the Game/i }));
    fireEvent.click(screen.getByRole('button', { name: /Draw a Bible Question/i }));
    expect(screen.getByText('Who built the ark?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /✓ Correct/i })).toBeInTheDocument();
  });

  test('the custom source needs at least one question before starting', async () => {
    mockApi();
    render(<StadiumGame user={APPROVED} />);
    fireEvent.click(screen.getByRole('button', { name: /Custom/i }));
    expect(await screen.findByText(/Add at least one question to start/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start the Game/i })).toBeDisabled();
  });

  test('a pending account cannot add custom questions, only view them', async () => {
    mockApi({ customQuestions: { success: true, questions: [
      { id: 1, type: 'mc', question: 'Who built the ark?', options: ['Noah', 'Moses', 'David', 'Paul'], answer: '0', hint: '' },
    ] } });
    render(<StadiumGame user={PENDING} />);
    fireEvent.click(screen.getByRole('button', { name: /Custom/i }));

    expect(await screen.findByText('Who built the ark?')).toBeInTheDocument();
    expect(screen.getByText(/Pending approval/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add Manually/i })).not.toBeInTheDocument();
  });
});

// ─── Custom question management ───────────────────────────────────────────────

describe('StadiumGame — managing custom questions', () => {
  async function openCustom(routes) {
    const fetchMock = mockApi(routes);
    render(<StadiumGame user={APPROVED} />);
    fireEvent.click(screen.getByRole('button', { name: /Custom/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/game-questions'));
    return fetchMock;
  }

  test('lists existing questions with a type badge', async () => {
    await openCustom({ customQuestions: { success: true, questions: [
      { id: 1, type: 'mc', question: 'Who built the ark?', options: ['Noah', 'Moses', 'David', 'Paul'], answer: '0', hint: '' },
    ] } });
    expect(await screen.findByText('Who built the ark?')).toBeInTheDocument();
    expect(screen.getByText('MC')).toBeInTheDocument();
  });

  test('adding a multiple-choice question saves it and lists it', async () => {
    const fetchMock = await openCustom({
      save: { success: true, question: { id: 5, type: 'mc', question: 'How many disciples?', options: ['10', '11', '12', '13'], answer: '2', hint: '' } },
    });
    fireEvent.click(screen.getByRole('button', { name: /Add Manually/i }));

    fireEvent.change(screen.getByPlaceholderText(/Enter your question/i), { target: { value: 'How many disciples?' } });
    const optionInputs = screen.getAllByPlaceholderText(/Option/i);
    fireEvent.change(optionInputs[0], { target: { value: '10' } });
    fireEvent.change(optionInputs[1], { target: { value: '11' } });
    fireEvent.change(optionInputs[2], { target: { value: '12' } });
    fireEvent.change(optionInputs[3], { target: { value: '13' } });

    fireEvent.click(screen.getByRole('button', { name: /Save Question/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/game-questions', expect.objectContaining({ method: 'POST' })
    ));
    expect(await screen.findByText('How many disciples?')).toBeInTheDocument();
  });

  test('editing an existing question pre-fills its fields', async () => {
    await openCustom({ customQuestions: { success: true, questions: [
      { id: 1, type: 'true-false', question: 'Jonah was swallowed by a whale.', options: null, answer: 'true', hint: '' },
    ] } });
    await screen.findByText('Jonah was swallowed by a whale.');
    fireEvent.click(screen.getByTitle('Edit'));
    expect(screen.getByDisplayValue('Jonah was swallowed by a whale.')).toBeInTheDocument();
  });

  test('deleting a question asks first, then removes it', async () => {
    const fetchMock = await openCustom({ customQuestions: { success: true, questions: [
      { id: 1, type: 'open', question: 'How many days did it rain?', options: null, answer: '40', hint: '' },
    ] } });
    await screen.findByText('How many days did it rain?');

    fireEvent.click(screen.getByTitle('Delete'));
    expect(globalThis.confirm).toHaveBeenCalled();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/game-questions/1', expect.objectContaining({ method: 'DELETE' })
    ));
    await waitFor(() => expect(screen.queryByText('How many days did it rain?')).not.toBeInTheDocument());
  });

  test('generating with AI adds the results to the pool', async () => {
    const fetchMock = await openCustom({
      generate: { success: true, questions: [
        { id: 7, type: 'mc', question: 'Who led Israel out of Egypt?', options: ['Aaron', 'Moses', 'Joshua', 'Caleb'], answer: '1', hint: '' },
      ] },
    });
    fireEvent.click(screen.getByRole('button', { name: /Generate with AI/i }));

    fireEvent.change(screen.getByPlaceholderText(/John 3:1-21/i), { target: { value: 'Exodus' } });
    fireEvent.click(screen.getByRole('button', { name: /Generate Game Questions/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/game-questions/generate', expect.objectContaining({ method: 'POST' })
    ));
    expect(await screen.findByText(/1 questions generated/i)).toBeInTheDocument();
  });

  test('a generation failure is reported', async () => {
    await openCustom({ generate: { success: false, error: 'ANTHROPIC_API_KEY is not configured' } });
    fireEvent.click(screen.getByRole('button', { name: /Generate with AI/i }));
    fireEvent.click(screen.getByRole('button', { name: /Generate Game Questions/i }));
    expect(await screen.findByText(/Enter a passage or topic/i)).toBeInTheDocument();
  });
});

// ─── Playing a round ──────────────────────────────────────────────────────────

describe('StadiumGame — playing', () => {
  function start() {
    mockApi();
    render(<StadiumGame user={APPROVED} />);
    fireEvent.click(screen.getByRole('button', { name: /Start the Game/i }));
  }

  test("shows the first team's turn and lets them draw a question", () => {
    start();
    expect(screen.getByText(/Red Eagles.*Turn/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Draw a Bible Question/i }));

    // The draw button is replaced by a question with four lettered choices
    expect(screen.queryByRole('button', { name: /Draw a Bible Question/i })).not.toBeInTheDocument();
    expect(screen.getByText('A', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('D', { selector: 'span' })).toBeInTheDocument();
  });

  // Clicks whichever lettered choice is currently on screen — A through D —
  // and returns to the caller once the result panel confirms the answer.
  function answerCurrentQuestion() {
    const letter = screen.getByText('A', { selector: 'span' });
    fireEvent.click(letter.closest('button'));
  }

  test('answering moves on to the result panel either way', async () => {
    start();
    fireEvent.click(screen.getByRole('button', { name: /Draw a Bible Question/i }));
    answerCurrentQuestion();

    // The result panel appears after a short pause, not synchronously
    const next = await screen.findByRole('button', { name: /Next Team|Take Another Turn|Final Standings/i });
    fireEvent.click(next);
    expect(screen.queryByRole('button', { name: /Next Team|Take Another Turn|Final Standings/i })).not.toBeInTheDocument();
  });

  test('finishing every turn shows the final standings and can restart', async () => {
    mockApi();
    render(<StadiumGame user={APPROVED} />);
    // Smallest game: 2 teams, 5 rounds each = 10 turns (a "Trophy Spot" extra
    // turn would add more, but with Math.random pinned to 0 the game always
    // advances by the minimum, 2 squares, so no special square is ever hit).
    fireEvent.click(screen.getByRole('button', { name: '5' }));
    fireEvent.click(screen.getByRole('button', { name: /Start the Game/i }));

    for (let turn = 0; turn < 10; turn++) {
      fireEvent.click(screen.getByRole('button', { name: /Draw a Bible Question/i }));
      answerCurrentQuestion();
      fireEvent.click(await screen.findByRole('button', { name: /Next Team|Take Another Turn|Final Standings/i }));
    }

    expect(screen.getByText('Final Standings')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Play Again/i }));
    expect(screen.getByText('Bible Bowl Stadium')).toBeInTheDocument();
  });
});
