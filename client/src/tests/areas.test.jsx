import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { describe, test, expect, vi, afterEach } from 'vitest';

import { hasArea, hasAnyArea, areasOf, areaInfo, AREAS, isAdmin } from '../lib/roles';
import ActionHistoryView from '../components/ActionHistoryView';
import UsersView from '../components/UsersView';

// ─── The rules themselves ─────────────────────────────────────────────────────
//
// Areas are not a ladder. That is the whole point of them, so it is worth
// saying out loud in a test.

describe('areas', () => {
  const songLeader = { id: 1, role: 'approved', areas: ['songs'] };
  const member     = { id: 2, role: 'approved', areas: [] };
  const admin      = { id: 3, role: 'admin' };
  const waiting    = { id: 4, role: 'pending', areas: ['songs'] };

  test('holding one area grants nothing else', () => {
    expect(hasArea(songLeader, 'songs')).toBe(true);
    expect(hasArea(songLeader, 'announcements')).toBe(false);
    expect(hasArea(songLeader, 'attendance')).toBe(false);
    expect(isAdmin(songLeader)).toBe(false);
  });

  test('a member with nothing granted looks after nothing', () => {
    expect(areasOf(member)).toEqual([]);
    expect(AREAS.every(a => !hasArea(member, a.id))).toBe(true);
  });

  test('an admin looks after every area without any being granted', () => {
    expect(AREAS.every(a => hasArea(admin, a.id))).toBe(true);
    expect(areasOf(admin)).toHaveLength(AREAS.length);
  });

  test('an account still waiting holds nothing, whatever it was granted', () => {
    expect(hasArea(waiting, 'songs')).toBe(false);
    expect(areasOf(waiting)).toEqual([]);
  });

  test('hasAnyArea covers a page two areas can write', () => {
    const calendarKeeper = { id: 5, role: 'approved', areas: ['calendar'] };
    expect(hasAnyArea(calendarKeeper, ['calendar', 'announcements'])).toBe(true);
    expect(hasAnyArea(member, ['calendar', 'announcements'])).toBe(false);
  });

  test('every area has something to show for itself', () => {
    for (const area of AREAS) {
      expect(areaInfo(area.id).label).toBeTruthy();
      expect(area.description).toBeTruthy();
      expect(area.page).toBeTruthy();
    }
    // Something that is not an area still renders rather than crashing.
    expect(areaInfo('nonsense').label).toBe('nonsense');
  });
});

// ─── Action History ───────────────────────────────────────────────────────────

describe('ActionHistoryView', () => {
  const ROWS = [
    {
      id: 2, user_id: 5, user_name: 'Cora', area: 'serving-schedule', action: 'update',
      entity: 'serving assignment', entity_id: '12', summary: 'Joe Carter signed up for Song Leader on June 7',
      details: { changes: { name: { from: '', to: 'Joe Carter' } } }, created_at: '2026-06-01 14:30:00',
    },
    {
      id: 1, user_id: 4, user_name: 'Gus', area: 'visitors', action: 'create',
      entity: 'guest', entity_id: '3', summary: 'Added guest Sam Rivers',
      details: { created: { name: 'Sam Rivers', city: 'Harvest' } }, created_at: '2026-05-31 09:00:00',
    },
  ];

  function mockHistory(rows = ROWS, total = rows.length) {
    const fetchMock = vi.fn(() => Promise.resolve({
      json: () => Promise.resolve({
        success: true, rows, total,
        actors: [{ id: 5, name: 'Cora', entries: 1 }, { id: 4, name: 'Gus', entries: 1 }],
        areas:  [{ area: 'serving-schedule', entries: 1 }, { area: 'visitors', entries: 1 }],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  afterEach(() => { vi.unstubAllGlobals(); });

  test('lists what everybody has changed, most recent first', async () => {
    mockHistory();
    render(<ActionHistoryView />);

    expect(await screen.findByText(/Joe Carter signed up for Song Leader/)).toBeInTheDocument();
    expect(screen.getByText('Added guest Sam Rivers')).toBeInTheDocument();
    expect(screen.getByText('Cora')).toBeInTheDocument();
    expect(screen.getByText('Guest Tracker')).toBeInTheDocument();
  });

  test('filtering by area asks the server for just that area', async () => {
    const fetchMock = mockHistory();
    render(<ActionHistoryView />);
    await screen.findByText('Added guest Sam Rivers');

    fireEvent.change(screen.getByLabelText(/^Area/), { target: { value: 'visitors' } });

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('area=visitors'))).toBe(true);
    });
  });

  test('opening an entry spells out what actually changed', async () => {
    mockHistory();
    render(<ActionHistoryView />);
    fireEvent.click(await screen.findByText(/Joe Carter signed up for Song Leader/));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('name')).toBeInTheDocument();
    expect(within(dialog).getByText('Joe Carter')).toBeInTheDocument();
  });

  test('an entry for something added shows what was added', async () => {
    mockHistory();
    render(<ActionHistoryView />);
    fireEvent.click(await screen.findByText('Added guest Sam Rivers'));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Sam Rivers')).toBeInTheDocument();
    expect(within(dialog).getByText('Harvest')).toBeInTheDocument();
  });

  test('says so when nothing matches the filters', async () => {
    mockHistory([], 0);
    render(<ActionHistoryView />);
    expect(await screen.findByText(/Nothing matches these filters/i)).toBeInTheDocument();
  });
});

// ─── Handing areas out ────────────────────────────────────────────────────────

describe('UsersView — areas', () => {
  const USERS = [
    { id: 1, name: 'Ada', email: 'ada@example.com', role: 'admin',    provider: 'google', areas: [], is_owner: false },
    { id: 2, name: 'Mel', email: 'mel@example.com', role: 'approved', provider: 'local',  areas: ['songs'], is_owner: false },
  ];

  function mockUsers() {
    const fetchMock = vi.fn((url, options) => {
      if (String(url).startsWith('/api/records/directory')) {
        return Promise.resolve({ json: () => Promise.resolve({ success: true, rows: [] }) });
      }
      if (options?.method === 'PATCH') {
        return Promise.resolve({ json: () => Promise.resolve({ success: true, user: USERS[1] }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ success: true, users: USERS, roles: ['pending', 'approved', 'admin'] }) });
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  afterEach(() => { vi.unstubAllGlobals(); });

  test('the grid says what each account looks after', async () => {
    mockUsers();
    render(<UsersView currentUser={{ id: 1, role: 'admin' }} />);
    await screen.findByRole('button', { name: 'Manage Mel' });

    const melRow = screen.getByText('Mel').closest('tr');
    expect(within(melRow).getByText('Song Tracker')).toBeInTheDocument();

    const adaRow = screen.getByText('Ada').closest('tr');
    expect(within(adaRow).getByText('Every area')).toBeInTheDocument();
  });

  test('ticking an area sends the whole set, not a change to it', async () => {
    const fetchMock = mockUsers();
    render(<UsersView currentUser={{ id: 1, role: 'admin' }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Manage Mel' }));

    const panel = screen.getByRole('dialog', { name: /details for mel/i });
    fireEvent.click(within(panel).getByLabelText('Attendance'));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, o]) => String(url) === '/api/auth/users/2/areas' && o?.method === 'PATCH');
      expect(JSON.parse(call[1].body).areas.sort()).toEqual(['attendance', 'songs']);
    });
  });

  test('an admin is told they already look after everything', async () => {
    mockUsers();
    render(<UsersView currentUser={{ id: 2, role: 'admin' }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Manage Ada' }));

    const panel = screen.getByRole('dialog', { name: /details for ada/i });
    expect(within(panel).getByText(/Admins look after every area/i)).toBeInTheDocument();
    expect(within(panel).queryByLabelText('Attendance')).not.toBeInTheDocument();
  });
});
