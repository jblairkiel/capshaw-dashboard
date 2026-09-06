import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import LoginPage from '../components/LoginPage';
import AnnouncementsView from '../components/AnnouncementsView';
import UsersView from '../components/UsersView';
import { hasWriteAccess, isAdmin, hasRole } from '../lib/roles';

// ─── LoginPage ────────────────────────────────────────────────────────────────

describe('LoginPage', () => {
  test('renders Google sign-in link pointing to /api/auth/google', () => {
    render(<LoginPage />);
    const link = screen.getByRole('link', { name: /sign in with google/i });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toBe('/api/auth/google');
  });

  test('renders Facebook sign-in link pointing to /api/auth/facebook', () => {
    render(<LoginPage />);
    const link = screen.getByRole('link', { name: /sign in with facebook/i });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toBe('/api/auth/facebook');
  });
});

// ─── AnnouncementsView — permission gating ────────────────────────────────────

describe('AnnouncementsView — permission gating', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve({ success: true, items: [] }) })
    ));
  });

  test('hides "Add Item" button when user.role=pending', async () => {
    render(<AnnouncementsView user={{ role: 'pending' }} />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /add item/i })).not.toBeInTheDocument();
  });

  test('hides "Add Item" button when user.role=approved — announcements are admin-only', async () => {
    render(<AnnouncementsView user={{ role: 'approved' }} />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /add item/i })).not.toBeInTheDocument();
  });

  test('shows "Add Item" button when user.role=admin', async () => {
    render(<AnnouncementsView user={{ role: 'admin' }} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /add item/i })).toBeInTheDocument());
  });
});

// ─── Role helpers ─────────────────────────────────────────────────────────────

describe('role helpers', () => {
  test('members and admins have write access, pending users do not', () => {
    expect(hasWriteAccess({ role: 'admin' })).toBe(true);
    expect(hasWriteAccess({ role: 'approved' })).toBe(true);
    expect(hasWriteAccess({ role: 'pending' })).toBe(false);
    expect(hasWriteAccess(null)).toBe(false);
  });

  test('only admins carry admin privileges', () => {
    expect(isAdmin({ role: 'admin' })).toBe(true);
    expect(isAdmin({ role: 'approved' })).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
  });

  test('hasRole compares ranks rather than exact roles', () => {
    expect(hasRole({ role: 'admin' }, 'approved')).toBe(true);
    expect(hasRole({ role: 'approved' }, 'admin')).toBe(false);
  });
});

// ─── UsersView — role management ──────────────────────────────────────────────

const USERS = [
  { id: 1, name: 'Ada',  email: 'ada@example.com',  provider: 'google',   role: 'admin',    is_owner: true  },
  { id: 2, name: 'Mel',  email: 'mel@example.com',  provider: 'google',   role: 'approved', is_owner: false },
  { id: 3, name: 'Pat',  email: 'pat@example.com',  provider: 'facebook', role: 'pending',  is_owner: false },
  { id: 4, name: 'Sam',  email: 'sam@example.com',  provider: 'google',   role: 'admin',    is_owner: false },
];

function mockUsersFetch() {
  const fetchMock = vi.fn(() =>
    Promise.resolve({ json: () => Promise.resolve({ success: true, users: USERS }) })
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('UsersView — role management', () => {
  beforeEach(() => { mockUsersFetch(); });

  test('renders a role selector set to each user\'s current role', async () => {
    render(<UsersView currentUser={{ id: 4, role: 'admin' }} />);
    const melSelect = await screen.findByLabelText('Role for Mel');
    expect(melSelect.value).toBe('approved');
    expect(screen.getByLabelText('Role for Pat').value).toBe('pending');
  });

  test('changing a role PATCHes /api/auth/users/:id/role', async () => {
    const fetchMock = mockUsersFetch();
    render(<UsersView currentUser={{ id: 4, role: 'admin' }} />);
    const select = await screen.findByLabelText('Role for Mel');

    fireEvent.change(select, { target: { value: 'admin' } });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/users/2/role',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ role: 'admin' }) })
      );
    });
  });

  test('locks the selector for your own account and for the owner', async () => {
    render(<UsersView currentUser={{ id: 4, role: 'admin' }} />);
    expect(await screen.findByLabelText('Role for Sam')).toBeDisabled();  // self
    expect(screen.getByLabelText('Role for Ada')).toBeDisabled();         // owner
    expect(screen.getByLabelText('Role for Mel')).not.toBeDisabled();
  });

  test('explains what each role can do', async () => {
    render(<UsersView currentUser={{ id: 4, role: 'admin' }} />);
    expect(await screen.findByText(/what each role can do/i)).toBeInTheDocument();
    expect(screen.getByText(/editing every database table directly/i)).toBeInTheDocument();
  });
});
