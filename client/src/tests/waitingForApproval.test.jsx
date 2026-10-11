import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, test, expect, vi, afterEach } from 'vitest';
import WaitingForApproval from '../components/WaitingForApproval';
import App from '../App';

const PAT = { id: 3, name: 'Pat Nolan', email: 'pat@example.com', role: 'pending' };
const CONTACTS = {
  success: true, approved: false, you: { name: 'Pat Nolan', email: 'pat@example.com', provider: 'local' },
  admins: [{ name: 'Ada Admin', cell: '(256) 555-0142' }, { name: 'Bo Admin', cell: null }],
};

function mockFetch(answer) {
  const fetchMock = vi.fn(url => Promise.resolve({ ok: true, json: () => Promise.resolve(answer(String(url))) }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('waiting for approval', () => {
  test('says the admins have been told, and lists who to contact to speed it up', async () => {
    mockFetch(() => CONTACTS);
    render(<WaitingForApproval user={PAT} onApproved={vi.fn()} onLogout={vi.fn()} />);
    expect(screen.getByRole('heading', { name: /Welcome, Pat! Your account is waiting to be approved/ })).toBeInTheDocument();
    expect(screen.getByText(/admins have been notified automatically/)).toBeInTheDocument();
    expect(screen.getByText(/if you would like to speed things up, you could call or text one of them/)).toBeInTheDocument();
    expect(screen.getByText('pat@example.com')).toBeInTheDocument();

    const list = await screen.findByRole('list', { name: 'Admins you can contact' });
    expect(within(list).getByRole('link', { name: 'Call or text Ada Admin at (256) 555-0142' })).toHaveAttribute('href', 'tel:2565550142');
    expect(within(list).getByText('Bo Admin')).toBeInTheDocument();
    expect(within(list).getByText('No cellphone on file')).toBeInTheDocument();
  });

  test('checking again lets them in once approved, and says so while it has not', async () => {
    let role = 'pending';
    mockFetch(url => (url === '/api/auth/me' ? { success: true, user: { ...PAT, role } } : CONTACTS));
    const onApproved = vi.fn();
    render(<WaitingForApproval user={PAT} onApproved={onApproved} onLogout={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/still waiting/);
    role = 'approved';
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(onApproved).toHaveBeenCalledWith(expect.objectContaining({ role: 'approved' })));
  });

  test('signs out', async () => {
    const fetchMock = mockFetch(() => CONTACTS);
    const onLogout = vi.fn();
    render(<WaitingForApproval user={PAT} onApproved={vi.fn()} onLogout={onLogout} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(onLogout).toHaveBeenCalled());
    expect(fetchMock.mock.calls.some(([url, o]) => url === '/api/auth/logout' && o?.method === 'POST')).toBe(true);
  });

  test('the app shows a waiting account nothing but this page', async () => {
    const fetchMock = mockFetch(url => (url === '/api/auth/me' ? { success: true, user: PAT, impersonatedBy: null } : CONTACTS));
    render(<App />);
    expect(await screen.findByRole('heading', { name: /waiting to be approved/ })).toBeInTheDocument();
    // No menu, and nothing of the portal asked for.
    expect(screen.queryByRole('button', { name: /^Worship/ })).not.toBeInTheDocument();
    await screen.findByRole('list', { name: 'Admins you can contact' });
    expect(fetchMock.mock.calls.map(([url]) => String(url)).sort()).toEqual(['/api/auth/me', '/api/welcome/contacts']);
  });
});
