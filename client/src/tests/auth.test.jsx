import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import App from '../App';
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

  test('welcomes the church family rather than staff', () => {
    render(<LoginPage />);
    expect(screen.getByText(/member portal/i)).toBeInTheDocument();
    expect(screen.getByText(/members and friends of Capshaw Church of Christ/i)).toBeInTheDocument();
    expect(screen.queryByText(/staff/i)).not.toBeInTheDocument();
  });

  test('offers no way past the sign-in', () => {
    render(<LoginPage />);
    expect(screen.queryByText(/continue without signing in/i)).not.toBeInTheDocument();
  });
});

// ─── App — the site is signed-in only ─────────────────────────────────────────

function mockApi(user) {
  const fetchMock = vi.fn(url => {
    if (url.startsWith('/api/auth/me')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ user }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, data: null }) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('App — site-wide sign-in gate', () => {
  const portalFooter = /Capshaw Church of Christ — Member Portal/;

  test('shows the sign-in page, and no portal content, when signed out', async () => {
    mockApi(null);
    render(<App />);
    expect(await screen.findByRole('link', { name: /sign in with google/i })).toBeInTheDocument();
    expect(screen.queryByText(portalFooter)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /refresh/i })).not.toBeInTheDocument();
  });

  test('shows the portal once a member is signed in', async () => {
    mockApi({ id: 1, name: 'Mel', role: 'approved' });
    render(<App />);
    expect(await screen.findByText(portalFooter)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /sign in with google/i })).not.toBeInTheDocument();
  });

  test('signing out drops straight back to the sign-in page', async () => {
    mockApi({ id: 1, name: 'Mel', role: 'approved' });
    render(<App />);
    await screen.findByText(portalFooter);

    fireEvent.click(screen.getByRole('button', { name: /Mel/ }));
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));

    expect(await screen.findByRole('link', { name: /sign in with google/i })).toBeInTheDocument();
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

/** Opens the detail menu for one user and waits for the drawer to appear. */
async function openDetail(name) {
  fireEvent.click(await screen.findByRole('button', { name: `Manage ${name}` }));
  return screen.findByRole('dialog', { name: `Details for ${name}` });
}

describe('UsersView — role management', () => {
  beforeEach(() => { mockUsersFetch(); });

  test('lists every account in the grid', async () => {
    render(<UsersView currentUser={{ id: 4, role: 'admin' }} />);
    for (const u of USERS) {
      expect(await screen.findByRole('button', { name: `Manage ${u.name}` })).toBeInTheDocument();
    }
  });

  test('the detail menu shows the role options with the current one selected', async () => {
    render(<UsersView currentUser={{ id: 4, role: 'admin' }} />);
    const drawer = await openDetail('Mel');

    expect(within(drawer).getByRole('radio', { name: 'Member role' })).toBeChecked();
    expect(within(drawer).getByRole('radio', { name: 'Admin role' })).not.toBeChecked();
  });

  test('assigning a role from the detail menu PATCHes /api/auth/users/:id/role', async () => {
    const fetchMock = mockUsersFetch();
    render(<UsersView currentUser={{ id: 4, role: 'admin' }} />);
    const drawer = await openDetail('Mel');

    fireEvent.click(within(drawer).getByRole('radio', { name: 'Admin role' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/users/2/role',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ role: 'admin' }) })
      );
    });
  });

  test('approving a pending user from the grid PATCHes them to approved', async () => {
    const fetchMock = mockUsersFetch();
    render(<UsersView currentUser={{ id: 4, role: 'admin' }} />);

    fireEvent.click(await screen.findByRole('button', { name: /^approve$/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/users/3/role',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ role: 'approved' }) })
      );
    });
  });

  test('locks the role controls for your own account and for the owner', async () => {
    render(<UsersView currentUser={{ id: 4, role: 'admin' }} />);

    const self = await openDetail('Sam');
    expect(within(self).getByRole('radio', { name: 'Admin role' })).toBeDisabled();
    expect(within(self).getByText(/cannot change your own role/i)).toBeInTheDocument();
    fireEvent.click(within(self).getByRole('button', { name: /close details/i }));

    const owner = await openDetail('Ada');
    expect(within(owner).getByRole('radio', { name: 'Admin role' })).toBeDisabled();
    expect(within(owner).getByText(/owner account is always an admin/i)).toBeInTheDocument();
    fireEvent.click(within(owner).getByRole('button', { name: /close details/i }));

    const other = await openDetail('Mel');
    expect(within(other).getByRole('radio', { name: 'Admin role' })).not.toBeDisabled();
  });

  test('links an account to a directory entry from the detail menu', async () => {
    const fetchMock = mockUsersFetch();
    render(<UsersView currentUser={{ id: 4, role: 'admin' }} />);
    const drawer = await openDetail('Mel');

    fireEvent.change(within(drawer).getByLabelText('Directory entry for Mel'), { target: { value: '' } });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/users/2/directory',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ directory_id: null }) })
      );
    });
  });

  test('explains what each role can do', async () => {
    render(<UsersView currentUser={{ id: 4, role: 'admin' }} />);
    expect(await screen.findByText(/what each role can do/i)).toBeInTheDocument();
    expect(screen.getByText(/editing every database table directly/i)).toBeInTheDocument();
  });
});
