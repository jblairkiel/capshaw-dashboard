import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import UsersView from '../components/UsersView';
import { readJsonCookie, writeJsonCookie, readCookie, deleteCookie } from '../lib/cookies';

const COLUMN_COOKIE = 'capshaw.users.columns';

const USERS = [
  { id: 1, name: 'Ada',  email: 'ada@example.com',  provider: 'google',   role: 'admin',    is_owner: true,  created_at: '2024-01-02', directory_name: 'Ada Byron' },
  { id: 2, name: 'Mel',  email: 'mel@example.com',  provider: 'google',   role: 'approved', is_owner: false, created_at: '2024-03-04', directory_name: null },
  { id: 3, name: 'Pat',  email: 'pat@example.com',  provider: 'facebook', role: 'pending',  is_owner: false, created_at: '2024-05-06', directory_name: null },
  { id: 4, name: 'Sam',  email: 'sam@example.com',  provider: 'google',   role: 'admin',    is_owner: false, created_at: '2024-07-08', directory_name: 'Sam Rivers' },
];

function mockUsersFetch() {
  const fetchMock = vi.fn(() =>
    Promise.resolve({ json: () => Promise.resolve({ success: true, users: USERS }) })
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function rowNames() {
  return screen
    .getAllByRole('button', { name: /^Manage / })
    .map(b => b.getAttribute('aria-label').replace('Manage ', ''));
}

async function renderGrid() {
  render(<UsersView currentUser={{ id: 4, role: 'admin' }} />);
  await screen.findByRole('button', { name: 'Manage Ada' });
}

describe('cookie helpers', () => {
  afterEach(() => { deleteCookie('test.pref'); });

  test('round-trips a JSON value', () => {
    writeJsonCookie('test.pref', ['a', 'b']);
    expect(readJsonCookie('test.pref')).toEqual(['a', 'b']);
  });

  test('falls back when the cookie is missing or unreadable', () => {
    expect(readJsonCookie('test.missing', 'fallback')).toBe('fallback');
    document.cookie = 'test.pref=not-json; path=/';
    expect(readJsonCookie('test.pref', 'fallback')).toBe('fallback');
  });

  test('deleting a cookie removes it', () => {
    writeJsonCookie('test.pref', 1);
    deleteCookie('test.pref');
    expect(readCookie('test.pref')).toBeNull();
  });
});

describe('UsersView grid — filtering', () => {
  beforeEach(() => { deleteCookie(COLUMN_COOKIE); mockUsersFetch(); });

  test('a text column filter narrows the rows', async () => {
    await renderGrid();
    expect(rowNames()).toHaveLength(4);

    fireEvent.change(screen.getByLabelText('Filter by Name'), { target: { value: 'me' } });

    expect(rowNames()).toEqual(['Mel']);
    expect(screen.getByText(/showing/i)).toHaveTextContent('Showing 1 of 4 accounts');
  });

  test('filtering is case-insensitive and works on other columns too', async () => {
    await renderGrid();

    fireEvent.change(screen.getByLabelText('Filter by Email'), { target: { value: 'PAT@' } });
    expect(rowNames()).toEqual(['Pat']);
  });

  test('the role column filters on an exact role', async () => {
    await renderGrid();

    fireEvent.change(screen.getByLabelText('Filter by Role'), { target: { value: 'admin' } });
    expect(rowNames().sort()).toEqual(['Ada', 'Sam']);
  });

  test('filters combine across columns and can be cleared', async () => {
    await renderGrid();

    fireEvent.change(screen.getByLabelText('Filter by Role'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('Filter by Name'), { target: { value: 'sam' } });
    expect(rowNames()).toEqual(['Sam']);

    fireEvent.click(screen.getByRole('button', { name: /clear filters/i }));
    expect(rowNames()).toHaveLength(4);
  });

  test('says so when nothing matches', async () => {
    await renderGrid();

    fireEvent.change(screen.getByLabelText('Filter by Name'), { target: { value: 'nobody' } });
    expect(screen.getByText(/no users match these filters/i)).toBeInTheDocument();
  });

  test('sorting by a column reverses on a second click', async () => {
    await renderGrid();

    fireEvent.click(screen.getByRole('button', { name: 'Sort by Name' }));
    expect(rowNames()).toEqual(['Ada', 'Mel', 'Pat', 'Sam']);

    fireEvent.click(screen.getByRole('button', { name: 'Sort by Name' }));
    expect(rowNames()).toEqual(['Sam', 'Pat', 'Mel', 'Ada']);
  });
});

describe('UsersView grid — column selector', () => {
  beforeEach(() => { deleteCookie(COLUMN_COOKIE); mockUsersFetch(); });

  function openPicker() {
    fireEvent.click(screen.getByRole('button', { name: /columns/i }));
    return screen.getByRole('checkbox', { name: /email/i }).closest('div');
  }

  test('hides a column when it is switched off', async () => {
    await renderGrid();
    expect(screen.getByLabelText('Filter by Email')).toBeInTheDocument();

    const panel = openPicker();
    fireEvent.click(within(panel).getByRole('checkbox', { name: /email/i }));

    expect(screen.queryByLabelText('Filter by Email')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Filter by Name')).toBeInTheDocument();
  });

  test('shows a column that is off by default when it is switched on', async () => {
    await renderGrid();
    expect(screen.queryByLabelText('Filter by Last seen')).not.toBeInTheDocument();

    const panel = openPicker();
    fireEvent.click(within(panel).getByRole('checkbox', { name: /last seen/i }));

    expect(screen.getByLabelText('Filter by Last seen')).toBeInTheDocument();
  });

  test('the name column cannot be switched off', async () => {
    await renderGrid();
    const panel = openPicker();
    expect(within(panel).getByRole('checkbox', { name: /name/i })).toBeDisabled();
  });

  test('saves the choice to a cookie and restores it on the next render', async () => {
    const { unmount } = render(<UsersView currentUser={{ id: 4, role: 'admin' }} />);
    await screen.findByRole('button', { name: 'Manage Ada' });

    const panel = openPicker();
    fireEvent.click(within(panel).getByRole('checkbox', { name: /email/i }));

    await waitFor(() => {
      expect(readJsonCookie(COLUMN_COOKIE)).not.toContain('email');
    });
    expect(readJsonCookie(COLUMN_COOKIE)).toContain('name');

    unmount();
    await renderGrid();
    expect(screen.queryByLabelText('Filter by Email')).not.toBeInTheDocument();
  });

  test('ignores columns in the cookie that no longer exist, and keeps required ones', async () => {
    writeJsonCookie(COLUMN_COOKIE, ['email', 'gone-away']);
    await renderGrid();

    expect(screen.getByLabelText('Filter by Name')).toBeInTheDocument();   // required, re-added
    expect(screen.getByLabelText('Filter by Email')).toBeInTheDocument();
    expect(screen.queryByLabelText('Filter by Role')).not.toBeInTheDocument();
  });

  test('reset puts the default columns back', async () => {
    writeJsonCookie(COLUMN_COOKIE, ['name']);
    await renderGrid();
    expect(screen.queryByLabelText('Filter by Email')).not.toBeInTheDocument();

    const panel = openPicker();
    fireEvent.click(within(panel).getByRole('button', { name: /reset to defaults/i }));

    expect(screen.getByLabelText('Filter by Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter by Role')).toBeInTheDocument();
  });
});
