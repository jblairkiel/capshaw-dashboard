import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { describe, test, expect, vi, afterEach } from 'vitest';
import SongTrackerView from '../components/SongTrackerView';

const ADMIN  = { id: 1, role: 'admin' };
const MEMBER = { id: 2, role: 'approved' };

const RECORD = over => ({
  id: 1, date: '2025-01-05', service: 'Sun AM', leader: 'Tom Nelson', song_count: 2, ...over,
});

function mockApi(overrides = {}) {
  const routes = {
    records:   { success: true, records: [RECORD()], total: 1 },
    analytics: { success: true, topSongs: [], byService: [], byLeader: [], monthly: [], totals: { services: 0, uniqueSongs: 0, plays: 0 } },
    songs:     { success: true, songs: [{ id: 10, title: 'Amazing Grace', number: '123', hymnal: 'Praise' }] },
    refresh:   { success: true, songs: [{ id: 11, title: 'Refreshed Song' }] },
    sync:      { success: true, synced: 3, warnings: [] },
    options:   { success: true, leaders: [{ id: 7, name: 'Tom Nelson' }], services: [{ id: 1, name: 'Sunday AM' }] },
    search:    { success: true, results: [{ id: 10, title: 'Amazing Grace', number: '123', hymnal: 'Praise' }] },
    add:       { success: true, id: 99 },
    ...overrides,
  };
  const fetchMock = vi.fn((url, opts = {}) => {
    const method = opts.method || 'GET';
    let body;
    if (url.includes('/analytics'))                body = routes.analytics;
    else if (url.includes('/options'))              body = routes.options;
    else if (url.includes('/search'))               body = routes.search;
    else if (method === 'POST' && url.includes('/sync'))    body = routes.sync;
    else if (method === 'POST' && url.includes('/add'))     body = routes.add;
    else if (method === 'POST' && url.includes('/refresh')) body = routes.refresh;
    else if (/\/api\/songs\/\d+$/.test(url))        body = routes.songs;
    else                                             body = routes.records;
    return Promise.resolve({ json: () => Promise.resolve(body) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => { vi.unstubAllGlobals(); });

// ─── History list ─────────────────────────────────────────────────────────────

describe('SongTrackerView — history', () => {
  test('lists service records with their leader and song count', async () => {
    mockApi();
    render(<SongTrackerView user={MEMBER} />);
    expect(await screen.findByText('Sun AM')).toBeInTheDocument();
    expect(screen.getByText('Tom Nelson')).toBeInTheDocument();
    expect(screen.getByText('2 songs')).toBeInTheDocument();
  });

  test('says so when nothing has been synced yet', async () => {
    mockApi({ records: { success: true, records: [], total: 0 } });
    render(<SongTrackerView user={MEMBER} />);
    expect(await screen.findByText(/No service records found/i)).toBeInTheDocument();
  });

  test('a member sees no hint to sync — that is an admin action', async () => {
    mockApi({ records: { success: true, records: [], total: 0 } });
    render(<SongTrackerView user={MEMBER} />);
    await screen.findByText(/No service records found/i);
    expect(screen.queryByText(/Click.*Sync/i)).not.toBeInTheDocument();
  });

  test('a member sees no Sync or Add controls', async () => {
    mockApi();
    render(<SongTrackerView user={MEMBER} />);
    await screen.findByText('Sun AM');
    expect(screen.queryByRole('button', { name: 'Sync' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
  });

  test('a service filter chip re-fetches with that service', async () => {
    const fetchMock = mockApi();
    render(<SongTrackerView user={MEMBER} />);
    await screen.findByText('Sun AM');

    fireEvent.click(screen.getByRole('button', { name: 'Wed' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('service=Wed')));
  });

  test('typing a search re-fetches with the query', async () => {
    const fetchMock = mockApi();
    render(<SongTrackerView user={MEMBER} />);
    await screen.findByText('Sun AM');

    fireEvent.change(screen.getByPlaceholderText('Search songs…'), { target: { value: 'Amazing' } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('q=Amazing')));
  });

  test('"Load more" appends rather than replacing the list', async () => {
    mockApi({ records: { success: true, records: Array.from({ length: 25 }, (_, i) => RECORD({ id: i + 1, date: `2025-01-${String(i+1).padStart(2,'0')}` })), total: 30 } });
    render(<SongTrackerView user={MEMBER} />);
    await screen.findByText('Sun AM');
    expect(screen.getByRole('button', { name: /Load more/i })).toBeInTheDocument();
  });

  test('no "Load more" once a short page comes back', async () => {
    mockApi({ records: { success: true, records: [RECORD()], total: 1 } });
    render(<SongTrackerView user={MEMBER} />);
    await screen.findByText('Sun AM');
    expect(screen.queryByRole('button', { name: /Load more/i })).not.toBeInTheDocument();
  });
});

// ─── ServiceCard ──────────────────────────────────────────────────────────────

describe('SongTrackerView — a service record', () => {
  test('expanding fetches and shows its songs', async () => {
    mockApi();
    render(<SongTrackerView user={MEMBER} />);
    // "Sun AM" also names a filter chip, so click the record row via its
    // leader name, which is unique.
    fireEvent.click(await screen.findByText('Tom Nelson'));
    expect(await screen.findByText('Amazing Grace')).toBeInTheDocument();
    expect(screen.getByText('#123 — Praise')).toBeInTheDocument();
  });

  test('collapsing and re-expanding does not re-fetch', async () => {
    const fetchMock = mockApi();
    render(<SongTrackerView user={MEMBER} />);
    const row = await screen.findByText('Tom Nelson');

    fireEvent.click(row);
    await screen.findByText('Amazing Grace');
    const calls = fetchMock.mock.calls.length;

    fireEvent.click(row);
    expect(screen.queryByText('Amazing Grace')).not.toBeInTheDocument();
    fireEvent.click(row);
    expect(await screen.findByText('Amazing Grace')).toBeInTheDocument();
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  test('a record with no songs recorded says so', async () => {
    mockApi({ songs: { success: true, songs: [] } });
    render(<SongTrackerView user={MEMBER} />);
    fireEvent.click(await screen.findByText('Tom Nelson'));
    expect(await screen.findByText(/No songs recorded/i)).toBeInTheDocument();
  });

  test('a member sees no refresh control', async () => {
    mockApi();
    render(<SongTrackerView user={MEMBER} />);
    fireEvent.click(await screen.findByText('Tom Nelson'));
    await screen.findByText('Amazing Grace');
    expect(screen.queryByText(/Refresh from server/i)).not.toBeInTheDocument();
  });

  test('an admin can refresh the songs from the server', async () => {
    const fetchMock = mockApi();
    render(<SongTrackerView user={ADMIN} />);
    fireEvent.click(await screen.findByText('Tom Nelson'));
    await screen.findByText('Amazing Grace');

    fireEvent.click(screen.getByText(/Refresh from server/i));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/songs/1/refresh', expect.objectContaining({ method: 'POST' })
    ));
    expect(await screen.findByText('Refreshed Song')).toBeInTheDocument();
  });
});

// ─── Analytics ────────────────────────────────────────────────────────────────

describe('SongTrackerView — analytics', () => {
  test('switches to the analytics tab and shows the totals', async () => {
    mockApi({ analytics: {
      success: true,
      topSongs: [{ id: 10, title: 'Amazing Grace', count: 5, last_sung: '2025-01-05' }],
      byService: [{ service: 'Sun AM', count: 10 }],
      byLeader: [{ leader: 'Tom Nelson', count: 4 }],
      monthly: [{ month: '2025-01', count: 3 }],
      totals: { services: 12, uniqueSongs: 40, plays: 96 },
    } });
    render(<SongTrackerView user={MEMBER} />);
    await screen.findByText('Sun AM');

    fireEvent.click(screen.getByRole('button', { name: 'Analytics' }));
    expect(await screen.findByText('12')).toBeInTheDocument();
    expect(screen.getByText('96')).toBeInTheDocument();
    expect(screen.getByText('Amazing Grace')).toBeInTheDocument();
    expect(screen.getByText('5×')).toBeInTheDocument();
    expect(screen.getByText('Tom Nelson')).toBeInTheDocument();
  });

  test('an empty analytics set says so in each panel', async () => {
    mockApi();
    render(<SongTrackerView user={MEMBER} />);
    await screen.findByText('Sun AM');
    fireEvent.click(screen.getByRole('button', { name: 'Analytics' }));

    expect(await screen.findByText(/No data yet — sync first/i)).toBeInTheDocument();
    expect(screen.getAllByText(/No data yet\.?/i).length).toBeGreaterThanOrEqual(2);
  });

  test('reports analytics that failed to load', async () => {
    mockApi({ analytics: { success: false, error: 'Not signed in' } });
    render(<SongTrackerView user={MEMBER} />);
    await screen.findByText('Sun AM');
    fireEvent.click(screen.getByRole('button', { name: 'Analytics' }));
    expect(await screen.findByText('Not signed in')).toBeInTheDocument();
  });
});

// ─── Syncing ──────────────────────────────────────────────────────────────────

describe('SongTrackerView — syncing (admin)', () => {
  test('runs a sync and reports how many records came in', async () => {
    const fetchMock = mockApi();
    render(<SongTrackerView user={ADMIN} />);
    await screen.findByText('Sun AM');

    fireEvent.click(screen.getByRole('button', { name: 'Sync' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/songs/sync', expect.objectContaining({ method: 'POST' })
    ));
    expect(await screen.findByText('Synced 3 records')).toBeInTheDocument();
  });

  test('reports a sync that failed', async () => {
    mockApi({ sync: { success: false, error: 'Admin session expired' } });
    render(<SongTrackerView user={ADMIN} />);
    await screen.findByText('Sun AM');
    fireEvent.click(screen.getByRole('button', { name: 'Sync' }));
    expect(await screen.findByText('Sync failed: Admin session expired')).toBeInTheDocument();
  });
});

// ─── Add service form ─────────────────────────────────────────────────────────

describe('SongTrackerView — adding a record (admin)', () => {
  test('opens the form and lists the service options', async () => {
    mockApi();
    render(<SongTrackerView user={ADMIN} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));

    expect(await screen.findByText('Add Service Record')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Sunday AM' })).toBeInTheDocument();
  });

  test('reports a failure to load the form options', async () => {
    mockApi({ options: { success: false, error: 'Could not reach admin panel' } });
    render(<SongTrackerView user={ADMIN} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
    expect(await screen.findByText('Could not reach admin panel')).toBeInTheDocument();
  });

  test('filters leaders as you type, and picking one confirms the choice', async () => {
    mockApi();
    render(<SongTrackerView user={ADMIN} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
    await screen.findByText('Add Service Record');

    fireEvent.change(screen.getByPlaceholderText('Search leaders…'), { target: { value: 'Tom' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Tom Nelson' }));
    expect(screen.getByText('Leader selected')).toBeInTheDocument();
  });

  test('a search with no matches says so', async () => {
    mockApi();
    render(<SongTrackerView user={ADMIN} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
    await screen.findByText('Add Service Record');
    fireEvent.change(screen.getByPlaceholderText('Search leaders…'), { target: { value: 'zzz' } });
    expect(await screen.findByText('No matches')).toBeInTheDocument();
  });

  test('refuses to submit without a leader or a song', async () => {
    mockApi();
    render(<SongTrackerView user={ADMIN} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
    await screen.findByText('Add Service Record');

    fireEvent.click(screen.getByRole('button', { name: /Submit Service Record/i }));
    expect(await screen.findByText(/Select a leader/i)).toBeInTheDocument();
  });

  test('adding a song lists it, and removing it clears the list again', async () => {
    mockApi();
    render(<SongTrackerView user={ADMIN} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
    await screen.findByText('Add Service Record');

    fireEvent.change(screen.getByPlaceholderText('Search and add songs…'), { target: { value: 'grace' } });
    fireEvent.mouseDown(await screen.findByText('Amazing Grace'));
    const listedSong = await screen.findByText('#123');
    expect(listedSong).toBeInTheDocument();

    // The remove control is the only button inside that song's own row.
    const songRow = listedSong.closest('li');
    fireEvent.click(within(songRow).getByRole('button'));
    expect(screen.queryByText('#123')).not.toBeInTheDocument();
  });

  test('a complete submission goes through and returns to history', async () => {
    const fetchMock = mockApi();
    render(<SongTrackerView user={ADMIN} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
    await screen.findByText('Add Service Record');

    fireEvent.change(screen.getByPlaceholderText('Search leaders…'), { target: { value: 'Tom' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Tom Nelson' }));

    fireEvent.change(screen.getByPlaceholderText('Search and add songs…'), { target: { value: 'grace' } });
    fireEvent.mouseDown(await screen.findByText('Amazing Grace'));

    fireEvent.click(screen.getByRole('button', { name: /Submit Service Record/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/songs/add', expect.objectContaining({ method: 'POST' })
    ));
    // Back on the history list — "Sun AM" also names a filter chip, so check
    // the record itself came back via its leader.
    expect(await screen.findByText('Tom Nelson')).toBeInTheDocument();
  });

  test('a refused submission is shown, and the form stays open', async () => {
    mockApi({ add: { success: false, error: 'Admin panel rejected the submission' } });
    render(<SongTrackerView user={ADMIN} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
    await screen.findByText('Add Service Record');

    fireEvent.change(screen.getByPlaceholderText('Search leaders…'), { target: { value: 'Tom' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Tom Nelson' }));
    fireEvent.change(screen.getByPlaceholderText('Search and add songs…'), { target: { value: 'grace' } });
    fireEvent.mouseDown(await screen.findByText('Amazing Grace'));
    fireEvent.click(screen.getByRole('button', { name: /Submit Service Record/i }));

    expect(await screen.findByText('Admin panel rejected the submission')).toBeInTheDocument();
    expect(screen.getByText('Add Service Record')).toBeInTheDocument();
  });

  test('going back returns to history without saving', async () => {
    mockApi();
    render(<SongTrackerView user={ADMIN} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
    await screen.findByText('Add Service Record');
    fireEvent.click(screen.getByRole('button', { name: /Back to history/i }));
    expect(await screen.findByText('Tom Nelson')).toBeInTheDocument();
  });
});
