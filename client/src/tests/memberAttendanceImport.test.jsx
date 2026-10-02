import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, test, expect, vi, afterEach } from 'vitest';
import MemberAttendanceImport from '../components/MemberAttendanceImport';

const STATUSES = [
  { id: 1, label: 'Present', tone: 'blue',   counts_present: 1, sort_order: 0, active: 1 },
  { id: 2, label: 'Sick',    tone: 'orange', counts_present: 0, sort_order: 1, active: 1 },
  { id: 4, label: 'Absent',  tone: 'yellow', counts_present: 0, sort_order: 3, active: 1 },
];
const SERVICES = [
  { id: 2, name: 'Wednesday Bible Study', weekday: 3, active: 1 },
  { id: 1, name: 'Sunday AM Worship', weekday: 0, active: 1 },
];
const PEOPLE = [{ id: 11, name: 'Ada Archer', letter: 'A' }, { id: 12, name: 'Bob Baker', letter: 'B' }];

// Two weekly roster sheets: one dated on the sheet, one only by its file name,
// and a third with no date at all until one is typed in.
function previewFor(fields) {
  const keyMap = JSON.parse(fields.get('keyMap'));
  const personMap = JSON.parse(fields.get('personMap'));
  const dateMap = JSON.parse(fields.get('dateMap'));
  const third = dateMap['2#Sheet1'];
  const mapped = Object.values(keyMap).filter(Boolean).length;
  return {
    success: true, dryRun: fields.get('dryRun') === 'true',
    sheets: [], sheet: '',
    pages: [
      { id: '0#Sheet1', file: 'a.xlsx', sheet: 'Sheet1', layout: 'roster', dates: ['2025-09-07'], dateFound: true, problem: null, people: 3 },
      { id: '1#Sheet1', file: 'Attendance_09_14_2025.xlsx', sheet: 'Sheet1', layout: 'roster', dates: ['2025-09-14'], dateFound: false, problem: null, people: 3 },
      { id: '2#Sheet1', file: 'old.xlsx', sheet: 'Sheet1', layout: 'roster', dates: third ? [third] : [], dateFound: false, problem: third ? null : 'No date found on this sheet. Enter it.', people: 3 },
    ],
    dates: ['2025-09-07', '2025-09-14', ...(third ? [third] : [])],
    legend: [{ colour: '#D8E4BC', name: 'Green', label: 'Present' }, { colour: '#FFFF00', name: 'Yellow', label: 'Work' }],
    keys: [
      { key: '#D8E4BC', colour: '#D8E4BC', text: '', none: false, count: 4, legend: 'Green = Present', legendLabel: 'Present', approximate: false, suggest: 1 },
      { key: 'none', colour: null, text: '', none: true, count: 1, suggest: 4 },
      { key: '#FFFF00', colour: '#FFFF00', text: '', none: false, count: 1, legend: 'Yellow = Work', legendLabel: 'Work', approximate: false, suggest: null },
    ],
    people: [
      { key: 'ada archer', name: 'Ada Archer', where: 'Sheet1 A4', personId: 11, matchedName: 'Ada Archer', marks: 2 },
      { key: 'cara nobody', name: 'Cara Nobody', where: 'Sheet1 D4', personId: null, matchedName: null, marks: 2 },
    ],
    service: fields.get('service'),
    counts: { add: mapped * 2 + (personMap['cara nobody'] ? 1 : 0), replace: 0, same: 0, keep: 0, unmapped: 0, unmatchedPeople: personMap['cara nobody'] ? 0 : 1, skippedPeople: 0 },
    imported: fields.get('dryRun') === 'true' ? undefined : 5,
  };
}

function mockApi() {
  const sent = [];
  const calls = [];
  vi.stubGlobal('fetch', vi.fn((url, options = {}) => {
    calls.push({ url, options });
    let body;
    if (url.endsWith('/import')) {
      sent.push(options.body);
      body = previewFor(options.body);
    } else if (url.endsWith('/statuses')) body = { success: true, status: { id: 9, label: 'Work', tone: 'green', active: 1 } };
    else body = { success: true, people: PEOPLE, services: SERVICES, statuses: STATUSES, marks: {} };
    return Promise.resolve({ json: () => Promise.resolve(body) });
  }));
  return { sent, calls };
}

afterEach(() => vi.unstubAllGlobals());

const chooseFiles = () => {
  const type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const files = ['a.xlsx', 'Attendance_09_14_2025.xlsx', 'old.xlsx'].map(n => new File(['xlsx'], n, { type }));
  fireEvent.change(screen.getByLabelText('Spreadsheets (.xlsx)'), { target: { files } });
};

const renderDialog = (props = {}) => render(
  <MemberAttendanceImport services={SERVICES} statuses={STATUSES} onClose={() => {}} {...props} />,
);

describe('importing the weekly sheets', () => {
  test('sends every file chosen, and lists each sheet with its date and where the date came from', async () => {
    const { sent } = mockApi();
    renderDialog();
    chooseFiles();
    expect(await screen.findByText('What each colour means')).toBeInTheDocument();
    expect(sent[0].getAll('file').map(f => f.name)).toEqual(['a.xlsx', 'Attendance_09_14_2025.xlsx', 'old.xlsx']);
    expect(screen.getByText('from the sheet')).toBeInTheDocument();
    expect(screen.getByText('from the file name')).toBeInTheDocument();
    expect(screen.getByText('No date found on this sheet. Enter it.')).toBeInTheDocument();
  });

  test('starts from the legend: Present for green, Absent for no colour, and picks the service from the dates', async () => {
    const { sent } = mockApi();
    renderDialog();
    chooseFiles();
    await screen.findByText('What each colour means');
    await waitFor(() => expect(JSON.parse(sent.at(-1).get('keyMap'))).toEqual({ '#D8E4BC': 1, none: 4 }));
    expect(screen.getByLabelText('Status for #D8E4BC')).toHaveValue('1');
    expect(screen.getByLabelText('Status for no colour')).toHaveValue('4');
    expect(screen.getByText('Green = Present')).toBeInTheDocument();
    expect(screen.getByText(/most likely absent/)).toBeInTheDocument();
    // Both dates are Sundays.
    await waitFor(() => expect(sent.at(-1).get('service')).toBe('Sunday AM Worship'));
  });

  test('a legend colour with no status offers to add one, and then uses it', async () => {
    const { sent, calls } = mockApi();
    const onStatusesChanged = vi.fn(() => Promise.resolve());
    renderDialog({ onStatusesChanged });
    chooseFiles();
    fireEvent.click(await screen.findByRole('button', { name: 'Add “Work” as a status' }));
    await waitFor(() => expect(onStatusesChanged).toHaveBeenCalled());
    expect(JSON.parse(calls.find(c => c.url.endsWith('/statuses')).options.body)).toEqual({ label: 'Work' });
    await waitFor(() => expect(JSON.parse(sent.at(-1).get('keyMap'))['#FFFF00']).toBe(9));
  });

  test('a sheet with no date gets one typed in', async () => {
    const { sent } = mockApi();
    renderDialog();
    chooseFiles();
    await screen.findByText('What each colour means');
    fireEvent.change(screen.getByLabelText('Date of old.xlsx Sheet1'), { target: { value: '2025-09-21' } });
    await waitFor(() => expect(JSON.parse(sent.at(-1).get('dateMap'))).toEqual({ '2#Sheet1': '2025-09-21' }));
    await waitFor(() => expect(screen.queryByText('No date found on this sheet. Enter it.')).not.toBeInTheDocument());
  });

  test('an unmatched name is given a person, and Import saves', async () => {
    const { sent } = mockApi();
    const onImported = vi.fn();
    renderDialog({ onImported });
    chooseFiles();
    await screen.findByText('Names not found in the directory (1)');
    fireEvent.change(screen.getByLabelText('Who is Cara Nobody'), { target: { value: '12' } });
    await waitFor(() => expect(JSON.parse(sent.at(-1).get('personMap'))).toEqual({ 'cara nobody': 12 }));
    expect(await screen.findByText(/Import will save 5 marks for Sunday AM Worship/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByText('Imported 5 marks.')).toBeInTheDocument();
    expect(sent.at(-1).get('dryRun')).toBe('false');
    expect(onImported).toHaveBeenCalled();
  });

  test('leaving a suggested colour out is kept, not filled back in', async () => {
    const { sent } = mockApi();
    renderDialog();
    chooseFiles();
    await screen.findByText('What each colour means');
    await waitFor(() => expect(screen.getByLabelText('Status for no colour')).toHaveValue('4'));
    fireEvent.change(screen.getByLabelText('Status for no colour'), { target: { value: '' } });
    await waitFor(() => expect(JSON.parse(sent.at(-1).get('keyMap')).none).toBe(''));
    const list = screen.getByText('What each colour means').nextElementSibling;
    expect(within(list).getByLabelText('Status for no colour')).toHaveValue('');
  });
});
