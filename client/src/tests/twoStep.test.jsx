import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, test, expect, vi, afterEach } from 'vitest';
import LoginPage from '../components/LoginPage';
import App from '../App';
import { TwoStepSetup, TwoStepSettings } from '../components/TwoStep';

// ─── Two-step sign-in: the code step, the setup, and My Info ──────────────────

function mockFetch(handler) {
  const fetchMock = vi.fn((url, options) => {
    const { status = 200, body } = handler(String(url), options) || {};
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body ?? { success: true }) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const bodyOf = (fetchMock, url) => {
  const call = fetchMock.mock.calls.findLast(([called]) => called === url);
  return call?.[1]?.body ? JSON.parse(call[1].body) : null;
};

afterEach(() => { vi.unstubAllGlobals(); });

const ADA = { id: 1, name: 'Ada', email: 'ada@example.com', role: 'admin', two_step: { enabled: true, required: true, recovery_codes_left: 10 } };

describe('signing in with a code', () => {
  test('a right password for an account with it on asks for the code, then signs in', async () => {
    const onSignedIn = vi.fn();
    const fetchMock = mockFetch(url => {
      if (url === '/api/auth/login') return { status: 401, body: { success: false, code: 'two_step_required' } };
      if (url === '/api/auth/two-step/verify') return { body: { success: true, user: ADA } };
      return {};
    });
    render(<LoginPage providers={[]} onSignedIn={onSignedIn} />);
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'a long password' } });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    const code = await screen.findByLabelText(/six-digit code/i);
    expect(screen.queryByLabelText(/^password$/i)).not.toBeInTheDocument();
    fireEvent.change(code, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(ADA));
    expect(bodyOf(fetchMock, '/api/auth/two-step/verify')).toEqual({ code: '123456' });
  });

  test('a wrong code says so and lets them try again; a recovery code can be used instead', async () => {
    mockFetch(url => {
      if (url === '/api/auth/two-step/verify') return { status: 401, body: { success: false, code: 'two_step_wrong', error: 'That code did not work.' } };
      return {};
    });
    render(<LoginPage providers={[]} secondStep />);
    fireEvent.change(screen.getByLabelText(/six-digit code/i), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That code did not work.');
    fireEvent.click(screen.getByRole('button', { name: /use a recovery code/i }));
    expect(screen.getByLabelText(/recovery code/i)).toBeInTheDocument();
    expect(screen.getByText(/ask another admin to reset/i)).toBeInTheDocument();
  });

  test('after Google or Facebook, the page opens on the code step', async () => {
    mockFetch(url => {
      if (url.startsWith('/api/auth/me')) return { status: 401, body: { success: false, code: 'two_step_required' } };
      if (url.startsWith('/api/auth/providers')) return { body: { success: true, providers: ['google'] } };
      return {};
    });
    render(<App />);
    expect(await screen.findByLabelText(/six-digit code/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /sign in with google/i })).not.toBeInTheDocument();
  });
});

describe('setting it up', () => {
  test('an admin without it sees only the setup page', async () => {
    mockFetch(url => {
      if (url.startsWith('/api/auth/me')) return { body: { success: true, user: { ...ADA, two_step: { enabled: false, required: true } } } };
      return {};
    });
    render(<App />);
    expect(await screen.findByRole('heading', { name: /set up two-step sign-in/i })).toBeInTheDocument();
    expect(screen.getByText(/admins can see and change everybody/i)).toBeInTheDocument();
  });

  test('scan, confirm with a code, then the recovery codes must be saved before going on', async () => {
    const onDone = vi.fn();
    const codes = Array.from({ length: 10 }, (_, i) => `AAAA-BBB${i}`);
    const fetchMock = mockFetch(url => {
      if (url === '/api/auth/two-step/setup') return { body: { success: true, secret: 'ABCD EFGH', qr: '<svg></svg>', uri: 'otpauth://x' } };
      if (url === '/api/auth/two-step/enable') return { body: { success: true, recoveryCodes: codes, user: ADA } };
      return {};
    });
    render(<TwoStepSetup onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: /set it up/i }));
    expect(await screen.findByAltText(/qr code/i)).toBeInTheDocument();
    expect(screen.getByText('ABCD EFGH')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/code from your app/i), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: /turn on two-step/i }));
    expect(await screen.findByText(/save these recovery codes now/i)).toBeInTheDocument();
    expect(bodyOf(fetchMock, '/api/auth/two-step/enable')).toEqual({ code: '654321' });
    codes.forEach(c => expect(screen.getByText(c)).toBeInTheDocument());

    const done = screen.getByRole('button', { name: /^done$/i });
    expect(done).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/saved these codes/i));
    fireEvent.click(done);
    expect(onDone).toHaveBeenCalledWith(ADA);
  });
});

describe('My Info', () => {
  test('an admin can make new recovery codes but not turn it off', () => {
    render(<TwoStepSettings user={ADA} />);
    expect(screen.getByText(/10 of 10 recovery codes left/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new recovery codes/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /turn off/i })).not.toBeInTheDocument();
  });

  test('a member may turn it on, and off again once it is on', () => {
    const { rerender } = render(<TwoStepSettings user={{ id: 2, name: 'Sam', role: 'approved', two_step: { enabled: false, required: false } }} />);
    expect(screen.getByRole('button', { name: /turn on/i })).toBeInTheDocument();
    rerender(<TwoStepSettings key="on" user={{ id: 2, name: 'Sam', role: 'approved', two_step: { enabled: true, required: false, recovery_codes_left: 8 } }} />);
    expect(screen.getByRole('button', { name: /turn off/i })).toBeInTheDocument();
  });
});
