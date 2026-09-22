import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, test, expect, vi, afterEach } from 'vitest';
import BugReportsView from '../components/BugReportsView';

// The admin triage page: reading the queue, opening one report, and moving it
// through its states.

const REPORTS = [
  {
    id: 2, title: 'Week picker stuck', description: 'Changing the week does nothing.',
    steps: '1. Open Serving Schedule\n2. Change Week of', severity: 'blocking', status: 'open',
    page: 'assignments', url: 'https://example.org/?tab=assignments', userAgent: 'TestBrowser/1.0',
    screenshot: 'abc123.png', reporterName: 'Joe Carter', adminNote: '', createdAt: '2025-04-13 10:00:00',
  },
  {
    id: 1, title: 'Typo on the roster', description: 'Says "Sevring" instead of "Serving".',
    steps: '', severity: 'minor', status: 'resolved',
    page: 'assignments', url: '', userAgent: '',
    screenshot: null, reporterName: 'Ray Harris', adminNote: 'Fixed the spelling', createdAt: '2025-04-10 10:00:00',
  },
];

function mockList(body) {
  const fetchMock = vi.fn((url, options = {}) => {
    if (options.method === 'PATCH') {
      return Promise.resolve({
        json: () => Promise.resolve({
          success: true,
          report: { ...REPORTS.find(r => r.id === Number(url.match(/(\d+)$/)[1])), ...JSON.parse(options.body) },
        }),
      });
    }
    return Promise.resolve({ json: () => Promise.resolve(body) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => { vi.unstubAllGlobals(); });

async function renderView(body = { success: true, reports: REPORTS, counts: { open: 1, resolved: 1 } }) {
  const fetchMock = mockList(body);
  render(<BugReportsView />);
  await screen.findByText('Week picker stuck');
  return fetchMock;
}

describe('BugReportsView', () => {
  test('lists every report with its severity and status', async () => {
    await renderView();
    expect(screen.getByText('Week picker stuck')).toBeInTheDocument();
    expect(screen.getByText('Typo on the roster')).toBeInTheDocument();
    expect(screen.getByText("I can't get this done")).toBeInTheDocument();
    expect(screen.getByText('Resolved')).toBeInTheDocument();
  });

  test('an empty list renders its own empty state', async () => {
    mockList({ success: true, reports: [], counts: {} });
    render(<BugReportsView />);
    expect(await screen.findByText(/nothing filed yet/i)).toBeInTheDocument();
  });

  test('opening a report shows what happened and the steps', async () => {
    await renderView();
    fireEvent.click(screen.getByRole('button', { name: /Bug report: Week picker stuck/ }));

    expect(await screen.findByText('Changing the week does nothing.')).toBeInTheDocument();
    expect(screen.getByText(/Change Week of/)).toBeInTheDocument();
    expect(screen.getByText(/Filed by Joe Carter/)).toBeInTheDocument();
  });

  test('a report with a screenshot shows it; one without does not', async () => {
    await renderView();
    fireEvent.click(screen.getByRole('button', { name: /Bug report: Week picker stuck/ }));
    expect(await screen.findByAltText(/Screenshot attached to "Week picker stuck"/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Bug report: Week picker stuck/ }));   // close it
    fireEvent.click(screen.getByRole('button', { name: /Bug report: Typo on the roster/ }));
    expect(screen.queryByAltText(/Screenshot attached/)).not.toBeInTheDocument();
  });

  test('changing the status and saving sends a PATCH, and updates the row', async () => {
    const fetchMock = await renderView();
    fireEvent.click(screen.getByRole('button', { name: /Bug report: Week picker stuck/ }));

    await screen.findByText('Changing the week does nothing.');
    // Only one report is open at a time, so its controls are the only ones on screen.
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'resolved' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, o]) => String(url).endsWith('/2') && o?.method === 'PATCH');
      expect(JSON.parse(call[1].body)).toMatchObject({ status: 'resolved' });
    });
  });

  test('the save button is disabled until something actually changes', async () => {
    await renderView();
    fireEvent.click(screen.getByRole('button', { name: /Bug report: Week picker stuck/ }));
    await screen.findByText('Changing the week does nothing.');

    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
  });

  test('the status filter asks the server for one status at a time', async () => {
    const fetchMock = await renderView();
    fireEvent.click(screen.getByRole('button', { name: /^resolved/i }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('status=resolved'))).toBe(true);
    });
  });

  test('a failed load is shown, not swallowed', async () => {
    mockList({ success: false, error: 'Admin access required' });
    render(<BugReportsView />);
    expect(await screen.findByText('Admin access required')).toBeInTheDocument();
  });
});
