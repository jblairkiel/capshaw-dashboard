import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, test, expect, vi, afterEach } from 'vitest';
import RecordKeepingView from '../components/RecordKeepingView';

const CHECKS = [
  { id: 'songs', label: 'Songs', page: 'songs', noneLabel: 'No songs to record', scope: 'service' },
  { id: 'guests', label: 'Guests', page: 'visitors', noneLabel: 'No guests', scope: 'service' },
  { id: 'contribution', label: 'Contribution', page: 'contributions', noneLabel: 'No contribution taken', scope: 'sunday' },
];

const REPORT = {
  success: true,
  today: '2026-09-30',
  totalMissing: 3,
  missing: { songs: 1, guests: 1, contribution: 1 },
  checks: CHECKS,
  weeks: [
    {
      start: '2026-09-27', end: '2026-10-03',
      contribution: { date: '2026-09-27', status: 'missing' },
      rows: [
        { date: '2026-09-27', service: 'Sunday AM Worship', tracking: 'weekly', cells: { songs: { status: 'recorded' }, guests: { status: 'missing' } } },
        { date: '2026-09-30', service: 'Wednesday Bible Study', tracking: 'weekly', cells: { songs: { status: 'missing' }, guests: { status: 'none', checkoffId: 5, by: 'Record Keeper', note: '' } } },
      ],
    },
    {
      start: '2026-09-20', end: '2026-09-26',
      contribution: { date: '2026-09-20', status: 'recorded' },
      rows: [
        { date: '2026-09-20', service: 'Sunday AM Worship', tracking: 'weekly', notHeld: { checkoffId: 9, by: 'Office Admin', note: 'Snow' }, cells: {} },
      ],
    },
  ],
};

const SERVICES = {
  success: true,
  songNames: ['AM', 'PM', 'Wednesday'],
  weekdays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  services: [
    { id: 2, name: 'Sunday PM Worship', active: 1, tracking: 'when-held', weekday: 0, song_names: 'PM' },
  ],
};

function mockApi(report = REPORT) {
  const fetchMock = vi.fn((url, options) => {
    let body = report;
    if (url.includes('/services')) body = options?.method === 'PUT' ? { success: true, service: {} } : SERVICES;
    else if (url.includes('/checkoffs')) body = { success: true };
    return Promise.resolve({ json: () => Promise.resolve(body) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => { vi.unstubAllGlobals(); });

const week = start => screen.getByRole('region', { name: new RegExp(`Week of ${new Date(`${start}T12:00:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}`) });

describe('RecordKeepingView', () => {
  test('sums up what is missing', async () => {
    mockApi();
    render(<RecordKeepingView />);
    const summary = await screen.findByText(/in the last 8 weeks/);
    expect(summary).toHaveTextContent('3 missing in the last 8 weeks — songs 1, guests 1, contribution 1.');
    expect(within(week('2026-09-27')).getByText('3 missing')).toBeInTheDocument();
    expect(within(week('2026-09-20')).getByText('All recorded')).toBeInTheDocument();
  });

  test('says so when everything is recorded', async () => {
    mockApi({ ...REPORT, totalMissing: 0, missing: { songs: 0, guests: 0, contribution: 0 }, weeks: [] });
    render(<RecordKeepingView />);
    expect(await screen.findByText(/Everything is recorded/)).toBeInTheDocument();
  });

  test('shows each service with each check, week by week', async () => {
    mockApi();
    render(<RecordKeepingView />);
    await screen.findByText(/in the last 8 weeks/);
    const thisWeek = week('2026-09-27');
    expect(within(thisWeek).getByText('✓ Recorded')).toBeInTheDocument();
    expect(within(thisWeek).getAllByText('Missing')).toHaveLength(3);
    expect(within(thisWeek).getByText('No guests · Record Keeper')).toBeInTheDocument();

    expect(within(week('2026-09-20')).getByText('Did not happen · Office Admin — Snow')).toBeInTheDocument();
  });

  test('Add sends you to the page that owns the record', async () => {
    mockApi();
    const onGoToPage = vi.fn();
    render(<RecordKeepingView onGoToPage={onGoToPage} />);
    await screen.findByText(/in the last 8 weeks/);
    const addButtons = within(week('2026-09-27')).getAllByRole('button', { name: 'Add' });
    fireEvent.click(addButtons[0]);   // the contribution, in the week's header
    fireEvent.click(addButtons[1]);   // Sunday's guests
    fireEvent.click(addButtons[2]);   // Wednesday's songs
    expect(onGoToPage.mock.calls.map(c => c[0])).toEqual(['contributions', 'visitors', 'songs']);
  });

  test('saying there was nothing to record signs it off and reloads', async () => {
    const fetchMock = mockApi();
    render(<RecordKeepingView />);
    await screen.findByText(/in the last 8 weeks/);
    fireEvent.click(within(week('2026-09-27')).getByRole('button', { name: 'No guests' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/record-keeping/checkoffs', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ date: '2026-09-27', service: 'Sunday AM Worship', check: 'guests' }),
    })));
    await waitFor(() => expect(fetchMock.mock.calls.filter(c => String(c[0]).startsWith('/api/record-keeping?')).length).toBe(2));
  });

  test('a service that did not happen can be marked, and taken back', async () => {
    const fetchMock = mockApi();
    render(<RecordKeepingView />);
    await screen.findByText(/in the last 8 weeks/);
    fireEvent.click(within(week('2026-09-27')).getAllByRole('button', { name: "Didn't happen" })[0]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/record-keeping/checkoffs', expect.objectContaining({
      body: JSON.stringify({ date: '2026-09-27', service: 'Sunday AM Worship', check: 'not-held' }),
    })));

    fireEvent.click(within(week('2026-09-20')).getByRole('button', { name: 'undo' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/record-keeping/checkoffs/9', expect.objectContaining({ method: 'DELETE' })));
  });

  test('asks for more weeks when the range changes', async () => {
    const fetchMock = mockApi();
    render(<RecordKeepingView />);
    fireEvent.change(await screen.findByLabelText('Weeks to show'), { target: { value: '13' } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/record-keeping?weeks=13', expect.anything()));
  });

  test('changes how a service is tracked', async () => {
    const fetchMock = mockApi();
    render(<RecordKeepingView />);
    fireEvent.click(await screen.findByRole('button', { name: /Which services are tracked/ }));
    fireEvent.change(await screen.findByLabelText('How Sunday PM Worship is tracked'), { target: { value: 'weekly' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/record-keeping/services/2', expect.objectContaining({
      method: 'PUT', body: JSON.stringify({ tracking: 'weekly', weekday: 0, songNames: 'PM' }),
    })));
  });
});
