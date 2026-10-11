import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, test, expect, vi, afterEach } from 'vitest';
import CommunionPrepView from '../components/CommunionPrepView';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const months = (over = {}) => MONTH_NAMES.map((label, i) => ({
  month: i + 1, label, started: i + 1 <= 10, signup: null, ...(over[i + 1] || {}),
}));

function mockApi(page = {}, routes = {}) {
  const body = {
    success: true, today: '2026-10-11', year: 2026, years: [2026], startable: [], canManage: false, people: [],
    months: months({
      3: { signup: { id: 1, name: 'Al Adams', mine: false, hasEmail: true } },
      11: { signup: { id: 2, name: 'Joe Carter', mine: true, hasEmail: true } },
    }),
    ...page,
  };
  const fetchMock = vi.fn((url, opts = {}) => {
    const route = Object.keys(routes).find(k => String(url).includes(k) && (!routes[k].method || routes[k].method === (opts.method || 'GET')));
    const answer = route ? routes[route].body : body;
    return Promise.resolve({ json: () => Promise.resolve(answer) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('the communion preparation list', () => {
  test('shows the twelve months, who is down, which are open, and yours', async () => {
    mockApi();
    render(<CommunionPrepView />);
    const list = await screen.findByRole('list', { name: 'Communion preparation 2026' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(12);
    expect(within(screen.getByRole('listitem', { name: 'March 2026' })).getByText('Al Adams')).toBeInTheDocument();
    expect(within(screen.getByRole('listitem', { name: 'November 2026' })).getByText('(you)')).toBeInTheDocument();
    expect(within(screen.getByRole('listitem', { name: 'December 2026' })).getByText('Open')).toBeInTheDocument();
    expect(screen.getByText(/1 month still open/)).toBeInTheDocument();
    // A month that has begun cannot be signed up for.
    expect(within(screen.getByRole('listitem', { name: 'October 2026' })).queryByRole('button', { name: /Sign up/ })).toBeNull();
  });

  test('signing up for an open month posts it', async () => {
    const fetchMock = mockApi({}, { '/2026/12/signup': { method: 'POST', body: { success: true, months: months({ 12: { signup: { id: 3, name: 'Joe Carter', mine: true, hasEmail: true } } }) } } });
    render(<CommunionPrepView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign up for December' }));
    await waitFor(() => expect(within(screen.getByRole('listitem', { name: 'December 2026' })).getByText('Joe Carter')).toBeInTheDocument());
    expect(fetchMock.mock.calls.some(([url, o]) => url === '/api/communion-prep/2026/12/signup' && o?.method === 'POST')).toBe(true);
  });

  test('you can take your own name off, after saying so', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const fetchMock = mockApi({}, { '/2026/11/signup': { method: 'DELETE', body: { success: true, months: months() } } });
    render(<CommunionPrepView />);
    const nov = await screen.findByRole('listitem', { name: 'November 2026' });
    fireEvent.click(within(nov).getByRole('button', { name: 'Take my name off' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, o]) => url === '/api/communion-prep/2026/11/signup' && o?.method === 'DELETE')).toBe(true));
    expect(within(screen.getByRole('listitem', { name: 'March 2026' })).queryByRole('button', { name: 'Take my name off' })).toBeNull();
    confirm.mockRestore();
  });

  test('a member gets no keeper controls', async () => {
    mockApi({ startable: [] });
    render(<CommunionPrepView />);
    await screen.findByRole('list', { name: 'Communion preparation 2026' });
    expect(screen.queryByRole('button', { name: /Change who prepares|Put someone down/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Start the/ })).toBeNull();
  });

  test('the keeper puts a name against a month, from the directory or typed', async () => {
    const fetchMock = mockApi({ canManage: true, people: ['Joe Carter', 'Ned Poole'] }, {
      '/2026/12': { method: 'PUT', body: { success: true, months: months({ 12: { signup: { id: 4, name: 'Ned Poole', mine: false, hasEmail: false } } }) } },
    });
    render(<CommunionPrepView />);
    const dec = await screen.findByRole('listitem', { name: 'December 2026' });
    fireEvent.click(within(dec).getByRole('button', { name: 'Change who prepares December' }));
    fireEvent.change(within(dec).getByLabelText('Who prepares communion in December'), { target: { value: 'Ned Poole' } });
    fireEvent.click(within(dec).getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, o]) => url === '/api/communion-prep/2026/12' && o?.method === 'PUT');
      expect(JSON.parse(call[1].body)).toEqual({ name: 'Ned Poole' });
    });
    expect(await screen.findByText(/No email on file/)).toBeInTheDocument();
  });

  test('with no list for the year, the keeper is offered to start it', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const fetchMock = mockApi({ year: 2027, years: [2026], months: null, canManage: true, startable: [2027, 2028] }, {
      '/years': { method: 'POST', body: { success: true, year: 2027 } },
    });
    render(<CommunionPrepView />);
    expect(await screen.findByText(/There is no list for 2027 yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start the 2027 list' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, o]) => url === '/api/communion-prep/years' && o?.method === 'POST');
      expect(JSON.parse(call[1].body)).toEqual({ year: 2027 });
    });
    expect(screen.getByRole('button', { name: 'Start the 2028 list' })).toBeInTheDocument();
    confirm.mockRestore();
  });

  test('a member with no list yet is told it has not started', async () => {
    mockApi({ months: null });
    render(<CommunionPrepView />);
    expect(await screen.findByText(/The 2026 list has not been started yet/)).toBeInTheDocument();
  });

  test('a link to a year opens that year', async () => {
    const fetchMock = mockApi();
    render(<CommunionPrepView initialYear={2027} />);
    await screen.findByRole('list', { name: 'Communion preparation 2026' });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/communion-prep?year=2027');
  });
});
