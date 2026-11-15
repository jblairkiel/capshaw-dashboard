import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { describe, test, expect, vi, afterEach } from 'vitest';
import ReportsPage from '../components/reports/ReportsPage';
import REPORT from './fixtures/weeklyReport.json';

// Reports & Record Keeping: each tab for whoever holds its area, the two weekly
// reports drawn from the same figures as the emailed PDFs, any week, and the
// admin's settings for when they are sent. The figures are a real report built
// from the made-up sample data (server/lib/weeklyReport.js).

const SETTINGS = [
  { kind: 'summary', title: 'Weekly Summary', weekday: 0, time: '15:00', enabled: true, lastSent: null },
  { kind: 'analytical', title: 'Weekly Analytical Report', weekday: 0, time: '15:00', enabled: true, lastSent: null },
];

function mockApi({ reports = ['summary', 'analytical'], admin = false, onPut } = {}) {
  const titles = { summary: 'Weekly Summary', analytical: 'Weekly Analytical Report' };
  const fetchMock = vi.fn((url, options = {}) => {
    const u = String(url);
    let body;
    if (u === '/api/reports') body = { success: true, reports: reports.map(kind => ({ kind, title: titles[kind] })), canManage: admin, settings: admin ? SETTINGS : undefined };
    else if (u.startsWith('/api/reports/settings/')) body = onPut ? onPut(u, JSON.parse(options.body)) : { success: true, setting: SETTINGS[0] };
    else if (/^\/api\/reports\/(summary|analytical)(\?|$)/.test(u)) body = { success: true, report: REPORT };
    else body = { success: true, weeks: [], checks: [], missing: {} };
    return Promise.resolve({ json: () => Promise.resolve(body) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Reports & Record Keeping', () => {
  test('a deacon who receives only the summary sees only its tab', async () => {
    mockApi({ reports: ['summary'] });
    render(<ReportsPage user={{ id: 2, role: 'approved', areas: ['summary-report'] }} />);
    expect(await screen.findByText('Sunday AM Worship attendance')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Analytical Report' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Record Keeping' })).not.toBeInTheDocument();
  });

  test('the summary shows the week, and the year so far one tap away', async () => {
    mockApi();
    render(<ReportsPage user={{ id: 1, role: 'admin' }} initialTab="summary" />);
    expect(await screen.findByText('November 8–14, 2026')).toBeInTheDocument();
    expect(screen.getByText('Sunday AM Worship attendance').parentElement).toHaveTextContent('212');
    expect(screen.getByText('On the portal')).toBeInTheDocument();
    expect(screen.getByText(/Busiest: /)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download PDF' })).toHaveAttribute('href', '/api/reports/summary/pdf?week=2026-11-08');

    fireEvent.click(screen.getByRole('tab', { name: '2026 so far' }));
    expect(screen.getByText('Contributions, running total')).toBeInTheDocument();
    expect(screen.getByText('Members on the portal, each week')).toBeInTheDocument();
  });

  test('another week can be chosen', async () => {
    const fetchMock = mockApi();
    render(<ReportsPage user={{ id: 1, role: 'admin' }} initialTab="summary" />);
    await screen.findByText('November 8–14, 2026');
    fireEvent.click(screen.getByRole('button', { name: 'The week before' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => u === '/api/reports/summary?week=2026-11-01')).toBe(true));
    fireEvent.change(screen.getByLabelText('Show the week holding this date'), { target: { value: '2026-10-14' } });
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => u === '/api/reports/summary?week=2026-10-14')).toBe(true));
  });

  test('the analytical report names guests and members who have been away', async () => {
    mockApi();
    render(<ReportsPage user={{ id: 1, role: 'admin' }} initialTab="analytical" />);
    const guests = await screen.findByText(/^Guests \(/);
    const card = guests.closest('section');
    expect(within(card).getByText(REPORT.week.guests.list[0].name)).toBeInTheDocument();
    expect(screen.getByText('The week on the portal')).toBeInTheDocument();
    expect(screen.getByText(`Inactive 30+ days (${REPORT.week.portal.inactive.length})`)).toBeInTheDocument();
  });

  test('an admin sets the day and time each report is sent', async () => {
    const onPut = vi.fn((url, body) => ({ success: true, setting: { ...SETTINGS[0], ...body } }));
    mockApi({ admin: true, onPut });
    render(<ReportsPage user={{ id: 1, role: 'admin' }} initialTab="settings" />);
    const card = (await screen.findByRole('heading', { name: 'Weekly Summary' })).closest('section');
    expect(within(card).getByText(/Sent every Sunday at 3:00 PM church time, covering the week that ended the Saturday before/)).toBeInTheDocument();

    fireEvent.change(within(card).getByLabelText('Day'), { target: { value: '6' } });
    fireEvent.change(within(card).getByLabelText('Time'), { target: { value: '16:30' } });
    expect(within(card).getByText(/Saturday at 4:30 PM church time, covering that week/)).toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onPut).toHaveBeenCalledWith('/api/reports/settings/summary', { weekday: 6, time: '16:30', enabled: true }));
    expect(await within(card).findByText('Saved.')).toBeInTheDocument();
  });

  test('only an admin sees Settings', async () => {
    mockApi({ admin: false });
    render(<ReportsPage user={{ id: 3, role: 'approved', areas: ['summary-report', 'analytical-report'] }} />);
    await screen.findByRole('tab', { name: 'Analytical Report' });
    expect(screen.queryByRole('tab', { name: 'Settings' })).not.toBeInTheDocument();
  });
});
