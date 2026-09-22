import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import ServiceRosterView from '../components/ServiceRosterView';

// The Service Roster: what each man will volunteer for, kept by whoever builds
// the schedule. The page is a grid — a row per man, summarised — with a
// Details button opening the same editor a row used to expand into.

const MEMBERS = [
  {
    id: 1, name: 'Joe Carter', gender: 'male', email: 'joe@example.com', assignments: 3,
    jobs: ['Song Leader'],
    preferences: { 'Song Leader': 'preferred', Usher: 'willing', Communion: 'unavailable' },
    notes: 'Away most of June',
    blackouts: [{ id: 5, directoryId: 1, startsOn: '2026-06-07', endsOn: '2026-06-21', reason: 'Away with family' }],
  },
  {
    id: 2, name: 'Ned Poole', gender: 'male', email: 'ned@example.com', assignments: 0,
    jobs: [], preferences: {}, notes: '', blackouts: [],
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
  await screen.findByRole('button', { name: 'Details for Joe Carter' });
}

function rowNames() {
  return screen.getAllByRole('button', { name: /^Details for / })
    .map(b => b.getAttribute('aria-label').replace('Details for ', ''));
}

function openDetails(name) {
  fireEvent.click(screen.getByRole('button', { name: `Details for ${name}` }));
  return screen.findByRole('dialog', { name });
}

describe('ServiceRosterView — the grid', () => {
  beforeEach(() => { vi.unstubAllGlobals(); });

  test('shows the men and, by default, leaves the women out', async () => {
    await renderRoster();
    expect(rowNames()).toEqual(['Joe Carter', 'Ned Poole']);

    fireEvent.click(screen.getByRole('checkbox', { name: /only show the men/i }));
    expect(rowNames()).toEqual(['Joe Carter', 'Ned Poole', 'Ruth Poole']);
  });

  test('summarises what somebody has said on the row, and says so when they have not', async () => {
    await renderRoster();

    const joeRow = screen.getByRole('button', { name: 'Details for Joe Carter' }).closest('tr');
    expect(within(joeRow).getByText('1 glad')).toBeInTheDocument();
    expect(within(joeRow).getByText('1 willing')).toBeInTheDocument();
    expect(within(joeRow).getByText(/rather not: Communion/)).toBeInTheDocument();

    const nedRow = screen.getByRole('button', { name: 'Details for Ned Poole' }).closest('tr');
    expect(within(nedRow).getByText('Nothing said yet')).toBeInTheDocument();
  });

  test('shows turns on the roster, and a dash for nobody with any', async () => {
    await renderRoster();
    const joeRow = screen.getByRole('button', { name: 'Details for Joe Carter' }).closest('tr');
    const nedRow = screen.getByRole('button', { name: 'Details for Ned Poole' }).closest('tr');

    expect(within(joeRow).getByText('3')).toBeInTheDocument();
    expect(within(nedRow).getAllByText('—').length).toBeGreaterThan(0);
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

  test('a man away shows the range on his row, without opening him', async () => {
    await renderRoster();
    const joeRow = screen.getByRole('button', { name: 'Details for Joe Carter' }).closest('tr');
    expect(within(joeRow).getByText('June 7 – June 21, 2026')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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

describe('ServiceRosterView — the Details dialog', () => {
  beforeEach(() => { vi.unstubAllGlobals(); });

  test('opens a man who has said nothing and records a preference', async () => {
    const fetchMock = mockRoster();
    render(<ServiceRosterView />);
    await screen.findByRole('button', { name: 'Details for Joe Carter' });
    await openDetails('Ned Poole');

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

    // The grid row shows what was saved without another trip to the server,
    // even with the dialog still open over it.
    await waitFor(() => {
      const nedRow = screen.getByRole('button', { name: 'Details for Ned Poole' }).closest('tr');
      expect(within(nedRow).getByText('1 willing')).toBeInTheDocument();
    });
  });

  test('says which jobs he may sign himself up for, and whose decision that is', async () => {
    await renderRoster();
    await openDetails('Joe Carter');

    expect(screen.getByText(/Signed off to sign up for:/)).toBeInTheDocument();
    expect(screen.getByText(/Member Jobs/)).toBeInTheDocument();
  });

  test('opening a man shows the reason for his time away, not just the dates', async () => {
    await renderRoster();
    await openDetails('Joe Carter');
    expect(screen.getByText(/Away with family/)).toBeInTheDocument();
  });

  test('blocking out days for a man posts them against him', async () => {
    const fetchMock = mockRoster();
    render(<ServiceRosterView />);
    await screen.findByRole('button', { name: 'Details for Joe Carter' });
    await openDetails('Ned Poole');

    fireEvent.change(screen.getByLabelText('First day away'), { target: { value: '2026-07-05' } });
    fireEvent.change(screen.getByLabelText('Last day away'),  { target: { value: '2026-07-12' } });
    fireEvent.click(screen.getByRole('button', { name: /block out these days/i }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, o]) => String(url).endsWith('/blackouts') && o?.method === 'POST');
      expect(JSON.parse(call[1].body)).toMatchObject({ directoryId: 2, startsOn: '2026-07-05', endsOn: '2026-07-12' });
    });
  });

  test('a man with nothing blocked out is said to be available', async () => {
    await renderRoster();
    await openDetails('Ned Poole');
    expect(screen.getByText(/available for every service on the roster/)).toBeInTheDocument();
  });

  test('warns that a woman cannot be rostered whatever is recorded', async () => {
    await renderRoster();
    fireEvent.click(screen.getByRole('checkbox', { name: /only show the men/i }));
    await openDetails('Ruth Poole');

    expect(screen.getByText(/rosters the worship jobs among its men/)).toBeInTheDocument();
  });

  test('closes without disturbing the grid underneath', async () => {
    await renderRoster();
    const dialog = await openDetails('Joe Carter');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Details for Joe Carter' })).toBeInTheDocument();
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
