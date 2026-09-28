import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import ContributionsView from '../components/ContributionsView';

// A fixed "now" so the analytics tiles (this year, this month) are computed
// against a known date rather than whatever day the suite happens to run.
const NOW = new Date('2026-06-15T12:00:00');

const RECORDS = [
  { id: 1, date: '2026-06-07', amount: 4200 },
  { id: 2, date: '2026-01-04', amount: 5000 },
  { id: 3, date: '2025-06-08', amount: 3800 },
];

const COUNTER = { id: 2, role: 'approved', areas: ['contributions'] };
const ADMIN   = { id: 1, role: 'admin' };
const MEMBER  = { id: 3, role: 'approved', areas: [] };

function mockApi({ records = RECORDS, importResult } = {}) {
  const fetchMock = vi.fn((url, options) => {
    if (String(url).includes('/import-contributions')) {
      return Promise.resolve({
        json: () => Promise.resolve(importResult || { success: true, found: 2, added: 1, warnings: [] }),
      });
    }
    if (options?.method) return Promise.resolve({ json: () => Promise.resolve({ success: true, row: {} }) });
    return Promise.resolve({ json: () => Promise.resolve({ success: true, rows: records }) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('ContributionsView', () => {
  test('shows the empty state with nothing recorded yet', async () => {
    mockApi({ records: [] });
    render(<ContributionsView user={MEMBER} />);
    expect(await screen.findByText(/No contributions recorded yet/i)).toBeInTheDocument();
  });

  test('shows analytics before the raw list of weeks', async () => {
    mockApi();
    render(<ContributionsView user={MEMBER} />);

    expect(await screen.findByText('$9,200')).toBeInTheDocument(); // 2026 so far: 4200 + 5000
    expect(screen.getByText('This month')).toBeInTheDocument();
    expect(screen.getByText('Average per week')).toBeInTheDocument();
    expect(screen.getByText(/Vs\. 2025/)).toBeInTheDocument();

    // The weekly entries table is still there, just below the analytics.
    expect(screen.getByText('Weekly entries')).toBeInTheDocument();
    expect(screen.getByText('2026-06-07')).toBeInTheDocument();
  });

  test('only the contributions area is offered the write controls', async () => {
    mockApi();
    const { unmount } = render(<ContributionsView user={MEMBER} />);
    await screen.findByText('Weekly entries');
    expect(screen.queryByRole('button', { name: /record this week/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /import from old site/i })).not.toBeInTheDocument();
    unmount();

    mockApi();
    render(<ContributionsView user={COUNTER} />);
    expect(await screen.findByRole('button', { name: /record this week/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /import from old site/i })).toBeInTheDocument();
  });

  test('an admin gets the write controls too', async () => {
    mockApi();
    render(<ContributionsView user={ADMIN} />);
    expect(await screen.findByRole('button', { name: /record this week/i })).toBeInTheDocument();
  });

  test('recording a week posts the date and amount', async () => {
    const fetchMock = mockApi();
    render(<ContributionsView user={COUNTER} />);
    fireEvent.click(await screen.findByRole('button', { name: /record this week/i }));

    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/week of/i), { target: { value: '2026-06-21' } });
    fireEvent.change(within(dialog).getByLabelText(/total contribution/i), { target: { value: '4500' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, o]) => String(url) === '/api/records/contributions' && o?.method === 'POST');
      expect(JSON.parse(call[1].body)).toEqual({ date: '2026-06-21', amount: 4500 });
    });
  });

  test('importing reports what the old site had and how many weeks were new', async () => {
    mockApi({ importResult: { success: true, found: 12, added: 3, warnings: [] } });
    render(<ContributionsView user={COUNTER} />);
    fireEvent.click(await screen.findByRole('button', { name: /import from old site/i }));

    expect(await screen.findByText(/Found 12 weeks on the old site — added 3 new\./i)).toBeInTheDocument();
  });

  test('an import that reads nothing says why, rather than only counting warnings', async () => {
    mockApi({ importResult: {
      success: true, found: 0, added: 0,
      warnings: ['contributions: asking for /members/finances landed on /members instead — the account the scraper signs in with may not be allowed to see the finances page'],
    } });
    render(<ContributionsView user={COUNTER} />);
    fireEvent.click(await screen.findByRole('button', { name: /import from old site/i }));

    expect(await screen.findByText(/Nothing could be read from the old site’s finances page/i)).toBeInTheDocument();
    expect(screen.getByText(/landed on \/members instead/)).toBeInTheDocument();
  });
});
