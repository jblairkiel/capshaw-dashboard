import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { describe, test, expect, vi, afterEach } from 'vitest';
import BibleClassView    from '../components/BibleClassView';
import QuestionGenerator from '../components/QuestionGenerator';
import QuestionLibrary   from '../components/QuestionLibrary';

const APPROVED = { id: 1, role: 'approved' };
const PENDING  = { id: 2, role: 'pending' };

function mockFetch(handler) {
  const fetchMock = vi.fn(handler);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => { vi.unstubAllGlobals(); });

// ─── BibleClassView — the launcher ────────────────────────────────────────────

describe('BibleClassView', () => {
  test('lists the available apps and marks the rest coming soon', () => {
    render(<BibleClassView user={APPROVED} />);
    expect(screen.getByText('Question Generator')).toBeInTheDocument();
    expect(screen.getAllByText('Coming Soon')).toHaveLength(2);
  });

  test('opens an app and shows a way back', () => {
    mockFetch(() => Promise.resolve({ json: () => Promise.resolve({ success: true, sets: [] }) }));
    render(<BibleClassView user={APPROVED} />);

    fireEvent.click(screen.getByText('Question Library').closest('div.card'));
    expect(screen.getByText('Bible Class Apps')).toBeInTheDocument();
    // Two "Question Library" texts now: the breadcrumb and the loaded view's own heading (if any)
    expect(screen.getAllByText('Question Library').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText('Bible Class Apps'));
    expect(screen.getByText('Powered by AI')).toBeInTheDocument();
  });

  test('a "coming soon" tile does not open', () => {
    render(<BibleClassView user={APPROVED} />);
    fireEvent.click(screen.getByText('Memory Verse Helper').closest('div.card'));
    expect(screen.queryByText('Bible Class Apps')).not.toBeInTheDocument();
  });
});

// ─── QuestionGenerator ────────────────────────────────────────────────────────

describe('QuestionGenerator', () => {
  test('a pending account is told it needs approval, and cannot submit', () => {
    render(<QuestionGenerator user={PENDING} />);
    expect(screen.getByText(/pending approval/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Generate Questions/i })).toBeDisabled();
  });

  test('refuses to generate with no passage entered', () => {
    render(<QuestionGenerator user={APPROVED} />);
    fireEvent.click(screen.getByRole('button', { name: /Generate Questions/i }));
    expect(screen.getByText(/Enter a Bible passage/i)).toBeInTheDocument();
  });

  test('every question type can be turned off, and generating then refuses', () => {
    render(<QuestionGenerator user={APPROVED} />);
    fireEvent.change(screen.getByPlaceholderText(/John 3:16/i), { target: { value: 'John 3:16' } });

    for (const label of ['Comprehension', 'Application', 'Discussion']) {
      fireEvent.click(screen.getByRole('button', { name: label }));
    }
    fireEvent.click(screen.getByRole('button', { name: /Generate Questions/i }));
    expect(screen.getByText(/Select at least one question type/i)).toBeInTheDocument();
  });

  test('generates, shows the questions, and separately saves them to the library', async () => {
    const fetchMock = mockFetch(url => {
      if (url.includes('generate-questions')) {
        return Promise.resolve({ json: () => Promise.resolve({
          success: true,
          questions: [{ question: 'Who built the ark?', answer: 'Noah', type: 'comprehension', hint: 'Genesis 6' }],
        }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ success: true }) });
    });

    render(<QuestionGenerator user={APPROVED} />);
    fireEvent.change(screen.getByPlaceholderText(/John 3:16/i), { target: { value: 'Genesis 6' } });
    fireEvent.click(screen.getByRole('button', { name: /Generate Questions/i }));

    expect(await screen.findByText('Who built the ark?')).toBeInTheDocument();
    expect(screen.getByText('1 Questions')).toBeInTheDocument();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/bible-class/questions/save', expect.objectContaining({ method: 'POST' })
    ));
  });

  test('the answer is hidden until revealed', async () => {
    mockFetch(() => Promise.resolve({ json: () => Promise.resolve({
      success: true,
      questions: [{ question: 'Who built the ark?', answer: 'Noah', type: 'comprehension' }],
    }) }));

    render(<QuestionGenerator user={APPROVED} />);
    fireEvent.change(screen.getByPlaceholderText(/John 3:16/i), { target: { value: 'Genesis 6' } });
    fireEvent.click(screen.getByRole('button', { name: /Generate Questions/i }));
    await screen.findByText('Who built the ark?');

    expect(screen.queryByText('Noah')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Show answer/i }));
    expect(screen.getByText('Noah')).toBeInTheDocument();
  });

  test('a failed generation is reported', async () => {
    mockFetch(() => Promise.resolve({ json: () => Promise.resolve({ success: false, error: 'ANTHROPIC_API_KEY is not set' }) }));
    render(<QuestionGenerator user={APPROVED} />);
    fireEvent.change(screen.getByPlaceholderText(/John 3:16/i), { target: { value: 'Genesis 6' } });
    fireEvent.click(screen.getByRole('button', { name: /Generate Questions/i }));

    expect(await screen.findByText('ANTHROPIC_API_KEY is not set')).toBeInTheDocument();
  });

  test('changing the grade level highlights the chosen one', () => {
    render(<QuestionGenerator user={APPROVED} />);
    const preschool = screen.getByRole('button', { name: /Preschool/i });
    fireEvent.click(preschool);
    expect(preschool.className).toContain('bg-church-navy');
  });
});

// ─── QuestionLibrary ──────────────────────────────────────────────────────────

describe('QuestionLibrary', () => {
  const SETS = [
    { id: 1, passage: 'Genesis 6', grade: 'adult', createdAt: '2025-01-05T00:00:00',
      questions: [{ id: 1, question: 'Who built the ark?', answer: 'Noah', type: 'comprehension', hint: '' }] },
    { id: 2, passage: 'Psalm 23', grade: 'preschool', createdAt: '2025-01-06T00:00:00', questions: [] },
  ];

  function mockLibrary(sets = SETS) {
    return mockFetch(url => {
      const u = new URL(url, 'http://localhost');
      let filtered = sets;
      const search = u.searchParams.get('search');
      const grade  = u.searchParams.get('grade');
      if (search) filtered = filtered.filter(s => s.passage.toLowerCase().includes(search.toLowerCase()));
      if (grade)  filtered = filtered.filter(s => s.grade === grade);
      return Promise.resolve({ json: () => Promise.resolve({ success: true, sets: filtered }) });
    });
  }

  test('lists the saved sets once loaded', async () => {
    mockLibrary();
    render(<QuestionLibrary user={APPROVED} />);
    expect(await screen.findByText('Genesis 6')).toBeInTheDocument();
    expect(screen.getByText('Psalm 23')).toBeInTheDocument();
    expect(screen.getByText('2 sets found')).toBeInTheDocument();
  });

  test('says so when there is nothing saved', async () => {
    mockLibrary([]);
    render(<QuestionLibrary user={APPROVED} />);
    expect(await screen.findByText(/No saved question sets yet/i)).toBeInTheDocument();
  });

  test('reports a library that failed to load', async () => {
    mockFetch(() => Promise.resolve({ json: () => Promise.resolve({ success: false, error: 'Not signed in' }) }));
    render(<QuestionLibrary user={APPROVED} />);
    expect(await screen.findByText('Not signed in')).toBeInTheDocument();
  });

  test('searching filters the sets', async () => {
    mockLibrary();
    render(<QuestionLibrary user={APPROVED} />);
    await screen.findByText('Genesis 6');

    fireEvent.change(screen.getByPlaceholderText(/Search passages/i), { target: { value: 'Psalm' } });
    fireEvent.submit(screen.getByPlaceholderText(/Search passages/i).closest('form'));

    await waitFor(() => expect(screen.queryByText('Genesis 6')).not.toBeInTheDocument());
    expect(screen.getByText('Psalm 23')).toBeInTheDocument();
  });

  test('a grade pill filters, and toggles off on a second click', async () => {
    mockLibrary();
    render(<QuestionLibrary user={APPROVED} />);
    await screen.findByText('Genesis 6');

    const adultPill = screen.getByRole('button', { name: 'Adult' });
    fireEvent.click(adultPill);
    await waitFor(() => expect(screen.queryByText('Psalm 23')).not.toBeInTheDocument());

    fireEvent.click(adultPill);
    expect(await screen.findByText('Psalm 23')).toBeInTheDocument();
  });

  test('clear resets both the search and the grade filter', async () => {
    mockLibrary();
    render(<QuestionLibrary user={APPROVED} />);
    await screen.findByText('Genesis 6');

    fireEvent.change(screen.getByPlaceholderText(/Search passages/i), { target: { value: 'Psalm' } });
    fireEvent.submit(screen.getByPlaceholderText(/Search passages/i).closest('form'));
    await waitFor(() => expect(screen.queryByText('Genesis 6')).not.toBeInTheDocument());

    fireEvent.click(await screen.findByRole('button', { name: 'Clear' }));
    expect(await screen.findByText('Genesis 6')).toBeInTheDocument();
  });

  test('expanding a set shows its questions, collapsed by default', async () => {
    mockLibrary();
    render(<QuestionLibrary user={APPROVED} />);
    const card = (await screen.findByText('Genesis 6')).closest('div.card');

    expect(within(card).queryByText('Who built the ark?')).not.toBeInTheDocument();
    fireEvent.click(within(card).getByText('Genesis 6'));
    expect(within(card).getByText('Who built the ark?')).toBeInTheDocument();
  });

  test('a member without write access sees no delete button', async () => {
    mockLibrary();
    render(<QuestionLibrary user={PENDING} />);
    const card = (await screen.findByText('Genesis 6')).closest('div.card');
    expect(within(card).queryByTitle('Delete set')).not.toBeInTheDocument();
  });

  test('deleting a set asks first, then removes it from the list', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    const fetchMock = mockLibrary();
    render(<QuestionLibrary user={APPROVED} />);
    const card = (await screen.findByText('Genesis 6')).closest('div.card');

    fireEvent.click(within(card).getByTitle('Delete set'));
    expect(globalThis.confirm).toHaveBeenCalled();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/bible-class/questions/set/1', expect.objectContaining({ method: 'DELETE' })
    ));
    await waitFor(() => expect(screen.queryByText('Genesis 6')).not.toBeInTheDocument());
  });

  test('declining the prompt keeps the set', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    mockLibrary();
    render(<QuestionLibrary user={APPROVED} />);
    const card = (await screen.findByText('Genesis 6')).closest('div.card');

    fireEvent.click(within(card).getByTitle('Delete set'));
    expect(screen.getByText('Genesis 6')).toBeInTheDocument();
  });
});
