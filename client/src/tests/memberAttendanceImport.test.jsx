import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, test, expect, vi, afterEach } from 'vitest';
import MemberAttendanceImport from '../components/MemberAttendanceImport';

const STATUSES = [
  { id: 1, label: 'Present', tone: 'blue',   counts_present: 1, sort_order: 0, active: 1 },
  { id: 4, label: 'Absent',  tone: 'yellow', counts_present: 0, sort_order: 3, active: 1 },
];
const SERVICES = [{ id: 1, name: 'Sunday AM Worship', weekday: 0, active: 1 }];
const PEOPLE = [{ id: 11, name: 'Ada Archer', letter: 'A' }, { id: 12, name: 'Bob Baker', letter: 'B' }];

function previewFor(fields) {
  const keyMap = JSON.parse(fields.get('keyMap'));
  const personMap = JSON.parse(fields.get('personMap'));
  const mapped = Object.values(keyMap).filter(Boolean).length;
  return {
    success: true, dryRun: fields.get('dryRun') === 'true',
    sheets: ['2025', 'Notes'], sheet: fields.get('sheet') || '2025', headerRow: 2, nameColumn: 'A',
    dates: [{ column: 'B', date: '2025-09-07', heading: '9/7/25' }, { column: 'C', date: '2025-09-14', heading: '9/14/25' }],
    keys: [
      { key: '#00B050', colour: '#00B050', text: '', count: 3, sample: '' },
      { key: 'text:p', colour: null, text: 'P', count: 1, sample: 'P' },
    ],
    people: [
      { row: 3, name: 'Archer, Ada', personId: 11, matchedName: 'Ada Archer', marks: 2 },
      { row: 4, name: 'Cara Nobody', personId: null, matchedName: null, marks: 2 },
    ],
    service: 'Sunday AM Worship',
    counts: { add: mapped * 2 + (personMap[4] ? 1 : 0), replace: 0, same: 0, keep: 0, unmapped: 0, unmatchedPeople: personMap[4] ? 0 : 1, skippedPeople: 0 },
    imported: fields.get('dryRun') === 'true' ? undefined : 3,
  };
}

function mockApi() {
  const sent = [];
  vi.stubGlobal('fetch', vi.fn((url, options = {}) => {
    let body;
    if (url.endsWith('/import')) {
      sent.push(options.body);
      body = previewFor(options.body);
    } else body = { success: true, people: PEOPLE, services: SERVICES, statuses: STATUSES, marks: {} };
    return Promise.resolve({ json: () => Promise.resolve(body) });
  }));
  return sent;
}

afterEach(() => vi.unstubAllGlobals());

const chooseFile = () => {
  const file = new File(['xlsx'], 'attendance.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  fireEvent.change(screen.getByLabelText('Spreadsheet (.xlsx)'), { target: { files: [file] } });
};

describe('importing from Excel', () => {
  test('reads the file as a dry run and shows what it found', async () => {
    const sent = mockApi();
    render(<MemberAttendanceImport services={SERVICES} statuses={STATUSES} onClose={() => {}} />);
    chooseFile();
    expect(await screen.findByText('What each colour means')).toBeInTheDocument();
    expect(sent[0].get('dryRun')).toBe('true');
    expect(sent[0].get('service')).toBe('Sunday AM Worship');
    expect(screen.getByText(/in column A/)).toBeInTheDocument();
    expect(screen.getByText('Names not found in the directory (1)')).toBeInTheDocument();
    expect(screen.getByText(/Nothing to import yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
    expect(screen.getByLabelText('Sheet')).toBeInTheDocument();
  });

  test('mapping a colour and a name re-reads the file with them, then Import saves', async () => {
    const sent = mockApi();
    const onImported = vi.fn();
    render(<MemberAttendanceImport services={SERVICES} statuses={STATUSES} onClose={() => {}} onImported={onImported} />);
    chooseFile();
    await screen.findByText('What each colour means');

    fireEvent.change(screen.getByLabelText('Status for #00B050'), { target: { value: '1' } });
    await waitFor(() => expect(JSON.parse(sent.at(-1).get('keyMap'))).toEqual({ '#00B050': 1 }));
    fireEvent.change(screen.getByLabelText('Who is Cara Nobody'), { target: { value: '12' } });
    await waitFor(() => expect(JSON.parse(sent.at(-1).get('personMap'))).toEqual({ 4: 12 }));
    expect(await screen.findByText(/Import will save 3 marks for Sunday AM Worship/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByText('Imported 3 marks.')).toBeInTheDocument();
    expect(sent.at(-1).get('dryRun')).toBe('false');
    expect(sent.at(-1).get('file').name).toBe('attendance.xlsx');
    expect(onImported).toHaveBeenCalled();
  });

  test('a cell with no colour is listed by what is typed in it', async () => {
    mockApi();
    render(<MemberAttendanceImport services={SERVICES} statuses={STATUSES} onClose={() => {}} />);
    chooseFile();
    const list = (await screen.findByText('What each colour means')).nextElementSibling;
    expect(within(list).getByText('typed, no colour')).toBeInTheDocument();
    expect(within(list).getByText('P')).toBeInTheDocument();
  });
});
