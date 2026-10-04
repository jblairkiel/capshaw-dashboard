import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, test, expect, vi, afterEach } from 'vitest';
import WorshipParticipationView from '../components/WorshipParticipationView';

const SERVICES = [
  { date: '2026-09-27', service: 'Sunday Worship', slots: 3, checked: 0, unfilled: 0 },
  { date: '2026-09-20', service: 'Sunday Worship', slots: 3, checked: 3, unfilled: 0 },
];
const SERVERS = [{ name: 'Al Adams', personId: 1 }, { name: 'Ben Brown', personId: 2 }, { name: 'Cal Cole', personId: 3 }];
const SLOTS = [
  { date: '2026-09-27', service: 'Sunday Worship', job: 'Song Leader', position: 0, scheduled: 'Al Adams', check: null },
  { date: '2026-09-27', service: 'Sunday Worship', job: 'Opening Prayer', position: 0, scheduled: 'Ben Brown', check: { outcome: 'substitute', servedName: 'Cal Cole', by: 'Keeper' } },
  { date: '2026-09-27', service: 'Sunday Worship', job: 'Communion', position: 0, scheduled: '', check: null },
];
const ANALYSIS = {
  success: true, weeks: 26, roles: ['Song Leader', 'Opening Prayer'],
  summary: { services: 2, checkedServices: 1, slots: 6, served: 4, confirmed: 2, assumed: 2, substitutes: 1, missed: 1, unfilled: 1, people: 3 },
  byRole: [
    { role: 'Song Leader', slots: 4, served: 4, people: 1, topShare: 100 },
    { role: 'Opening Prayer', slots: 2, served: 2, people: 2, topShare: 50 },
  ],
  people: [
    { key: 'al adams', name: 'Al Adams', personId: 1, served: 4, confirmed: 2, assumed: 2, steppedIn: 0, replaced: 0, missed: 0, scheduled: 4, byRole: { 'Song Leader': 4 }, lastServed: '2026-09-27' },
    { key: 'ben brown', name: 'Ben Brown', personId: 2, served: 1, confirmed: 0, assumed: 1, steppedIn: 0, replaced: 1, missed: 0, scheduled: 2, byRole: { 'Opening Prayer': 1 }, lastServed: '2026-09-20' },
  ],
  unused: [{ personId: 3, name: 'Cal Cole', roles: [{ role: 'Song Leader', level: 'willing' }], servedAtAll: 0 }],
  servers: SERVERS,
};
const PERSON = {
  success: true, weeks: 26, roles: ['Song Leader', 'Opening Prayer'],
  person: { ...ANALYSIS.people[1] },
  preferences: { 'Opening Prayer': 'preferred', 'Song Leader': 'unavailable' },
  history: [
    { date: '2026-09-27', service: 'Sunday Worship', job: 'Opening Prayer', kind: 'replaced', other: 'Cal Cole', note: '' },
    { date: '2026-09-20', service: 'Sunday Worship', job: 'Opening Prayer', kind: 'assumed', other: '', note: '' },
  ],
};

function mockApi() {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn((url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : undefined });
    let body = { success: true };
    if (url.startsWith('/api/participation/services')) body = { success: true, services: SERVICES, servers: SERVERS };
    else if (url.startsWith('/api/participation/service?')) body = { success: true, date: '2026-09-27', service: 'Sunday Worship', slots: SLOTS };
    else if (url.startsWith('/api/participation/analysis')) body = ANALYSIS;
    else if (url.startsWith('/api/participation/person')) body = PERSON;
    else if (url.startsWith('/api/participation/served')) body = { success: true, count: 1 };
    return Promise.resolve({ json: () => Promise.resolve(body) });
  }));
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

const jobRow = job => screen.getByRole('group', { name: `What happened: ${job}` });

describe('recording a service', () => {
  test('lists the services, opens the newest, and shows what is already checked', async () => {
    mockApi();
    render(<WorshipParticipationView />);
    expect(await screen.findByText('Song Leader')).toBeInTheDocument();
    expect(screen.getAllByText('Not checked').length).toBeGreaterThan(0);
    expect(screen.getByText(/Served by/)).toHaveTextContent('Served by Cal Cole instead');
    expect(within(jobRow('Opening Prayer')).getByRole('button', { name: 'Someone else' })).toHaveAttribute('aria-pressed', 'true');
    // Nobody was down for communion, so "Served" is not offered.
    expect(within(jobRow('Communion')).queryByRole('button', { name: 'Served' })).not.toBeInTheDocument();
  });

  test('a job is marked served, nobody, or someone else by name', async () => {
    const calls = mockApi();
    render(<WorshipParticipationView />);
    await screen.findByText('Song Leader');

    fireEvent.click(within(jobRow('Song Leader')).getByRole('button', { name: 'Served' }));
    await waitFor(() => expect(calls.find(c => c.method === 'PUT')?.body).toMatchObject({ job: 'Song Leader', outcome: 'served', date: '2026-09-27' }));

    fireEvent.click(within(jobRow('Communion')).getByRole('button', { name: 'Someone did it' }));
    fireEvent.change(screen.getByLabelText('Who served Communion instead'), { target: { value: 'Cal Cole' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.filter(c => c.method === 'PUT').at(-1).body).toMatchObject({ job: 'Communion', outcome: 'substitute', servedName: 'Cal Cole' }));
  });

  test('pressing the active choice again takes the check back off', async () => {
    const calls = mockApi();
    render(<WorshipParticipationView />);
    await screen.findByText('Song Leader');
    fireEvent.click(within(jobRow('Opening Prayer')).getByRole('button', { name: 'Someone else' }));
    await waitFor(() => expect(calls.find(c => c.method === 'PUT')?.body).toMatchObject({ job: 'Opening Prayer', outcome: null }));
  });

  test('"It went as scheduled" marks the rest served', async () => {
    const calls = mockApi();
    render(<WorshipParticipationView />);
    fireEvent.click(await screen.findByRole('button', { name: 'It went as scheduled' }));
    await waitFor(() => expect(calls.find(c => c.url === '/api/participation/served')?.body).toEqual({ date: '2026-09-27', service: 'Sunday Worship' }));
  });
});

describe('analysis', () => {
  test('everyone: the totals, who is carrying it, by job, and who has not been used', async () => {
    mockApi();
    render(<WorshipParticipationView />);
    fireEvent.click(screen.getByRole('tab', { name: 'Analysis' }));
    expect(await screen.findByText('Who is carrying it')).toBeInTheDocument();
    expect(screen.getByText('4 of 6')).toBeInTheDocument();
    expect(screen.getByText(/Services nobody has checked are counted/)).toBeInTheDocument();
    expect(screen.getByText('Willing, but not used for it')).toBeInTheDocument();
    expect(screen.getByText('Song Leader · Willing')).toBeInTheDocument();
    expect(screen.getByText('Did not serve when scheduled')).toBeInTheDocument();
  });

  test('a man picked from the chart opens his record, with what he said beside what he did', async () => {
    const calls = mockApi();
    render(<WorshipParticipationView />);
    fireEvent.click(screen.getByRole('tab', { name: 'Analysis' }));
    await screen.findByText('Who is carrying it');
    fireEvent.click(screen.getAllByRole('button', { name: 'Ben Brown' })[0]);
    expect(await screen.findByText('Jobs, and what he has said')).toBeInTheDocument();
    expect(calls.some(c => c.url.startsWith('/api/participation/person?name=Ben%20Brown'))).toBe(true);
    expect(screen.getByText('Glad to')).toBeInTheDocument();
    expect(screen.getByText('Replaced · Cal Cole')).toBeInTheDocument();
  });

  test('filters go to the server', async () => {
    const calls = mockApi();
    render(<WorshipParticipationView />);
    fireEvent.click(screen.getByRole('tab', { name: 'Analysis' }));
    await screen.findByText('Who is carrying it');
    fireEvent.click(screen.getByLabelText('Checked services only'));
    fireEvent.change(screen.getByLabelText('Weeks'), { target: { value: '13' } });
    await waitFor(() => expect(calls.some(c => c.url.includes('weeks=13') && c.url.includes('checkedOnly=true'))).toBe(true));
  });
});
