import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import MailGroupsView from '../components/MailGroupsView';

const GROUPS = {
  success: true,
  groups: [
    { id: 1, key: 'elders',        name: 'Elders',        description: 'The eldership', memberCount: 2, reachable: 1, missing: ['Jo Harris'] },
    { id: 2, key: 'announcements', name: 'Announcements', description: 'Everyone',      memberCount: 0, reachable: 0, missing: [] },
  ],
  mail: { configured: false, redirecting: true, redirectTo: 'jblairkiel@gmail.com', from: 'Capshaw <jblairkiel@gmail.com>' },
};

const DETAIL = {
  success: true,
  group: { id: 1, key: 'elders', name: 'Elders', description: 'The eldership' },
  members: [
    { id: 10, directoryId: 5, name: 'Ray Harris', email: 'ray@example.com' },
    { id: 11, directoryId: 6, name: 'Jo Harris',  email: '' },
  ],
  candidates: [{ id: 7, name: 'Ann Elder', email: 'ann@example.com' }],
};

function mockApi(overrides = {}) {
  const routes = { groups: GROUPS, detail: DETAIL, outbox: { success: true, messages: [], counts: {} }, ...overrides };
  const fetchMock = vi.fn(url => {
    let body = routes.groups;
    if (url.includes('/outbox'))              body = routes.outbox;
    // Adding or removing returns the updated member list, as the API does.
    else if (url.includes('/members'))        body = routes.members ?? { success: true, members: DETAIL.members };
    else if (/\/groups\/[a-z-]+$/.test(url))  body = routes.detail;
    return Promise.resolve({ json: () => Promise.resolve(body) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('MailGroupsView', () => {
  beforeEach(() => { mockApi(); });

  test('warns prominently that mail is being redirected to the test account', async () => {
    render(<MailGroupsView />);
    expect(await screen.findByText(/test mode/i)).toBeInTheDocument();
    expect(screen.getByText('jblairkiel@gmail.com')).toBeInTheDocument();
  });

  test('says when no mail server is set up, and that nothing is lost', async () => {
    render(<MailGroupsView />);
    expect(await screen.findByText(/no mail server is configured/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing is lost/i)).toBeInTheDocument();
  });

  test('lists the groups with reachable-versus-listed counts', async () => {
    render(<MailGroupsView />);
    expect(await screen.findByText('Elders')).toBeInTheDocument();
    expect(screen.getByText('1/2')).toBeInTheDocument();
    expect(screen.getByText(/1 with no address on file/i)).toBeInTheDocument();
  });

  test('explains that a group is a list, not a mailbox you can write to', async () => {
    render(<MailGroupsView />);
    expect(await screen.findByText(/has to be set up with your mail provider/i)).toBeInTheDocument();
  });

  test('opening a group shows its members and flags anyone unreachable', async () => {
    render(<MailGroupsView />);
    fireEvent.click(await screen.findByText('Elders'));

    expect(await screen.findByText('Ray Harris')).toBeInTheDocument();
    expect(screen.getByText('ray@example.com')).toBeInTheDocument();
    expect(screen.getByText(/they will not receive group mail/i)).toBeInTheDocument();
  });

  test('adding someone from the directory posts them to the group', async () => {
    const fetchMock = mockApi();
    render(<MailGroupsView />);
    fireEvent.click(await screen.findByText('Elders'));

    const select = await screen.findByRole('combobox');
    fireEvent.change(select, { target: { value: '7' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/mail/groups/elders/members',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ directoryId: 7 }) })
      );
    });
  });

  test('surfaces a server error rather than failing silently', async () => {
    mockApi({ groups: { success: false, error: 'Admin only' } });
    render(<MailGroupsView />);
    expect(await screen.findByText('Admin only')).toBeInTheDocument();
  });
});
