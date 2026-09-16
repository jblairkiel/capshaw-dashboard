import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import LoginPage from '../components/LoginPage';
import UsersView from '../components/UsersView';

// ─── Registering, and the two gates after it ──────────────────────────────────

function mockFetch(handler) {
  const fetchMock = vi.fn((url, options) =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(handler(url, options)) })
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function bodyOf(fetchMock, url) {
  const call = fetchMock.mock.calls.find(([called]) => called === url);
  return call ? JSON.parse(call[1].body) : null;
}

describe('LoginPage — signing in with an email address and password', () => {
  test('offers a password sign-in alongside the two providers', () => {
    render(<LoginPage />);
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /sign in with google/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /sign in with facebook/i })).toBeInTheDocument();
  });

  async function signIn(password = 'harvest-oak-1963') {
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'pat@example.com' } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: password } });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
  }

  test('POSTs the credentials and hands the signed-in user back', async () => {
    const user = { id: 7, name: 'Pat Nolan', role: 'approved' };
    const fetchMock = mockFetch(() => ({ success: true, user }));
    const onSignedIn = vi.fn();

    render(<LoginPage onSignedIn={onSignedIn} />);
    await signIn();

    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(user));
    expect(bodyOf(fetchMock, '/api/auth/login'))
      .toEqual({ email: 'pat@example.com', password: 'harvest-oak-1963' });
  });

  test('shows the server\'s reason when the account is still waiting on an admin', async () => {
    mockFetch(() => ({
      success: false, code: 'pending_approval',
      error: 'The church office still has to approve your account.',
    }));
    const onSignedIn = vi.fn();

    render(<LoginPage onSignedIn={onSignedIn} />);
    await signIn();

    expect(await screen.findByRole('alert')).toHaveTextContent(/still has to approve/i);
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  test('offers to send the confirmation email again when it has not been answered', async () => {
    const fetchMock = mockFetch(url =>
      url === '/api/auth/login'
        ? { success: false, code: 'email_unverified', error: 'Please confirm your email address first.' }
        : { success: true, message: 'Another confirmation email is on its way.' }
    );

    render(<LoginPage />);
    await signIn();

    const resend = await screen.findByRole('button', { name: /send the confirmation email again/i });
    fireEvent.click(resend);

    await waitFor(() => {
      expect(bodyOf(fetchMock, '/api/auth/resend-verification')).toEqual({ email: 'pat@example.com' });
    });
    expect(await screen.findByText(/on its way/i)).toBeInTheDocument();
  });

  test('a wrong password leaves nobody signed in', async () => {
    mockFetch(() => ({ success: false, error: 'That email address and password do not match an account here.' }));
    const onSignedIn = vi.fn();

    render(<LoginPage onSignedIn={onSignedIn} />);
    await signIn('not-the-password');

    expect(await screen.findByRole('alert')).toHaveTextContent(/do not match/i);
    expect(onSignedIn).not.toHaveBeenCalled();
  });
});

describe('LoginPage — creating an account', () => {
  function openRegistration() {
    render(<LoginPage />);
    fireEvent.click(screen.getByRole('button', { name: /create one/i }));
  }

  function fill({ name = 'Pat Nolan', email = 'pat@example.com', password = 'harvest-oak-1963', confirm = password } = {}) {
    fireEvent.change(screen.getByLabelText(/your name/i),      { target: { value: name } });
    fireEvent.change(screen.getByLabelText(/email address/i),  { target: { value: email } });
    fireEvent.change(screen.getByLabelText(/^password$/i),     { target: { value: password } });
    fireEvent.change(screen.getByLabelText(/password again/i), { target: { value: confirm } });
    fireEvent.click(screen.getByRole('button', { name: /create my account/i }));
  }

  test('explains that confirming the email and an admin approval both come first', () => {
    openRegistration();
    expect(screen.getByText(/confirm your email address/i)).toBeInTheDocument();
    expect(screen.getByText(/church office approves your account/i)).toBeInTheDocument();
  });

  test('POSTs the registration and then asks them to check their email', async () => {
    const fetchMock = mockFetch(() => ({ success: true, message: 'A confirmation email is on its way.' }));
    openRegistration();
    fill();

    await waitFor(() => {
      expect(bodyOf(fetchMock, '/api/auth/register'))
        .toEqual({ name: 'Pat Nolan', email: 'pat@example.com', password: 'harvest-oak-1963' });
    });
    expect(await screen.findByText(/check your email/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create my account/i })).not.toBeInTheDocument();
  });

  test('never sends the password when the two do not match', async () => {
    const fetchMock = mockFetch(() => ({ success: true }));
    openRegistration();
    fill({ confirm: 'something-else-entirely' });

    expect(await screen.findByRole('alert')).toHaveTextContent(/not the same/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('catches a short password before asking the server', async () => {
    const fetchMock = mockFetch(() => ({ success: true }));
    openRegistration();
    fill({ password: 'short' });

    expect(await screen.findByRole('alert')).toHaveTextContent(/at least 10 characters/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('shows what the server refused, and keeps the form', async () => {
    mockFetch(() => ({ success: false, error: 'That password is too easy to guess.' }));
    openRegistration();
    fill({ password: 'password123', confirm: 'password123' });

    expect(await screen.findByRole('alert')).toHaveTextContent(/too easy to guess/i);
    expect(screen.getByRole('button', { name: /create my account/i })).toBeInTheDocument();
  });
});

describe('LoginPage — coming back from the confirmation link', () => {
  test('a confirmed address that still needs approval says so', () => {
    render(<LoginPage verified="pending" />);
    expect(screen.getByRole('status')).toHaveTextContent(/church office still has to approve/i);
  });

  test('a confirmed and approved account is invited to sign in', () => {
    render(<LoginPage verified="1" />);
    expect(screen.getByRole('status')).toHaveTextContent(/ready.*sign in/i);
  });

  test('an expired link explains how to get another', () => {
    render(<LoginPage verifyError="expired" />);
    expect(screen.getByRole('status')).toHaveTextContent(/expired/i);
  });

  test('an unrecognised outcome still says something useful', () => {
    render(<LoginPage verifyError="something-new" />);
    expect(screen.getByRole('status')).toHaveTextContent(/did not work/i);
  });
});

// ─── Approving: access and a member profile, in one act ───────────────────────

const USERS = [
  { id: 1, name: 'Ada', email: 'ada@example.com', provider: 'google', role: 'admin', is_owner: true },
  { id: 3, name: 'Pat Nolan', email: 'pat@example.com', provider: 'local', role: 'pending', is_owner: false, email_verified_at: '2026-09-01 10:00:00' },
  { id: 5, name: 'Jo Nolan', email: 'jo@example.com', provider: 'local', role: 'pending', is_owner: false, email_verified_at: null },
];

const PEOPLE = [
  { id: 11, name: 'Pat Nolan', email: 'pat@example.com' },
  { id: 12, name: 'Ray Harris', email: 'ray@example.com' },
];

function mockAdminFetch(approveResult = { success: true }) {
  const fetchMock = vi.fn(url => {
    if (url.startsWith('/api/admin/directory')) {
      return Promise.resolve({ json: () => Promise.resolve({ rows: PEOPLE }) });
    }
    if (url.includes('/approve')) {
      return Promise.resolve({ json: () => Promise.resolve(approveResult) });
    }
    return Promise.resolve({ json: () => Promise.resolve({ success: true, users: USERS }) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function openApproval(name = 'Pat Nolan') {
  render(<UsersView currentUser={{ id: 1, role: 'admin' }} />);
  fireEvent.click(await screen.findByRole('button', { name: `Manage ${name}` }));
  const drawer = await screen.findByRole('dialog', { name: `Details for ${name}` });
  fireEvent.click(within(drawer).getByRole('button', { name: /approve and give them a profile/i }));
  return screen.findByRole('dialog', { name: `Approve ${name}` });
}

describe('UsersView — approving creates or pairs a member profile', () => {
  beforeEach(() => { mockAdminFetch(); });

  test('the approval dialog will not submit until somebody is chosen', async () => {
    const dialog = await openApproval('Jo Nolan');
    // Nobody in the directory matches Jo, so it opens on "somebody new" with
    // the name prefilled — clearing it leaves nothing to approve with.
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: '' } });
    expect(within(dialog).getByRole('button', { name: /approve jo nolan/i })).toBeDisabled();
  });

  test('pairs with the directory entry that matches, and says it is only a suggestion', async () => {
    const fetchMock = mockAdminFetch();
    const dialog = await openApproval();

    expect(within(dialog).getByLabelText(/member directory entry/i)).toHaveValue('11');
    expect(within(dialog).getByText(/suggested because it matches/i)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: /approve pat nolan/i }));

    await waitFor(() => {
      expect(bodyOf(fetchMock, '/api/auth/users/3/approve'))
        .toEqual({ role: 'approved', directory_id: 11 });
    });
  });

  test('pairs with a different person when the admin picks one', async () => {
    const fetchMock = mockAdminFetch();
    const dialog = await openApproval();

    fireEvent.change(within(dialog).getByLabelText(/member directory entry/i), { target: { value: '12' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /approve pat nolan/i }));

    await waitFor(() => {
      expect(bodyOf(fetchMock, '/api/auth/users/3/approve').directory_id).toBe(12);
    });
  });

  test('creates a new directory entry for somebody new to us', async () => {
    const fetchMock = mockAdminFetch();
    const dialog = await openApproval('Jo Nolan');

    fireEvent.change(within(dialog).getByLabelText(/^Mobile/), { target: { value: '256-555-0143' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /approve jo nolan/i }));

    await waitFor(() => {
      const body = bodyOf(fetchMock, '/api/auth/users/5/approve');
      expect(body.directory_id).toBeUndefined();
      expect(body.person).toMatchObject({ name: 'Jo Nolan', email: 'jo@example.com', cell: '256-555-0143' });
    });
  });

  test('can hand out a role above plain member at the same time', async () => {
    const fetchMock = mockAdminFetch();
    const dialog = await openApproval();

    fireEvent.change(within(dialog).getByLabelText(/what may they do/i), { target: { value: 'worship-coordinator' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /approve pat nolan/i }));

    await waitFor(() => {
      expect(bodyOf(fetchMock, '/api/auth/users/3/approve').role).toBe('worship-coordinator');
    });
  });

  test('keeps the dialog open and explains a refusal', async () => {
    mockAdminFetch({ success: false, error: 'Already linked to Ray Harris' });
    const dialog = await openApproval();

    fireEvent.click(within(dialog).getByRole('button', { name: /approve pat nolan/i }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/already linked to ray harris/i);
    expect(screen.getByRole('dialog', { name: /approve pat nolan/i })).toBeInTheDocument();
  });

  test('warns when an account has not answered its confirmation email yet', async () => {
    render(<UsersView currentUser={{ id: 1, role: 'admin' }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Manage Jo Nolan' }));
    const drawer = await screen.findByRole('dialog', { name: 'Details for Jo Nolan' });

    expect(within(drawer).getByText(/have not opened the confirmation email/i)).toBeInTheDocument();
  });
});
