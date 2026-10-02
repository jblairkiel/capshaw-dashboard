import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, test, expect, vi, afterEach } from 'vitest';
import MemberAttendanceView from '../components/MemberAttendanceView';

const STATUSES = [
  { id: 1, label: 'Present',     tone: 'blue',   counts_present: 1, sort_order: 0, active: 1, uses: 4 },
  { id: 2, label: 'Sick',        tone: 'orange', counts_present: 0, sort_order: 1, active: 1, uses: 1 },
  { id: 3, label: 'Out of town', tone: 'aqua',   counts_present: 0, sort_order: 2, active: 1, uses: 0 },
  { id: 4, label: 'Absent',      tone: 'yellow', counts_present: 0, sort_order: 3, active: 1, uses: 0 },
];
const SERVICES = [
  { id: 1, name: 'Sunday AM Worship', weekday: 0, active: 1 },
  { id: 3, name: 'Wednesday Bible Study', weekday: 3, active: 1 },
];
const PEOPLE = [
  { id: 11, name: 'Ada Archer', surname: 'Archer', letter: 'A', has_photo: true },
  { id: 12, name: 'Bob Baker',  surname: 'Baker',  letter: 'B', has_photo: false },
  { id: 13, name: 'Cy Zimmer',  surname: 'Zimmer', letter: 'Z', has_photo: false },
];

const GROUP = {
  success: true, statuses: STATUSES, weeks: 13, service: '',
  rolls: [
    { date: '2026-09-20', service: 'Sunday AM Worship', counts: { 1: 2, 2: 1 }, present: 2, marked: 3 },
    { date: '2026-09-27', service: 'Sunday AM Worship', counts: { 1: 1, 4: 2 }, present: 1, marked: 3 },
  ],
  totals: { 1: 3, 2: 1, 4: 2 },
  summary: { rolls: 2, marked: 6, present: 3, rate: 50, averagePresent: 1.5, people: 3 },
  members: [
    { id: 11, name: 'Ada Archer', letter: 'A', has_photo: true, marked: 2, present: 2, rate: 100, lastPresent: '2026-09-27', missedInARow: 0 },
    { id: 12, name: 'Bob Baker',  letter: 'B', has_photo: false, marked: 2, present: 0, rate: 0, lastPresent: null, missedInARow: 2 },
    { id: 13, name: 'Cy Zimmer',  letter: 'Z', has_photo: false, marked: 2, present: 1, rate: 50, lastPresent: '2026-09-20', missedInARow: 1 },
  ],
};
const PERSON = {
  success: true, statuses: STATUSES, weeks: 13, service: '',
  person: { id: 12, name: 'Bob Baker', has_photo: false },
  counts: { 2: 1, 4: 1 },
  summary: { marked: 2, present: 0, rate: 0, notMarked: 0, missedInARow: 2, lastPresent: null },
  byService: [{ service: 'Sunday AM Worship', marked: 2, present: 0, rate: 0 }],
  history: [
    { date: '2026-09-27', service: 'Sunday AM Worship', statusId: 4 },
    { date: '2026-09-20', service: 'Sunday AM Worship', statusId: 2 },
  ],
};

function mockApi({ marks = { 11: { statusId: 1 } }, markReply = { success: true } } = {}) {
  const fetchMock = vi.fn((url, options = {}) => {
    let body;
    if (url.includes('/roll/mark')) body = markReply;
    else if (url.includes('/roll')) body = { success: true, services: SERVICES, statuses: STATUSES, people: PEOPLE, marks: url.includes('date=') ? marks : {} };
    else if (url.includes('/analytics/person/')) body = PERSON;
    else if (url.includes('/analytics')) body = GROUP;
    else if (url.includes('/statuses')) body = { success: true, status: {} };
    fetchMock.calls.push({ url, ...options, body: options.body ? JSON.parse(options.body) : undefined });
    return Promise.resolve({ json: () => Promise.resolve(body) });
  });
  fetchMock.calls = [];
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

const row = name => screen.getByRole('group', { name: `Mark ${name}` });
const marksSent = api => api.calls.filter(c => c.url.endsWith('/roll/mark')).map(c => c.body);

describe('taking the roll', () => {
  test('lists everybody under their letter, with large names and a photo from the attendance API', async () => {
    mockApi();
    render(<MemberAttendanceView />);
    expect(await screen.findByText('Ada Archer')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'A' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Z' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Ada Archer' })).toHaveAttribute('src', '/api/member-attendance/photo/11');
    expect(screen.getByText('Ada Archer').className).toMatch(/text-2xl/);
    expect(screen.getByText('1 of 3 marked')).toBeInTheDocument();
  });

  test('the letter rail is always there, with letters nobody is under turned off', async () => {
    mockApi();
    render(<MemberAttendanceView />);
    await screen.findByText('Ada Archer');
    const rail = screen.getByRole('navigation', { name: 'Jump to letter' });
    expect(within(rail).getByRole('button', { name: 'Jump to A' })).toBeEnabled();
    expect(within(rail).getByRole('button', { name: 'Jump to C' })).toBeDisabled();
    const section = screen.getByRole('region', { name: 'Z' });
    section.scrollIntoView = vi.fn();
    fireEvent.click(within(rail).getByRole('button', { name: 'Jump to Z' }));
    expect(section.scrollIntoView).toHaveBeenCalled();
  });

  test('a status button marks somebody, and tapping it again takes the mark off', async () => {
    const api = mockApi();
    render(<MemberAttendanceView />);
    await screen.findByText('Bob Baker');

    fireEvent.click(within(row('Bob Baker')).getByRole('button', { name: /Sick/ }));
    expect(within(row('Bob Baker')).getByRole('button', { name: /Sick/ })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(marksSent(api)).toHaveLength(1));
    expect(marksSent(api)[0]).toMatchObject({ personId: 12, statusId: 2, service: expect.any(String) });

    fireEvent.click(within(row('Bob Baker')).getByRole('button', { name: /Sick/ }));
    await waitFor(() => expect(marksSent(api)).toHaveLength(2));
    expect(marksSent(api)[1].statusId).toBeNull();
  });

  test('tapping the photo steps on to the next status', async () => {
    const api = mockApi();
    render(<MemberAttendanceView />);
    await screen.findByText('Ada Archer');
    fireEvent.click(screen.getByRole('button', { name: /Ada Archer: Present\. Tap to change\./ }));
    await waitFor(() => expect(marksSent(api)).toHaveLength(1));
    expect(marksSent(api)[0]).toMatchObject({ personId: 11, statusId: 2 });
    expect(screen.getByRole('button', { name: /Ada Archer: Sick/ })).toBeInTheDocument();
  });

  test('a mark the server refuses is put back, and says why', async () => {
    mockApi({ markReply: { success: false, error: 'That status has been retired' } });
    render(<MemberAttendanceView />);
    await screen.findByText('Bob Baker');
    fireEvent.click(within(row('Bob Baker')).getByRole('button', { name: /Absent/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Bob Baker was not saved: That status has been retired');
    expect(within(row('Bob Baker')).getByRole('button', { name: /Absent/ })).toHaveAttribute('aria-pressed', 'false');
  });

  test('finding a name filters the roll', async () => {
    mockApi();
    render(<MemberAttendanceView />);
    await screen.findByText('Ada Archer');
    fireEvent.change(screen.getByPlaceholderText('Type to filter'), { target: { value: 'zim' } });
    expect(screen.queryByText('Ada Archer')).not.toBeInTheDocument();
    expect(screen.getByText('Cy Zimmer')).toBeInTheDocument();
  });

  test('everyone left can be marked at once', async () => {
    const api = mockApi();
    vi.stubGlobal('confirm', vi.fn(() => true));
    render(<MemberAttendanceView />);
    await screen.findByText('Ada Archer');
    fireEvent.change(screen.getByLabelText('Status for everyone left'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark' }));
    await waitFor(() => expect(api.calls.some(c => c.url.endsWith('/roll/mark-rest'))).toBe(true));
    expect(api.calls.find(c => c.url.endsWith('/roll/mark-rest')).body).toMatchObject({ statusId: 4 });
  });
});

describe('the status list', () => {
  test('can be added to, and a used status offers retiring rather than removing', async () => {
    const api = mockApi();
    render(<MemberAttendanceView />);
    await screen.findByText('Ada Archer');
    fireEvent.click(screen.getByRole('button', { name: 'Statuses' }));
    const dialog = screen.getByRole('dialog', { name: 'Attendance statuses' });
    expect(within(dialog).queryByRole('button', { name: 'Remove Present' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Remove Absent' })).toBeInTheDocument();

    fireEvent.change(within(dialog).getByPlaceholderText('Homebound'), { target: { value: 'Homebound' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(api.calls.some(c => c.url.endsWith('/statuses') && c.method === 'POST')).toBe(true));
  });
});

describe('analytics', () => {
  test('shows the whole congregation, then one member picked from the dropdown', async () => {
    mockApi();
    render(<MemberAttendanceView />);
    await screen.findByText('Ada Archer');
    fireEvent.click(screen.getByRole('tab', { name: 'Analytics' }));

    expect(await screen.findByText('Rolls taken')).toBeInTheDocument();
    expect(screen.getByText('Attendance rate').previousSibling).toHaveTextContent('50%');
    expect(screen.getByText('Not here lately')).toBeInTheDocument();
    expect(screen.getByText('2 in a row')).toBeInTheDocument();

    await waitFor(() => expect(screen.getByLabelText('Member').options.length).toBe(4));
    fireEvent.change(screen.getByLabelText('Member'), { target: { value: '12' } });
    expect(await screen.findByText('Missed in a row')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Bob Baker' })).toBeInTheDocument();
    expect(screen.getByText('Not marked present in this window')).toBeInTheDocument();
  });
});
