import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import DirectoryView from '../components/DirectoryView';

// The member directory groups people into households by shared address, which
// is the part worth pinning down: the scrape produces a flat list of people and
// the view has to work out who lives with whom, and what to call each family.

const person = over => ({
  id: 1, name: 'Ray Harris', address: '1 Oak St', city: 'Harvest', state: 'AL', zip: '35749',
  phone: '(256) 555-0100', cell: '(256) 555-0101', email: 'ray@example.com', notes: '', photo: '', ...over,
});

const HOUSEHOLD = [
  person({ id: 1, name: 'Ray Harris' }),
  person({ id: 2, name: 'Jo Harris', cell: '', phone: '', email: 'jo@example.com' }),
  person({ id: 3, name: 'Tom Nelson', address: '2 Elm St', zip: '35750', email: 'tom@example.com' }),
];

function mockApi({ rows = HOUSEHOLD, ...routes } = {}) {
  const fetchMock = vi.fn((url, opts = {}) => {
    const method = opts.method || 'GET';
    let body;

    if (url.includes('/api/members/update'))               body = routes.sync   ?? { success: true };
    else if (url.includes('/worship'))                      body = { success: true, person: {} };
    else if (method === 'PATCH')                            body = routes.save   ?? { success: true, person: person({ id: 1, name: 'Raymond Harris' }) };
    else if (url.includes('/api/profile/person/'))         body = routes.person ?? { success: true, person: { id: 1, name: 'Ray Harris', preferences: {}, notes: '' } };
    else if (method === 'DELETE')                          body = routes.remove ?? { success: true };
    else if (method === 'POST')                             body = routes.save   ?? { success: true, row: person({ id: 9, name: 'New Person', address: '9 Pine St', zip: '35751' }) };
    else                                                   body = routes.list   ?? { success: true, rows };

    return Promise.resolve({ json: () => Promise.resolve(body) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}


beforeEach(() => {
  vi.stubGlobal('confirm', vi.fn(() => true));
});

afterEach(() => { vi.unstubAllGlobals(); });

// ─── Loading and grouping ─────────────────────────────────────────────────────

describe('DirectoryView', () => {
  test('asks for the whole directory, sorted by name', async () => {
    const fetchMock = mockApi();
    render(<DirectoryView />);

    await screen.findByText('Harris Family');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/directory?limit=2000&sort=name&dir=asc',
      expect.objectContaining({ credentials: 'include' })
    );
  });

  test('puts people who share an address into one family', async () => {
    mockApi();
    render(<DirectoryView />);

    const harris = (await screen.findByText('Harris Family')).closest('div.bg-white');
    expect(within(harris).getByText('Ray Harris')).toBeInTheDocument();
    expect(within(harris).getByText('Jo Harris')).toBeInTheDocument();
    expect(within(harris).queryByText('Tom Nelson')).not.toBeInTheDocument();
  });

  test('counts the families and the people in them', async () => {
    mockApi();
    render(<DirectoryView />);
    expect(await screen.findByText('2 families · 3 members')).toBeInTheDocument();
  });

  test('says "1 family" rather than "1 families"', async () => {
    mockApi({ rows: [person()] });
    render(<DirectoryView />);
    expect(await screen.findByText('1 family · 1 members')).toBeInTheDocument();
  });

  test('names a family after the surname most of its members share', async () => {
    mockApi({ rows: [
      person({ id: 1, name: 'Ray Harris' }),
      person({ id: 2, name: 'Jo Harris' }),
      person({ id: 3, name: 'Ann Boarder' }),
    ] });
    render(<DirectoryView />);
    expect(await screen.findByText('Harris Family')).toBeInTheDocument();
  });

  test('people at different addresses stay in separate families', async () => {
    mockApi();
    render(<DirectoryView />);
    await screen.findByText('Harris Family');
    expect(screen.getByText('Nelson Family')).toBeInTheDocument();
  });

  test('people with no address are not lumped together', async () => {
    mockApi({ rows: [
      person({ id: 1, name: 'Ray Harris', address: '', zip: '' }),
      person({ id: 2, name: 'Tom Nelson', address: '', zip: '' }),
    ] });
    render(<DirectoryView />);

    await screen.findByText('Harris Family');
    expect(screen.getByText('Nelson Family')).toBeInTheDocument();
    expect(screen.getByText('2 families · 2 members')).toBeInTheDocument();
  });

  test('a one-word name is used as the family name', async () => {
    mockApi({ rows: [person({ id: 1, name: 'Cher' })] });
    render(<DirectoryView />);
    expect(await screen.findByText('Cher Family')).toBeInTheDocument();
  });

  test('shows each household address once, on the card', async () => {
    mockApi();
    render(<DirectoryView />);
    expect(await screen.findByText('1 Oak St, Harvest, AL, 35749')).toBeInTheDocument();
  });

  test('shows the contact details a person actually has', async () => {
    mockApi();
    render(<DirectoryView />);

    const harris = (await screen.findByText('Harris Family')).closest('div.bg-white');
    expect(within(harris).getByText('📱 (256) 555-0101')).toBeInTheDocument();
    expect(within(harris).getByText('📞 (256) 555-0100')).toBeInTheDocument();
    expect(within(harris).getByRole('link', { name: /ray@example.com/ })).toHaveAttribute('href', 'mailto:ray@example.com');
    // Jo has neither number, so only Ray's line appears in this family
    expect(within(harris).getAllByText(/📱/)).toHaveLength(1);
  });

  test('shows a note when somebody has one', async () => {
    mockApi({ rows: [person({ notes: 'Prefers texts' })] });
    render(<DirectoryView />);
    expect(await screen.findByText('Prefers texts')).toBeInTheDocument();
  });

  test('reports a directory that could not be loaded', async () => {
    mockApi({ list: { success: false, error: 'Admin access required' } });
    render(<DirectoryView />);
    expect(await screen.findByText('Admin access required')).toBeInTheDocument();
  });

  test('invites the first import when the directory is empty', async () => {
    mockApi({ rows: [] });
    render(<DirectoryView />);
    expect(await screen.findByText(/click "Sync from Site" to import/i)).toBeInTheDocument();
  });
});

// ─── Searching and the alphabet ───────────────────────────────────────────────

describe('DirectoryView — finding somebody', () => {
  async function renderLoaded() {
    mockApi();
    render(<DirectoryView />);
    await screen.findByText('Harris Family');
    return screen.getByPlaceholderText(/Search name, address/i);
  }

  test('searches by name', async () => {
    const search = await renderLoaded();
    fireEvent.change(search, { target: { value: 'Nelson' } });

    await waitFor(() => expect(screen.queryByText('Harris Family')).not.toBeInTheDocument());
    expect(screen.getByText('Nelson Family')).toBeInTheDocument();
  });

  test('searches the address, the city, either phone number and the email', async () => {
    const search = await renderLoaded();

    for (const term of ['Elm', 'Harvest', '555-0100', '555-0101', 'tom@example.com']) {
      fireEvent.change(search, { target: { value: term } });
      await waitFor(() => expect(screen.queryByText(/No families match/i)).not.toBeInTheDocument());
    }
  });

  test('a search that matches nobody says so', async () => {
    const search = await renderLoaded();
    fireEvent.change(search, { target: { value: 'zzzz' } });
    expect(await screen.findByText(/No families match your search/i)).toBeInTheDocument();
  });

  test('a letter narrows to families whose name starts with it', async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole('button', { name: 'N' }));

    await waitFor(() => expect(screen.queryByText('Harris Family')).not.toBeInTheDocument());
    expect(screen.getByText('Nelson Family')).toBeInTheDocument();
  });

  test('clicking the same letter again clears it', async () => {
    await renderLoaded();
    const n = screen.getByRole('button', { name: 'N' });

    fireEvent.click(n);
    await waitFor(() => expect(screen.queryByText('Harris Family')).not.toBeInTheDocument());
    fireEvent.click(n);
    expect(await screen.findByText('Harris Family')).toBeInTheDocument();
  });

  test('a letter and a search do not fight each other', async () => {
    const search = await renderLoaded();

    fireEvent.click(screen.getByRole('button', { name: 'N' }));
    await waitFor(() => expect(screen.queryByText('Harris Family')).not.toBeInTheDocument());

    // Typing clears the letter rather than narrowing within it
    fireEvent.change(search, { target: { value: 'Harris' } });
    expect(await screen.findByText('Harris Family')).toBeInTheDocument();
  });

  test('the clear button appears only while something is filtered, and resets both', async () => {
    const search = await renderLoaded();
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'Nelson' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Clear' }));

    expect(await screen.findByText('Harris Family')).toBeInTheDocument();
    expect(search).toHaveValue('');
  });
});

// ─── Editing ──────────────────────────────────────────────────────────────────

describe('DirectoryView — changing the directory', () => {
  async function openLoaded(routes) {
    mockApi(routes);
    render(<DirectoryView />);
    await screen.findByText('Harris Family');
  }

  test('adding a member opens an empty form', async () => {
    await openLoaded();
    fireEvent.click(screen.getByRole('button', { name: /Add Member/i }));

    expect(await screen.findByText('Add Member', { selector: 'h3' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('First Last')).toHaveValue('');
  });

  test('editing a member opens their details', async () => {
    await openLoaded();
    fireEvent.click(screen.getAllByTitle('Edit')[0]);

    expect(await screen.findByText('Edit Member', { selector: 'h3' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('First Last')).toHaveValue('Ray Harris');
    expect(screen.getByPlaceholderText('name@example.com')).toHaveValue('ray@example.com');
  });

  test('a new member is created through the directory table', async () => {
    const fetchMock = mockApi();
    render(<DirectoryView />);
    await screen.findByText('Harris Family');

    fireEvent.click(screen.getByRole('button', { name: /Add Member/i }));
    fireEvent.change(await screen.findByPlaceholderText('First Last'), { target: { value: 'New Person' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/directory', expect.objectContaining({ method: 'POST' })
    ));
    expect(await screen.findByText('Person Family')).toBeInTheDocument();
  });

  test('an edit goes through the profile API, so the scraper leaves it alone', async () => {
    const fetchMock = mockApi({ save: { success: true, person: person({ id: 1, name: 'Raymond Harris' }) } });
    render(<DirectoryView />);
    await screen.findByText('Harris Family');

    fireEvent.click(screen.getAllByTitle('Edit')[0]);
    fireEvent.change(await screen.findByPlaceholderText('First Last'), { target: { value: 'Raymond Harris' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/profile/person/1', expect.objectContaining({ method: 'PATCH' })
    ));
    expect(await screen.findByText('Raymond Harris')).toBeInTheDocument();
  });

  test('a refused save is shown in the form, which stays open', async () => {
    await openLoaded({ save: { success: false, error: 'That email is already in use' } });

    fireEvent.click(screen.getByRole('button', { name: /Add Member/i }));
    fireEvent.change(await screen.findByPlaceholderText('First Last'), { target: { value: 'Someone' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('That email is already in use')).toBeInTheDocument();
    expect(screen.getByText('Add Member', { selector: 'h3' })).toBeInTheDocument();
  });

  test('the form can be dismissed without saving', async () => {
    await openLoaded();
    fireEvent.click(screen.getByRole('button', { name: /Add Member/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByText('Add Member', { selector: 'h3' })).not.toBeInTheDocument());
  });

  test('removing somebody asks first, then takes them off the page', async () => {
    const fetchMock = mockApi();
    render(<DirectoryView />);
    await screen.findByText('Harris Family');

    fireEvent.click(screen.getAllByTitle('Remove')[0]);
    expect(globalThis.confirm).toHaveBeenCalled();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/directory/1', expect.objectContaining({ method: 'DELETE' })
    ));
    await waitFor(() => expect(screen.queryByText('Ray Harris')).not.toBeInTheDocument());
  });

  test('saying no to the prompt removes nobody', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    const fetchMock = mockApi();
    render(<DirectoryView />);
    await screen.findByText('Harris Family');

    fireEvent.click(screen.getAllByTitle('Remove')[0]);
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/directory/1'), expect.anything());
    expect(screen.getByText('Ray Harris')).toBeInTheDocument();
  });

  test('a refused removal is reported and the person stays', async () => {
    await openLoaded({ remove: { success: false, error: 'Admin access required' } });
    fireEvent.click(screen.getAllByTitle('Remove')[0]);

    expect(await screen.findByText('Admin access required')).toBeInTheDocument();
    expect(screen.getByText('Ray Harris')).toBeInTheDocument();
  });
});

// ─── Syncing ──────────────────────────────────────────────────────────────────

describe('DirectoryView — syncing from the church site', () => {
  test('runs the scrape, reloads, and clears whatever was filtered', async () => {
    const fetchMock = mockApi();
    render(<DirectoryView />);
    await screen.findByText('Harris Family');

    fireEvent.change(screen.getByPlaceholderText(/Search name, address/i), { target: { value: 'Nelson' } });
    fireEvent.click(screen.getByRole('button', { name: /Sync from Site/i }));

    expect(await screen.findByText('Sync complete')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/members/update', expect.objectContaining({ method: 'POST' }));
    expect(screen.getByPlaceholderText(/Search name, address/i)).toHaveValue('');
    expect(screen.getByText('Harris Family')).toBeInTheDocument();
  });

  test('reports a sync that failed', async () => {
    mockApi({ sync: { success: false, error: 'Session expired' } });
    render(<DirectoryView />);
    await screen.findByText('Harris Family');

    fireEvent.click(screen.getByRole('button', { name: /Sync from Site/i }));
    expect(await screen.findByText('Sync failed: Session expired')).toBeInTheDocument();
  });

  test('the button is disabled while a sync is running', async () => {
    let finish;
    const fetchMock = vi.fn((url, opts = {}) => {
      if (url.includes('/api/members/update')) return new Promise(r => { finish = () => r({ json: () => Promise.resolve({ success: true }) }); });
      return Promise.resolve({ json: () => Promise.resolve({ success: true, rows: HOUSEHOLD }) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<DirectoryView />);
    await screen.findByText('Harris Family');
    fireEvent.click(screen.getByRole('button', { name: /Sync from Site/i }));

    const button = await screen.findByRole('button', { name: /Syncing/i });
    expect(button).toBeDisabled();

    finish();
    await screen.findByText('Sync complete');
  });
});
