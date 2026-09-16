import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { describe, test, expect, vi, afterEach } from 'vitest';
import LessonPlanner from '../components/LessonPlanner';

const APPROVED = { id: 1, role: 'approved' };
const PENDING  = { id: 2, role: 'pending' };

const PLAN = {
  title: 'Noah Trusts and Obeys',
  objectives: ['Students will retell the flood account'],
  materials: ['Bibles'],
  memoryVerse: { reference: 'Genesis 6:22', text: 'Noah did everything just as God commanded him.' },
  sections: [
    { title: 'Warm-up', duration: 5,  type: 'opener',    content: 'Ask about big storms.', items: ['Q1'] },
    { title: 'Read it', duration: 35, type: 'scripture', content: 'Read Genesis 6-9.', items: ['Gen 6'], teacherNote: 'Slow down here.' },
    { title: 'Send-off', duration: 5, type: 'closing',   content: 'Pray and recite the verse.', items: ['Verse'] },
  ],
};

function mockFetch(handler) {
  const fetchMock = vi.fn(handler);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function generatePlan(user = APPROVED) {
  mockFetch(url => {
    if (url.includes('/generate')) return Promise.resolve({ json: () => Promise.resolve({ success: true, plan: PLAN }) });
    return Promise.resolve({ json: () => Promise.resolve({ success: true, id: 42 }) });
  });
  render(<LessonPlanner user={user} />);
  fireEvent.change(screen.getByPlaceholderText(/John 3:1/i), { target: { value: 'Genesis 6-9' } });
  fireEvent.click(screen.getByRole('button', { name: /Generate Lesson Plan/i }));
  await screen.findByText('Noah Trusts and Obeys');
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('LessonPlanner — setup', () => {
  test('a pending account is told it needs approval, and cannot submit', () => {
    render(<LessonPlanner user={PENDING} />);
    expect(screen.getByText(/pending approval/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Generate Lesson Plan/i })).toBeDisabled();
  });

  test('refuses to generate with no passage', () => {
    render(<LessonPlanner user={APPROVED} />);
    fireEvent.click(screen.getByRole('button', { name: /Generate Lesson Plan/i }));
    expect(screen.getByText(/Enter a Bible passage or topic/i)).toBeInTheDocument();
  });

  test('turning off every focus area refuses to generate', () => {
    render(<LessonPlanner user={APPROVED} />);
    fireEvent.change(screen.getByPlaceholderText(/John 3:1/i), { target: { value: 'Genesis 6' } });
    for (const label of ['Scripture Study', 'Discussion', 'Life Application']) {
      fireEvent.click(screen.getByText(label).closest('button'));
    }
    fireEvent.click(screen.getByRole('button', { name: /Generate Lesson Plan/i }));
    expect(screen.getByText(/Select at least one focus area/i)).toBeInTheDocument();
  });

  test('a failed generation is reported and stays on setup', async () => {
    mockFetch(() => Promise.resolve({ json: () => Promise.resolve({ success: false, error: 'ANTHROPIC_API_KEY is not configured' }) }));
    render(<LessonPlanner user={APPROVED} />);
    fireEvent.change(screen.getByPlaceholderText(/John 3:1/i), { target: { value: 'Genesis 6' } });
    fireEvent.click(screen.getByRole('button', { name: /Generate Lesson Plan/i }));

    expect(await screen.findByText('ANTHROPIC_API_KEY is not configured')).toBeInTheDocument();
    expect(screen.getByText('Lesson Planner')).toBeInTheDocument();
  });
});

describe('LessonPlanner — the generated plan', () => {
  test('shows the plan header, objectives, materials and memory verse', async () => {
    await generatePlan();
    expect(screen.getByText('📖 Genesis 6-9')).toBeInTheDocument();
    expect(screen.getByText(/Upper Elementary/)).toBeInTheDocument();
    expect(screen.getByText('⏱ 45 min')).toBeInTheDocument();
    expect(screen.getByText('Students will retell the flood account')).toBeInTheDocument();
    expect(screen.getByText('Bibles')).toBeInTheDocument();
    expect(screen.getByText(/Noah did everything just as God commanded him/)).toBeInTheDocument();
  });

  test('renders every section of the lesson flow, in order', async () => {
    await generatePlan();
    const headings = screen.getAllByText(/Warm-up|Read it|Send-off/);
    expect(headings.map(h => h.textContent)).toEqual(['Warm-up', 'Read it', 'Send-off']);
    expect(screen.getByText('Read Genesis 6-9.')).toBeInTheDocument();
  });

  test('a teacher note is collapsed until opened', async () => {
    // A second copy of the note always exists for print (CSS hides it on screen,
    // which jsdom does not honor), so only the toggled copy is asserted on here.
    await generatePlan();
    expect(screen.getAllByText(/Slow down here/)).toHaveLength(1);
    fireEvent.click(screen.getByText('Teacher note'));
    expect(screen.getAllByText(/Slow down here/)).toHaveLength(2);
  });

  test('flags when the section durations do not add to the requested length', async () => {
    // Sections sum to 45, which matches the default duration, so change duration first
    mockFetch(url => Promise.resolve({ json: () => Promise.resolve(
      url.includes('/generate') ? { success: true, plan: PLAN } : { success: true, id: 1 }
    ) }));
    render(<LessonPlanner user={APPROVED} />);
    fireEvent.click(screen.getByRole('button', { name: '60 min' }));
    fireEvent.change(screen.getByPlaceholderText(/John 3:1/i), { target: { value: 'Genesis 6' } });
    fireEvent.click(screen.getByRole('button', { name: /Generate Lesson Plan/i }));

    await screen.findByText('Noah Trusts and Obeys');
    expect(screen.getByText('(sections: 45 min)')).toBeInTheDocument();
  });

  test('going back returns to the setup form', async () => {
    await generatePlan();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Lesson Planner')).toBeInTheDocument();
  });

  test('saves the plan to the library and then shows it as saved', async () => {
    const fetchMock = mockFetch(url => Promise.resolve({ json: () => Promise.resolve(
      url.includes('/generate') ? { success: true, plan: PLAN } : { success: true, id: 42 }
    ) }));
    render(<LessonPlanner user={APPROVED} />);
    fireEvent.change(screen.getByPlaceholderText(/John 3:1/i), { target: { value: 'Genesis 6-9' } });
    fireEvent.click(screen.getByRole('button', { name: /Generate Lesson Plan/i }));
    await screen.findByText('Noah Trusts and Obeys');

    fireEvent.click(screen.getByRole('button', { name: /Save to Library/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/lesson-planner/save', expect.objectContaining({ method: 'POST' })
    ));
    expect(await screen.findByText('Saved to library')).toBeInTheDocument();
  });

  test('a pending account sees no save button on an opened saved plan', async () => {
    mockFetch(url => {
      if (url === '/api/lesson-planner') return Promise.resolve({ json: () => Promise.resolve({
        success: true,
        plans: [{ id: 1, title: 'Noah Trusts and Obeys', passage: 'Genesis 6-9', grade: 'adult', duration: 45, created_at: '2025-01-05T00:00:00' }],
      }) });
      return Promise.resolve({ json: () => Promise.resolve({
        success: true,
        plan: { id: 1, passage: 'Genesis 6-9', grade: 'adult', duration: 45, focuses: 'scripture', plan: PLAN },
      }) });
    });

    render(<LessonPlanner user={PENDING} />);
    fireEvent.click(screen.getByRole('button', { name: /Saved Plans/i }));
    fireEvent.click(await screen.findByText('Noah Trusts and Obeys'));

    await screen.findByText('📖 Genesis 6-9');
    expect(screen.queryByRole('button', { name: /Save to Library/i })).not.toBeInTheDocument();
  });
});

describe('LessonPlanner — saved plans library', () => {
  const SAVED = [
    { id: 1, title: 'Noah Trusts and Obeys', passage: 'Genesis 6-9', grade: 'adult', duration: 45, created_at: '2025-01-05T00:00:00' },
    { id: 2, title: 'The Good Shepherd',     passage: 'Psalm 23',   grade: 'preschool', duration: 30, created_at: '2025-01-06T00:00:00' },
  ];

  test('lists saved plans', async () => {
    mockFetch(() => Promise.resolve({ json: () => Promise.resolve({ success: true, plans: SAVED }) }));
    render(<LessonPlanner user={APPROVED} />);
    fireEvent.click(screen.getByRole('button', { name: /Saved Plans/i }));

    expect(await screen.findByText('Noah Trusts and Obeys')).toBeInTheDocument();
    expect(screen.getByText('2 saved plans')).toBeInTheDocument();
  });

  test('says so when there are no saved plans', async () => {
    mockFetch(() => Promise.resolve({ json: () => Promise.resolve({ success: true, plans: [] }) }));
    render(<LessonPlanner user={APPROVED} />);
    fireEvent.click(screen.getByRole('button', { name: /Saved Plans/i }));
    expect(await screen.findByText(/No saved lesson plans yet/i)).toBeInTheDocument();
  });

  test('opening a saved plan loads and displays it', async () => {
    const fetchMock = mockFetch(url => {
      if (url === '/api/lesson-planner') return Promise.resolve({ json: () => Promise.resolve({ success: true, plans: SAVED }) });
      // GET /api/lesson-planner/:id nests the generated plan under `plan`,
      // alongside the row's own passage/grade/duration/focuses.
      return Promise.resolve({ json: () => Promise.resolve({
        success: true,
        plan: { id: 1, passage: 'Genesis 6-9', grade: 'adult', duration: 45, focuses: 'scripture', plan: PLAN },
      }) });
    });
    render(<LessonPlanner user={APPROVED} />);
    fireEvent.click(screen.getByRole('button', { name: /Saved Plans/i }));
    fireEvent.click(await screen.findByText('Noah Trusts and Obeys'));

    expect(await screen.findByText('Saved to library')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/lesson-planner/1');
  });

  test('deleting a saved plan asks first, then removes it', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    const fetchMock = mockFetch(() => Promise.resolve({ json: () => Promise.resolve({ success: true, plans: SAVED }) }));
    render(<LessonPlanner user={APPROVED} />);
    fireEvent.click(screen.getByRole('button', { name: /Saved Plans/i }));
    await screen.findByText('Noah Trusts and Obeys');

    fireEvent.click(screen.getAllByTitle('Delete')[0]);
    expect(globalThis.confirm).toHaveBeenCalled();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/lesson-planner/1', expect.objectContaining({ method: 'DELETE' })
    ));
    await waitFor(() => expect(screen.queryByText('Noah Trusts and Obeys')).not.toBeInTheDocument());
  });

  test('a member without write access sees no delete button', async () => {
    mockFetch(() => Promise.resolve({ json: () => Promise.resolve({ success: true, plans: SAVED }) }));
    render(<LessonPlanner user={PENDING} />);
    fireEvent.click(screen.getByRole('button', { name: /Saved Plans/i }));
    await screen.findByText('Noah Trusts and Obeys');
    expect(screen.queryByTitle('Delete')).not.toBeInTheDocument();
  });

  test('reports a library that failed to load', async () => {
    mockFetch(() => Promise.resolve({ json: () => Promise.resolve({ success: false, error: 'Not signed in' }) }));
    render(<LessonPlanner user={APPROVED} />);
    fireEvent.click(screen.getByRole('button', { name: /Saved Plans/i }));
    expect(await screen.findByText('Not signed in')).toBeInTheDocument();
  });

  test('back from the library returns to setup', async () => {
    mockFetch(() => Promise.resolve({ json: () => Promise.resolve({ success: true, plans: [] }) }));
    render(<LessonPlanner user={APPROVED} />);
    fireEvent.click(screen.getByRole('button', { name: /Saved Plans/i }));
    await screen.findByText(/No saved lesson plans yet/i);

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Lesson Planner')).toBeInTheDocument();
  });
});
