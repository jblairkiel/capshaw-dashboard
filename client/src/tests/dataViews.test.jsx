import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { describe, test, expect, vi, afterEach } from 'vitest';

// Typing into a controlled input, the way the rest of these tests do it.
const type   = (input, value) => fireEvent.change(input, { target: { value } });
const choose = (select, value) => fireEvent.change(select, { target: { value } });

import LivestreamsView from '../components/LivestreamsView';
import VisitorTracker  from '../components/VisitorTracker';
import ServingSchedule from '../components/ServingSchedule';
import PersonPhoto     from '../components/PersonPhoto';

// The scraped data views: each one takes what the scraper found and lets a
// member search it. They share a "nothing loaded yet" state, which is what a
// signed-in member sees before the first update.

// ─── LivestreamsView ──────────────────────────────────────────────────────────

describe('LivestreamsView', () => {
  const CHANNEL = { handle: '@CapshawChurch', url: 'https://www.youtube.com/@CapshawChurch', id: 'UC123' };

  const VIDEOS = [
    { id: 'abc', title: 'Sunday Morning Worship', published: '2025-04-13T15:00:00+00:00',
      url: 'https://www.youtube.com/watch?v=abc', thumbnail: 'https://i.ytimg.com/vi/abc/hq.jpg', views: 84 },
    { id: 'def', title: 'Wednesday Bible Study', published: '2025-04-09T23:30:00+00:00',
      url: 'https://www.youtube.com/watch?v=def', thumbnail: '', views: 1 },
  ];

  function mockApi(body) {
    const fetchMock = vi.fn(() => Promise.resolve({ json: () => Promise.resolve(body) }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  afterEach(() => { vi.unstubAllGlobals(); });

  test('lists the recent streams, each linking to its video', async () => {
    mockApi({ success: true, channel: CHANNEL, videos: VIDEOS });
    render(<LivestreamsView />);

    const link = await screen.findByRole('link', { name: /Sunday Morning Worship/ });
    expect(link).toHaveAttribute('href', 'https://www.youtube.com/watch?v=abc');
    expect(screen.getByText('Wednesday Bible Study')).toBeInTheDocument();
  });

  test('says "1 view" rather than "1 views"', async () => {
    mockApi({ success: true, channel: CHANNEL, videos: VIDEOS });
    render(<LivestreamsView />);
    expect(await screen.findByText(/1 view$/)).toBeInTheDocument();
    expect(screen.getByText(/84 views$/)).toBeInTheDocument();
  });

  test('always offers the channel itself', async () => {
    mockApi({ success: true, channel: CHANNEL, videos: VIDEOS });
    render(<LivestreamsView />);
    const channelLink = await screen.findByRole('link', { name: /Watch on YouTube/ });
    expect(channelLink).toHaveAttribute('href', 'https://www.youtube.com/@CapshawChurch');
  });

  test('an unreachable YouTube leaves the channel link, not an error page', async () => {
    mockApi({ success: true, channel: CHANNEL, videos: [], warning: 'timed out' });
    render(<LivestreamsView />);

    expect(await screen.findByText(/could not reach YouTube/i)).toBeInTheDocument();
    expect(screen.getByText('youtube.com/@CapshawChurch')).toBeInTheDocument();
  });

  test('an empty channel is not an error', async () => {
    mockApi({ success: true, channel: CHANNEL, videos: [] });
    render(<LivestreamsView />);
    expect(await screen.findByText(/always on the channel/i)).toBeInTheDocument();
  });

  test('a failed request is reported rather than swallowed', async () => {
    mockApi({ success: false, error: 'Authentication required' });
    render(<LivestreamsView />);
    expect(await screen.findByText('Authentication required')).toBeInTheDocument();
  });

  test('refreshing asks YouTube again rather than the cache', async () => {
    const fetchMock = mockApi({ success: true, channel: CHANNEL, videos: VIDEOS });
    render(<LivestreamsView />);

    await screen.findByText('Sunday Morning Worship');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toContain('refresh=1');
  });
});

// ─── VisitorTracker ───────────────────────────────────────────────────────────
//
// The guest page used to render only what the church website knew — a name off
// a heading and a list of dates — so it read as comments and visit history with
// nobody's details on it. It now reads our own records, which carry the details.

describe('VisitorTracker', () => {
  const GUESTS = [
    {
      id: 1, name: 'Pat Lane', phone: '256-555-0143', email: 'pat@example.com',
      city: 'Harvest', state: 'AL', invited_by: 'The Carters', status: 'Visited twice',
      notes: 'Asked about the Wednesday class',
      visits: [{ id: 1, date: '04/13/25', service: 'AM' }, { id: 2, date: '03/30/25', service: 'PM' }],
      followUp: { active: null, lastDone: null },
    },
    {
      id: 2, name: 'Sam Ford', phone: '', email: '', city: '', state: '',
      invited_by: '', status: '', notes: '',
      visits: [{ id: 3, date: '04/06/25', service: 'AM' }],
      followUp: { active: null, lastDone: null },
    },
  ];

  function mockGuests(visitors = GUESTS, canManage = false) {
    const fetchMock = vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ success: true, visitors, canManage }) }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  afterEach(() => { vi.unstubAllGlobals(); });

  test('shows each guest by name, with their details beside them', async () => {
    mockGuests();
    render(<VisitorTracker />);

    const row = (await screen.findByRole('button', { name: 'Pat Lane' })).closest('tr');
    expect(within(row).getByText(/256-555-0143/)).toBeInTheDocument();
    expect(within(row).getByText('Harvest, AL')).toBeInTheDocument();
    expect(within(row).getByText('The Carters')).toBeInTheDocument();
    expect(within(row).getByText('03/30/25')).toBeInTheDocument();   // first visit
    expect(within(row).getByText('04/13/25')).toBeInTheDocument();   // last visit
    expect(screen.getByText('2 guests')).toBeInTheDocument();
  });

  test('counts the guests, their visits and who came back', async () => {
    mockGuests();
    render(<VisitorTracker />);
    await screen.findByRole('button', { name: 'Pat Lane' });

    expect(screen.getByText('Visits recorded').previousSibling).toHaveTextContent('3');
    expect(screen.getByText('Came back').previousSibling).toHaveTextContent('1');
    expect(screen.getByText('Most recent visit').previousSibling).toHaveTextContent('04/13/25');
  });

  test('says "1 guest" rather than "1 guests"', async () => {
    mockGuests();
    render(<VisitorTracker />);
    await screen.findByRole('button', { name: 'Pat Lane' });

    type(screen.getByPlaceholderText(/Search guests/i), 'Pat');
    expect(screen.getByText('1 guest')).toBeInTheDocument();
  });

  test('a guest with no recorded visits shows a dash rather than "undefined"', async () => {
    mockGuests([{ id: 9, name: 'Jo Reed', visits: [] }]);
    render(<VisitorTracker />);

    const row = (await screen.findByRole('button', { name: 'Jo Reed' })).closest('tr');
    expect(within(row).getAllByText('—').length).toBeGreaterThan(0);
  });

  test('the tracker\'s own comments are shown, and kept apart from ours', async () => {
    mockGuests([{
      ...GUESTS[0],
      comments: 'Came with the Carters',
      notes:    'Rang them on Tuesday',
    }]);
    render(<VisitorTracker />);
    fireEvent.click(await screen.findByRole('button', { name: 'Pat Lane' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Comments from the tracker')).toBeInTheDocument();
    expect(within(dialog).getByText('Came with the Carters')).toBeInTheDocument();
    expect(within(dialog).getByText('Our notes')).toBeInTheDocument();
    expect(within(dialog).getByText('Rang them on Tuesday')).toBeInTheDocument();
  });

  test('editing never sends the tracker\'s comments back, since the next refresh owns them', async () => {
    const fetchMock = mockGuests([{ ...GUESTS[0], comments: 'From the site' }], true);
    render(<VisitorTracker />);
    fireEvent.click(await screen.findByRole('button', { name: 'Pat Lane' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /edit details/i }));

    const form = screen.getByRole('dialog');
    type(within(form).getByLabelText(/^Our notes/), 'Ours to keep');
    fireEvent.click(within(form).getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, o]) => String(url).includes('/api/visitors/1') && o?.method === 'PATCH');
      const body = JSON.parse(call[1].body);
      expect(body.notes).toBe('Ours to keep');
      expect(body).not.toHaveProperty('comments');
    });
  });

  test('the most recently with us come first, and a guest with no visits last', async () => {
    mockGuests([
      { id: 1, name: 'Older Visit',  visits: [{ id: 1, date: '03/30/25', service: 'AM' }], followUp: {} },
      { id: 2, name: 'Never Came',   visits: [], followUp: {} },
      { id: 3, name: 'Latest Visit', visits: [{ id: 2, date: '04/13/25', service: 'AM' }], followUp: {} },
    ]);
    render(<VisitorTracker />);
    await screen.findByRole('button', { name: 'Latest Visit' });

    const names = screen.getAllByRole('row').slice(1).map(r => r.querySelector('button').textContent);
    expect(names).toEqual(['Latest Visit', 'Older Visit', 'Never Came']);
  });

  test('December sorts after February of the following year, not before it', async () => {
    // Sorting the dates as text would put 12/21/25 above 02/08/26.
    mockGuests([
      { id: 1, name: 'December',  visits: [{ id: 1, date: '12/21/25', service: 'AM' }], followUp: {} },
      { id: 2, name: 'February',  visits: [{ id: 2, date: '02/08/26', service: 'AM' }], followUp: {} },
    ]);
    render(<VisitorTracker />);
    await screen.findByRole('button', { name: 'February' });

    const names = screen.getAllByRole('row').slice(1).map(r => r.querySelector('button').textContent);
    expect(names).toEqual(['February', 'December']);
  });

  test('the details and visit history are spelled out when the guest is clicked', async () => {
    mockGuests();
    render(<VisitorTracker />);
    fireEvent.click(await screen.findByRole('button', { name: 'Pat Lane' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('2 visits on record')).toBeInTheDocument();
    expect(within(dialog).getByText('pat@example.com')).toBeInTheDocument();
    expect(within(dialog).getByText('The Carters')).toBeInTheDocument();
    expect(within(dialog).getByText('Asked about the Wednesday class')).toBeInTheDocument();
    expect(within(dialog).getByText('03/30/25')).toBeInTheDocument();
    expect(within(dialog).getByText('PM')).toBeInTheDocument();
  });

  test('a guest we know little about says so rather than showing empty fields', async () => {
    mockGuests();
    render(<VisitorTracker />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sam Ford' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('1 visit on record')).toBeInTheDocument();
    expect(within(dialog).getByText(/Nothing beyond their name yet/i)).toBeInTheDocument();
    expect(within(dialog).queryByText('03/30/25')).not.toBeInTheDocument();
  });

  test('the details close again', async () => {
    mockGuests();
    render(<VisitorTracker />);
    fireEvent.click(await screen.findByRole('button', { name: 'Pat Lane' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('searching matches a detail as well as a name', async () => {
    mockGuests();
    render(<VisitorTracker />);
    await screen.findByRole('button', { name: 'Pat Lane' });

    type(screen.getByPlaceholderText(/Search guests/i), 'carters');
    expect(screen.getByText('Pat Lane')).toBeInTheDocument();
    expect(screen.queryByText('Sam Ford')).not.toBeInTheDocument();
  });

  test('a search that matches nobody says so', async () => {
    mockGuests();
    render(<VisitorTracker />);
    await screen.findByRole('button', { name: 'Pat Lane' });

    type(screen.getByPlaceholderText(/Search guests/i), 'nobody');
    expect(screen.getByText(/No guests match your search/i)).toBeInTheDocument();
  });

  // ── Follow-ups, from the guest they are about ──────────────────────────────

  test('shows where a guest\'s follow-up has got to', async () => {
    mockGuests([
      { ...GUESTS[0], followUp: { active: { id: 4, step: 'reach-out' }, lastDone: null } },
      {
        ...GUESTS[1],
        last_contacted_at: '2026-06-07 10:00:00',
        last_contact_method: 'phone',
        last_contacted_by: 'Ray Harris',
        followUp: { active: null, lastDone: { id: 3, outcome: 'contacted' } },
      },
    ]);
    render(<VisitorTracker user={{ id: 1, role: 'approved' }} />);

    await screen.findByRole('button', { name: 'Pat Lane' });
    expect(screen.getByText('Follow-up in progress')).toBeInTheDocument();
    expect(screen.getByText('Phoned by Ray Harris')).toBeInTheDocument();
  });

  test('a guest with one in flight is not offered another', async () => {
    mockGuests([{ ...GUESTS[0], followUp: { active: { id: 4, step: 'reach-out' }, lastDone: null } }]);
    render(<VisitorTracker user={{ id: 1, role: 'approved' }} />);

    await screen.findByRole('button', { name: 'Pat Lane' });
    expect(screen.queryByRole('button', { name: /^follow up$/i })).not.toBeInTheDocument();
    expect(screen.getByText('In progress')).toBeInTheDocument();
  });

  test('a guest nobody has reached gets a Follow up button of their own', async () => {
    mockGuests([{ ...GUESTS[0], followUp: { active: null, lastDone: null } }]);
    render(<VisitorTracker user={{ id: 1, role: 'approved' }} />);

    await screen.findByRole('button', { name: 'Pat Lane' });
    expect(screen.getByRole('button', { name: /^follow up$/i })).toBeInTheDocument();
  });

  test('the details offer the two ways of reaching them', async () => {
    mockGuests([{ ...GUESTS[0], followUp: { active: null, lastDone: null } }]);
    render(<VisitorTracker user={{ id: 1, role: 'approved' }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Pat Lane' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('link', { name: /call 256-555-0143/i }))
      .toHaveAttribute('href', 'tel:2565550143');
    expect(within(dialog).getByRole('link', { name: /email pat@example.com/i }))
      .toHaveAttribute('href', 'mailto:pat@example.com');
  });

  test('signed-out visitors are offered no follow-up at all', async () => {
    mockGuests([{ ...GUESTS[0], followUp: { active: null, lastDone: null } }]);
    render(<VisitorTracker user={null} />);

    await screen.findByRole('button', { name: 'Pat Lane' });
    expect(screen.queryByRole('button', { name: /follow up/i })).not.toBeInTheDocument();
  });

  test('only the guest area is offered the Add and Edit buttons', async () => {
    mockGuests(GUESTS, false);
    const { unmount } = render(<VisitorTracker />);
    await screen.findByRole('button', { name: 'Pat Lane' });
    expect(screen.queryByRole('button', { name: /add a guest/i })).not.toBeInTheDocument();
    unmount();

    mockGuests(GUESTS, true);
    render(<VisitorTracker />);
    expect(await screen.findByRole('button', { name: /add a guest/i })).toBeInTheDocument();
  });

  test('adding a guest posts their details, and the first visit with them', async () => {
    const fetchMock = mockGuests(GUESTS, true);
    render(<VisitorTracker />);
    fireEvent.click(await screen.findByRole('button', { name: /add a guest/i }));

    const dialog = screen.getByRole('dialog');
    type(within(dialog).getByLabelText(/^Name/), 'Dana Webb');
    type(within(dialog).getByLabelText(/^Phone/), '256-555-0170');
    type(within(dialog).getByLabelText(/^Our notes/), 'Neighbour of the Carters');
    type(within(dialog).getByLabelText(/^First visit/), '05/04/25');
    fireEvent.click(within(dialog).getByRole('button', { name: /add guest/i }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, opts]) => url === '/api/visitors' && opts?.method === 'POST');
      expect(call).toBeTruthy();
      const body = JSON.parse(call[1].body);
      expect(body).toMatchObject({ name: 'Dana Webb', phone: '256-555-0170', notes: 'Neighbour of the Carters' });
      expect(body.visit).toEqual({ date: '05/04/25', service: '' });
    });
  });
});

// ─── ServingSchedule ──────────────────────────────────────────────────────────

describe('ServingSchedule', () => {
  const ASSIGNMENTS = [
    { id: 1, month: 'April 2025', date: 'April 6',  service: 'Sunday Worship', job: 'Song Leader',        name: 'Tom Nelson' },
    { id: 2, month: 'April 2025', date: 'April 6',  service: 'Sunday Worship', job: 'Opening Prayer',     name: '' },
    { id: 3, month: 'April 2025', date: 'April 13', service: 'Sunday Worship', job: 'Song Leader',        name: 'Lee Park' },
    { id: 4, month: 'April 2025', date: 'April 6',  service: 'Sunday Worship', job: 'Visuals',            name: 'Jo Reed' },
    { id: 5, month: 'April 2025', date: '',         service: '',               job: 'Visual Preparation', name: 'Sam Ford' },
  ];

  function mockSchedule(overrides = {}) {
    const body = {
      success: true,
      months: [{ month: 'April 2025', slots: 5 }],
      month: 'April 2025',
      assignments: ASSIGNMENTS,
      jobs: ['Song Leader', 'Opening Prayer', 'Visuals', 'Visual Preparation'],
      services: ['Sunday Worship', 'Sunday Evening', 'Wednesday'],
      serviceJobs: {},
      canManage: false,
      blackouts: [],
      me: { directoryId: null, name: '', gender: '', jobs: [], canSignUp: false, blackouts: [] },
      ...overrides,
    };
    const fetchMock = vi.fn(() => Promise.resolve({ json: () => Promise.resolve(body) }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  afterEach(() => { vi.unstubAllGlobals(); });

  test('shows the month the roster covers', async () => {
    mockSchedule();
    render(<ServingSchedule />);
    expect(await screen.findByText('April 2025')).toBeInTheDocument();
  });

  test('offers every week of the roster, and opens on the first', async () => {
    mockSchedule();
    render(<ServingSchedule />);
    const weeks = await screen.findByRole('combobox', { name: 'Week' });

    expect(within(weeks).getAllByRole('option').map(o => o.textContent)).toEqual(['April 6', 'April 13']);
    expect(weeks).toHaveValue('April 6');
  });

  test('shows one week at a time, in a single table', async () => {
    mockSchedule();
    render(<ServingSchedule />);
    await screen.findByRole('combobox', { name: 'Week' });

    expect(screen.getAllByRole('table')).toHaveLength(1);
    expect(screen.getByText('Opening Prayer')).toBeInTheDocument();
    expect(screen.queryByText('Lee Park')).not.toBeInTheDocument();
  });

  test('choosing another week swaps the table over', async () => {
    mockSchedule();
    render(<ServingSchedule />);
    choose(await screen.findByRole('combobox', { name: 'Week' }), 'April 13');

    expect(screen.getByText('Lee Park')).toBeInTheDocument();
    expect(screen.queryByText('Opening Prayer')).not.toBeInTheDocument();
  });

  test('an empty slot says nobody has it yet', async () => {
    mockSchedule();
    render(<ServingSchedule />);
    expect(await screen.findByText('Nobody yet')).toBeInTheDocument();
  });

  test('the monthly visual preparation is called out above the table, not as a week', async () => {
    mockSchedule();
    render(<ServingSchedule />);
    expect(await screen.findByText(/Visual Preparation: Sam Ford/)).toBeInTheDocument();
    expect(within(screen.getByRole('combobox', { name: 'Week' })).getAllByRole('option')).toHaveLength(2);
  });

  test('a roster with nothing in it renders empty rather than breaking', async () => {
    mockSchedule({ months: [], month: '', assignments: [] });
    render(<ServingSchedule />);
    expect(await screen.findByText(/Nobody is rostered yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Week' })).not.toBeInTheDocument();
  });

  test('a member who may not sign up is told how to change that', async () => {
    mockSchedule();
    render(<ServingSchedule />);
    expect(await screen.findByText(/men of the congregation can sign up/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sign me up/i })).not.toBeInTheDocument();
  });

  test('a man signed off for the job is offered the empty slot, and only that one', async () => {
    mockSchedule({ me: { directoryId: 3, name: 'Ray Harris', gender: 'male', jobs: ['Opening Prayer'], canSignUp: true } });
    render(<ServingSchedule />);

    expect(await screen.findByRole('button', { name: /sign me up/i })).toBeInTheDocument();
    // Only the empty Opening Prayer slot — the filled Song Leader one is not offered.
    expect(screen.getAllByRole('button', { name: /sign me up/i })).toHaveLength(1);
  });

  test('signing up asks the server, then reloads the month', async () => {
    const fetchMock = mockSchedule({ me: { directoryId: 3, name: 'Ray Harris', gender: 'male', jobs: ['Opening Prayer'], canSignUp: true } });
    render(<ServingSchedule />);
    fireEvent.click(await screen.findByRole('button', { name: /sign me up/i }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/assignments/2/signup'));
      expect(call[1].method).toBe('POST');
    });
  });

  test('you can take your own name back off', async () => {
    const fetchMock = mockSchedule({ me: { directoryId: 3, name: 'Tom Nelson', gender: 'male', jobs: ['Song Leader'], canSignUp: true } });
    render(<ServingSchedule />);
    fireEvent.click(await screen.findByRole('button', { name: /take me off/i }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/assignments/1/signup'));
      expect(call[1].method).toBe('DELETE');
    });
  });

  test('only the schedule keeper gets the build and edit buttons', async () => {
    mockSchedule();
    const { unmount } = render(<ServingSchedule />);
    await screen.findByRole('combobox', { name: 'Week' });
    expect(screen.queryByRole('button', { name: /build next month/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit song leader/i })).not.toBeInTheDocument();
    unmount();

    mockSchedule({ canManage: true });
    render(<ServingSchedule />);
    expect(await screen.findByRole('button', { name: /build next month/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /edit song leader/i })).toBeInTheDocument();
  });

  // ─── Time away ──────────────────────────────────────────────────────────────

  test('somebody not in the directory yet is not offered time away', async () => {
    mockSchedule();
    render(<ServingSchedule />);
    await screen.findByRole('combobox', { name: 'Week' });
    expect(screen.queryByText('Time away')).not.toBeInTheDocument();
  });

  test('a member sees the days they have blocked out', async () => {
    mockSchedule({
      me: {
        directoryId: 3, name: 'Ray Harris', gender: 'male', jobs: [], canSignUp: true,
        blackouts: [{ id: 7, startsOn: '2025-06-07', endsOn: '2025-06-21', reason: 'Away with family' }],
      },
    });
    render(<ServingSchedule />);

    expect(await screen.findByText(/June 7 – June 21, 2025/)).toBeInTheDocument();
    expect(screen.getByText(/Away with family/)).toBeInTheDocument();
  });

  test('blocking out days posts the range, and one day needs only a first day', async () => {
    const fetchMock = mockSchedule({
      me: { directoryId: 3, name: 'Ray Harris', gender: 'male', jobs: [], canSignUp: true, blackouts: [] },
    });
    render(<ServingSchedule />);

    type(await screen.findByLabelText('First day away'), '2025-06-07');
    fireEvent.click(screen.getByRole('button', { name: /block out these days/i }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, opts]) => String(url).endsWith('/blackouts') && opts?.method === 'POST');
      expect(JSON.parse(call[1].body)).toMatchObject({ startsOn: '2025-06-07', endsOn: '2025-06-07' });
    });
  });

  test('clearing a range asks the server to drop it', async () => {
    const fetchMock = mockSchedule({
      me: {
        directoryId: 3, name: 'Ray Harris', gender: 'male', jobs: [], canSignUp: true,
        blackouts: [{ id: 7, startsOn: '2025-06-07', endsOn: '2025-06-07', reason: '' }],
      },
    });
    render(<ServingSchedule />);
    fireEvent.click(await screen.findByRole('button', { name: /clear time away/i }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, opts]) => String(url).includes('/blackouts/7') && opts?.method === 'DELETE');
      expect(call).toBeTruthy();
    });
  });

  test('a man down for a day he is away is flagged on the roster', async () => {
    mockSchedule({
      assignments: ASSIGNMENTS.map(a => (a.id === 1
        ? { ...a, away: { startsOn: '2025-04-05', endsOn: '2025-04-07', reason: 'Away with family' } }
        : a)),
    });
    render(<ServingSchedule />);
    expect(await screen.findByText('away')).toBeInTheDocument();
  });

  test('the schedule keeper sees who is away across the congregation', async () => {
    mockSchedule({
      canManage: true,
      blackouts: [{ id: 7, directoryId: 3, name: 'Ray Harris', startsOn: '2025-04-06', endsOn: '2025-04-06', reason: '' }],
    });
    render(<ServingSchedule />);

    expect(await screen.findByText('Who is away')).toBeInTheDocument();
    expect(screen.getByText('April 6, 2025')).toBeInTheDocument();
  });

  test('a schedule keeper with nobody away yet sees an empty state, not an empty list', async () => {
    mockSchedule({ canManage: true, blackouts: [] });
    render(<ServingSchedule />);

    expect(await screen.findByText('Who is away')).toBeInTheDocument();
    expect(screen.getByText(/nobody has blocked out any days/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Calendar' })).not.toBeInTheDocument();
  });

  test('switching to the calendar plots each person on the day they are away', async () => {
    mockSchedule({
      canManage: true,
      blackouts: [
        { id: 7, directoryId: 3, name: 'Ray Harris', startsOn: '2025-04-06', endsOn: '2025-04-06', reason: '' },
        { id: 8, directoryId: 4, name: 'Bill Shaw', startsOn: '2025-04-05', endsOn: '2025-04-08', reason: 'Away with family' },
      ],
    });
    render(<ServingSchedule />);
    await screen.findByText('Who is away');

    fireEvent.click(screen.getByRole('button', { name: 'Calendar' }));

    // Opens on the month the roster is already showing, and shows a range on
    // every day it covers, not only the day it starts.
    const heading = await screen.findByRole('heading', { name: 'April 2025' });
    expect(heading).toBeInTheDocument();
    expect(screen.getByText('Ray Harris')).toBeInTheDocument();
    expect(screen.getAllByText('Bill Shaw')).toHaveLength(4);
  });

  test('the calendar can be paged to another month', async () => {
    mockSchedule({
      canManage: true,
      blackouts: [{ id: 7, directoryId: 3, name: 'Ray Harris', startsOn: '2025-04-06', endsOn: '2025-04-06', reason: '' }],
    });
    render(<ServingSchedule />);
    fireEvent.click(await screen.findByRole('button', { name: 'Calendar' }));
    await screen.findByRole('heading', { name: 'April 2025' });

    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));

    expect(await screen.findByRole('heading', { name: 'May 2025' })).toBeInTheDocument();
    expect(screen.queryByText('Ray Harris')).not.toBeInTheDocument();
  });

  test('switching back to the list keeps the same data', async () => {
    mockSchedule({
      canManage: true,
      blackouts: [{ id: 7, directoryId: 3, name: 'Ray Harris', startsOn: '2025-04-06', endsOn: '2025-04-06', reason: '' }],
    });
    render(<ServingSchedule />);
    fireEvent.click(await screen.findByRole('button', { name: 'Calendar' }));
    await screen.findByRole('heading', { name: 'April 2025' });

    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    expect(screen.getByText('April 6, 2025')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'April 2025' })).not.toBeInTheDocument();
  });

  test('building a month posts the month and the services chosen', async () => {
    const fetchMock = mockSchedule({ canManage: true });
    render(<ServingSchedule />);
    fireEvent.click(await screen.findByRole('button', { name: /build next month/i }));

    const dialog = screen.getByRole('dialog');
    type(within(dialog).getByLabelText(/^Month/), 'June 2026');
    fireEvent.click(within(dialog).getByLabelText('Wednesday'));    // leave the Sundays on
    fireEvent.click(within(dialog).getByRole('button', { name: /build the month/i }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, opts]) => String(url).endsWith('/months') && opts?.method === 'POST');
      const body = JSON.parse(call[1].body);
      expect(body.month).toBe('June 2026');
      expect(body.services).toEqual(['Sunday Worship', 'Sunday Evening']);
    });
  });
});

// ─── PersonPhoto ──────────────────────────────────────────────────────────────

describe('PersonPhoto', () => {
  test('shows the photo when the person has one', () => {
    render(<PersonPhoto person={{ id: 7, name: 'Ray Harris', has_photo: 1 }} />);
    const img = screen.getByRole('img', { name: 'Ray Harris' });
    expect(img).toHaveAttribute('src', '/api/profile/person/7/photo');
    expect(img).toHaveAttribute('loading', 'lazy');
  });

  test('falls back to initials when the person has no photo', () => {
    render(<PersonPhoto person={{ id: 7, name: 'Ray Harris', has_photo: 0 }} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('RH')).toBeInTheDocument();
  });

  test('falls back to initials when the photo will not load', () => {
    render(<PersonPhoto person={{ id: 7, name: 'Ray Harris', has_photo: 1 }} />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByText('RH')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  test('takes at most two initials, however many names there are', () => {
    render(<PersonPhoto person={{ id: 1, name: 'Mary Ann Harris Nelson' }} />);
    expect(screen.getByText('MA')).toBeInTheDocument();
  });

  test('a single name gives a single initial', () => {
    render(<PersonPhoto person={{ id: 1, name: 'Ray' }} />);
    expect(screen.getByText('R')).toBeInTheDocument();
  });

  test('somebody with no name at all still renders', () => {
    render(<PersonPhoto person={null} />);
    expect(screen.getByText('?')).toBeInTheDocument();
  });

  test('honours the requested size', () => {
    render(<PersonPhoto person={{ id: 1, name: 'Ray Harris', has_photo: 1 }} size={96} />);
    expect(screen.getByRole('img')).toHaveAttribute('width', '96');
  });
});

// ─── The follow-ups board ─────────────────────────────────────────────────────
//
// The same guests as the list, read by where their follow-up has got to: who
// still needs somebody, who is on it, and who actually made contact.

describe('VisitorTracker — the follow-ups tab', () => {
  const REACHED = {
    id: 1, name: 'Pat Lane', phone: '256-555-0143', email: 'pat@example.com',
    visits: [{ id: 1, date: '04/13/25', service: 'AM' }],
    last_contacted_at: '2026-09-13 14:02:11',
    last_contact_method: 'phone',
    last_contacted_by: 'Ray Harris',
    followUp: {
      active: null,
      lastDone: { id: 7, outcome: 'contacted', at: '2026-09-13 14:02:11', by: 'Ray Harris', method: 'phone' },
      history: [{
        id: 7, status: 'completed', outcome: 'contacted',
        startedAt: '2026-09-10 09:00:00', completedAt: '2026-09-13 14:02:11',
        startedBy: 'Blair Kiel', assignedTo: 'Ray Harris', contactedBy: 'Ray Harris', method: 'phone',
        rounds: [
          { action: 'no-answer', by: 'Ray Harris', at: '2026-09-11 18:00:00', note: '' },
          { action: 'phoned',    by: 'Ray Harris', at: '2026-09-13 14:02:11', note: 'Lovely chat' },
        ],
      }],
    },
  };

  const IN_PROGRESS = {
    id: 2, name: 'Sam Ford', visits: [{ id: 2, date: '04/06/25', service: 'AM' }],
    followUp: {
      active: { id: 8, step: 'reach-out', since: '2026-09-15 10:00:00', assignedTo: 'Tom Nelson' },
      lastDone: null,
      history: [{
        id: 8, status: 'active', outcome: '', startedAt: '2026-09-15 10:00:00', completedAt: '',
        startedBy: 'Blair Kiel', assignedTo: 'Tom Nelson', contactedBy: '', method: '', rounds: [],
      }],
    },
  };

  const NOBODY = {
    id: 3, name: 'Jo Reed', visits: [{ id: 3, date: '04/05/25', service: 'AM' }],
    followUp: { active: null, lastDone: null, history: [] },
  };

  function mockGuests(visitors, canManage = false) {
    const fetchMock = vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ success: true, visitors, canManage }) }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  afterEach(() => { vi.unstubAllGlobals(); });

  async function openBoard(visitors = [REACHED, IN_PROGRESS, NOBODY]) {
    mockGuests(visitors);
    render(<VisitorTracker />);
    await screen.findByRole('tab', { name: /Guests/ });
    fireEvent.click(screen.getByRole('tab', { name: /Follow-ups/ }));
  }

  test('the tab says how many guests nobody has reached out to', async () => {
    mockGuests([REACHED, IN_PROGRESS, NOBODY]);
    render(<VisitorTracker />);
    const tab = await screen.findByRole('tab', { name: /Follow-ups/ });
    expect(tab).toHaveTextContent('1');
  });

  test('each guest is grouped by where their follow-up has got to', async () => {
    await openBoard();
    const panel = screen.getByRole('tabpanel');

    expect(within(panel).getByRole('heading', { name: 'Reached' })).toBeInTheDocument();
    expect(within(panel).getByRole('heading', { name: 'Someone is on it' })).toBeInTheDocument();
    expect(within(panel).getByRole('heading', { name: 'Nobody has reached out' })).toBeInTheDocument();
  });

  test('who reached them, and who is still being waited on, are named', async () => {
    await openBoard();
    const panel = screen.getByRole('tabpanel');

    expect(within(panel).getByText(/Reached by/)).toHaveTextContent('Ray Harris');
    expect(within(panel).getByText(/Waiting on/)).toHaveTextContent('Tom Nelson');
    expect(within(panel).getByText('Nobody has been asked to reach out yet')).toBeInTheDocument();
  });

  test('the rounds of a follow-up are on the card, with who did each', async () => {
    await openBoard([REACHED]);
    fireEvent.click(screen.getByText(/1 follow-up on record/));

    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByText(/Ray Harris asked to reach out/)).toBeInTheDocument();
    expect(within(panel).getByText(/No answer/)).toBeInTheDocument();
    expect(within(panel).getByText(/Phoned them/)).toBeInTheDocument();
    expect(within(panel).getByText(/Lovely chat/)).toBeInTheDocument();
  });

  test('a card opens the same guest, with the same details and actions', async () => {
    await openBoard([REACHED]);
    fireEvent.click(within(screen.getByRole('tabpanel')).getByRole('button', { name: 'Pat Lane' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('1 visit on record')).toBeInTheDocument();
    expect(within(dialog).getByText('pat@example.com')).toBeInTheDocument();
    expect(within(dialog).getByText('Follow-ups on record')).toBeInTheDocument();
    expect(within(dialog).getByText(/Ray Harris asked to reach out/)).toBeInTheDocument();
  });

  test('a status is never colour alone — every badge says what it is', async () => {
    await openBoard();
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByText('Phoned by Ray Harris')).toBeInTheDocument();
    expect(within(panel).getByText('Tom Nelson is on it')).toBeInTheDocument();
  });

  test('the search box filters the board as well as the list', async () => {
    await openBoard();
    type(screen.getByPlaceholderText(/Search guests/i), 'Pat');

    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByRole('button', { name: 'Pat Lane' })).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Sam Ford' })).not.toBeInTheDocument();
  });
});
