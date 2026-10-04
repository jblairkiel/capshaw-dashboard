import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, test, expect, vi, afterEach } from 'vitest';
import { useState } from 'react';
import UpcomingServiceView from '../components/UpcomingServiceView';

// The printed order of service has tests of its own; here it only has to be there.
vi.mock('../components/OrderOfService', () => ({ default: () => <div>Printed order goes here</div> }));

const PARTS = [
  { id: 1, name: 'Song', takesSong: true, takesPerson: false, detailLabel: '', servingJob: '', active: true },
  { id: 2, name: 'Opening prayer', takesSong: false, takesPerson: true, detailLabel: '', servingJob: 'Opening Prayer', active: true },
  { id: 5, name: 'Sermon', takesSong: false, takesPerson: true, detailLabel: 'Title', servingJob: '', active: true },
];
const GRACE = { id: 10, title: 'Amazing Grace', hymnal: 'Praise for the Lord', number: '123' };
const ABIDE = { id: 11, title: 'Abide With Me', hymnal: 'Praise for the Lord', number: '40' };

const PLAN = {
  id: 7, date: '2026-10-04', service: 'Sunday AM Worship', leader: 'Lee Leader', notes: '', status: 'submitted',
  submittedByName: 'Lee Leader', canEdit: true,
  items: [
    { partId: 1, partName: 'Song', takesSong: true, takesPerson: false, detailLabel: '', song: GRACE, person: '', detail: '', note: 'vv. 1, 2 and 4' },
    { partId: 5, partName: 'Sermon', takesSong: false, takesPerson: true, detailLabel: 'Title', song: null, person: 'Sam Preacher', detail: 'The Good Shepherd' },
  ],
};

function overview({ canOrganize = false, keepsSongs = false, withPlan = false, canSubmit = true, requests = [] } = {}) {
  return {
    success: true, today: '2026-09-30', canOrganize, keepsSongs, parts: PARTS,
    services: [{ id: 2, name: 'Sunday AM Worship' }, { id: 4, name: 'Wednesday Bible Study' }],
    requests,
    upcoming: [
      { date: '2026-10-04', service: 'Sunday AM Worship', leader: 'Lee Leader', plan: withPlan ? PLAN : null, canSubmit, canEdit: withPlan && canSubmit },
      { date: '2026-10-07', service: 'Wednesday Bible Study', leader: '', plan: null, canSubmit, canEdit: false },
    ],
  };
}

const TEMPLATE = {
  date: '2026-10-04', service: 'Sunday AM Worship', leader: 'Lee Leader', serving: { 'Opening Prayer': ['Mo Member'] },
  items: [
    { partId: 1, partName: 'Song', takesSong: true, takesPerson: false, detailLabel: '', song: null, person: '', detail: '' },
    { partId: 2, partName: 'Opening prayer', takesSong: false, takesPerson: true, detailLabel: '', song: null, person: 'Mo Member', detail: '' },
    { partId: 1, partName: 'Song', takesSong: true, takesPerson: false, detailLabel: '', song: null, person: '', detail: '' },
  ],
};

function mockApi({ view = overview(), planFor = null, canSubmit = true, onPost } = {}) {
  const fetchMock = vi.fn((url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    let body = { success: true };
    if (u === '/api/worship/overview') body = view;
    else if (u.startsWith('/api/worship/plans/for')) body = { success: true, plan: planFor, template: TEMPLATE, canSubmit, canOrganize: view.canOrganize };
    else if (u.startsWith('/api/songs/search')) body = { success: true, results: [GRACE, ABIDE].filter(s => s.title.toLowerCase().includes(new URL(u, 'http://x').searchParams.get('q').toLowerCase())) };
    else if (u === '/api/songs/library' && method === 'POST') body = { success: true, song: { id: 1000001, title: JSON.parse(opts.body).title, hymnal: '', number: '' }, existing: false };
    else if (u === '/api/worship/plans' && method === 'POST') body = onPost?.(JSON.parse(opts.body)) || { success: true, created: true, emailed: 1, plan: { ...PLAN, id: 8 } };
    else if (u.startsWith('/api/worship/requests') && method === 'GET') body = { success: true, requests: [] };
    else if (u.startsWith('/api/songs')) body = { success: true, records: [], total: 0 };
    return Promise.resolve({ json: () => Promise.resolve(body) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => { vi.unstubAllGlobals(); });

// The page is controlled by its tab, as App drives it.
function Page(props) {
  const [tab, setTab] = useState(props.tab || 'order');
  return <UpcomingServiceView user={{ id: 4, role: 'approved' }} {...props} tab={tab} onTabChange={setTab} />;
}

const calls = (fetchMock, method, url) => fetchMock.mock.calls.filter(([u, o = {}]) => u === url && (o.method || 'GET') === method);

describe('the page', () => {
  test('puts worship order, submitting, the tracker and requests on one page', async () => {
    mockApi();
    render(<Page />);
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map(t => t.textContent)).toEqual(['Order of Worship', 'Submit a Service', 'Song Tracker', 'Song Requests']);
    expect(screen.getByText('Printed order goes here')).toBeInTheDocument();
  });

  test('the worship organizer also gets Service Parts, and a count of services to confirm', async () => {
    mockApi({ view: overview({ canOrganize: true, withPlan: true }) });
    render(<Page />);
    expect(await screen.findByRole('tab', { name: 'Service Parts' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Submit a Service/ })).toHaveTextContent('1');
  });
});

describe('Order of Worship', () => {
  test('shows each service coming up, as submitted or not yet', async () => {
    mockApi({ view: overview({ withPlan: true }) });
    render(<Page />);
    const sunday = await screen.findByRole('region', { name: /Sunday AM Worship/ });
    expect(within(sunday).getByText('Waiting to be confirmed')).toBeInTheDocument();
    expect(within(sunday).getByText('Amazing Grace')).toBeInTheDocument();
    expect(within(sunday).getByText('“The Good Shepherd”')).toBeInTheDocument();
    expect(within(sunday).getByText('vv. 1, 2 and 4')).toBeInTheDocument();
    const wednesday = screen.getByRole('region', { name: /Wednesday Bible Study/ });
    expect(within(wednesday).getByText('Not submitted yet')).toBeInTheDocument();
    // Only the organizer confirms.
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
  });

  test('the organizer confirms from here', async () => {
    const fetchMock = mockApi({ view: overview({ canOrganize: true, withPlan: true }) });
    render(<Page />);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(calls(fetchMock, 'POST', '/api/worship/plans/7/confirm')).toHaveLength(1));
    expect(await screen.findByText(/Its songs are now in the song tracker/)).toBeInTheDocument();
  });

  test('"Submit this service" opens it on the Submit tab', async () => {
    mockApi();
    render(<Page />);
    const wednesday = await screen.findByRole('region', { name: /Wednesday Bible Study/ });
    fireEvent.click(within(wednesday).getByRole('button', { name: 'Submit this service' }));
    expect(await screen.findByRole('tab', { name: 'Submit a Service', selected: true })).toBeInTheDocument();
    expect(screen.getByLabelText('Which service')).toHaveValue('2026-10-07|Wednesday Bible Study');
  });
});

describe('Submit a Service', () => {
  async function openSubmit(options) {
    const fetchMock = mockApi(options);
    render(<Page tab="service" />);
    await screen.findByLabelText('Order of the service');
    return fetchMock;
  }

  async function pickSong(label, text, title) {
    fireEvent.change(screen.getByLabelText(label), { target: { value: text } });
    fireEvent.mouseDown(await screen.findByRole('option', { name: new RegExp(title) }));
  }

  test('starts from the usual order, with the Serving Schedule filled in', async () => {
    await openSubmit();
    expect(screen.getByLabelText('Who for Opening prayer 2')).toHaveValue('Mo Member');
    expect(screen.getByLabelText('Song leader')).toHaveValue('Lee Leader');
    expect(screen.getByRole('button', { name: 'Submit service' })).toBeInTheDocument();
  });

  test('sends every part in order, and says the organizer has been emailed', async () => {
    let sent;
    const fetchMock = await openSubmit({ onPost: b => { sent = b; return null; } });
    await pickSong('Song for Song 1', 'grace', 'Amazing Grace');
    await pickSong('Song for Song 3', 'abide', 'Abide With Me');
    const note = screen.getByLabelText('Note for Song 3');
    expect(note).toHaveAttribute('placeholder', 'specific vs. or comments');
    fireEvent.change(note, { target: { value: 'vv. 1 and 3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move Song 3 up' }));
    // The note goes with its part.
    expect(screen.getByLabelText('Note for Song 2')).toHaveValue('vv. 1 and 3');
    fireEvent.click(screen.getByRole('button', { name: 'Submit service' }));

    await waitFor(() => expect(calls(fetchMock, 'POST', '/api/worship/plans')).toHaveLength(1));
    expect(sent).toMatchObject({
      date: '2026-10-04', service: 'Sunday AM Worship', leader: 'Lee Leader',
      items: [
        { partId: 1, songId: GRACE.id, note: '' },
        { partId: 1, songId: ABIDE.id, note: 'vv. 1 and 3' },
        { partId: 2, songId: null, person: 'Mo Member', note: '' },
      ],
    });
    expect(await screen.findByText(/The worship organizer has been emailed/)).toBeInTheDocument();
  });

  test('a part can be added or taken out', async () => {
    await openSubmit();
    fireEvent.change(screen.getByLabelText('Add a part'), { target: { value: '5' } });
    expect(screen.getByLabelText('Title for Sermon 4')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Opening prayer 2' }));
    expect(screen.queryByLabelText('Who for Opening prayer 2')).toBeNull();
  });

  test('a requested song goes into the first empty song slot', async () => {
    await openSubmit({ view: overview({ requests: [{ id: 3, status: 'open', song: ABIDE, requesterName: 'Mo Member', forDate: '', note: 'For my mother', plan: null }] }) });
    const aside = screen.getByRole('complementary', { name: 'Requested songs' });
    expect(within(aside).getByText('For my mother')).toBeInTheDocument();
    fireEvent.click(within(aside).getByRole('button', { name: 'Use' }));
    expect(screen.getAllByText('Abide With Me')[0].closest('li')).toHaveTextContent('Song');
    expect(within(aside).getByText('In it')).toBeInTheDocument();
  });

  test('a song nobody has entered can be added from the picker and used at once', async () => {
    const fetchMock = await openSubmit();
    fireEvent.change(screen.getByLabelText('Song for Song 1'), { target: { value: 'Sing to Me of Heaven' } });
    fireEvent.mouseDown(await screen.findByRole('button', { name: /Add “Sing to Me of Heaven” as a new song/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a song' });
    expect(within(dialog).getByLabelText('Title')).toHaveValue('Sing to Me of Heaven');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add song' }));
    await waitFor(() => expect(calls(fetchMock, 'POST', '/api/songs/library')).toHaveLength(1));
    expect(await screen.findByText('Sing to Me of Heaven')).toBeInTheDocument();
  });

  test('somebody who may not submit it can look but not change it', async () => {
    await openSubmit({ canSubmit: false, view: overview({ canSubmit: false }) });
    expect(screen.getByText(/Only the song leader on the Serving Schedule/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit service' })).toBeNull();
    expect(screen.queryByLabelText('Song for Song 1')).toBeNull();
    expect(screen.queryByLabelText('Note for Song 1')).toBeNull();
  });

  test('the organizer can confirm a submitted service from here', async () => {
    const fetchMock = await openSubmit({ view: overview({ canOrganize: true, withPlan: true }), planFor: PLAN });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(calls(fetchMock, 'POST', '/api/worship/plans/7/confirm')).toHaveLength(1));
  });
});

describe('names from the Serving Schedule', () => {
  test('a service not submitted yet shows who is down for it', async () => {
    const view = overview();
    view.upcoming[1].serving = { 'Song Leader': ['Visiting Leader'], 'Opening Prayer': ['Mo Member'] };
    mockApi({ view });
    render(<Page tab="order" />);
    const card = await screen.findByRole('region', { name: /Wednesday Bible Study/ });
    expect(within(card).getByText('On the Serving Schedule')).toBeInTheDocument();
    expect(within(card).getByText('Opening Prayer').nextSibling).toHaveTextContent('Mo Member');
  });
});

describe('a link to one service', () => {
  test('the song leader\'s reminder opens that service on the Submit tab', async () => {
    const fetchMock = mockApi();
    render(<Page tab="service" initialSelection={{ date: '2026-10-07', service: 'Wednesday Bible Study' }} />);
    await screen.findByLabelText('Order of the service');
    expect(screen.getByLabelText('Which service')).toHaveValue('2026-10-07|Wednesday Bible Study');
    expect(fetchMock.mock.calls.some(([u]) => u === '/api/worship/plans/for?date=2026-10-07&service=Wednesday%20Bible%20Study')).toBe(true);
  });

  test('a service beyond the next two weeks still shows as the one chosen', async () => {
    const fetchMock = mockApi();
    render(<Page tab="service" initialSelection={{ date: '2026-11-08', service: 'Sunday AM Worship' }} />);
    await screen.findByLabelText('Order of the service');
    const picker = screen.getByLabelText('Which service');
    expect(picker).toHaveValue('2026-11-08|Sunday AM Worship');
    expect(screen.queryByLabelText('Date')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => u === '/api/worship/plans/for?date=2026-11-08&service=Sunday%20AM%20Worship')).toBe(true);
    // Choosing "another date" still works from there.
    fireEvent.change(picker, { target: { value: 'other' } });
    expect(screen.getByLabelText('Date')).toHaveValue('2026-11-08');
  });

  test('Copy link puts the service\'s own link on the clipboard', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    mockApi();
    render(<Page tab="service" initialSelection={{ date: '2026-10-07', service: 'Wednesday Bible Study' }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Copy the link to Wednesday Bible Study, 2026-10-07' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/?page=upcoming&tab=service&date=2026-10-07&service=Wednesday+Bible+Study`));
    expect(await screen.findByRole('button', { name: /Copy the link/ })).toHaveTextContent('Link copied');
  });

  test('where the clipboard is not allowed, the link is shown to copy by hand', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: () => Promise.reject(new Error('denied')) } });
    mockApi();
    render(<Page tab="order" />);
    const card = await screen.findByRole('region', { name: /Wednesday Bible Study/ });
    fireEvent.click(within(card).getByRole('button', { name: /Copy the link/ }));
    expect(await within(card).findByLabelText('Link to this service'))
      .toHaveValue(`${window.location.origin}/?page=upcoming&tab=service&date=2026-10-07&service=Wednesday+Bible+Study`);
  });
});

describe('Song Requests', () => {
  test('any member can ask for a song', async () => {
    const fetchMock = mockApi();
    render(<Page tab="requests" />);
    fireEvent.change(await screen.findByLabelText('Song to request'), { target: { value: 'grace' } });
    fireEvent.mouseDown(await screen.findByRole('option', { name: /Amazing Grace/ }));
    fireEvent.change(screen.getByLabelText(/Why, or anything/), { target: { value: 'For my mother' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask for this song' }));
    await waitFor(() => {
      const [[, opts]] = calls(fetchMock, 'POST', '/api/worship/requests');
      expect(JSON.parse(opts.body)).toEqual({ songId: GRACE.id, forDate: '', note: 'For my mother' });
    });
  });

  test('the asker can withdraw it; a song keeper can decline it', async () => {
    const mine = { id: 3, status: 'open', song: GRACE, requestedBy: 4, requesterName: 'Lee Leader', forDate: '', note: '', plan: null };
    const theirs = { ...mine, id: 4, requestedBy: 9, requesterName: 'Mo Member', song: ABIDE };
    const fetchMock = mockApi({ view: overview({ requests: [mine, theirs] }) });
    render(<Page tab="requests" />);
    const list = await screen.findByRole('region', { name: 'Requested songs' });
    expect(within(list).getAllByRole('button', { name: 'Withdraw' })).toHaveLength(1);
    expect(within(list).queryByRole('button', { name: 'Decline' })).toBeNull();
    fireEvent.click(within(list).getByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expect(calls(fetchMock, 'PATCH', '/api/worship/requests/3')).toHaveLength(1));
  });
});

describe('adding a song from the header', () => {
  test('is offered on every tab, and says it can be chosen straight away', async () => {
    mockApi();
    render(<Page />);
    fireEvent.click(await screen.findByRole('button', { name: '+ Add a song' }));
    const dialog = screen.getByRole('dialog', { name: 'Add a song' });
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Night With Ebon Pinion' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add song' }));
    expect(await screen.findByText(/Added “Night With Ebon Pinion” to the song list/)).toBeInTheDocument();
  });
});

describe('Service Parts', () => {
  const OUTLINES = {
    default: [1, 2, 1],
    services: [
      { id: 2, name: 'Sunday AM Worship', startTime: '09:50', partIds: [1, 2, 1], own: false },
      { id: 4, name: 'Wednesday Bible Study', startTime: '19:00', partIds: [1, 1], own: true },
    ],
  };

  function partsApi() {
    const fetchMock = mockApi({ view: overview({ canOrganize: true }) });
    const inner = fetchMock.getMockImplementation();
    fetchMock.mockImplementation((url, opts = {}) => {
      if (url === '/api/worship/parts' && (opts.method || 'GET') === 'GET') {
        return Promise.resolve({ json: () => Promise.resolve({ success: true, parts: PARTS, outlines: OUTLINES, canOrganize: true }) });
      }
      return inner(url, opts);
    });
    return fetchMock;
  }

  test('the organizer changes the usual order and saves it', async () => {
    const fetchMock = partsApi();
    render(<Page tab="parts" />);
    const order = await screen.findByRole('region', { name: 'Usual order' });
    fireEvent.click(within(order).getByRole('button', { name: 'Remove Opening prayer 2' }));
    fireEvent.change(within(order).getByLabelText('Add a part to the order'), { target: { value: '5' } });
    fireEvent.click(within(order).getByRole('button', { name: 'Save order' }));
    await waitFor(() => {
      const [[, opts]] = calls(fetchMock, 'PUT', '/api/worship/outlines/default');
      expect(JSON.parse(opts.body)).toEqual({ partIds: [1, 1, 5] });
    });
  });

  test('a service with its own order can go back to the shared one', async () => {
    const fetchMock = partsApi();
    render(<Page tab="parts" />);
    const order = await screen.findByRole('region', { name: 'Usual order' });
    fireEvent.change(within(order).getByLabelText("Which service's order"), { target: { value: '4' } });
    fireEvent.click(within(order).getByRole('button', { name: /Use the order for every service instead/ }));
    await waitFor(() => {
      const [[, opts]] = calls(fetchMock, 'PUT', '/api/worship/outlines/4');
      expect(JSON.parse(opts.body)).toEqual({ partIds: null });
    });
  });

  test('a new part says what it collects', async () => {
    const fetchMock = partsApi();
    render(<Page tab="parts" />);
    await screen.findByRole('region', { name: 'Service parts' });
    const names = screen.getAllByLabelText('Part name');
    const blank = names[names.length - 1];
    fireEvent.change(blank, { target: { value: 'Welcome' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => {
      const [[, opts]] = calls(fetchMock, 'POST', '/api/worship/parts');
      expect(JSON.parse(opts.body)).toMatchObject({ name: 'Welcome', takesPerson: true, takesSong: false });
    });
  });

  test('each service\'s start time, which the song leader\'s reminders count back from', async () => {
    const fetchMock = partsApi();
    render(<Page tab="parts" />);
    const times = await screen.findByRole('region', { name: 'Service times' });
    expect(within(times).getByText(/emailed four days \(96 hours\) before/)).toBeInTheDocument();
    const am = within(times).getByLabelText('Sunday AM Worship starts at');
    expect(am).toHaveValue('09:50');
    fireEvent.change(am, { target: { value: '10:00' } });
    fireEvent.click(within(am.closest('li')).getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      const [[, opts]] = calls(fetchMock, 'PUT', '/api/worship/services/2/start-time');
      expect(JSON.parse(opts.body)).toEqual({ time: '10:00' });
    });
  });
});
