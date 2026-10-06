import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import ServiceRosterView from '../components/ServiceRosterView';

// The Service Roster's Preferences tab, as whoever keeps the schedule uses it:
// opening a man to record what he will do, or his time away, for him — when
// he said it in the foyer rather than on My Household & Preferences.

const MEMBERS = [
  {
    id: 1, name: 'Joe Carter', gender: 'male', email: 'joe@example.com', assignments: 3,
    preferences: { 'Song Leader': 'preferred', Usher: 'willing', Communion: 'unavailable' },
    notes: 'Away most of June',
    blackouts: [{ id: 5, directoryId: 1, startsOn: '2026-06-07', endsOn: '2026-06-21', reason: 'Away with family' }],
  },
  {
    id: 2, name: 'Ned Poole', gender: 'male', email: 'ned@example.com', assignments: 0,
    preferences: {}, notes: '', blackouts: [],
  },
  {
    id: 3, name: 'Sam Lee', gender: '', email: '', assignments: 0,
    preferences: {}, notes: '', blackouts: [],
  },
];

const PREFERENCES = {
  success: true, weeks: 26, roles: ['Song Leader', 'Usher', 'Communion'],
  men: MEMBERS.map(m => ({
    personId: m.id, name: m.name, preferences: m.preferences, said: Object.keys(m.preferences).length,
    updatedAt: null, notes: m.notes, served: {}, servedTotal: 0,
  })),
  coverage: [],
  summary: { men: 3, said: 1, unsaid: 2 },
};

function mockRoster() {
  const fetchMock = vi.fn((url, options = {}) => {
    let body = { success: true };
    if (options.method === 'PUT') {
      const sent = JSON.parse(options.body);
      const id   = Number(url.match(/members\/(\d+)/)[1]);
      const kept = Object.fromEntries(Object.entries(sent.preferences).filter(([, level]) => level));
      body = { success: true, member: { ...MEMBERS.find(m => m.id === id), preferences: kept, notes: sent.notes ?? '' } };
    } else if (String(url).startsWith('/api/participation/preferences')) body = PREFERENCES;
    else if (String(url).startsWith('/api/serving/members')) body = { success: true, members: MEMBERS };
    return Promise.resolve({ json: () => Promise.resolve(body) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function openMan(name) {
  render(<ServiceRosterView tab="preferences" />);
  fireEvent.click(await screen.findByRole('button', { name }));
  return screen.findByRole('dialog', { name });
}

describe('ServiceRosterView — opening a man from Preferences', () => {
  beforeEach(() => { vi.unstubAllGlobals(); });

  test('there is no separate Roster tab — an old link to it lands on Preferences', async () => {
    mockRoster();
    render(<ServiceRosterView tab="roster" />);
    await screen.findByText('How each job is covered');
    expect(screen.queryByRole('tab', { name: 'Roster' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Preferences' })).toHaveAttribute('aria-selected', 'true');
  });

  test('records a preference for a man who has said nothing', async () => {
    const fetchMock = mockRoster();
    await openMan('Ned Poole');

    const group = screen.getByRole('group', { name: 'Usher preference' });
    fireEvent.click(within(group).getByRole('button', { name: /willing/i }));
    fireEvent.click(screen.getByRole('button', { name: /save preferences/i }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([, o]) => o?.method === 'PUT')).toBe(true));
    const [url, options] = fetchMock.mock.calls.find(([, o]) => o?.method === 'PUT');
    expect(url).toBe('/api/serving/members/2/preferences');
    const body = JSON.parse(options.body);
    expect(body.preferences.Usher).toBe('willing');
    // Everything he did not choose is sent as null, so the server drops it.
    expect(body.preferences['Song Leader']).toBeNull();
  });

  test('shows the reason for his time away, not just the dates', async () => {
    mockRoster();
    await openMan('Joe Carter');
    expect(screen.getByText(/Away with family/)).toBeInTheDocument();
  });

  test('blocking out days for a man posts them against him', async () => {
    const fetchMock = mockRoster();
    await openMan('Ned Poole');

    fireEvent.change(screen.getByLabelText('First day away'), { target: { value: '2026-07-05' } });
    fireEvent.change(screen.getByLabelText('Last day away'),  { target: { value: '2026-07-12' } });
    fireEvent.click(screen.getByRole('button', { name: /block out these days/i }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, o]) => String(url).endsWith('/blackouts') && o?.method === 'POST');
      expect(JSON.parse(call[1].body)).toMatchObject({ directoryId: 2, startsOn: '2026-07-05', endsOn: '2026-07-12' });
    });
  });

  test('a man with nothing blocked out is said to be available', async () => {
    mockRoster();
    await openMan('Ned Poole');
    expect(screen.getByText(/available for every service on the roster/)).toBeInTheDocument();
  });

  test('warns when his directory entry does not say he is a man', async () => {
    mockRoster();
    await openMan('Sam Lee');
    expect(screen.getByText(/rosters the worship jobs among its men/)).toBeInTheDocument();
  });

  test('closes without leaving the tab', async () => {
    mockRoster();
    const dialog = await openMan('Joe Carter');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('tab', { name: 'Preferences' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('ServiceRosterView — when the server says no', () => {
  beforeEach(() => { vi.unstubAllGlobals(); });

  test('shows the error rather than an empty list', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve({ success: false, error: 'Not your area' }) })
    ));
    render(<ServiceRosterView tab="preferences" />);
    expect(await screen.findByText('Not your area')).toBeInTheDocument();
  });
});
