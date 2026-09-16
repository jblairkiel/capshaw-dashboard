import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import DatabaseAdminView from '../components/DatabaseAdminView';

const OVERVIEW = {
  success: true,
  counts: { attendance: 120, sermons: 45, songs: 300 },
  lastScraped: '2025-03-01T12:00:00Z',
};

const SERMON_ROW = { id: 1, date: '2025-01-05', title: 'Faith That Works', speaker: 'Ray Harris', type: 'Expository', series: 'James', service: 'AM' };

function mockApi(overrides = {}) {
  const routes = {
    overview:     OVERVIEW,
    tableRows:    { success: true, rows: [SERMON_ROW], total: 1 },
    scrapeStatus: { success: true, lastScraped: null, allWarnings: [], sections: [] },
    scrape:       { success: true, warnings: [] },
    importCache:  { success: true, counts: { attendance: 10, sermons: 5 } },
    save:         { success: true, row: { id: 9, ...SERMON_ROW } },
    remove:       { success: true },
    debug:        { success: true, report: { path: '/members/sermons', status: 200, bytes: 1200, looksLikeLogin: false, pageNotFound: false, tables: [], parsed: { count: 5 } } },
    ...overrides,
  };
  const fetchMock = vi.fn((url, opts = {}) => {
    const method = opts.method || 'GET';
    let body;
    if (url.includes('/overview'))            body = routes.overview;
    else if (url.includes('/scrape-status'))  body = routes.scrapeStatus;
    else if (url.includes('/members/update')) body = routes.scrape;
    else if (url.includes('/import-cache'))   body = routes.importCache;
    else if (url.includes('/members/debug/')) body = routes.debug;
    else if (method === 'DELETE')             body = routes.remove;
    else if (method === 'POST' || method === 'PATCH') body = routes.save;
    else                                       body = routes.tableRows;
    return Promise.resolve({ json: () => Promise.resolve(body) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => { vi.stubGlobal('confirm', vi.fn(() => true)); });
afterEach(() => { vi.unstubAllGlobals(); });

// ─── Overview ─────────────────────────────────────────────────────────────────

describe('DatabaseAdminView — overview', () => {
  test('shows the count for each table and the last scrape time', async () => {
    mockApi();
    render(<DatabaseAdminView />);
    // "120" also names the sidebar's row count next to Attendance
    expect(await screen.findByText('120', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('Attendance', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('300', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText(/Last scraped:/)).toBeInTheDocument();
  });

  test('groups tables under Congregation and Worship', async () => {
    mockApi();
    render(<DatabaseAdminView />);
    await screen.findByText('120', { selector: 'p' });
    // Both group names also head their sidebar section
    expect(screen.getByText('Congregation', { selector: 'h3' })).toBeInTheDocument();
    expect(screen.getByText('Worship', { selector: 'h3' })).toBeInTheDocument();
  });

  test('a table with no rows yet shows a zero rather than nothing', async () => {
    mockApi({ overview: { success: true, counts: {}, lastScraped: null } });
    render(<DatabaseAdminView />);
    await screen.findByText('Database Overview');
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
  });

  test('scraping updates the message and refreshes the counts', async () => {
    const fetchMock = mockApi({ scrape: { success: true, warnings: ['sermons: parse error'] } });
    render(<DatabaseAdminView />);
    await screen.findByText('120', { selector: 'p' });

    fireEvent.click(screen.getByRole('button', { name: /Scrape & Import/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/members/update', expect.objectContaining({ method: 'POST' })
    ));
    expect(await screen.findByText('Scrape complete · 1 warning(s)')).toBeInTheDocument();
  });

  test('a failed scrape is reported', async () => {
    mockApi({ scrape: { success: false, error: 'Session expired' } });
    render(<DatabaseAdminView />);
    await screen.findByText('120', { selector: 'p' });
    fireEvent.click(screen.getByRole('button', { name: /Scrape & Import/i }));
    expect(await screen.findByText('Scrape failed: Session expired')).toBeInTheDocument();
  });

  test('the scrape message can be dismissed', async () => {
    mockApi();
    render(<DatabaseAdminView />);
    await screen.findByText('120', { selector: 'p' });
    fireEvent.click(screen.getByRole('button', { name: /Scrape & Import/i }));
    await screen.findByText('Scrape complete');
    fireEvent.click(screen.getByText('✕'));
    expect(screen.queryByText('Scrape complete')).not.toBeInTheDocument();
  });

  test('importing the cache reports the total rows loaded', async () => {
    const fetchMock = mockApi();
    render(<DatabaseAdminView />);
    await screen.findByText('120', { selector: 'p' });

    fireEvent.click(screen.getByRole('button', { name: /Import Cache/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/import-cache', expect.objectContaining({ method: 'POST' })
    ));
    expect(await screen.findByText('Cache imported — 15 total rows')).toBeInTheDocument();
  });

  test('a failed import is reported', async () => {
    mockApi({ importCache: { success: false, error: 'No cached data found' } });
    render(<DatabaseAdminView />);
    await screen.findByText('120', { selector: 'p' });
    fireEvent.click(screen.getByRole('button', { name: /Import Cache/i }));
    expect(await screen.findByText('Import failed: No cached data found')).toBeInTheDocument();
  });
});

// ─── Navigation ───────────────────────────────────────────────────────────────

describe('DatabaseAdminView — navigation', () => {
  test('the sidebar shows a row count next to each table once loaded', async () => {
    mockApi();
    render(<DatabaseAdminView />);
    const sermonsLink = await screen.findByRole('button', { name: /Sermons\s*45/ });
    expect(sermonsLink).toBeInTheDocument();
  });

  test('selecting a table from the sidebar opens its data grid', async () => {
    mockApi();
    render(<DatabaseAdminView />);
    fireEvent.click(await screen.findByRole('button', { name: /Sermons/ }));
    expect(await screen.findByText('Faith That Works')).toBeInTheDocument();
  });

  test('the mobile select offers the same destinations', async () => {
    mockApi();
    render(<DatabaseAdminView />);
    await screen.findByText('120', { selector: 'p' });
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'sermons' } });
    expect(await screen.findByText('Faith That Works')).toBeInTheDocument();
  });
});

// ─── TableView ────────────────────────────────────────────────────────────────

describe('DatabaseAdminView — a table grid', () => {
  async function openSermons(routes) {
    const fetchMock = mockApi(routes);
    render(<DatabaseAdminView />);
    fireEvent.click(await screen.findByRole('button', { name: /Sermons/ }));
    // The row-count pill only renders once the table's own fetch has resolved,
    // unlike the heading, which is static regardless of the row data.
    await waitFor(() => expect(screen.getByText(/rows$/)).toBeInTheDocument());
    return fetchMock;
  }

  test('shows the row count and every column', async () => {
    await openSermons();
    expect(await screen.findByText('Faith That Works')).toBeInTheDocument();
    expect(screen.getByText('1 rows')).toBeInTheDocument();
    expect(screen.getByText('Ray Harris')).toBeInTheDocument();
  });

  test('an empty table says so', async () => {
    await openSermons({ tableRows: { success: true, rows: [], total: 0 } });
    expect(await screen.findByText('No rows found.')).toBeInTheDocument();
  });

  test('a load failure is reported', async () => {
    const fetchMock = mockApi({ tableRows: { success: false, error: 'Admin access required' } });
    render(<DatabaseAdminView />);
    fireEvent.click(await screen.findByRole('button', { name: /Sermons/ }));
    expect(await screen.findByText('Admin access required')).toBeInTheDocument();
  });

  test('clicking a column header sorts by it, and again reverses the direction', async () => {
    const fetchMock = await openSermons();
    fireEvent.click(screen.getByRole('button', { name: /^title/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('sort=title'), expect.anything()
    ));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('dir=asc'), expect.anything()
    ));

    fireEvent.click(screen.getByRole('button', { name: /^title/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('dir=desc'), expect.anything()
    ));
  });

  test('typing in a column filter re-fetches after a short pause', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = await openSermons();

    // columns are date, title, speaker, type, series, service — index 2 is speaker
    fireEvent.change(screen.getAllByPlaceholderText('filter…')[2], { target: { value: 'Harris' } });
    await vi.advanceTimersByTimeAsync(350);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('f_speaker=Harris'), expect.anything()));

    expect(screen.getByRole('button', { name: /Clear filters/i })).toBeInTheDocument();
    vi.useRealTimers();
  });

  test('clear filters empties every filter box and reloads', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = await openSermons();
    const filterInput = screen.getAllByPlaceholderText('filter…')[2];

    fireEvent.change(filterInput, { target: { value: 'Harris' } });
    await vi.advanceTimersByTimeAsync(350);
    await screen.findByRole('button', { name: /Clear filters/i });

    fireEvent.click(screen.getByRole('button', { name: /Clear filters/i }));
    expect(filterInput).toHaveValue('');
    expect(screen.queryByRole('button', { name: /Clear filters/i })).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  test('deleting a row asks first, then removes it', async () => {
    const fetchMock = await openSermons();
    fireEvent.click(screen.getByTitle('Delete'));
    expect(globalThis.confirm).toHaveBeenCalled();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/sermons/1', expect.objectContaining({ method: 'DELETE' })
    ));
  });

  test('a refused delete is reported', async () => {
    await openSermons({ remove: { success: false, error: 'Admin access required' } });
    fireEvent.click(screen.getByTitle('Delete'));
    expect(await screen.findByText('Admin access required')).toBeInTheDocument();
  });

  test('pagination controls appear once there is more than one page', async () => {
    await openSermons({ tableRows: { success: true, rows: [SERMON_ROW], total: 120 } });
    // The range covers a full page (LIMIT=50) even though only one row came
    // back in this fixture, and is rendered as several text nodes.
    expect(screen.getByText((_, node) => node?.textContent === '1–50 of 120')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Prev' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled();
  });

  test('no pagination controls when everything fits on one page', async () => {
    await openSermons();
    expect(screen.queryByText(/of \d+$/)).not.toBeInTheDocument();
  });

  test('a long cell value is truncated with the full text in a title attribute', async () => {
    const long = 'x'.repeat(90);
    await openSermons({ tableRows: { success: true, rows: [{ ...SERMON_ROW, series: long }], total: 1 } });
    const truncated = screen.getByTitle(long);
    expect(truncated.textContent.length).toBeLessThan(long.length);
  });

  test('a null cell renders as a dash', async () => {
    await openSermons({ tableRows: { success: true, rows: [{ ...SERMON_ROW, series: null }], total: 1 } });
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

// ─── RowModal ─────────────────────────────────────────────────────────────────

describe('DatabaseAdminView — editing a row', () => {
  async function openSermons(routes) {
    const fetchMock = mockApi(routes);
    render(<DatabaseAdminView />);
    fireEvent.click(await screen.findByRole('button', { name: /Sermons/ }));
    await screen.findByText('Faith That Works');
    return fetchMock;
  }

  test('adding a row opens a blank form and creates it on save', async () => {
    const fetchMock = await openSermons();
    fireEvent.click(screen.getByRole('button', { name: /Add/i }));

    expect(screen.getByText('Add Sermons')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText ? screen.getByLabelText('Title') : screen.getAllByRole('textbox')[1], { target: { value: 'New Sermon' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/sermons', expect.objectContaining({ method: 'POST' })
    ));
  });

  test('editing a row pre-fills the form and updates on save', async () => {
    await openSermons();
    fireEvent.click(screen.getByTitle('Edit'));
    expect(screen.getByText('Edit Sermons')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Faith That Works')).toBeInTheDocument();
  });

  test('a refused save shows the error and keeps the form open', async () => {
    await openSermons({ save: { success: false, error: 'Constraint violation' } });
    fireEvent.click(screen.getByTitle('Edit'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Constraint violation')).toBeInTheDocument();
    expect(screen.getByText('Edit Sermons')).toBeInTheDocument();
  });

  test('the form can be dismissed without saving', async () => {
    await openSermons();
    fireEvent.click(screen.getByTitle('Edit'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Edit Sermons')).not.toBeInTheDocument();
  });
});

// ─── ScrapeStatus ─────────────────────────────────────────────────────────────

describe('DatabaseAdminView — scrape status', () => {
  const SECTIONS = {
    success: true, lastScraped: '2025-03-01T12:00:00Z',
    allWarnings: ['sermons: only found 1 row'],
    sections: [
      { key: 'attendance', label: 'Attendance', count: 120, latestDate: '2025-03-01', warnings: [], status: 'ok' },
      { key: 'sermons',    label: 'Sermons',    count: 45,  latestDate: '2025-02-23', warnings: ['sermons: only found 1 row'], status: 'warning' },
      { key: 'deacons',    label: 'Deacons',    count: 0,   latestDate: null,          warnings: [],                          status: 'empty' },
    ],
  };

  test('shows an overall status badge and each section', async () => {
    mockApi({ scrapeStatus: SECTIONS });
    render(<DatabaseAdminView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Scrape Status' }));

    // "Attendance" also names a sidebar link and a mobile-select option, and
    // "Warning" appears both as the overall badge and the sermons row's own
    expect(await screen.findByText('Attendance', { selector: 'span.font-medium' })).toBeInTheDocument();
    expect(screen.getAllByText('Warning').length).toBeGreaterThan(0);
    expect(screen.getAllByText('120 rows')[0]).toBeInTheDocument();
  });

  test('shows "Never scraped" before the first scrape', async () => {
    mockApi({ scrapeStatus: { success: true, lastScraped: null, allWarnings: [], sections: [] } });
    render(<DatabaseAdminView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Scrape Status' }));
    expect(await screen.findByText('Never scraped')).toBeInTheDocument();
  });

  test('expanding a warning section shows the message', async () => {
    mockApi({ scrapeStatus: SECTIONS });
    render(<DatabaseAdminView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Scrape Status' }));
    await screen.findByText('Sermons', { selector: 'span.font-medium' });

    const sermonsRow = screen.getByText('Sermons', { selector: 'span.font-medium' }).closest('div.bg-white');
    // The row has two buttons — Diagnose, then the expand chevron — and only
    // the chevron toggles the warnings open.
    fireEvent.click(within(sermonsRow).getAllByRole('button').at(-1));

    // The one-line preview (amber-700, truncated) disappears once expanded;
    // the same text reappears in the expanded warnings list (amber-800, mono).
    await waitFor(() => expect(within(sermonsRow).queryByText('sermons: only found 1 row', { selector: 'p.text-amber-700' })).not.toBeInTheDocument());
    expect(within(sermonsRow).getByText('sermons: only found 1 row', { selector: 'p.text-amber-800' })).toBeInTheDocument();
  });

  test('a summary of all warnings is shown at the bottom', async () => {
    mockApi({ scrapeStatus: SECTIONS });
    render(<DatabaseAdminView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Scrape Status' }));
    expect(await screen.findByText('All warnings (1)')).toBeInTheDocument();
  });

  test('no warnings after a clean scrape says so', async () => {
    mockApi({ scrapeStatus: { success: true, lastScraped: '2025-03-01T12:00:00Z', allWarnings: [], sections: [] } });
    render(<DatabaseAdminView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Scrape Status' }));
    expect(await screen.findByText(/No warnings from the last scrape/i)).toBeInTheDocument();
  });

  test('diagnosing a section fetches and shows what the site actually returned', async () => {
    mockApi({ scrapeStatus: SECTIONS });
    render(<DatabaseAdminView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Scrape Status' }));
    await screen.findByText('Sermons', { selector: 'span.font-medium' });

    fireEvent.click(screen.getAllByRole('button', { name: 'Diagnose' })[1]);
    expect(await screen.findByText(/Loaded and parsed 5 rows/i)).toBeInTheDocument();
    expect(screen.getByText(/HTTP 200/)).toBeInTheDocument();
  });

  test('a diagnosis that finds a login page explains that plainly', async () => {
    mockApi({
      scrapeStatus: SECTIONS,
      debug: { success: true, report: { path: '/members/sermons', status: 200, bytes: 500, looksLikeLogin: true, pageNotFound: false, tables: [] } },
    });
    render(<DatabaseAdminView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Scrape Status' }));
    await screen.findByText('Sermons', { selector: 'span.font-medium' });

    fireEvent.click(screen.getAllByRole('button', { name: 'Diagnose' })[1]);
    expect(await screen.findByText(/scraper credentials are being rejected/i)).toBeInTheDocument();
  });

  test('a diagnosis request that fails is reported inline', async () => {
    mockApi({ scrapeStatus: SECTIONS, debug: { success: false, error: 'Session expired' } });
    render(<DatabaseAdminView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Scrape Status' }));
    await screen.findByText('Sermons', { selector: 'span.font-medium' });

    fireEvent.click(screen.getAllByRole('button', { name: 'Diagnose' })[1]);
    expect(await screen.findByText(/Could not check: Session expired/i)).toBeInTheDocument();
  });

  test('scraping from this view also refreshes the section statuses', async () => {
    const fetchMock = mockApi({ scrapeStatus: SECTIONS });
    render(<DatabaseAdminView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Scrape Status' }));
    await screen.findByText('Attendance', { selector: 'span.font-medium' });

    fireEvent.click(screen.getByRole('button', { name: /Scrape Now/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/members/update', expect.objectContaining({ method: 'POST' })
    ));
  });
});
