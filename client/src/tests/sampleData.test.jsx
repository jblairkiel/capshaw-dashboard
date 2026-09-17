import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, test, expect, vi, afterEach } from 'vitest';
import SampleDataPanel from '../components/SampleDataPanel';

// Filling the site up to look at it, and taking the filling back out. The panel
// has to be plain about which of those it is doing, because one of them writes
// a few hundred rows into the congregation's records.

const CATALOGUE = [
  { id: 'directory', label: 'Member Directory', describe: 'Households with addresses.', page: 'Church Directory', tables: ['directory'] },
  { id: 'visitors',  label: 'Guests',           describe: 'Guests with visit histories.', page: 'Guests', tables: ['visitors'] },
];

const BATCH = {
  id: 'sample-2026-09-17-4f21',
  created_at: '2026-09-17 09:30:00',
  created_by: 'Ada',
  note: 'Checking the Guests page',
  generators: ['directory'],
  scale: 1,
  rows: 42,
  tables: [{ name: 'directory', rows: 30 }, { name: 'anniversaries', rows: 12 }],
};

const NOT_FILLED = { users: 'Accounts. Made-up sign-ins are not sample data, they are a way in.' };

function mockApi({ batches = [], onPost, onDelete } = {}) {
  const fetchMock = vi.fn((url, options = {}) => {
    const method = options.method || 'GET';
    if (method === 'POST')   return Promise.resolve({ json: () => Promise.resolve(onPost(url, options)) });
    if (method === 'DELETE') return Promise.resolve({ json: () => Promise.resolve(onDelete(url)) });
    return Promise.resolve({ json: () => Promise.resolve({
      success: true, generators: CATALOGUE, batches, notFilled: NOT_FILLED,
    }) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('the sample data panel', () => {
  test('lists what can be filled, and where in the site it shows up', async () => {
    mockApi();
    render(<SampleDataPanel />);

    expect(await screen.findByText('Member Directory')).toBeInTheDocument();
    expect(screen.getByText('Church Directory')).toBeInTheDocument();
    expect(screen.getByText('Guests with visit histories.')).toBeInTheDocument();
  });

  test('says plainly when there is none in the site', async () => {
    mockApi();
    render(<SampleDataPanel />);
    expect(await screen.findByText(/Everything on the site is the congregation/)).toBeInTheDocument();
  });

  test('filling nothing in particular fills all of it', async () => {
    const fetchMock = mockApi({
      onPost: () => ({ success: true, batch: BATCH.id, total: 42, made: {}, batches: [BATCH] }),
    });
    render(<SampleDataPanel />);

    fireEvent.click(await screen.findByRole('button', { name: /Fill 2 parts of the site/ }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, o]) => o?.method === 'POST');
      expect(JSON.parse(call[1].body).generators).toEqual([]);
    });
  });

  test('only the ticked parts are asked for', async () => {
    const fetchMock = mockApi({
      onPost: () => ({ success: true, batch: BATCH.id, total: 42, made: {}, batches: [BATCH] }),
    });
    render(<SampleDataPanel />);

    fireEvent.click(await screen.findByRole('checkbox', { name: /Guests/ }));
    fireEvent.click(screen.getByRole('button', { name: /Fill 1 part of the site/ }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, o]) => o?.method === 'POST');
      expect(JSON.parse(call[1].body).generators).toEqual(['visitors']);
    });
  });

  test('a batch shows what it made, table by table', async () => {
    mockApi({ batches: [BATCH] });
    render(<SampleDataPanel />);

    const batch = (await screen.findByText(BATCH.id)).closest('li');
    expect(within(batch).getByText('42 rows', { exact: false })).toBeInTheDocument();
    expect(within(batch).getByText(/Checking the Guests page/)).toBeInTheDocument();
    expect(within(batch).getByText(/asked for by Ada/)).toBeInTheDocument();

    // Every table it wrote to, with how many rows went into each. Read off the
    // chips directly: the name and the count are separate elements, so a text
    // matcher sees two strings rather than one.
    const counts = [...batch.querySelectorAll('span.rounded-full')]
      .map(chip => chip.textContent.replace(/\s+/g, ' ').trim());
    expect(counts).toEqual(['directory 30', 'anniversaries 12']);
  });

  test('removing a batch is asked about first, and says how much went', async () => {
    const fetchMock = mockApi({
      batches: [BATCH],
      onDelete: () => ({ success: true, rows: 42, deleted: 42, batches: [] }),
    });
    render(<SampleDataPanel />);

    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    // Nothing has been asked of the server yet.
    expect(fetchMock.mock.calls.some(([, o]) => o?.method === 'DELETE')).toBe(false);
    expect(screen.getByText('Remove all 42?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Yes, remove it/ }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, o]) => o?.method === 'DELETE');
      expect(String(call[0])).toContain(BATCH.id);
    });
    expect(await screen.findByText(/Removed 42 rows. Nothing else was touched./)).toBeInTheDocument();
  });

  test('changing your mind leaves the batch alone', async () => {
    const fetchMock = mockApi({ batches: [BATCH] });
    render(<SampleDataPanel />);

    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));

    expect(fetchMock.mock.calls.some(([, o]) => o?.method === 'DELETE')).toBe(false);
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  test('what is never filled is there to be read, with the reason', async () => {
    mockApi();
    render(<SampleDataPanel />);

    fireEvent.click(await screen.findByText(/What is never filled/));
    expect(screen.getByText('users')).toBeInTheDocument();
    expect(screen.getByText(/they are a way in/)).toBeInTheDocument();
  });

  test('a refusal from the server is shown rather than swallowed', async () => {
    mockApi({ onPost: () => ({ success: false, error: 'none of those parts of the site can be filled' }) });
    render(<SampleDataPanel />);

    fireEvent.click(await screen.findByRole('button', { name: /Fill 2 parts/ }));
    expect(await screen.findByText(/none of those parts of the site can be filled/)).toBeInTheDocument();
  });
});
