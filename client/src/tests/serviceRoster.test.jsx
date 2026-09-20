import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import ServiceRosterView from '../components/ServiceRosterView';

// The Service Roster: what each man will volunteer for, kept by whoever builds
// the schedule. The page edits preferences and only reports what somebody has
// been signed off for — that is Member Jobs' to change.

const MEMBERS = [
  {
    id: 1, name: 'Joe Carter', gender: 'male', email: 'joe@example.com', assignments: 3,
    jobs: ['Song Leader'],
    preferences: { 'Song Leader': 'preferred', Usher: 'willing', Communion: 'unavailable' },
    notes: 'Away most of June',
  },
  {
    id: 2, name: 'Ned Poole', gender: 'male', email: 'ned@example.com', assignments: 0,
    jobs: [], preferences: {}, notes: '',
  },
  {
    id: 3, name: 'Ruth Poole', gender: 'female', email: 'ruth@example.com', assignments: 0,
    jobs: [], preferences: { Visuals: 'preferred' }, notes: '',
  },
];

function mockRoster(members = MEMBERS) {
  const fetchMock = vi.fn((url, options = {}) => {
    if (options.method === 'PUT') {
      const body = JSON.parse(options.body);
      const id   = Number(url.match(/members\/(\d+)/)[1]);
      const kept = Object.fromEntries(Object.entries(body.preferences).filter(([, level]) => level));
      return Promise.resolve({
        json: () => Promise.resolve({
          success: true,
          member: { id, name: 'Ned Poole', preferences: kept, notes: body.notes ?? '' },
        }),
      });
    }
    return Promise.resolve({
      json: () => Promise.resolve({
        success: true,
        members,
        jobs: ['Song Leader', 'Usher', 'Communion'],
        levels: ['preferred', 'willing', 'unavailable'],
      }),
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function renderRoster(members) {
  mockRoster(members);
  render(<ServiceRosterView />);
  await screen.findByRole('button', { name: 'Preferences for Joe Carter' });
}

function rowNames() {
  return screen.getAllByRole('button', { name: /^Preferences for / })
    .map(b => b.getAttribute('aria-label').replace('Preferences for ', ''));
}

describe('ServiceRosterView — the list', () => {
  beforeEach(() => { vi.unstubAllGlobals(); });

  test('shows the men and, by default, leaves the women out', async () => {
    await renderRoster();
    expect(rowNames()).toEqual(['Joe Carter', 'Ned Poole']);

    fireEvent.click(screen.getByRole('checkbox', { name: /only show the men/i }));
    expect(rowNames()).toEqual(['Joe Carter', 'Ned Poole', 'Ruth Poole']);
  });

  test('reads back what somebody has said, and says so when they have not', async () => {
    await renderRoster();

    const joe = screen.getByRole('button', { name: 'Preferences for Joe Carter' });
    expect(within(joe).getByText('Song Leader')).toBeInTheDocument();
    expect(within(joe).getByText('Usher')).toBeInTheDocument();
    expect(within(joe).getByText(/rather not: Communion/)).toBeInTheDocument();

    const ned = screen.getByRole('button', { name: 'Preferences for Ned Poole' });
    expect(within(ned).getByText(/Nothing said yet/)).toBeInTheDocument();
  });

  test('counts how many have said anything at all', async () => {
    await renderRoster();
    expect(screen.getByText(/1 of 2 have said something/)).toBeInTheDocument();
  });

  test('narrows to the men who have not said yet', async () => {
    await renderRoster();
    fireEvent.change(screen.getByRole('combobox', { name: /who to show/i }), { target: { value: 'quiet' } });
    expect(rowNames()).toEqual(['Ned Poole']);

    fireEvent.change(screen.getByRole('combobox', { name: /who to show/i }), { target: { value: 'spoken' } });
    expect(rowNames()).toEqual(['Joe Carter']);
  });

  test('searching narrows by name', async () => {
    await renderRoster();
    fireEvent.change(screen.getByPlaceholderText('Search members…'), { target: { value: 'ned' } });
    expect(rowNames()).toEqual(['Ned Poole']);
  });
});

describe('ServiceRosterView — where the roster is thin', () => {
  beforeEach(() => { vi.unstubAllGlobals(); });

  test('names the jobs nobody has volunteered for', async () => {
    await renderRoster();
    // Joe is glad to lead singing and willing to usher; nothing else is covered.
    expect(screen.getByText(/Nobody has volunteered for/)).toHaveTextContent('Opening Prayer');
    expect(screen.getByText(/Nobody has volunteered for/)).not.toHaveTextContent('Song Leader');
  });

  test('a job somebody said "rather not" to still counts as uncovered', async () => {
    await renderRoster();
    expect(screen.getByText(/Nobody has volunteered for/)).toHaveTextContent('Communion');
  });
});

describe('ServiceRosterView — writing down what he said', () => {
  beforeEach(() => { vi.unstubAllGlobals(); });

  test('opens a man who has said nothing and records a preference', async () => {
    const fetchMock = mockRoster();
    render(<ServiceRosterView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Preferences for Ned Poole' }));

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

    // The row shows what was saved without another trip to the server.
    await waitFor(() => {
      const ned = screen.getByRole('button', { name: 'Preferences for Ned Poole' });
      expect(within(ned).getByText('Usher')).toBeInTheDocument();
    });
  });

  test('says which jobs he may sign himself up for, and whose decision that is', async () => {
    await renderRoster();
    fireEvent.click(screen.getByRole('button', { name: 'Preferences for Joe Carter' }));

    expect(screen.getByText(/Signed off to sign up for:/)).toBeInTheDocument();
    expect(screen.getByText(/Member Jobs/)).toBeInTheDocument();
  });

  test('warns that a woman cannot be rostered whatever is recorded', async () => {
    await renderRoster();
    fireEvent.click(screen.getByRole('checkbox', { name: /only show the men/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Preferences for Ruth Poole' }));

    expect(screen.getByText(/rosters the worship jobs among its men/)).toBeInTheDocument();
  });
});

describe('ServiceRosterView — when the server says no', () => {
  beforeEach(() => { vi.unstubAllGlobals(); });

  test('shows the error rather than an empty roster', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve({ success: false, error: 'Not your area' }) })
    ));
    render(<ServiceRosterView />);
    expect(await screen.findByText('Not your area')).toBeInTheDocument();
  });
});
