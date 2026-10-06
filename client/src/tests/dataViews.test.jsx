import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { describe, test, expect, vi, afterEach } from 'vitest';

// Typing into a controlled input, the way the rest of these tests do it.
const type = (input, value) => fireEvent.change(input, { target: { value } });

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
    // The page's own Follow Up button, at the top, is all there is.
    expect(screen.getAllByRole('button', { name: /^follow up$/i })).toHaveLength(1);
    expect(screen.getByText('In progress')).toBeInTheDocument();
  });

  test('a guest nobody has reached gets a Follow up button of their own', async () => {
    mockGuests([{ ...GUESTS[0], followUp: { active: null, lastDone: null } }]);
    render(<VisitorTracker user={{ id: 1, role: 'approved' }} />);

    await screen.findByRole('button', { name: 'Pat Lane' });
    // The page's Follow Up button, and the guest's own.
    expect(screen.getAllByRole('button', { name: /^follow up$/i })).toHaveLength(2);
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
    // The picker speaks ISO; the visit is still saved as MM/DD/YY.
    type(within(dialog).getByLabelText(/^First visit/), '2025-05-04');
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

  function mockSchedule(overrides = {}, routes = {}) {
    const body = {
      success: true,
      months: [{ month: 'April 2025', slots: 5 }],
      month: 'April 2025',
      assignments: ASSIGNMENTS,
      jobs: ['Song Leader', 'Opening Prayer', 'Visuals', 'Visual Preparation'],
      services: ['Sunday Worship', 'Sunday Evening', 'Wednesday'],
      serviceJobs: [],
      canManage: false,
      blackouts: [],
      me: { directoryId: null, name: '', gender: '', blackouts: [] },
      ...overrides,
    };
    const fetchMock = vi.fn((url, options = {}) => {
      const route = Object.keys(routes).find(k => String(url).includes(k));
      const answer = route ? routes[route] : body;
      return Promise.resolve({ json: () => Promise.resolve(typeof answer === 'function' ? answer(url, options) : answer) });
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  const card = name => screen.findByRole('region', { name: new RegExp(`^${name}`) });

  afterEach(() => { vi.unstubAllGlobals(); });

  test('shows the month the roster covers', async () => {
    mockSchedule();
    render(<ServingSchedule />);
    expect(await screen.findByText('April 2025')).toBeInTheDocument();
  });

  test('shows the whole month, a card for each service in the order they happen', async () => {
    mockSchedule();
    render(<ServingSchedule />);
    const first = await card('Sunday Worship, Sunday, April 6');
    expect(within(first).getByText('Tom Nelson')).toBeInTheDocument();
    expect(within(first).getByText('Opening Prayer')).toBeInTheDocument();
    const second = screen.getByRole('region', { name: /^Sunday Worship, Sunday, April 13/ });
    expect(within(second).getByText('Lee Park')).toBeInTheDocument();
    expect(screen.getAllByRole('region').map(r => r.getAttribute('aria-label'))).toEqual([
      'Sunday Worship, Sunday, April 6', 'Sunday Worship, Sunday, April 13',
    ]);
    expect(screen.queryByRole('combobox', { name: 'Week' })).not.toBeInTheDocument();
  });

  test('open slots are counted for the month and on each card', async () => {
    mockSchedule();
    render(<ServingSchedule />);
    expect(await screen.findByText('1 slot still open')).toBeInTheDocument();
    expect(within(await card('Sunday Worship, Sunday, April 6')).getByText('1 open')).toBeInTheDocument();
  });

  test('each service has its own link, straight to it on the Scheduled tab', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    mockSchedule();
    render(<ServingSchedule />);
    const first = await card('Sunday Worship, Sunday, April 6');
    fireEvent.click(within(first).getByRole('button', { name: /copy the link/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const link = new URL(writeText.mock.calls[0][0]);
    expect(Object.fromEntries(link.searchParams)).toEqual({
      page: 'service-roster', tab: 'scheduled', date: '2025-04-06', service: 'Sunday Worship',
    });
  });

  test('a link to one service opens its month and marks the service', async () => {
    const fetchMock = mockSchedule();
    render(<ServingSchedule focus={{ date: '2025-04-13', service: 'Sunday Worship' }} />);
    const second = await card('Sunday Worship, Sunday, April 13');
    expect(second.className).toMatch(/ring-2/);
    expect((await card('Sunday Worship, Sunday, April 6')).className).not.toMatch(/ring-2/);
    expect(String(fetchMock.mock.calls[0][0])).toContain(encodeURIComponent('April 2025'));
  });

  test('an empty slot says nobody has it yet', async () => {
    mockSchedule();
    render(<ServingSchedule />);
    expect(await screen.findByText('Nobody yet')).toBeInTheDocument();
  });

  test('the monthly visual preparation is called out above the cards, not as a service', async () => {
    mockSchedule();
    render(<ServingSchedule />);
    expect(await screen.findByText(/Visual Preparation: Sam Ford/)).toBeInTheDocument();
    expect(screen.getAllByRole('region')).toHaveLength(2);
  });

  test('a roster with nothing in it renders empty rather than breaking', async () => {
    mockSchedule({ months: [], month: '', assignments: [] });
    render(<ServingSchedule />);
    expect(await screen.findByText(/Nobody is rostered yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  test('a member is told how a slot gets filled, and there is no sign-up button anywhere', async () => {
    mockSchedule();
    render(<ServingSchedule />);
    expect(await screen.findByText(/filled by whoever looks after the serving schedule/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sign me up/i })).not.toBeInTheDocument();
  });

  test('you ask to be replaced rather than taking your own name off', async () => {
    const fetchMock = mockSchedule({ me: { directoryId: 3, name: 'Tom Nelson', gender: 'male' } });
    render(<ServingSchedule />);
    expect(screen.queryByRole('button', { name: /take me off/i })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Ask to be replaced' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Why/), { target: { value: 'Out of town' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ask to be replaced' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/assignments/1/replacement'));
      expect(call[1].method).toBe('POST');
      expect(JSON.parse(call[1].body)).toEqual({ reason: 'Out of town' });
    });
    expect(await screen.findByText(/Whoever keeps the schedule has been told/)).toBeInTheDocument();
  });

  test('a slot already asked about says so, and is not asked about twice', async () => {
    mockSchedule({
      me: { directoryId: 3, name: 'Tom Nelson', gender: 'male' },
      assignments: ASSIGNMENTS.map(a => (a.id === 1 ? { ...a, replacement: { id: 4, askedBy: 'Tom', reason: 'Away' } } : a)),
    });
    render(<ServingSchedule />);
    expect(await screen.findByText('replacement asked for')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ask to be replaced' })).not.toBeInTheDocument();
  });

  test('only the schedule keeper gets the build button and can change a name', async () => {
    mockSchedule();
    const { unmount } = render(<ServingSchedule />);
    await card('Sunday Worship, Sunday, April 6');
    expect(screen.queryByRole('button', { name: 'Build a month' })).not.toBeInTheDocument();
    expect(screen.queryByText('Setup ▾')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /— change$/ })).not.toBeInTheDocument();
    unmount();

    mockSchedule({ canManage: true });
    render(<ServingSchedule />);
    expect(await screen.findByRole('button', { name: 'Build a month' })).toBeInTheDocument();
    expect(screen.getByText('Setup ▾')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Email everyone their jobs' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Song Leader: Tom Nelson — change' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Opening Prayer: open — change' })).toHaveTextContent('Open — choose someone');
  });

  // ─── Changing a name ────────────────────────────────────────────────────────

  const CANDIDATES = {
    success: true,
    candidates: [
      { id: 11, name: 'Ray Harris', level: 'preferred', away: null, busy: false, turns: 0, current: false, free: true },
      { id: 12, name: 'Bill Shaw', level: 'willing', away: null, busy: false, turns: 2, current: false, free: true },
      { id: 13, name: 'Ned Poole', level: 'preferred', away: { startsOn: '2025-04-05', endsOn: '2025-04-07', reason: '' }, busy: false, turns: 0, current: false, free: false },
      { id: 14, name: 'Al Adams', level: '', away: null, busy: false, turns: 0, current: false, free: true },
    ],
  };

  test('clicking a name lists the best fits first, and the rest on asking', async () => {
    const fetchMock = mockSchedule({ canManage: true }, { '/candidates': CANDIDATES });
    render(<ServingSchedule />);
    fireEvent.click(await screen.findByRole('button', { name: 'Opening Prayer: open — change' }));
    const list = await screen.findByRole('list', { name: 'Who could take it' });
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/assignments/2/candidates'))).toBe(true);
    expect(within(list).getAllByRole('button').map(b => b.textContent)).toEqual([
      expect.stringContaining('Ray Harris'), expect.stringContaining('Bill Shaw'),
    ]);
    expect(within(list).getByText('2 turns this month')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show everyone (4)' }));
    expect(within(list).getByText('Ned Poole')).toBeInTheDocument();
    expect(within(list).getByText(/^Away /)).toBeInTheDocument();
    expect(within(list).getByText('Al Adams')).toBeInTheDocument();
  });

  test('picking a man puts him in the slot', async () => {
    const fetchMock = mockSchedule({ canManage: true }, {
      '/candidates': CANDIDATES,
      '/assignments/2': { success: true, assignment: { ...ASSIGNMENTS[1], name: 'Bill Shaw' } },
    });
    render(<ServingSchedule />);
    fireEvent.click(await screen.findByRole('button', { name: 'Opening Prayer: open — change' }));
    const list = await screen.findByRole('list', { name: 'Who could take it' });
    fireEvent.click(within(list).getByText('Bill Shaw'));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, o]) => String(url).endsWith('/assignments/2') && o?.method === 'PATCH');
      expect(JSON.parse(call[1].body)).toEqual({ name: 'Bill Shaw' });
    });
  });

  test('a name not on the list can be typed in, and a slot can be left open', async () => {
    const fetchMock = mockSchedule({ canManage: true }, {
      '/candidates': CANDIDATES,
      '/assignments/': (url, o) => ({ success: true, assignment: { ...ASSIGNMENTS[0], name: JSON.parse(o.body).name } }),
    });
    render(<ServingSchedule />);
    fireEvent.click(await screen.findByRole('button', { name: 'Song Leader: Tom Nelson — change' }));
    await screen.findByRole('list', { name: 'Who could take it' });
    fireEvent.change(screen.getByLabelText('Or type a name'), { target: { value: 'Visiting Brother' } });
    fireEvent.click(screen.getByRole('button', { name: 'Put in' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, o]) => String(url).endsWith('/assignments/1') && o?.method === 'PATCH');
      expect(JSON.parse(call[1].body)).toEqual({ name: 'Visiting Brother' });
    });

    const first = await card('Sunday Worship, Sunday, April 6');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(within(first).getByRole('button', { name: /^Song Leader: .* — change$/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Leave it open' }));
    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter(([url, o]) => String(url).endsWith('/assignments/1') && o?.method === 'PATCH');
      expect(calls.map(([, o]) => JSON.parse(o.body))).toContainEqual({ name: '' });
    });
  });

  test('emailing everyone asks first, then says who was emailed', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const fetchMock = mockSchedule({ canManage: true }, {
      '/months/notify': { success: true, emailed: 3, unreachable: ['Lee Park'] },
    });
    render(<ServingSchedule />);
    fireEvent.click(await screen.findByRole('button', { name: 'Email everyone their jobs' }));
    expect(confirm).toHaveBeenCalled();
    expect(await screen.findByText(/Emailed 3 men their jobs for April 2025\. No email address on file for Lee Park\./)).toBeInTheDocument();
    const call = fetchMock.mock.calls.find(([url, o]) => String(url).endsWith('/months/notify') && o?.method === 'POST');
    expect(JSON.parse(call[1].body)).toEqual({ month: 'April 2025' });
    confirm.mockRestore();
  });

  // ─── Time away ──────────────────────────────────────────────────────────────

  test('somebody not in the directory yet is not offered time away', async () => {
    mockSchedule();
    render(<ServingSchedule />);
    await card('Sunday Worship, Sunday, April 6');
    expect(screen.queryByRole('button', { name: /time away/i })).not.toBeInTheDocument();
  });

  test('time away is nested behind its own button, not shown on the page itself', async () => {
    mockSchedule({
      me: {
        directoryId: 3, name: 'Ray Harris', gender: 'male',
        blackouts: [{ id: 7, startsOn: '2025-06-07', endsOn: '2025-06-21', reason: 'Away with family' }],
      },
    });
    render(<ServingSchedule />);
    await card('Sunday Worship, Sunday, April 6');

    // Not open on load, and the button says how many days are already blocked out.
    expect(screen.queryByText(/June 7 – June 21, 2025/)).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'My time away (1)' })).toBeInTheDocument();
  });

  test('somebody not linked to the directory is not offered a time-away button', async () => {
    mockSchedule();   // default me.directoryId is null
    render(<ServingSchedule />);
    await card('Sunday Worship, Sunday, April 6');
    expect(screen.queryByRole('button', { name: /^my time away/i })).not.toBeInTheDocument();
  });

  test('the time-away dialog opens on the button and closes again', async () => {
    mockSchedule({
      me: { directoryId: 3, name: 'Ray Harris', gender: 'male', blackouts: [] },
    });
    render(<ServingSchedule />);
    fireEvent.click(await screen.findByRole('button', { name: 'My time away' }));

    const dialog = await screen.findByRole('dialog', { name: 'Time away' });
    expect(dialog).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  test('a member sees the days they have blocked out', async () => {
    mockSchedule({
      me: {
        directoryId: 3, name: 'Ray Harris', gender: 'male',
        blackouts: [{ id: 7, startsOn: '2025-06-07', endsOn: '2025-06-21', reason: 'Away with family' }],
      },
    });
    render(<ServingSchedule />);
    fireEvent.click(await screen.findByRole('button', { name: /^my time away/i }));

    expect(await screen.findByText(/June 7 – June 21, 2025/)).toBeInTheDocument();
    expect(screen.getByText(/Away with family/)).toBeInTheDocument();
  });

  test('blocking out days posts the range, and one day needs only a first day', async () => {
    const fetchMock = mockSchedule({
      me: { directoryId: 3, name: 'Ray Harris', gender: 'male', blackouts: [] },
    });
    render(<ServingSchedule />);
    fireEvent.click(await screen.findByRole('button', { name: /^my time away/i }));

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
        directoryId: 3, name: 'Ray Harris', gender: 'male',
        blackouts: [{ id: 7, startsOn: '2025-06-07', endsOn: '2025-06-07', reason: '' }],
      },
    });
    render(<ServingSchedule />);
    fireEvent.click(await screen.findByRole('button', { name: /^my time away/i }));
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

  test('adding a special service posts the service, its nights and its jobs', async () => {
    const fetchMock = mockSchedule({ canManage: true, specialServices: ['Gospel Meeting', 'Monthly Singing'], jobs: ['Song Leader', 'Opening Prayer', 'Closing Prayer', 'Speaker'] });
    render(<ServingSchedule />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add a special service' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('First night'), { target: { value: '2026-11-15' } });
    fireEvent.change(within(dialog).getByLabelText(/^Last night/), { target: { value: '2026-11-18' } });
    fireEvent.click(within(dialog).getByLabelText('Speaker'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add it' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, opts]) => String(url).endsWith('/special') && opts?.method === 'POST');
      expect(JSON.parse(call[1].body)).toEqual({
        service: 'Gospel Meeting', from: '2026-11-15', through: '2026-11-18',
        jobs: ['Song Leader', 'Opening Prayer', 'Closing Prayer', 'Speaker'],
      });
    });
  });

  const SERVICE_JOBS = [
    { service: 'Sunday Worship', special: false, jobs: ['Song Leader', 'Opening Prayer', 'Speaker'], defaults: ['Song Leader', 'Opening Prayer', 'Speaker'], custom: false, updatedBy: '' },
    { service: 'Wednesday', special: false, jobs: ['Song Leader', 'Closing Prayer'], defaults: ['Song Leader', 'Opening Prayer', 'Closing Prayer'], custom: true, updatedBy: 'Cora' },
    { service: 'Gospel Meeting', special: true, jobs: ['Song Leader', 'Speaker'], defaults: ['Song Leader', 'Opening Prayer', 'Closing Prayer'], custom: true, updatedBy: 'Cora' },
  ];
  const JOBS = ['Song Leader', 'Opening Prayer', 'Speaker', 'Closing Prayer'];

  test('the schedule keeper sets the jobs each service needs', async () => {
    const fetchMock = mockSchedule({ canManage: true, jobs: JOBS, serviceJobs: SERVICE_JOBS, specialServices: ['Gospel Meeting'] });
    render(<ServingSchedule />);
    fireEvent.click(await screen.findByRole('button', { name: 'Jobs for each service' }));
    const wednesday = screen.getByRole('region', { name: 'Jobs for Wednesday' });
    expect(within(wednesday).getByText('Set by Cora')).toBeInTheDocument();
    expect(within(wednesday).getByLabelText('Wednesday: Closing Prayer')).toBeChecked();
    fireEvent.click(within(wednesday).getByLabelText('Wednesday: Opening Prayer'));
    fireEvent.click(within(wednesday).getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, o]) => String(url).endsWith('/service-jobs') && o?.method === 'PUT');
      expect(JSON.parse(call[1].body)).toEqual({ service: 'Wednesday', jobs: ['Song Leader', 'Opening Prayer', 'Closing Prayer'] });
    });
    fireEvent.click(within(screen.getByRole('region', { name: 'Jobs for Gospel Meeting' })).getByRole('button', { name: 'Back to the usual jobs' }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url, o]) => String(url).endsWith('/service-jobs') && o?.method === 'PUT')
      .map(([, o]) => JSON.parse(o.body))).toContainEqual({ service: 'Gospel Meeting', jobs: null }));
  });

  test('a special service starts from the jobs set for it', async () => {
    mockSchedule({ canManage: true, jobs: JOBS, serviceJobs: SERVICE_JOBS, specialServices: ['Gospel Meeting'] });
    render(<ServingSchedule />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add a special service' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('Speaker')).toBeChecked();
    expect(within(dialog).getByLabelText('Opening Prayer')).not.toBeChecked();
  });

  test('with no special services on the list, it says where an admin adds one', async () => {
    mockSchedule({ canManage: true, specialServices: [] });
    render(<ServingSchedule />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add a special service' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Church Records → Service Types');
  });

  test('a day with a special service keeps each service\'s jobs on its own card', async () => {
    mockSchedule({ assignments: [
      ...ASSIGNMENTS,
      { id: 9, month: 'April 2025', date: 'April 6', service: 'Gospel Meeting', job: 'Song Leader', name: 'Visiting Leader' },
    ] });
    render(<ServingSchedule />);
    const meeting = await card('Gospel Meeting, Sunday, April 6');
    expect(within(meeting).getByText('Visiting Leader')).toBeInTheDocument();
    expect(within(meeting).queryByText('Tom Nelson')).not.toBeInTheDocument();
    // Gospel Meeting comes after that day's Sunday Worship.
    expect(screen.getAllByRole('region').map(r => r.getAttribute('aria-label'))).toEqual([
      'Sunday Worship, Sunday, April 6', 'Gospel Meeting, Sunday, April 6', 'Sunday Worship, Sunday, April 13',
    ]);
  });

  test('building a month posts the month, the services chosen, and to fill in names', async () => {
    const fetchMock = mockSchedule({ canManage: true });
    render(<ServingSchedule />);
    fireEvent.click(await screen.findByRole('button', { name: 'Build a month' }));

    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Month: month'), { target: { value: '5' } });
    fireEvent.change(within(dialog).getByLabelText('Month: year'), { target: { value: '2026' } });
    fireEvent.click(within(dialog).getByLabelText('Wednesday'));    // leave the Sundays on
    expect(within(dialog).getByRole('checkbox', { name: /fill in names/i })).toBeChecked();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Build June 2026' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, opts]) => String(url).endsWith('/months') && opts?.method === 'POST');
      expect(JSON.parse(call[1].body)).toEqual({ month: 'June 2026', services: ['Sunday Worship', 'Sunday Evening'], fill: true });
    });
  });

  test('the keeper can build a month laid out but left empty', async () => {
    const fetchMock = mockSchedule({ canManage: true });
    render(<ServingSchedule />);
    fireEvent.click(await screen.findByRole('button', { name: 'Build a month' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /fill in names/i }));
    fireEvent.click(within(dialog).getByRole('button', { name: /^Build / }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, opts]) => String(url).endsWith('/months') && opts?.method === 'POST');
      expect(JSON.parse(call[1].body).fill).toBe(false);
    });
  });

  test('the setup actions sit in one menu', async () => {
    mockSchedule({ canManage: true });
    render(<ServingSchedule />);
    const summary = await screen.findByText('Setup ▾');
    const menu = summary.closest('details');
    expect(within(menu).getAllByRole('button').map(b => b.textContent)).toEqual([
      'Jobs for each service', 'Add a special service', 'Add a single job',
    ]);
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
    fireEvent.click(screen.getByRole('tab', { name: /All follow-ups/ }));
  }

  test('the tab says how many guests nobody has reached out to', async () => {
    mockGuests([REACHED, IN_PROGRESS, NOBODY]);
    render(<VisitorTracker />);
    const tab = await screen.findByRole('tab', { name: /All follow-ups/ });
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
