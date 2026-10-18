import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, test, expect, vi, afterEach } from 'vitest';
import WaitingForApproval from '../components/WaitingForApproval';
import LoginPage from '../components/LoginPage';
import UsersView from '../components/UsersView';

// A Facebook sign-in that came without an email address, waiting for approval.
const SAM = { id: 4, name: 'Sam Reed', email: null, provider: 'facebook', role: 'pending', pending_email: '' };
const contactsFor = user => ({
  success: true, approved: false,
  you: { name: user.name, email: user.email, provider: user.provider },
  admins: [{ name: 'Ada Admin', cell: '(256) 555-0142' }],
});

function mockFetch(answer) {
  const fetchMock = vi.fn((url, opts) => Promise.resolve({ ok: true, json: () => Promise.resolve(answer(String(url), opts)) }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const waiting = (user, props = {}) =>
  render(<WaitingForApproval user={user} onApproved={vi.fn()} onLogout={vi.fn()} {...props} />);

afterEach(() => vi.unstubAllGlobals());

describe('waiting page — adding an email address', () => {
  test('asks for one when the sign-in gave none, naming the provider', async () => {
    mockFetch(() => contactsFor(SAM));
    waiting(SAM);
    expect(screen.getByRole('heading', { name: 'Add your email address' })).toBeInTheDocument();
    expect(screen.getByText(/Facebook did not give us an email address/)).toBeInTheDocument();
    await screen.findByRole('list', { name: 'Admins you can contact' });
  });

  test('does not ask when the account has an address', async () => {
    const pat = { ...SAM, email: 'pat@example.com', provider: 'google' };
    mockFetch(() => contactsFor(pat));
    waiting(pat);
    await screen.findByRole('list', { name: 'Admins you can contact' });
    expect(screen.queryByRole('heading', { name: 'Add your email address' })).not.toBeInTheDocument();
  });

  test('sends the address and says a link is on its way', async () => {
    const fetchMock = mockFetch((url) => url === '/api/auth/add-email'
      ? { success: true, pending_email: 'sam@example.com', message: 'We have sent a link to sam@example.com. Open it to add the address to your account.' }
      : contactsFor(SAM));
    waiting(SAM);

    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'sam@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send me a link' }));

    expect(await screen.findByText(/We have sent a link to sam@example.com/)).toBeInTheDocument();
    const call = fetchMock.mock.calls.find(([u]) => u === '/api/auth/add-email');
    expect(call[1].method).toBe('POST');
    expect(JSON.parse(call[1].body)).toEqual({ email: 'sam@example.com' });
    expect(screen.getByRole('button', { name: 'Send it again' })).toBeInTheDocument();
  });

  test('shows what the server says is wrong', async () => {
    mockFetch(url => url === '/api/auth/add-email'
      ? { success: false, error: 'Please enter a valid email address.' }
      : contactsFor(SAM));
    waiting(SAM);
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send me a link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Please enter a valid email address.');
  });

  test('remembers an address still waiting on its link', async () => {
    mockFetch(() => contactsFor(SAM));
    waiting({ ...SAM, pending_email: 'sam@example.com' });
    expect(screen.getByLabelText('Email address')).toHaveValue('sam@example.com');
    expect(screen.getByText(/We have sent a link to sam@example.com/)).toBeInTheDocument();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
  });

  test('says when the link has added the address', async () => {
    const added = { ...SAM, email: 'sam@example.com' };
    mockFetch(() => contactsFor(added));
    waiting(added, { verified: 'added' });
    expect(screen.getByText(/your email address is confirmed and added to your account/)).toBeInTheDocument();
    await screen.findByRole('list', { name: 'Admins you can contact' });
    expect(screen.queryByRole('heading', { name: 'Add your email address' })).not.toBeInTheDocument();
  });

  test('says when the address was taken in the meantime', async () => {
    mockFetch(() => contactsFor(SAM));
    waiting(SAM, { verifyError: 'taken' });
    expect(screen.getByText(/now belongs to another account here, so it was not added/)).toBeInTheDocument();
    await screen.findByRole('list', { name: 'Admins you can contact' });
  });
});

describe('sign-in page — the link opened while signed out', () => {
  test('confirms the address was added', () => {
    render(<LoginPage verified="added" />);
    expect(screen.getByText(/confirmed and added to your account/)).toBeInTheDocument();
  });

  test('explains an address that was taken', () => {
    render(<LoginPage verifyError="taken" />);
    expect(screen.getByText(/now belongs to another account here/)).toBeInTheDocument();
  });
});

describe('Members & Access — an account with no email', () => {
  const USERS = [
    { id: 1, name: 'Ada', email: 'ada@example.com', provider: 'google',   role: 'admin',   is_owner: true,  created_at: '2024-01-02', directory_name: 'Ada Byron' },
    { id: 4, name: 'Sam', email: null,              provider: 'facebook', role: 'pending', is_owner: false, created_at: '2024-07-08', directory_name: null },
  ];

  test('is flagged in the list, and explained when opened', async () => {
    mockFetch(() => ({ success: true, users: USERS }));
    render(<UsersView currentUser={{ id: 1, role: 'admin' }} />);
    await screen.findByRole('button', { name: 'Manage Sam' });

    expect(screen.getAllByText('No email').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Manage Sam' }));
    expect(await screen.findByText(/Their Facebook gave no email address/)).toBeInTheDocument();
  });
});
