import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import CalendarView from '../components/CalendarView';

// A fixed month so the grid and the "today" highlight are predictable.
const NOW = new Date(2026, 4, 15); // 15 May 2026

const EVENT = {
  id: 1, type: 'event', title: 'Fellowship Breakfast', body: '',
  event_date: '2026-05-09', event_time: '8:00 AM', location: 'Fellowship Hall',
  priority: 'normal', active: 1, created_at: '',
};

// An announcement with no date must never reach the grid.
const UNDATED = { ...EVENT, id: 2, type: 'announcement', title: 'VBS Registration', event_date: null };

function mockApi(items = [EVENT, UNDATED], overrides = {}) {
  const fetchMock = vi.fn((url, options) => {
    if (options?.method && options.method !== 'GET') {
      return Promise.resolve({ json: () => Promise.resolve(overrides.write ?? { success: true }) });
    }
    return Promise.resolve({ json: () => Promise.resolve(overrides.read ?? { success: true, items }) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  mockApi();
});

describe('CalendarView', () => {
  test('reads its events from the announcements API', async () => {
    const fetchMock = mockApi();
    render(<CalendarView user={{ role: 'admin' }} />);
    await screen.findByText(/Fellowship Breakfast/);
    expect(fetchMock).toHaveBeenCalledWith('/api/announcements', expect.anything());
  });

  test('shows the current month and its dated events', async () => {
    render(<CalendarView user={{ role: 'admin' }} />);
    expect(await screen.findByText('May 2026')).toBeInTheDocument();
    expect(screen.getByText(/Fellowship Breakfast/)).toBeInTheDocument();
  });

  test('leaves undated announcements off the grid', async () => {
    render(<CalendarView user={{ role: 'admin' }} />);
    await screen.findByText(/Fellowship Breakfast/);
    expect(screen.queryByText(/VBS Registration/)).not.toBeInTheDocument();
  });

  test('counts only the events in the month on show', async () => {
    render(<CalendarView user={{ role: 'admin' }} />);
    expect(await screen.findByText(/1 event this month/)).toBeInTheDocument();
  });

  test('moving to another month leaves that month empty', async () => {
    render(<CalendarView user={{ role: 'admin' }} />);
    await screen.findByText(/Fellowship Breakfast/);
    fireEvent.click(screen.getByLabelText('Next month'));

    expect(screen.getByText('June 2026')).toBeInTheDocument();
    expect(screen.queryByText(/Fellowship Breakfast/)).not.toBeInTheDocument();
    expect(screen.getByText(/0 events this month/)).toBeInTheDocument();
  });

  test('Today returns to the current month', async () => {
    render(<CalendarView user={{ role: 'admin' }} />);
    await screen.findByText(/Fellowship Breakfast/);
    fireEvent.click(screen.getByLabelText('Previous month'));
    expect(screen.getByText('April 2026')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(screen.getByText('May 2026')).toBeInTheDocument();
  });

  // ─── Editing writes back to announcements ──────────────────────────────────

  test('an admin editing an event PUTs it to the announcements API', async () => {
    const fetchMock = mockApi();
    render(<CalendarView user={{ role: 'admin' }} />);
    fireEvent.click(await screen.findByText(/Fellowship Breakfast/));

    const dialog = screen.getByRole('button', { name: 'Save' }).closest('form');
    fireEvent.change(within(dialog).getByLabelText(/^Title/), { target: { value: 'Men’s Breakfast' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(c => c[1]?.method === 'PUT');
      expect(put[0]).toBe('/api/announcements/1');
      expect(JSON.parse(put[1].body).title).toBe('Men’s Breakfast');
    });
  });

  test('clicking a day opens a new event already dated for that day', async () => {
    const fetchMock = mockApi();
    render(<CalendarView user={{ role: 'admin' }} />);
    await screen.findByText(/Fellowship Breakfast/);

    fireEvent.click(screen.getByText('21'));
    const dialog = screen.getByRole('button', { name: 'Save' }).closest('form');
    fireEvent.change(within(dialog).getByLabelText(/^Title/), { target: { value: 'Elders Meeting' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c => c[1]?.method === 'POST');
      expect(post[0]).toBe('/api/announcements');
      const sent = JSON.parse(post[1].body);
      expect(sent.event_date).toBe('2026-05-21');
      expect(sent.type).toBe('event');
    });
  });

  // The input is marked `required`, so the browser stops a genuinely empty
  // title. Whitespace slips past that and is caught in the handler instead.
  test('a whitespace-only title is rejected rather than saved', async () => {
    const fetchMock = mockApi();
    render(<CalendarView user={{ role: 'admin' }} />);
    await screen.findByText(/Fellowship Breakfast/);

    fireEvent.click(screen.getByText('21'));
    const dialog = screen.getByRole('button', { name: 'Save' }).closest('form');
    fireEvent.change(within(dialog).getByLabelText(/^Title/), { target: { value: '   ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/a title is required/i)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(c => c[1]?.method === 'POST')).toBe(false);
  });

  // ─── Read-only for everyone else ───────────────────────────────────────────

  test('a member gets no add button and cannot open the editor', async () => {
    render(<CalendarView user={{ role: 'approved' }} />);
    await screen.findByText(/Fellowship Breakfast/);

    expect(screen.queryByRole('button', { name: 'Add event' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/Fellowship Breakfast/));
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.getByText(/ask an admin to add or change one/i)).toBeInTheDocument();
  });

  test('surfaces a load failure instead of an empty grid', async () => {
    mockApi([], { read: { success: false, error: 'Database is away' } });
    render(<CalendarView user={{ role: 'admin' }} />);
    expect(await screen.findByText('Database is away')).toBeInTheDocument();
  });
});
