import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, test, expect, vi, afterEach } from 'vitest';
import ServiceRosterView from '../components/ServiceRosterView';

const SERVERS = [{ name: 'Al Adams', personId: 1 }, { name: 'Ben Brown', personId: 2 }, { name: 'Cal Cole', personId: 3 }];
const ANALYSIS = {
  success: true, weeks: 26, roles: ['Song Leader', 'Opening Prayer'],
  summary: { services: 2, slots: 6, served: 5, unfilled: 1, people: 2 },
  byRole: [
    { role: 'Song Leader', slots: 4, served: 4, people: 1, topShare: 100 },
    { role: 'Opening Prayer', slots: 2, served: 1, people: 1, topShare: 100 },
  ],
  people: [
    { key: 'al adams', name: 'Al Adams', personId: 1, served: 4, byRole: { 'Song Leader': 4 }, lastServed: '2026-09-27', nextScheduled: null },
    { key: 'ben brown', name: 'Ben Brown', personId: 2, served: 1, byRole: { 'Opening Prayer': 1 }, lastServed: '2026-09-20', nextScheduled: '2026-10-11' },
  ],
  unused: [{ personId: 3, name: 'Cal Cole', roles: [{ role: 'Song Leader', level: 'willing' }], servedAtAll: 0 }],
  servers: SERVERS,
};
const PERSON = {
  success: true, weeks: 26, roles: ['Song Leader', 'Opening Prayer'],
  person: ANALYSIS.people[1],
  preferences: { 'Opening Prayer': 'preferred', 'Song Leader': 'unavailable' },
  notes: 'Evenings are hard',
  history: [
    { date: '2026-10-11', service: 'Sunday Worship', job: 'Song Leader', upcoming: true },
    { date: '2026-09-20', service: 'Sunday Worship', job: 'Opening Prayer', upcoming: false },
  ],
};
const PREFERENCES = {
  success: true, weeks: 26, roles: ['Song Leader', 'Opening Prayer', 'Communion'],
  men: [
    { personId: 1, name: 'Al Adams', preferences: { 'Song Leader': 'preferred', Communion: 'unavailable' }, said: 2, updatedAt: '2026-08-01 10:00:00', notes: 'Mornings only', served: { 'Song Leader': 4 }, servedTotal: 4 },
    { personId: 2, name: 'Ben Brown', preferences: { 'Opening Prayer': 'willing' }, said: 1, updatedAt: '2026-07-01 10:00:00', notes: '', served: { 'Opening Prayer': 1 }, servedTotal: 1 },
    { personId: 3, name: 'Cal Cole', preferences: {}, said: 0, updatedAt: null, notes: '', served: {}, servedTotal: 0 },
  ],
  coverage: [
    { role: 'Song Leader', glad: 1, willing: 0, unavailable: 0, unsaid: 2 },
    { role: 'Opening Prayer', glad: 0, willing: 1, unavailable: 0, unsaid: 2 },
    { role: 'Communion', glad: 0, willing: 0, unavailable: 1, unsaid: 2 },
  ],
  summary: { men: 3, said: 2, unsaid: 1 },
};

const MEMBERS = [
  { id: 2, name: 'Ben Brown', gender: 'male', assignments: 1, preferences: { 'Opening Prayer': 'willing' }, notes: '', blackouts: [] },
];

function mockApi() {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(url => {
    calls.push(url);
    let body = { success: false };
    if (url.startsWith('/api/participation/analysis')) body = ANALYSIS;
    else if (url.startsWith('/api/participation/person')) body = PERSON;
    else if (url.startsWith('/api/participation/preferences')) body = PREFERENCES;
    else if (url.startsWith('/api/serving/members')) body = { success: true, members: MEMBERS };
    return Promise.resolve({ json: () => Promise.resolve(body) });
  }));
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('the Service Roster page', () => {
  test('has the schedule, the preferences and the analysis as its tabs', async () => {
    mockApi();
    render(<ServiceRosterView tab="analysis" />);
    await screen.findByText('Who is carrying it');
    expect(screen.getAllByRole('tab').map(t => t.textContent)).toEqual(['Scheduled', 'Preferences', 'Analysis']);
    expect(screen.getByRole('heading', { name: 'Service Roster' })).toBeInTheDocument();
  });
});

test('a member who does not keep the schedule sees only the schedule', async () => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ success: true, months: [], month: '', assignments: [], jobs: [], services: [], serviceJobs: [], canManage: false, blackouts: [], me: {} }) })));
  render(<ServiceRosterView canManage={false} tab="analysis" />);
  expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  expect(await screen.findByText(/ask to be replaced/i)).toBeInTheDocument();
  expect(screen.queryByText('Who is carrying it')).not.toBeInTheDocument();
});

describe('analysis', () => {
  test('opens on the analysis, read straight from the schedule — there is nothing to confirm', async () => {
    mockApi();
    render(<ServiceRosterView tab="analysis" />);
    expect(await screen.findByText('Who is carrying it')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Record' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /went as scheduled/i })).not.toBeInTheDocument();
    expect(screen.getByText('5 of 6')).toBeInTheDocument();
    expect(screen.getByText(/as it stands/)).toBeInTheDocument();
    expect(screen.getByText('Willing, but not used for it')).toBeInTheDocument();
  });

  test('a man picked from the chart opens his record, with what he said beside what he did', async () => {
    const calls = mockApi();
    render(<ServiceRosterView tab="analysis" />);
    await screen.findByText('Who is carrying it');
    fireEvent.click(screen.getAllByRole('button', { name: 'Ben Brown' })[0]);
    expect(await screen.findByText('What he said, and what he has done')).toBeInTheDocument();
    expect(calls.some(c => c.startsWith('/api/participation/person?name=Ben%20Brown'))).toBe(true);
    expect(screen.getByText('Glad to')).toBeInTheDocument();
    expect(screen.getByText('Rather not')).toBeInTheDocument();
    expect(screen.getByText('Coming up')).toBeInTheDocument();
    expect(screen.getByText(/Evenings are hard/)).toBeInTheDocument();
  });

  test('filters go to the server', async () => {
    const calls = mockApi();
    render(<ServiceRosterView tab="analysis" />);
    await screen.findByText('Who is carrying it');
    fireEvent.change(screen.getByLabelText('Weeks'), { target: { value: '13' } });
    fireEvent.change(screen.getByLabelText('Job'), { target: { value: 'Song Leader' } });
    await waitFor(() => expect(calls.some(c => c.includes('weeks=13') && c.includes('role=Song%20Leader'))).toBe(true));
  });
});

describe('preferences', () => {
  const open = async () => {
    render(<ServiceRosterView tab="analysis" />);
    await screen.findByText('Who is carrying it');
    fireEvent.click(screen.getByRole('tab', { name: 'Preferences' }));
    await screen.findByText('How each job is covered');
  };

  test('every man against every job, with what he has served beside it and when he last changed it', async () => {
    mockApi();
    await open();
    const row = screen.getByRole('button', { name: 'Al Adams' }).closest('tr');
    expect(within(row).getByText('Glad')).toBeInTheDocument();
    expect(within(row).getByText('No')).toBeInTheDocument();
    expect(within(row).getByText('4×')).toBeInTheDocument();
    expect(within(row).getByText(/Mornings only/)).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: 'Cal Cole' }).closest('tr')).getByText('Not said')).toBeInTheDocument();
  });

  test('how each job is covered, with thin jobs marked, and who has not said', async () => {
    mockApi();
    await open();
    expect(screen.getByRole('img', { name: 'Song Leader: 1 glad, 0 willing, 0 rather not, 2 not said' })).toBeInTheDocument();
    expect(screen.getAllByText(/· thin/).length).toBe(3);
    expect(screen.getByText('Not said yet', { selector: 'p' })).toBeInTheDocument();
  });

  test('filters the men by name, and to those who have not said', async () => {
    mockApi();
    await open();
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'unsaid' } });
    expect(screen.queryByRole('button', { name: 'Al Adams' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cal Cole' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'all' } });
    fireEvent.change(screen.getByLabelText('Find a name'), { target: { value: 'ben' } });
    expect(screen.queryByRole('button', { name: 'Cal Cole' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ben Brown' })).toBeInTheDocument();
  });

  test("a man's name opens him, and from there his record on the analysis", async () => {
    const calls = mockApi();
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Ben Brown' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ben Brown' });
    fireEvent.click(within(dialog).getByRole('button', { name: /see what he has served/i }));
    expect(await screen.findByText('What he said, and what he has done')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Analysis' })).toHaveAttribute('aria-selected', 'true');
    expect(calls.some(c => c.startsWith('/api/participation/person?name=Ben%20Brown'))).toBe(true);
  });
});
