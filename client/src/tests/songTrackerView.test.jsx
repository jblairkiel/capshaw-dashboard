import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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

    fireEvent.click(screen.getByRole('button', { name: 'Import from capshawchurch.org' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/songs/sync', expect.objectContaining({ method: 'POST' })
    ));
    expect(await screen.findByText('Imported 3 records')).toBeInTheDocument();
  });

  test('reports a sync that failed', async () => {
    mockApi({ sync: { success: false, error: 'Admin session expired' } });
    render(<SongTrackerView user={ADMIN} />);
    await screen.findByText('Sun AM');
    fireEvent.click(screen.getByRole('button', { name: 'Import from capshawchurch.org' }));
    expect(await screen.findByText('Sync failed: Admin session expired')).toBeInTheDocument();
  });
});

// ─── Add service form ─────────────────────────────────────────────────────────

describe('SongTrackerView — adding a record', () => {
  test('Add goes to the Submit a Service tab rather than a form of its own', async () => {
    mockApi();
    const onSubmitService = vi.fn();
    render(<SongTrackerView user={ADMIN} onSubmitService={onSubmitService} />);
    await screen.findByText('Sun AM');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onSubmitService).toHaveBeenCalled();
  });

  test('a record made here has nothing to refresh from', async () => {
    mockApi({ records: { success: true, records: [RECORD({ source: 'portal' })], total: 1 } });
    render(<SongTrackerView user={ADMIN} />);
    // "Sun AM" is also a filter chip; the leader's name is the row's own.
    fireEvent.click(await screen.findByText('Tom Nelson'));
    await screen.findByText('Amazing Grace');
    expect(screen.queryByRole('button', { name: /Refresh from server/ })).toBeNull();
  });
});

describe('SongTrackerView — the library', () => {
  const LIBRARY = {
    success: true, canManage: true,
    songs: [
      { id: 10, title: 'Amazing Grace', hymnal: 'Praise', number: '123', source: 'capshawchurch', timesSung: 4 },
      { id: 1000001, title: 'Amazing Grace!', hymnal: '', number: '', source: 'portal', timesSung: 0 },
    ],
  };

  function libraryApi(library = LIBRARY) {
    const fetchMock = mockApi();
    const inner = fetchMock.getMockImplementation();
    fetchMock.mockImplementation((url, opts = {}) => {
      if (String(url).startsWith('/api/songs/library')) {
        const body = (opts.method || 'GET') === 'GET' ? library : { success: true, song: library.songs[0] };
        return Promise.resolve({ json: () => Promise.resolve(body) });
      }
      return inner(url, opts);
    });
    return fetchMock;
  }

  test('lists every song, how often it was sung, and which were added here', async () => {
    libraryApi();
    render(<SongTrackerView user={MEMBER} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Library' }));
    expect(await screen.findByText('sung 4×')).toBeInTheDocument();
    expect(screen.getByText('not sung yet')).toBeInTheDocument();
    expect(screen.getByText('added here')).toBeInTheDocument();
  });

  test('whoever keeps the songs can merge a duplicate into the song it repeats', async () => {
    const fetchMock = libraryApi();
    vi.stubGlobal('confirm', () => true);
    render(<SongTrackerView user={ADMIN} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Library' }));
    await screen.findByText('Amazing Grace!');
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[1]);
    fireEvent.change(screen.getByLabelText('Merge into'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u, o]) => u === '/api/songs/library/1000001/merge' && o?.method === 'POST');
      expect(JSON.parse(call[1].body)).toEqual({ into: 10 });
    });
  });

  test('a member sees no Edit button', async () => {
    libraryApi({ ...LIBRARY, canManage: false });
    render(<SongTrackerView user={MEMBER} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Library' }));
    await screen.findByText('sung 4×');
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });
});
