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
    },
    {
      id: 2, name: 'Sam Ford', phone: '', email: '', city: '', state: '',
      invited_by: '', status: '', notes: '',
      visits: [{ id: 3, date: '04/06/25', service: 'AM' }],
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
      me: { directoryId: null, name: '', gender: '', jobs: [], canSignUp: false },
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
