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

const PREVIEW = {
  success: true, dryRun: true, found: 254, added: 0, alreadyOnFile: 2,
  first: '2021-10-03', last: '2026-08-30', total: 2303600, statedTotal: 2303600,
  amountColumn: 'Income Giving', warnings: [],
};

function mockApi({ records = RECORDS, preview = PREVIEW, imported } = {}) {
  const fetchMock = vi.fn((url, options) => {
    if (String(url) === '/api/contributions/import') {
      const body = JSON.parse(options.body);
      const result = body.dryRun ? preview : (imported || { ...preview, dryRun: false, added: 252 });
      return Promise.resolve({ json: () => Promise.resolve(result) });
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

  test('this year is set against the same weeks of last year, not the whole of it', async () => {
    mockApi({ records: [
      { id: 1, date: '2026-03-01', amount: 1000 },
      { id: 2, date: '2025-02-01', amount: 800 },
      { id: 3, date: '2025-12-01', amount: 5000 },   // after March last year: not compared yet
    ] });
    render(<ContributionsView user={MEMBER} />);
    expect(await screen.findByText('+25.0%')).toBeInTheDocument();
    expect(screen.getByText('Vs. 2025 to date')).toBeInTheDocument();
  });

  test('only the contributions area is offered the write controls', async () => {
    mockApi();
    const { unmount } = render(<ContributionsView user={MEMBER} />);
    await screen.findByText('Weekly entries');
    expect(screen.queryByRole('button', { name: /record this week/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/import csv/i)).not.toBeInTheDocument();
    unmount();

    mockApi();
    render(<ContributionsView user={COUNTER} />);
    expect(await screen.findByRole('button', { name: /record this week/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/import csv/i)).toBeInTheDocument();
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

  function pickFile(text = 'csv', name = 'finances.csv') {
    const input = screen.getByLabelText(/import csv/i);
    fireEvent.change(input, { target: { files: [new File([text], name, { type: 'text/csv' })] } });
  }

  test('choosing a CSV shows what it holds before anything is saved', async () => {
    const fetchMock = mockApi();
    render(<ContributionsView user={COUNTER} />);
    await screen.findByText('Weekly entries');
    pickFile('"","Income"', 'finances.csv');

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('254')).toBeInTheDocument();
    expect(within(dialog).getByText(/Oct 3, 2021 to Aug 30, 2026/)).toBeInTheDocument();
    expect(within(dialog).getByText(/matches the file.s own total/)).toBeInTheDocument();
    expect(within(dialog).getByText(/2 of these weeks are already on file/)).toBeInTheDocument();

    const posts = fetchMock.mock.calls.filter(([url]) => url === '/api/contributions/import');
    expect(posts).toHaveLength(1);
    expect(JSON.parse(posts[0][1].body)).toEqual({ csv: '"","Income"', filename: 'finances.csv', dryRun: true });
  });

  test('confirming imports the file and reports what was added', async () => {
    const fetchMock = mockApi();
    render(<ContributionsView user={COUNTER} />);
    await screen.findByText('Weekly entries');
    pickFile();

    fireEvent.click(await screen.findByRole('button', { name: /import 252 weeks/i }));

    expect(await screen.findByText(/Imported 252 weeks of contributions — 2 already on file were left as they were/)).toBeInTheDocument();
    const saved = fetchMock.mock.calls.filter(([url, o]) => url === '/api/contributions/import' && !JSON.parse(o.body).dryRun);
    expect(saved).toHaveLength(1);
  });

  test('a file that cannot be read says why, and opens nothing', async () => {
    mockApi({ preview: { success: false, error: 'No weekly totals could be read from this file.' } });
    render(<ContributionsView user={COUNTER} />);
    await screen.findByText('Weekly entries');
    pickFile();

    expect(await screen.findByText(/No weekly totals could be read from this file/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
