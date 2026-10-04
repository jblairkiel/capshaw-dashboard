import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, test, expect, vi, afterEach } from 'vitest';
import LoginPage from '../components/LoginPage';

// "Forgot your password?" on the sign-in page, and the form the emailed link opens.

function mockFetch(handler) {
  const fetchMock = vi.fn((url, options) =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(handler(url, options)) })
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const bodyOf = (fetchMock, url) => {
  const call = fetchMock.mock.calls.find(([called]) => called === url);
  return call ? JSON.parse(call[1].body) : null;
};

afterEach(() => vi.unstubAllGlobals());

describe('LoginPage — forgot your password', () => {
  test('carries the address already typed over, and asks for a link', async () => {
    const fetchMock = mockFetch(() => ({ success: true, message: 'If that address has an account here, an email is on its way.' }));
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'pat@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Forgot your password?' }));

    expect(screen.getByLabelText(/email address/i)).toHaveValue('pat@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Email me a link' }));
    expect(await screen.findByText('If that address has an account here, an email is on its way.')).toBeInTheDocument();
    expect(bodyOf(fetchMock, '/api/auth/forgot-password')).toEqual({ email: 'pat@example.com' });

    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeInTheDocument();
  });

  test('shows what the server refused', async () => {
    mockFetch(() => ({ success: false, error: 'Please enter a valid email address.' }));
    render(<LoginPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Forgot your password?' }));
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Email me a link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Please enter a valid email address.');
  });
});

describe('LoginPage — choosing a new password from the link', () => {
  test('opens straight to the form, saves, then invites them to sign in', async () => {
    const replace = vi.spyOn(window.history, 'replaceState');
    const fetchMock = mockFetch(() => ({ success: true, message: 'Your password has been changed. Please sign in with it.' }));
    render(<LoginPage resetToken="tok123" />);
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'creek-lantern-2041' } });
    fireEvent.change(screen.getByLabelText('New password again'), { target: { value: 'creek-lantern-2041' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save my new password' }));

    expect(await screen.findByText('Your password has been changed. Please sign in with it.')).toBeInTheDocument();
    expect(bodyOf(fetchMock, '/api/auth/reset-password')).toEqual({ token: 'tok123', password: 'creek-lantern-2041' });
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeInTheDocument();
    expect(replace).toHaveBeenCalled();
    replace.mockRestore();
  });

  test('never sends a password that does not match or is too short', () => {
    const fetchMock = mockFetch(() => ({ success: true }));
    render(<LoginPage resetToken="tok123" />);
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'creek-lantern-2041' } });
    fireEvent.change(screen.getByLabelText('New password again'), { target: { value: 'something-else-99' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save my new password' }));
    expect(screen.getByRole('alert')).toHaveTextContent('not the same');

    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'short' } });
    fireEvent.change(screen.getByLabelText('New password again'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save my new password' }));
    expect(screen.getByRole('alert')).toHaveTextContent('at least 10 characters');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('a dead link offers to send a new one', async () => {
    mockFetch(() => ({ success: false, code: 'reset_invalid', error: 'That link to choose a new password is no longer valid.' }));
    render(<LoginPage resetToken="old" />);
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'creek-lantern-2041' } });
    fireEvent.change(screen.getByLabelText('New password again'), { target: { value: 'creek-lantern-2041' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save my new password' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Send me a new link' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Email me a link' })).toBeInTheDocument());
  });
});
