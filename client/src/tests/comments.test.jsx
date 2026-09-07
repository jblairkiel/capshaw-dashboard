import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import CommentThread from '../components/CommentThread';

const THREAD = {
  success: true,
  subject: { id: 7, type: 'event', title: 'Men’s Breakfast' },
  subscription: 'none',
  canComment: true,
  comments: [
    {
      id: 1, parentId: null, body: 'What time does it start?', deleted: false,
      author: { id: 2, name: 'Ray Harris', photo: '' },
      createdAt: '2026-05-01 09:00:00', editedAt: null, canEdit: false, canDelete: false,
    },
    {
      id: 2, parentId: 1, body: 'Eight o’clock', deleted: false,
      author: { id: 3, name: 'Jo Harris', photo: '' },
      createdAt: '2026-05-01 09:05:00', editedAt: null, canEdit: true, canDelete: true,
    },
  ],
};

function mockApi(overrides = {}) {
  const thread = { ...THREAD, ...overrides };
  const fetchMock = vi.fn(() => Promise.resolve({ json: () => Promise.resolve(thread) }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('CommentThread', () => {
  beforeEach(() => { mockApi(); });

  test('shows the conversation with its replies', async () => {
    render(<CommentThread subjectType="event" subjectId={7} />);

    expect(await screen.findByText('What time does it start?')).toBeInTheDocument();
    expect(screen.getByText('Eight o’clock')).toBeInTheDocument();
    expect(screen.getByText('2 comments')).toBeInTheDocument();
  });

  test('posting sends the comment to the thread’s own endpoint', async () => {
    const fetchMock = mockApi();
    render(<CommentThread subjectType="event" subjectId={7} />);

    fireEvent.change(await screen.findByPlaceholderText(/add a comment/i), { target: { value: 'See you there' } });
    fireEvent.click(screen.getByRole('button', { name: /post comment/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/comments/event/7',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ body: 'See you there', parentId: null }) })
      );
    });
  });

  test('replying carries the comment being answered', async () => {
    const fetchMock = mockApi();
    render(<CommentThread subjectType="event" subjectId={7} />);

    fireEvent.click((await screen.findAllByRole('button', { name: 'Reply' }))[0]);
    expect(screen.getByText(/replying to/i)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/add a comment/i), { target: { value: 'Eight' } });
    fireEvent.click(screen.getByRole('button', { name: /post reply/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/comments/event/7',
        expect.objectContaining({ body: JSON.stringify({ body: 'Eight', parentId: 1 }) })
      );
    });
  });

  test('only your own comments offer Edit', async () => {
    render(<CommentThread subjectType="event" subjectId={7} />);
    await screen.findByText('What time does it start?');

    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(1);
  });

  test('a removed comment leaves a note rather than a gap', async () => {
    mockApi({
      comments: [{
        id: 1, parentId: null, body: '', deleted: true,
        author: { id: 2, name: 'Ray Harris', photo: '' },
        createdAt: '2026-05-01 09:00:00', editedAt: null, canEdit: false, canDelete: false,
      }],
    });
    render(<CommentThread subjectType="event" subjectId={7} />);

    expect(await screen.findByText(/this comment was removed/i)).toBeInTheDocument();
  });

  test('following a thread is a switch of its own', async () => {
    const fetchMock = mockApi();
    render(<CommentThread subjectType="event" subjectId={7} />);

    fireEvent.click(await screen.findByRole('button', { name: /follow/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/comments/event/7/subscription',
        expect.objectContaining({ method: 'PUT', body: JSON.stringify({ state: 'on' }) })
      );
    });
  });

  test('a pending account is told why it cannot join in', async () => {
    mockApi({ canComment: false });
    render(<CommentThread subjectType="event" subjectId={7} />);

    expect(await screen.findByText(/approved by an admin/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/add a comment/i)).not.toBeInTheDocument();
  });
});
