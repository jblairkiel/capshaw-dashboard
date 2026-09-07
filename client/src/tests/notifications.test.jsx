import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import NotificationsView from '../components/NotificationsView';
import NotificationPreferences from '../components/NotificationPreferences';
import NotificationBell from '../components/NotificationBell';
import { timeAgo, hourLabel } from '../lib/notifications';

const CATEGORIES = [
  { id: 'announcements', label: 'Announcements', description: 'Notices.',      icon: '📢', total: 1, unread: 1 },
  { id: 'comments',      label: 'Comments',      description: 'Conversation.', icon: '💬', total: 1, unread: 0 },
  { id: 'workflows',     label: 'Workflows',     description: 'Jobs.',         icon: '📋', total: 0, unread: 0 },
];

const INBOX = {
  success: true,
  items: [
    {
      id: 9, type: 'announcement.posted', typeLabel: 'A new announcement is posted',
      category: 'announcements', title: 'Potluck Sunday', body: 'Bring a dish',
      subjectType: 'announcement', subjectId: 4, tab: 'announcements',
      actor: 'Ada Admin', read: false, createdAt: '2026-05-01 09:00:00',
    },
    {
      id: 8, type: 'comment.reply', typeLabel: 'Somebody replies to my comment',
      category: 'comments', title: 'Jo Harris replied to your comment', body: 'Eight',
      subjectType: 'event', subjectId: 7, tab: 'calendar',
      actor: 'Jo Harris', read: true, createdAt: '2026-04-30 09:00:00',
    },
  ],
  summary: { unread: 1, categories: { announcements: { total: 1, unread: 1 } }, types: {} },
  categories: CATEGORIES,
};

const SETTINGS = {
  success: true,
  settings: {
    account: { emailEnabled: true, digest: { frequency: 'daily', hour: 7, weekday: 1 } },
    categories: [{
      id: 'comments', label: 'Comments', description: 'Conversation on announcements and events.', icon: '💬',
      types: [
        { id: 'comment.reply', label: 'Somebody replies to my comment', description: '',
          audience: 'targeted', defaultEmail: 'immediate', inApp: true, email: 'immediate', customised: false },
        { id: 'comment.posted', label: 'Somebody comments on a thread I am following', description: 'You follow a thread by commenting on it.',
          audience: 'targeted', defaultEmail: 'digest', inApp: true, email: 'digest', customised: false },
      ],
    }],
    emailModes: [
      { id: 'immediate', short: 'Right away', label: 'Email me right away' },
      { id: 'digest',    short: 'Digest',     label: 'Save it for my digest' },
      { id: 'off',       short: 'No email',   label: 'No email' },
    ],
    digestFrequencies: ['daily', 'weekly'],
  },
};

function mockApi(routes = {}) {
  const fetchMock = vi.fn(url => {
    let body = routes.inbox ?? INBOX;
    if (url.includes('/preferences'))   body = routes.settings ?? SETTINGS;
    else if (url.includes('/summary'))  body = routes.summary ?? { success: true, summary: { unread: 3, categories: {}, types: {} } };
    else if (url.includes('/read'))     body = routes.read ?? { success: true, changed: 1, summary: { unread: 0 } };
    return Promise.resolve({ json: () => Promise.resolve(body) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

// ─── The inbox ────────────────────────────────────────────────────────────────

describe('NotificationsView', () => {
  beforeEach(() => { mockApi(); });

  test('lists what has happened, labelled by type', async () => {
    render(<NotificationsView />);

    expect(await screen.findByText('Potluck Sunday')).toBeInTheDocument();
    expect(screen.getByText('A new announcement is posted')).toBeInTheDocument();
    expect(screen.getByText('1 unread')).toBeInTheDocument();
  });

  test('offers a drawer per category that has anything in it', async () => {
    render(<NotificationsView />);
    await screen.findByText('Potluck Sunday');

    expect(screen.getByRole('button', { name: /📢 Announcements \(1\)/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /💬 Comments/ })).toBeInTheDocument();
    // A category with nothing in it is not a drawer worth showing.
    expect(screen.queryByRole('button', { name: /Workflows/ })).not.toBeInTheDocument();
  });

  test('choosing a drawer asks for that category alone', async () => {
    const fetchMock = mockApi();
    render(<NotificationsView />);

    fireEvent.click(await screen.findByRole('button', { name: /💬 Comments/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/notifications?category=comments', expect.anything());
    });
  });

  test('unread only is asked of the server, not filtered in the browser', async () => {
    const fetchMock = mockApi();
    render(<NotificationsView />);

    fireEvent.click(await screen.findByRole('checkbox', { name: /unread only/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/notifications?unread=1', expect.anything());
    });
  });

  test('opening one marks it read and goes to the screen that answers it', async () => {
    const fetchMock = mockApi();
    const onNavigate = vi.fn();
    render(<NotificationsView onNavigate={onNavigate} />);

    fireEvent.click((await screen.findAllByRole('button', { name: /open it/i }))[0]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/notifications/read',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ ids: [9] }) })
      );
    });
    expect(onNavigate).toHaveBeenCalledWith('announcements');
  });

  test('marking all read empties the whole inbox at once', async () => {
    const fetchMock = mockApi();
    render(<NotificationsView />);

    fireEvent.click(await screen.findByRole('button', { name: /mark all read/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/notifications/read',
        expect.objectContaining({ body: JSON.stringify({}) })
      );
    });
  });

  test('an empty inbox says what would land there', async () => {
    mockApi({ inbox: { success: true, items: [], summary: { unread: 0, categories: {}, types: {} }, categories: [] } });
    render(<NotificationsView />);

    expect(await screen.findByText('Nothing here')).toBeInTheDocument();
    expect(screen.getByText(/comments, announcements, events/i)).toBeInTheDocument();
  });
});

// ─── The settings ─────────────────────────────────────────────────────────────

describe('NotificationPreferences', () => {
  beforeEach(() => { mockApi(); });

  test('shows every type the site can raise, grouped by category', async () => {
    render(<NotificationPreferences />);

    expect(await screen.findByText('Comments')).toBeInTheDocument();
    expect(screen.getByText('Somebody replies to my comment')).toBeInTheDocument();
    expect(screen.getByText('Somebody comments on a thread I am following')).toBeInTheDocument();
  });

  test('changing one type saves only that type', async () => {
    const fetchMock = mockApi();
    render(<NotificationPreferences />);
    await screen.findByText('Somebody replies to my comment');

    // The first row's "No email" button.
    fireEvent.click(screen.getAllByRole('button', { name: 'No email' })[0]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/notifications/preferences',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ types: { 'comment.reply': { email: 'off' } } }),
        })
      );
    });
  });

  test('the inbox can be turned off for a type on its own', async () => {
    const fetchMock = mockApi();
    render(<NotificationPreferences />);
    const boxes = await screen.findAllByRole('checkbox', { name: /show these in my notification inbox/i });

    fireEvent.click(boxes[0]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/notifications/preferences',
        expect.objectContaining({ body: JSON.stringify({ types: { 'comment.reply': { inApp: false } } }) })
      );
    });
  });

  test('the master switch turns every email off', async () => {
    const fetchMock = mockApi();
    render(<NotificationPreferences />);

    fireEvent.click(await screen.findByRole('checkbox', { name: /email me at all/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/notifications/preferences',
        expect.objectContaining({ body: JSON.stringify({ emailEnabled: false }) })
      );
    });
  });

  test('a weekly digest asks which day; a daily one does not', async () => {
    const fetchMock = mockApi();
    render(<NotificationPreferences />);
    await screen.findByText('Comments');

    expect(screen.queryByDisplayValue('Monday')).not.toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('Every day'), { target: { value: 'weekly' } });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/notifications/preferences',
        expect.objectContaining({ body: JSON.stringify({ digest: { frequency: 'weekly' } }) })
      );
    });
  });
});

// ─── The bell ─────────────────────────────────────────────────────────────────

describe('NotificationBell', () => {
  beforeEach(() => { mockApi(); });

  test('shows how many are unread', async () => {
    render(<NotificationBell onOpenInbox={() => {}} />);
    expect(await screen.findByRole('button', { name: /3 unread/i })).toBeInTheDocument();
  });

  test('opens on the newest few and leads to the inbox', async () => {
    const onOpenInbox = vi.fn();
    render(<NotificationBell onOpenInbox={onOpenInbox} />);

    fireEvent.click(await screen.findByRole('button', { name: /notifications/i }));
    expect(await screen.findByText('Potluck Sunday')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /open the inbox/i }));
    expect(onOpenInbox).toHaveBeenCalled();
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

describe('helpers', () => {
  test('timestamps are read as UTC, the way SQLite writes them', () => {
    const now = Date.parse('2026-05-01T12:00:00Z');
    expect(timeAgo('2026-05-01 11:00:00', now)).toBe('1 hour ago');
    expect(timeAgo('2026-04-29 12:00:00', now)).toBe('2 days ago');
    expect(timeAgo('2026-05-01 11:59:30', now)).toBe('just now');
    expect(timeAgo(null, now)).toBe('');
  });

  test('the digest hour reads as a time of day', () => {
    expect(hourLabel(0)).toBe('12:00 am');
    expect(hourLabel(7)).toBe('7:00 am');
    expect(hourLabel(18)).toBe('6:00 pm');
  });
});
