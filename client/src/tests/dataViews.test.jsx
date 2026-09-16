import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { describe, test, expect, vi, afterEach } from 'vitest';

// Typing into a controlled input, the way the rest of these tests do it.
const type   = (input, value) => fireEvent.change(input, { target: { value } });
const choose = (select, value) => fireEvent.change(select, { target: { value } });

import LivestreamsView from '../components/LivestreamsView';
import VisitorTracker  from '../components/VisitorTracker';
import JobAssignments  from '../components/JobAssignments';
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

describe('VisitorTracker', () => {
  const VISITORS = [
    { name: 'Pat Lane', visits: [{ date: '04/13/25', service: 'AM' }, { date: '03/30/25', service: 'PM' }] },
    { name: 'Sam Ford', visits: [{ date: '04/06/25', service: 'AM' }] },
  ];

  test('prompts for an update when nothing has been loaded', () => {
    render(<VisitorTracker data={null} />);
    expect(screen.getByText(/No data/i)).toBeInTheDocument();
  });

  test('lists each guest with how often they came and when', () => {
    render(<VisitorTracker data={VISITORS} />);
    const row = screen.getByRole('button', { name: 'Pat Lane' }).closest('tr');

    expect(within(row).getByText('2')).toBeInTheDocument();
    expect(within(row).getByText('03/30/25')).toBeInTheDocument();   // first visit
    expect(within(row).getByText('04/13/25')).toBeInTheDocument();   // last visit
    expect(screen.getByText('2 guests')).toBeInTheDocument();
  });

  test('counts the guests, their visits and who came back', () => {
    render(<VisitorTracker data={VISITORS} />);
    expect(screen.getByText('Visits recorded').previousSibling).toHaveTextContent('3');
    expect(screen.getByText('Came back').previousSibling).toHaveTextContent('1');
    expect(screen.getByText('Most recent visit').previousSibling).toHaveTextContent('04/13/25');
  });

  test('says "1 guest" rather than "1 guests"', () => {
    render(<VisitorTracker data={VISITORS} />);
    type(screen.getByPlaceholderText(/Search guests/i), 'Pat');
    expect(screen.getByText('1 guest')).toBeInTheDocument();
  });

  test('a guest with no recorded visits shows a dash rather than "undefined"', () => {
    render(<VisitorTracker data={[{ name: 'Jo Reed', visits: [] }]} />);
    const row = screen.getByRole('button', { name: 'Jo Reed' }).closest('tr');
    expect(within(row).getAllByText('—')).toHaveLength(2);
  });

  test('the visit history is spelled out when the guest is clicked', () => {
    render(<VisitorTracker data={VISITORS} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Pat Lane' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Pat Lane')).toBeInTheDocument();
    expect(within(dialog).getByText('2 visits on record')).toBeInTheDocument();
    expect(within(dialog).getByText('03/30/25')).toBeInTheDocument();
    expect(within(dialog).getByText('PM')).toBeInTheDocument();
  });

  test('the details are for the guest that was clicked, not another', () => {
    render(<VisitorTracker data={VISITORS} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sam Ford' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('1 visit on record')).toBeInTheDocument();
    expect(within(dialog).queryByText('03/30/25')).not.toBeInTheDocument();
  });

  test('the details close again', () => {
    render(<VisitorTracker data={VISITORS} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pat Lane' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('searching by name narrows the list', () => {
    render(<VisitorTracker data={VISITORS} />);
    type(screen.getByPlaceholderText(/Search guests/i), 'sam');
    expect(screen.getByText('Sam Ford')).toBeInTheDocument();
    expect(screen.queryByText('Pat Lane')).not.toBeInTheDocument();
  });

  test('a search that matches nobody says so', () => {
    render(<VisitorTracker data={VISITORS} />);
    type(screen.getByPlaceholderText(/Search guests/i), 'nobody');
    expect(screen.getByText(/No visitors match your search/i)).toBeInTheDocument();
  });
});

// ─── JobAssignments ───────────────────────────────────────────────────────────

describe('JobAssignments', () => {
  const DATA = {
    month: 'April 2025',
    assignments: [
      { date: 'April 6',  service: 'AM', job: 'Song Leader',        name: 'Tom Nelson' },
      { date: 'April 6',  service: 'AM', job: 'Opening Prayer',     name: 'Ray Harris' },
      { date: 'April 13', service: 'PM', job: 'Song Leader',        name: 'Lee Park' },
      { date: 'April 6',  service: 'AM', job: 'Visuals',            name: 'Jo Reed' },
      { date: '',         service: '',   job: 'Visual Preparation', name: 'Sam Ford' },
    ],
  };

  test('prompts for an update when nothing has been loaded', () => {
    render(<JobAssignments data={null} />);
    expect(screen.getByText(/No data/i)).toBeInTheDocument();
  });

  test('shows the month the roster covers', () => {
    render(<JobAssignments data={DATA} />);
    expect(screen.getByText('April 2025')).toBeInTheDocument();
  });

  test('offers every week of the roster, and opens on the first', () => {
    render(<JobAssignments data={DATA} />);
    const weeks = screen.getByRole('combobox', { name: 'Week' });

    expect(within(weeks).getAllByRole('option').map(o => o.textContent)).toEqual(['April 6', 'April 13']);
    expect(weeks).toHaveValue('April 6');
  });

  test('shows one week at a time, in a single table', () => {
    render(<JobAssignments data={DATA} />);
    expect(screen.getAllByRole('table')).toHaveLength(1);
    expect(screen.getByText('Opening Prayer')).toBeInTheDocument();
    expect(screen.queryByText('Lee Park')).not.toBeInTheDocument();
  });

  test('choosing another week swaps the table over', () => {
    render(<JobAssignments data={DATA} />);
    choose(screen.getByRole('combobox', { name: 'Week' }), 'April 13');

    expect(screen.getByText('Lee Park')).toBeInTheDocument();
    expect(screen.queryByText('Opening Prayer')).not.toBeInTheDocument();
  });

  test('the service each job belongs to is left out', () => {
    render(<JobAssignments data={DATA} />);
    expect(screen.queryByText('Service')).not.toBeInTheDocument();
    expect(screen.queryByText('AM')).not.toBeInTheDocument();
  });

  test('the AV operator is listed with the rest of that week', () => {
    render(<JobAssignments data={DATA} />);
    expect(screen.getByText('Visuals')).toBeInTheDocument();
    expect(screen.getByText('Jo Reed')).toBeInTheDocument();
  });

  test('the monthly visual preparation is called out above the table, not as a week', () => {
    render(<JobAssignments data={DATA} />);
    expect(screen.getByText(/Visual Preparation: Sam Ford/)).toBeInTheDocument();
    expect(within(screen.getByRole('combobox', { name: 'Week' })).getAllByRole('option')).toHaveLength(2);
  });

  test('omits the monthly line when there is none', () => {
    render(<JobAssignments data={{ assignments: [DATA.assignments[0]] }} />);
    expect(screen.queryByText(/Visual Preparation/)).not.toBeInTheDocument();
  });

  test('a roster with no assignments at all renders empty rather than breaking', () => {
    render(<JobAssignments data={{}} />);
    expect(screen.getByText(/Nobody is rostered yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Week' })).not.toBeInTheDocument();
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
