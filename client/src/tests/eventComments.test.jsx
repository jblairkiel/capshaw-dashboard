import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import EventComments from '../components/EventComments';
import NotificationsBell from '../components/NotificationsBell';

// What the server sends back about somebody's own standing in a thread — the
// component never works it out for itself, so these flags are what the tests
// vary.
const THREAD = {
  success: true,
  maxLength: 2000,
  canReply: true,
  canModerate: false,
  comments: [
    { id: 1, userId: 5, mine: true,  author: 'Jo Member', body: 'What time does it start?', deleted: false, edited: false, createdAt: '2099-01-01 10:00:00' },
    { id: 2, userId: 6, mine: false, author: 'Ray Harris', body: 'Five, I think.',           deleted: false, edited: false, createdAt: '2099-01-01 11:00:00' },
  ],
};

function mockThread(overrides = {}) {
  const body = { ...THREAD, ...overrides };
  const fetchMock = vi.fn(() => Promise.resolve({ json: () => Promise.resolve(body) }));
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('confirm', () => true);
  return fetchMock;
}

describe('the thread under an event', () => {
  test('shows what has been said, whichever kind of event it hangs under', async () => {
    const fetchMock = mockThread();
    render(<EventComments subjectType="group-event" subjectId={90} />);

    expect(await screen.findByText('What time does it start?')).toBeInTheDocument();
    expect(screen.getByText('Ray Harris')).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/comments/group-event/90');
  });

  test('posting sends the text and clears the box', async () => {
    const fetchMock = mockThread();
    render(<EventComments subjectType="announcement" subjectId={4} />);
    await screen.findByText('Five, I think.');

    const box = screen.getByLabelText('Write a comment');
    fireEvent.change(box, { target: { value: 'We will be there.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c => c[1]?.method === 'POST');
      expect(post[0]).toBe('/api/comments/announcement/4');
      expect(JSON.parse(post[1].body)).toEqual({ body: 'We will be there.' });
    });
    await waitFor(() => expect(box.value).toBe(''));
  });

  test('somebody who may not reply gets no box at all', async () => {
    mockThread({ canReply: false });
    render(<EventComments subjectType="group-event" subjectId={90} />);
    await screen.findByText('Five, I think.');

    expect(screen.queryByLabelText('Write a comment')).not.toBeInTheDocument();
  });

  test('Edit is offered on your own words and on nobody else\'s', async () => {
    mockThread();
    render(<EventComments subjectType="group-event" subjectId={90} />);
    await screen.findByText('What time does it start?');

    // One comment is mine, one is not — so exactly one Edit.
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1);
  });

  test('a moderator may remove anybody\'s', async () => {
    mockThread({ canModerate: true });
    render(<EventComments subjectType="group-event" subjectId={90} />);
    await screen.findByText('What time does it start?');

    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(1);
  });

  test('editing sends the correction', async () => {
    const fetchMock = mockThread();
    render(<EventComments subjectType="group-event" subjectId={90} />);
    await screen.findByText('What time does it start?');

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const box = screen.getByDisplayValue('What time does it start?');
    fireEvent.change(box, { target: { value: 'What time, exactly?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(c => c[1]?.method === 'PUT');
      expect(put[0]).toBe('/api/comments/1');
      expect(JSON.parse(put[1].body)).toEqual({ body: 'What time, exactly?' });
    });
  });

  test('a removed comment leaves a note in its place rather than vanishing', async () => {
    mockThread({
      comments: [{ id: 1, userId: 5, mine: false, author: 'Jo Member', body: '', deleted: true, edited: false, createdAt: '2099-01-01 10:00:00' }],
    });
    render(<EventComments subjectType="announcement" subjectId={4} />);

    expect(await screen.findByText('This comment was removed.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });

  test('an empty thread invites the first word when you may write one', async () => {
    mockThread({ comments: [] });
    render(<EventComments subjectType="group-event" subjectId={90} />);
    expect(await screen.findByText(/Start it off/i)).toBeInTheDocument();
  });

  test('a refusal is shown rather than swallowed', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      json: () => Promise.resolve({ success: false, error: 'That is not yours to read' }),
    })));
    render(<EventComments subjectType="group-event" subjectId={90} />);
    expect(await screen.findByText('That is not yours to read')).toBeInTheDocument();
  });
});

// ─── The bell ─────────────────────────────────────────────────────────────────

const NOTIFICATIONS = {
  success: true,
  unread: 2,
  notifications: [
    { id: 11, kind: 'group-event-published', title: 'North Harvest: Fellowship meal', body: '2099-05-01 · 17:00', page: 'groups', read: false, createdAt: '2099-01-01 10:00:00' },
    { id: 12, kind: 'announcement-comment',  title: 'Ray Harris replied on "Singing night"', body: 'See you there', page: 'announcements', read: true, createdAt: '2099-01-01 09:00:00' },
  ],
};

function mockBell(overrides = {}) {
  const body = { ...NOTIFICATIONS, ...overrides };
  const fetchMock = vi.fn(url => Promise.resolve({
    json: () => Promise.resolve(String(url).includes('/count') ? { success: true, unread: body.unread } : body),
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('the notification bell', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  test('shows how many are waiting without opening anything', async () => {
    mockBell();
    render(<NotificationsBell />);
    expect(await screen.findByText('2')).toBeInTheDocument();
    expect(screen.queryByText(/North Harvest/)).not.toBeInTheDocument();
  });

  test('opening lists them and does not mark them read', async () => {
    const fetchMock = mockBell();
    render(<NotificationsBell />);
    fireEvent.click(await screen.findByLabelText(/Notifications, 2 unread/));

    expect(await screen.findByText('North Harvest: Fellowship meal')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(c => c[1]?.method === 'POST')).toBe(false);
  });

  test('picking one marks that one and opens the page it is about', async () => {
    const fetchMock = mockBell();
    const onGoToPage = vi.fn();
    render(<NotificationsBell onGoToPage={onGoToPage} />);
    fireEvent.click(await screen.findByLabelText(/Notifications, 2 unread/));
    fireEvent.click(await screen.findByText('North Harvest: Fellowship meal'));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c => c[1]?.method === 'POST');
      expect(JSON.parse(post[1].body)).toEqual({ ids: [11] });
    });
    expect(onGoToPage).toHaveBeenCalledWith('groups');
  });

  test('marking everything read sends no ids at all', async () => {
    const fetchMock = mockBell();
    render(<NotificationsBell />);
    fireEvent.click(await screen.findByLabelText(/Notifications, 2 unread/));
    fireEvent.click(await screen.findByRole('button', { name: 'Mark all read' }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c => c[1]?.method === 'POST');
      expect(JSON.parse(post[1].body)).toEqual({});
    });
  });

  test('an empty bell says so, and shows no badge', async () => {
    mockBell({ unread: 0, notifications: [] });
    render(<NotificationsBell />);
    fireEvent.click(await screen.findByLabelText('Notifications'));
    expect(await screen.findByText('Nothing new.')).toBeInTheDocument();
  });

  test('a bell that cannot be reached is quiet rather than an error banner', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    render(<NotificationsBell />);
    expect(await screen.findByLabelText('Notifications')).toBeInTheDocument();
  });
});
