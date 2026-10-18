import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { describe, test, expect, vi, afterEach } from 'vitest';
import LoginPage from '../components/LoginPage';
import UsersView from '../components/UsersView';

// ─── A Google or Facebook sign-in that shares an address with an account ──────
//
// It is joined only once an admin approves it. These cover the two screens that
// see that: the sign-in page telling the person why they are not in, and the
// panel on Members & Access where an admin decides.

describe('LoginPage — a sign-in waiting to be joined', () => {
  test('says the join is waiting on an admin, as a warning rather than a failure', () => {
    render(<LoginPage authError="link_pending" providers={['google']} />);
    const banner = screen.getByText(/an admin will confirm this sign-in is you/i);
    expect(banner).toHaveClass('bg-amber-50');
    expect(banner).toHaveTextContent(/sign in the way you did before/i);
  });

  test('says when an admin declined it', () => {
    render(<LoginPage authError="link_declined" providers={['google']} />);
    const banner = screen.getByText(/was not joined to the account/i);
    expect(banner).toHaveClass('bg-red-50');
  });

  test('an unknown reason is a plain failure, even one that names a built-in property', () => {
    render(<LoginPage authError="toString" providers={['google']} />);
    expect(screen.getByText('Sign-in failed. Please try again.')).toBeInTheDocument();
  });
});

const USERS = [
  { id: 1, name: 'Ada', email: 'ada@example.com', provider: 'google', role: 'admin',    is_owner: true,  created_at: '2024-01-02' },
  { id: 2, name: 'Ray', email: 'ray@example.com', provider: 'google', role: 'approved', is_owner: false, created_at: '2024-03-04' },
];

const RAY_REQUEST = {
  id: 10, provider: 'facebook', email: 'ray@example.com', status: 'pending', created_at: '2026-10-01 12:00:00',
  user_id: 2, account_name: 'Ray', account_email: 'ray@example.com', account_provider: 'google', account_role: 'approved',
};
const ADA_REQUEST = {
  id: 11, provider: 'facebook', email: 'ada@example.com', status: 'pending', created_at: '2026-10-02 12:00:00',
  user_id: 1, account_name: 'Ada', account_email: 'ada@example.com', account_provider: 'google', account_role: 'admin',
};

function mockApi({ requests = [RAY_REQUEST], decide } = {}) {
  const fetchMock = vi.fn((url, options = {}) => {
    let body;
    if (url === '/api/auth/users') body = { success: true, users: USERS };
    else if (url === '/api/auth/link-requests') body = { success: true, requests };
    else if (url.startsWith('/api/auth/link-requests/')) body = decide ? decide(url, options) : { success: true };
    else body = { rows: [] };
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function renderAs(currentUser = { id: 1, role: 'admin' }) {
  render(<UsersView currentUser={currentUser} />);
  await screen.findByRole('button', { name: 'Manage Ada' });
}

const panel = () => screen.queryByRole('region', { name: /sign-ins waiting to be joined/i });

describe('UsersView — sign-ins waiting to be joined', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  test('shows nothing when nothing is waiting', async () => {
    mockApi({ requests: [] });
    await renderAs();
    expect(panel()).toBeNull();
  });

  test('lists each request with the account it would join', async () => {
    mockApi();
    await renderAs();

    const box = panel();
    expect(box).toBeInTheDocument();
    expect(within(box).getByText('Facebook')).toBeInTheDocument();
    expect(within(box).getByText(/wants to join/)).toHaveTextContent('wants to join Ray (ray@example.com, signs in with Google)');
  });

  test('approving sends the decision and takes the request off the list', async () => {
    const fetchMock = mockApi({
      decide: () => ({ success: true, user: { ...USERS[1], linked_providers: ['facebook'] } }),
    });
    await renderAs();

    fireEvent.click(screen.getByRole('button', { name: 'Approve Facebook sign-in for Ray' }));

    await waitFor(() => expect(panel()).toBeNull());
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/link-requests/10/approve', { method: 'PATCH' });
    // Ray's row now shows both ways in.
    const row = screen.getByRole('button', { name: 'Manage Ray' }).closest('tr');
    expect(within(row).getByText('Facebook')).toBeInTheDocument();
  });

  test('declining sends the decision and takes the request off the list', async () => {
    const fetchMock = mockApi();
    await renderAs();

    fireEvent.click(screen.getByRole('button', { name: 'Decline Facebook sign-in for Ray' }));

    await waitFor(() => expect(panel()).toBeNull());
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/link-requests/10/decline', { method: 'PATCH' });
  });

  test('an admin is not offered Approve on their own account, only Decline', async () => {
    mockApi({ requests: [ADA_REQUEST, RAY_REQUEST] });
    await renderAs({ id: 1, role: 'admin' });

    expect(screen.queryByRole('button', { name: 'Approve Facebook sign-in for Ada' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Decline Facebook sign-in for Ada' })).toBeInTheDocument();
    expect(screen.getByText(/another admin has to approve it/i)).toBeInTheDocument();
    // Somebody else's request is still theirs to approve.
    expect(screen.getByRole('button', { name: 'Approve Facebook sign-in for Ray' })).toBeInTheDocument();
  });

  test('a refusal from the server is shown, and the request stays', async () => {
    mockApi({ decide: () => ({ success: false, error: 'That sign-in request has already been declined.' }) });
    await renderAs();

    fireEvent.click(screen.getByRole('button', { name: 'Approve Facebook sign-in for Ray' }));

    expect(await screen.findByText('That sign-in request has already been declined.')).toBeInTheDocument();
    expect(panel()).toBeInTheDocument();
  });

  test('the page still loads if the requests cannot be fetched', async () => {
    vi.stubGlobal('fetch', vi.fn(url => {
      if (url === '/api/auth/link-requests') return Promise.reject(new Error('offline'));
      const body = url === '/api/auth/users' ? { success: true, users: USERS } : { rows: [] };
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
    }));
    await renderAs();
    expect(panel()).toBeNull();
  });
});
