import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { describe, test, expect, vi, afterEach } from 'vitest';

import ImpersonationBanner from '../components/ImpersonationBanner';
import ActionHistoryView from '../components/ActionHistoryView';
import UsersView from '../components/UsersView';

// ─── The banner ───────────────────────────────────────────────────────────────
//
// The rest of the screen is deliberately somebody else's portal, so the banner
// is the only thing saying so. It has to be unmissable, and it has to say that
// this is not a read-only view.

describe('ImpersonationBanner', () => {
  const MEMBER = { id: 2, name: 'Mel', role: 'approved' };
  const ADMIN  = { id: 1, name: 'Ada' };

  afterEach(() => { vi.unstubAllGlobals(); });

  test('names both people and warns that changes are real', () => {
    render(<ImpersonationBanner user={MEMBER} impersonatedBy={ADMIN} onStopped={() => {}} />);

    expect(screen.getByText(/Mel/)).toBeInTheDocument();
    expect(screen.getByText(/signed in as Ada/)).toBeInTheDocument();
    expect(screen.getByText(/recorded against you/i)).toBeInTheDocument();
  });

  test('stopping hands the admin back their own account', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({
      json: () => Promise.resolve({ success: true, user: { id: 1, name: 'Ada', role: 'admin' } }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const onStopped = vi.fn();
    render(<ImpersonationBanner user={MEMBER} impersonatedBy={ADMIN} onStopped={onStopped} />);
    fireEvent.click(screen.getByRole('button', { name: /back to my own account/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/auth/impersonate', expect.objectContaining({ method: 'DELETE' }));
      expect(onStopped).toHaveBeenCalledWith({ id: 1, name: 'Ada', role: 'admin' });
    });
  });

  test('a refusal is shown rather than silently leaving them stuck', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      json: () => Promise.resolve({ success: false, error: 'Your session has expired' }),
    })));

    render(<ImpersonationBanner user={MEMBER} impersonatedBy={ADMIN} onStopped={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /back to my own account/i }));

    expect(await screen.findByText('Your session has expired')).toBeInTheDocument();
  });
});

// ─── Starting it from Members & Access ────────────────────────────────────────

describe('UsersView — viewing as a member', () => {
  const USERS = [
    { id: 1, name: 'Ada', email: 'ada@example.com', role: 'admin',    provider: 'google', areas: [], is_owner: false },
    { id: 2, name: 'Mel', email: 'mel@example.com', role: 'approved', provider: 'local',  areas: [], is_owner: false },
    { id: 3, name: 'Bea', email: 'bea@example.com', role: 'admin',    provider: 'google', areas: [], is_owner: false },
  ];

  function mockUsers() {
    const fetchMock = vi.fn((url, options) => {
      if (String(url).startsWith('/api/records/directory')) {
        return Promise.resolve({ json: () => Promise.resolve({ success: true, rows: [] }) });
      }
      if (options?.method === 'POST') {
        return Promise.resolve({ json: () => Promise.resolve({ success: true, user: USERS[1] }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ success: true, users: USERS, roles: [] }) });
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  afterEach(() => { vi.unstubAllGlobals(); });

  test('is offered for a member, and for nobody else', async () => {
    mockUsers();
    render(<UsersView currentUser={{ id: 1, role: 'admin' }} />);
    await screen.findByRole('button', { name: 'Manage Mel' });

    expect(screen.getByRole('button', { name: 'View as Mel' })).toBeInTheDocument();
    // Not another admin, and not yourself.
    expect(screen.queryByRole('button', { name: 'View as Bea' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View as Ada' })).not.toBeInTheDocument();
  });

  test('asks the server for that account', async () => {
    const fetchMock = mockUsers();
    render(<UsersView currentUser={{ id: 1, role: 'admin' }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'View as Mel' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, o]) => String(url) === '/api/auth/impersonate' && o?.method === 'POST');
      expect(JSON.parse(call[1].body)).toEqual({ userId: 2 });
    });
  });

  test('a refusal is reported rather than swallowed', async () => {
    vi.stubGlobal('fetch', vi.fn((url, options) => {
      if (String(url).startsWith('/api/records/directory')) {
        return Promise.resolve({ json: () => Promise.resolve({ success: true, rows: [] }) });
      }
      if (options?.method === 'POST') {
        return Promise.resolve({ json: () => Promise.resolve({ success: false, error: 'Not somebody else\'s to borrow' }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ success: true, users: USERS, roles: [] }) });
    }));

    render(<UsersView currentUser={{ id: 1, role: 'admin' }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'View as Mel' }));

    expect(await screen.findByText(/not somebody else's to borrow/i)).toBeInTheDocument();
  });
});

// ─── How it reads afterwards ──────────────────────────────────────────────────

describe('ActionHistoryView — changes made while viewing as somebody', () => {
  const ROWS = [
    {
      id: 2, user_id: 2, user_name: 'Mel', acting_user_id: 1, acting_user_name: 'Ada',
      area: 'attendance', action: 'create', entity: 'attendance record', entity_id: '5',
      summary: 'Added attendance record — 2026-06-07 · Sun AM · 91',
      details: {}, created_at: '2026-06-07 14:00:00',
    },
    {
      id: 1, user_id: 1, user_name: 'Ada', acting_user_id: null, acting_user_name: '',
      area: 'songs', action: 'update', entity: 'song', entity_id: '3',
      summary: 'Edited song — Amazing Grace',
      details: {}, created_at: '2026-06-06 09:00:00',
    },
  ];

  function mockHistory() {
    const fetchMock = vi.fn(() => Promise.resolve({
      json: () => Promise.resolve({
        success: true, rows: ROWS, total: 2, impersonated: 1,
        actors: [{ id: 1, name: 'Ada', entries: 1 }, { id: 2, name: 'Mel', entries: 1 }],
        areas:  [{ area: 'attendance', entries: 1 }, { area: 'songs', entries: 1 }],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  afterEach(() => { vi.unstubAllGlobals(); });

  test('names both the account and the admin behind it', async () => {
    mockHistory();
    render(<ActionHistoryView />);

    const row = (await screen.findByText(/Added attendance record/)).closest('tr');
    expect(within(row).getByText('Ada')).toBeInTheDocument();
    expect(within(row).getByText('viewing as Mel')).toBeInTheDocument();
  });

  test('an ordinary change names one person only', async () => {
    mockHistory();
    render(<ActionHistoryView />);

    const row = (await screen.findByText(/Edited song/)).closest('tr');
    expect(within(row).getByText('Ada')).toBeInTheDocument();
    expect(within(row).queryByText(/viewing as/)).not.toBeInTheDocument();
  });

  test('they can be filtered down to on their own', async () => {
    const fetchMock = mockHistory();
    render(<ActionHistoryView />);
    await screen.findByText(/Added attendance record/);

    fireEvent.click(screen.getByLabelText(/only while viewing as somebody/i));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('actingOnly=true'))).toBe(true);
    });
  });
});
