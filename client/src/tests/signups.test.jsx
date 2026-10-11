import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, test, expect, vi, afterEach } from 'vitest';
import SignupsView from '../components/SignupsView';

const summary = (over = {}) => ({
  id: 1, title: 'Fellowship meal', kind: 'one-date', closed: false, createdBy: 'Joe Carter',
  first: '2026-10-25', last: '2026-10-25', dateCount: 1, past: false, mine: false, madeByMe: false,
  totals: { entries: 2, needed: 6, filled: 2, people: 2 }, ...over,
});

const detail = (over = {}) => ({
  id: 1, title: 'Fellowship meal', description: 'After morning worship.', kind: 'one-date',
  allowFree: true, freeLabel: 'Something else to share', closed: false, createdBy: 'Joe Carter',
  createdAt: '2026-10-01', canEdit: false, past: false,
  items: [{ id: 10, label: 'Main dish', needed: 3, position: 0 }, { id: 11, label: 'Dessert', needed: 2, position: 1 }],
  dates: [{
    id: 5, date: '2026-10-25', time: '12:00', note: '', past: false,
    items: [
      { itemId: 10, taken: 1, needed: 3, full: false, entries: [{ id: 100, name: 'Al Adams', note: '', mine: false, canRemove: false }] },
      { itemId: 11, taken: 2, needed: 2, full: true, entries: [
        { id: 101, name: 'Bea Boone', note: '', mine: false, canRemove: false },
        { id: 102, name: 'Cy Cole', note: '', mine: false, canRemove: false },
      ] },
    ],
    free: [],
  }],
  totals: { entries: 3, needed: 5, filled: 3, people: 3 },
  ...over,
});

// Answers by the first route whose key the URL contains and whose method matches.
function mockApi(routes) {
  const fetchMock = vi.fn((url, opts = {}) => {
    const method = opts.method || 'GET';
    const hit = routes.find(r => (r.exact ? url === r.url : String(url).includes(r.url)) && (r.method || 'GET') === method);
    const body = hit ? (typeof hit.body === 'function' ? hit.body(opts) : hit.body) : { success: false, error: `no route for ${method} ${url}` };
    return Promise.resolve({ json: () => Promise.resolve(body) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const index = (over = {}) => ({ url: '/api/signups', exact: true, body: { success: true, lists: [summary(), summary({ id: 2, title: 'Old work day', past: true })], canManage: false, ...over } });
const one = (list = detail(), extra = {}) => ({ url: '/api/signups/1', exact: true, body: { success: true, list, emailGroups: [], canManage: false, ...extra } });

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('sign-ups', () => {
  test('lists what is coming up apart from what is past, and opens one by its link', async () => {
    mockApi([index(), one()]);
    render(<SignupsView />);
    const coming = await screen.findByRole('region', { name: 'Coming up' });
    expect(within(coming).getByText('Fellowship meal')).toBeInTheDocument();
    expect(within(coming).getByText('2 of 6 filled')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Past and closed' })).getByText('Old work day')).toBeInTheDocument();
    // Only the Sign-Up Manager sees the analytics.
    expect(screen.queryByRole('button', { name: 'Analytics' })).not.toBeInTheDocument();

    fireEvent.click(within(coming).getByRole('button', { name: /Fellowship meal/ }));
    expect(await screen.findByRole('heading', { name: 'Fellowship meal' })).toBeInTheDocument();
    expect(window.location.search).toBe('?page=signups&list=1');
  });

  test('a permanent link opens the sign-up straight away', async () => {
    const fetchMock = mockApi([one()]);
    render(<SignupsView initialListId={1} />);
    expect(await screen.findByText('After morning worship.')).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/signups/1');
    expect(screen.getByText('1 of 3 · 2 still needed')).toBeInTheDocument();
    expect(screen.getByText('Filled · 2 of 2')).toBeInTheDocument();
    // A member who did not make it cannot change it.
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Email' })).not.toBeInTheDocument();
  });

  test('signs up for an item, and for a free sign-up with what they will bring', async () => {
    const signedUp = detail();
    signedUp.dates[0].items[0].entries.push({ id: 103, name: 'Joe Carter', note: '', mine: true, canRemove: true });
    signedUp.dates[0].items[0].taken = 2;
    const fetchMock = mockApi([one(), { url: '/api/signups/1/entries', method: 'POST', body: { success: true, list: signedUp } }]);
    render(<SignupsView initialListId={1} />);
    await screen.findByText('After morning worship.');
    // A filled item has no Sign up button.
    expect(screen.queryByRole('button', { name: /Sign up for Dessert/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Sign up for Main dish/ }));
    expect(await screen.findByText('Joe Carter (you)')).toBeInTheDocument();
    const call = fetchMock.mock.calls.find(([url, o]) => url === '/api/signups/1/entries' && o?.method === 'POST');
    expect(JSON.parse(call[1].body)).toMatchObject({ dateId: 5, itemId: 10 });
    // Once down for an item, there is no second button for it.
    expect(screen.queryByRole('button', { name: /Sign up for Main dish/ })).not.toBeInTheDocument();

    const free = screen.getByRole('button', { name: /Sign up for Something else to share/ });
    expect(free).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: /What you will bring/ }), { target: { value: 'Rolls' } });
    expect(free).not.toBeDisabled();
    fireEvent.click(free);
    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter(([url, o]) => url === '/api/signups/1/entries' && o?.method === 'POST');
      expect(JSON.parse(calls[1][1].body)).toMatchObject({ dateId: 5, itemId: null, note: 'Rolls' });
    });
  });

  test('a closed sign-up takes no more names', async () => {
    mockApi([one(detail({ closed: true }))]);
    render(<SignupsView initialListId={1} />);
    await screen.findByText('After morning worship.');
    expect(screen.getByText('Closed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sign up for/ })).not.toBeInTheDocument();
  });

  test('makes a new sign-up over several dates', async () => {
    const made = detail({ id: 7, title: 'Meal train', kind: 'multi-date', canEdit: true });
    const fetchMock = mockApi([
      index(),
      { url: '/api/signups', exact: true, method: 'POST', body: { success: true, list: made } },
      { url: '/api/signups/7', exact: true, body: { success: true, list: made, emailGroups: [], canManage: false } },
    ]);
    render(<SignupsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'New sign-up' }));
    const form = screen.getByRole('form', { name: 'New sign-up' });
    fireEvent.change(within(form).getByPlaceholderText('Fellowship meal'), { target: { value: 'Meal train' } });
    fireEvent.click(within(form).getByRole('radio', { name: /Several dates/ }));
    fireEvent.change(within(form).getByLabelText('Date 1'), { target: { value: '2026-11-02' } });
    fireEvent.click(within(form).getByRole('button', { name: '+ Add a date' }));
    fireEvent.change(within(form).getByLabelText('Date 2'), { target: { value: '2026-11-04' } });
    fireEvent.change(within(form).getByLabelText('Item 1'), { target: { value: 'Bring dinner' } });
    fireEvent.change(within(form).getByLabelText('How many for item 1'), { target: { value: '1' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Make the sign-up' }));

    expect(await screen.findByRole('heading', { name: 'Meal train' })).toBeInTheDocument();
    const call = fetchMock.mock.calls.find(([url, o]) => url === '/api/signups' && o?.method === 'POST');
    expect(JSON.parse(call[1].body)).toMatchObject({
      title: 'Meal train', kind: 'multi-date',
      dates: [{ date: '2026-11-02' }, { date: '2026-11-04' }],
      items: [{ label: 'Bring dinner', needed: '1' }],
    });
    expect(window.location.search).toBe('?page=signups&list=7');
  });

  test('whoever made it previews an email with their own words before sending it', async () => {
    const fetchMock = mockApi([
      one(detail({ canEdit: true }), { emailGroups: [{ key: 'members', name: 'All members' }] }),
      { url: '/api/signups/1/email/preview', method: 'POST', body: { success: true, subject: 'Sign up: Fellowship meal', body: 'Please come!\n────────────\nFellowship meal', audience: 'everyone signed up', count: 3, missing: ['Cy Cole'] } },
      { url: '/api/signups/1/email', exact: true, method: 'POST', body: { success: true, sent: 2, missing: ['Cy Cole'] } },
    ]);
    render(<SignupsView initialListId={1} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Email' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('option', { name: 'All members (email group)' })).toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Your message' }), { target: { value: 'Please come!' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Preview' }));
    expect(await within(dialog).findByText(/To everyone signed up — 3 people · no email address for Cy Cole/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Emailed 2 people. No email address for Cy Cole.')).toBeInTheDocument();
    const call = fetchMock.mock.calls.find(([url, o]) => url === '/api/signups/1/email' && o?.method === 'POST');
    expect(JSON.parse(call[1].body)).toEqual({ to: 'signed-up', subject: '', message: 'Please come!' });
  });

  test('the Sign-Up Manager sees the analytics', async () => {
    mockApi([
      index({ canManage: true }),
      { url: '/api/signups/analytics', body: {
        success: true,
        totals: { lists: 4, open: 2, entries: 31, people: 17, fillRate: 82 },
        topPeople: [{ name: 'Al Adams', count: 5, lists: 3 }],
        byMonth: [{ month: '2026-09', count: 12 }, { month: '2026-10', count: 19 }],
        short: [{ id: 1, title: 'Fellowship meal', first: '2026-10-25', needed: 6, missing: 4 }],
        byCreator: [{ name: 'Joe Carter', count: 2 }],
      } },
    ]);
    render(<SignupsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Analytics' }));
    expect(await screen.findByText('82%')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Who signs up most' })).getByText('5 times · 3 sign-ups')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Still short' })).getByText(/4 of 6 still needed/)).toBeInTheDocument();
  });
});
