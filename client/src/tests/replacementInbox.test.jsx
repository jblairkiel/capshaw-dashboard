import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, test, expect, vi, afterEach } from 'vitest';
import InboxView from '../components/InboxView';

// A replacement request in My Inbox suggests who could take the slot, and
// choosing one settles it as "Someone else is taking it" with that name.

const TASK = {
  taskId: 9, instanceId: 4, definitionId: 'serving-replacement', workflow: 'Replacement on the Serving Schedule', page: 'assignments',
  title: 'Replace Joe Carter: Song Leader, June 7, Sunday Worship', stepId: 'find-replacement', stepTitle: 'Find a replacement',
  instruction: '', assignedRole: 'serving-schedule', createdAt: '2026-06-01 10:00:00',
  actions: [
    { id: 'replaced', label: 'Someone else is taking it', tone: 'good', requiresNote: true, notePrompt: 'Who is taking it?' },
    { id: 'leave-open', label: 'Leave the slot open', tone: 'neutral', requiresNote: false, notePrompt: '' },
  ],
  context: { slotId: 31, job: 'Song Leader', date: 'June 7', month: 'June 2026', service: 'Sunday Worship', currentName: 'Joe Carter', reason: 'Out of town' },
};

const CANDIDATES = [
  { id: 1, name: 'Joe Carter', level: 'preferred', free: true, current: true, turns: 2, away: null, busy: false },
  { id: 2, name: 'Ray Harris', level: 'preferred', free: true, current: false, turns: 0, away: null, busy: false },
  { id: 3, name: 'Bill Shaw', level: 'willing', free: true, current: false, turns: 1, away: null, busy: false },
  { id: 4, name: 'Ned Poole', level: 'preferred', free: false, current: false, turns: 0, away: { startsOn: '2026-06-06', endsOn: '2026-06-08' }, busy: false },
  { id: 5, name: 'Al Adams', level: '', free: true, current: false, turns: 0, away: null, busy: false },
];

function mockApi({ tasks = [TASK], candidates = CANDIDATES } = {}) {
  const fetchMock = vi.fn(url => {
    let body = { success: true };
    if (url === '/api/workflows/inbox') body = { success: true, tasks };
    else if (url === '/api/workflows/pages') body = { success: true, pages: [{ id: 'assignments', label: 'Service Roster' }] };
    else if (String(url).includes('/candidates')) body = { success: true, candidates };
    else if (String(url).startsWith('/api/workflows/tasks/')) body = { success: true };
    return Promise.resolve({ json: () => Promise.resolve(body) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('a replacement request in My Inbox', () => {
  test('shows why, and the best fits for the slot — never the man asking, nobody away, nobody who has not said', async () => {
    const fetchMock = mockApi();
    render(<InboxView />);
    expect(await screen.findByText(/Out of town/)).toBeInTheDocument();
    const list = await screen.findByRole('list', { name: 'Who could take Song Leader' });
    expect(within(list).getAllByRole('button').map(b => b.getAttribute('aria-label'))).toEqual(['Put Ray Harris in', 'Put Bill Shaw in']);
    expect(within(list).getByText('Willing · 1 turn this month')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/serving/assignments/31/candidates')).toBe(true);
  });

  test('choosing one settles the request with his name', async () => {
    const fetchMock = mockApi();
    render(<InboxView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Put Bill Shaw in' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/workflows/tasks/9',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ action: 'replaced', note: 'Bill Shaw' }) })));
  });

  test('with nobody free who has said so, it says to type a name instead', async () => {
    mockApi({ candidates: CANDIDATES.filter(c => c.current || !c.free || !c.level) });
    render(<InboxView />);
    expect(await screen.findByText(/Nobody free that day has said they will do Song Leader/)).toBeInTheDocument();
  });

  test('other kinds of task get no suggestions', async () => {
    const fetchMock = mockApi({ tasks: [{ ...TASK, definitionId: 'visitor-follow-up', context: null }] });
    render(<InboxView />);
    await screen.findByText(TASK.title);
    expect(screen.queryByText('Who could take it')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/candidates'))).toBe(false);
  });
});
