import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, test, expect, vi, afterEach } from 'vitest';
import MailDeliveryView from '../components/MailDeliveryView';

const BASE = {
  success: true,
  redirecting: true,
  redirectTo: 'jblairkiel@gmail.com',
  all: { on: false },
  kept: 1,
  roles: [
    { key: 'admin', label: 'Admins', description: '', deliver: false, holders: [{ name: 'Office Admin', email: 'admin@example.com' }] },
    { key: 'songs', label: 'Song Tracker', description: '', deliver: true, holders: [{ name: 'Song Keeper', email: 'songs@example.com' }] },
    { key: 'visitors', label: 'Guest Tracker', description: '', deliver: false, holders: [] },
  ],
  people: [{ email: 'songs@example.com', name: 'Song Keeper', deliver: false, updatedBy: 'Office Admin' }],
  addressBook: [
    { email: 'dir@example.com', name: 'Dir Person', sources: ['directory'] },
    { email: 'songs@example.com', name: 'Song Keeper', sources: ['account'] },
  ],
  real: [{ email: 'admin2@example.com', name: 'Second Song Keeper', why: 'role', roleLabel: 'Song Tracker' }],
};

function mockApi(state = BASE) {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn((url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : undefined });
    return Promise.resolve({ json: () => Promise.resolve(state) });
  }));
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('Email Delivery', () => {
  test('says test mode is on, where mail goes, and who is getting their own', async () => {
    mockApi();
    render(<MailDeliveryView />);
    expect(await screen.findByText(/Test mode is on/)).toBeInTheDocument();
    expect(screen.getAllByText('jblairkiel@gmail.com').length).toBeGreaterThan(0);
    const now = screen.getByRole('region', { name: 'Who gets their own email now' });
    expect(within(now).getByText('Second Song Keeper')).toBeInTheDocument();
    expect(within(now).getByText('As Song Tracker')).toBeInTheDocument();
  });

  test('when nothing is turned on, says everything comes to the redirect address', async () => {
    mockApi({ ...BASE, real: [] });
    render(<MailDeliveryView />);
    expect(await screen.findByText(/Nobody\. Every email goes to jblairkiel@gmail.com/)).toBeInTheDocument();
  });

  test('a role is switched on and off, and says who holds it', async () => {
    const calls = mockApi();
    render(<MailDeliveryView />);
    const admins = await screen.findByRole('switch', { name: 'Admins: send their own email' });
    expect(admins).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('switch', { name: 'Song Tracker: send their own email' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Nobody holds this yet')).toBeInTheDocument();
    fireEvent.click(admins);
    await waitFor(() => expect(calls.find(c => c.method === 'PUT')).toMatchObject({ url: '/api/mail-delivery/roles/admin', body: { deliver: true } }));
  });

  test('a person is added from the address book, changed, and removed', async () => {
    const calls = mockApi();
    render(<MailDeliveryView />);
    await screen.findByText(/Test mode is on/);
    fireEvent.change(screen.getByPlaceholderText('Start typing a name'), { target: { value: 'Dir Person <dir@example.com>' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(calls.find(c => c.url === '/api/mail-delivery/people' && c.method === 'PUT')?.body)
      .toEqual({ email: 'dir@example.com', name: 'Dir Person', deliver: true }));

    fireEvent.change(screen.getByLabelText('Setting for Song Keeper'), { target: { value: 'true' } });
    await waitFor(() => expect(calls.filter(c => c.method === 'PUT').at(-1).body).toEqual({ email: 'songs@example.com', name: 'Song Keeper', deliver: true }));

    fireEvent.click(screen.getByRole('button', { name: 'Remove Song Keeper' }));
    await waitFor(() => expect(calls.some(c => c.method === 'DELETE' && c.url === '/api/mail-delivery/people?email=songs%40example.com')).toBe(true));
  });

  test('a bare address typed in, kept redirected', async () => {
    const calls = mockApi();
    render(<MailDeliveryView />);
    await screen.findByText(/Test mode is on/);
    fireEvent.change(screen.getByPlaceholderText('Start typing a name'), { target: { value: 'new@example.com' } });
    fireEvent.change(screen.getByLabelText('Their setting'), { target: { value: 'false' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(calls.find(c => c.method === 'PUT')?.body).toEqual({ email: 'new@example.com', name: '', deliver: false }));
  });

  test('the Everyone switch asks first, then turns all mail on', async () => {
    const calls = mockApi();
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    render(<MailDeliveryView />);
    fireEvent.click(await screen.findByRole('switch', { name: 'Everyone: send their own email' }));
    expect(confirm).toHaveBeenCalled();
    await waitFor(() => expect(calls.find(c => c.url === '/api/mail-delivery/all')).toMatchObject({ method: 'PUT', body: { on: true } }));
  });

  test('saying no to the question changes nothing', async () => {
    const calls = mockApi();
    vi.stubGlobal('confirm', vi.fn(() => false));
    render(<MailDeliveryView />);
    fireEvent.click(await screen.findByRole('switch', { name: 'Everyone: send their own email' }));
    expect(calls.some(c => c.url === '/api/mail-delivery/all')).toBe(false);
  });

  test('with everyone on, says so, and says the roles wait until it is off', async () => {
    const calls = mockApi({ ...BASE, all: { on: true, by: 'Office Admin' }, real: [{ email: 'dir@example.com', name: 'Dir Person', why: 'all' }] });
    render(<MailDeliveryView />);
    expect((await screen.findByText(/Everyone is getting their own email/)).closest('div')).toHaveTextContent('except the 1 person kept redirected below');
    expect(screen.getByRole('switch', { name: 'Everyone: send their own email' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/these make no difference until it is turned off/)).toBeInTheDocument();
    expect(screen.getByText('Everyone is on')).toBeInTheDocument();
    // Turning it off needs no question.
    fireEvent.click(screen.getByRole('switch', { name: 'Everyone: send their own email' }));
    await waitFor(() => expect(calls.find(c => c.url === '/api/mail-delivery/all')?.body).toEqual({ on: false }));
  });

  test('when test mode is off, says these settings do nothing for now', async () => {
    mockApi({ ...BASE, redirecting: false, redirectTo: null });
    render(<MailDeliveryView />);
    expect(await screen.findByText(/Test mode is off/)).toBeInTheDocument();
  });
});
