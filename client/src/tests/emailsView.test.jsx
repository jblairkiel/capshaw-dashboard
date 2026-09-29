import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, test, expect, vi, afterEach } from 'vitest';
import EmailsView from '../components/EmailsView';

const email = (id, name, extra = {}) => ({
  id, name, audience: 'Somebody', trigger: `When ${name.toLowerCase()} happens.`,
  sent30: 0, pending: 0, failed: 0, last: null, ...extra,
});

const CATALOG = {
  success: true,
  redirect: 'test@example.com',
  uncategorised: 0,
  categories: [
    { id: 'notifications', label: 'Notifications', description: 'About one person.', emails: [email('account-confirm', 'Confirm your email address', { sent30: 4, pending: 2 })] },
    { id: 'bulletin', label: 'Bulletin', description: 'The newsletter.', emails: [] },
    { id: 'groups', label: 'Groups', description: 'Group meetings.', emails: [email('group-posted', 'Meeting posted', { failed: 1 })] },
    { id: 'reports', label: 'Reports', description: 'Schedules.', emails: [email('monthly-schedule', 'Monthly worship schedule')] },
  ],
};

const MESSAGE = {
  id: 9, to_email: 'ray@example.com', to_name: 'Ray', intended_for: '', subject: 'Games night',
  status: 'sent', error: '', created_at: '2026-09-20 10:00:00', sent_at: '2026-09-20 10:01:00',
  emailId: 'group-posted', emailName: 'Meeting posted', category: 'groups',
};

function mockApi({ history = { success: true, messages: [], total: 0, page: 1, pageSize: 50 }, sendNow } = {}) {
  const fetchMock = vi.fn((url, options) => {
    let body = CATALOG;
    if (url.includes('/preview')) body = { success: true, subject: 'Sample subject', body: 'Sample body text' };
    else if (/\/history\/\d+$/.test(url)) body = { success: true, message: { ...MESSAGE, body: 'The whole message' } };
    else if (url.includes('/history')) body = history;
    else if (url.includes('/send-now') && options?.method === 'POST') body = sendNow ?? { success: true, sent: 2, failed: 0 };
    return Promise.resolve({ json: () => Promise.resolve(body) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('EmailsView', () => {
  test('shows four tabs, starting on Notifications with its emails', async () => {
    mockApi();
    render(<EmailsView />);
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map(t => t.textContent.replace(/\d+$/, '').trim())).toEqual(['Notifications', 'Bulletin', 'Groups', 'Reports']);
    expect(screen.getByText('Confirm your email address')).toBeInTheDocument();
    expect(screen.getByText('4 sent in the last 30 days')).toBeInTheDocument();
    expect(screen.getByText('2 waiting')).toBeInTheDocument();
  });

  test('switching tabs shows that tab’s emails, and an empty tab says so', async () => {
    mockApi();
    render(<EmailsView />);
    fireEvent.click(await screen.findByRole('tab', { name: /Groups/ }));
    expect(screen.getByText('Meeting posted')).toBeInTheDocument();
    expect(screen.getByText('1 failed')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /Bulletin/ }));
    expect(screen.getByText('Nothing in this tab is sent yet.')).toBeInTheDocument();
  });

  test('warns when mail is being redirected to a test address', async () => {
    mockApi();
    render(<EmailsView />);
    expect(await screen.findByText('test@example.com')).toBeInTheDocument();
  });

  test('previews an email without sending anything', async () => {
    const fetchMock = mockApi();
    render(<EmailsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Preview' }));

    const dialog = await screen.findByRole('dialog', { name: 'Confirm your email address' });
    expect(await within(dialog).findByText('Sample subject')).toBeInTheDocument();
    expect(within(dialog).getByText('Sample body text')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/emails/catalog/account-confirm/preview', expect.anything());

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  test('lists what went out on the tab, and opens one to read', async () => {
    const fetchMock = mockApi({ history: { success: true, messages: [MESSAGE], total: 1, page: 1, pageSize: 50 } });
    render(<EmailsView />);
    fireEvent.click(await screen.findByRole('tab', { name: /Groups/ }));

    await waitFor(() => expect(fetchMock.mock.calls.some(c => String(c[0]).includes('/history?') && String(c[0]).includes('category=groups'))).toBe(true));
    fireEvent.click(await screen.findByText('Games night'));
    const dialog = await screen.findByRole('dialog', { name: 'Games night' });
    expect(await within(dialog).findByText('The whole message')).toBeInTheDocument();
  });

  test('clicking a count narrows the history to that one email', async () => {
    const fetchMock = mockApi();
    render(<EmailsView />);
    fireEvent.click(await screen.findByText('4 sent in the last 30 days'));
    await waitFor(() => expect(fetchMock.mock.calls.some(c => String(c[0]).includes('email=account-confirm'))).toBe(true));
    expect(screen.getByText(/Sent: Confirm your email address/)).toBeInTheDocument();
  });

  test('searching and filtering ask the server again', async () => {
    const fetchMock = mockApi();
    render(<EmailsView />);
    fireEvent.change(await screen.findByLabelText('Search sent email'), { target: { value: 'games' } });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'failed' } });
    await waitFor(() => expect(fetchMock.mock.calls.some(c => String(c[0]).includes('q=games') && String(c[0]).includes('status=failed'))).toBe(true));
  });

  test('sends waiting mail on request and says what happened', async () => {
    const fetchMock = mockApi();
    render(<EmailsView />);
    fireEvent.click(await screen.findByRole('button', { name: /Send waiting mail now \(2\)/ }));
    expect(await screen.findByText('2 sent, 0 failed.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/emails/send-now', expect.objectContaining({ method: 'POST' }));
  });

  test('says plainly when there is no mail server to send through', async () => {
    mockApi({ sendNow: { success: true, sent: 0, failed: 0, skipped: 2 } });
    render(<EmailsView />);
    fireEvent.click(await screen.findByRole('button', { name: /Send waiting mail now/ }));
    expect(await screen.findByText(/No mail server is set up/)).toBeInTheDocument();
  });
});
