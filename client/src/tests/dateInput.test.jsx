import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, test, expect, vi, afterEach } from 'vitest';
import { useState } from 'react';
import DateInput, { MonthInput } from '../components/DateInput';
import ServingSchedule from '../components/ServingSchedule';
import { toIso, fromIso, isoFromMonthDay, monthDayOf, monthLabelOf, parseMonth } from '../lib/dates';

afterEach(() => vi.unstubAllGlobals());

// Every date box is the same picker, speaking ISO, while each record keeps the
// shape it has always been saved in.

describe('reading the dates records hold', () => {
  test.each([
    ['2026-06-07', '2026-06-07'],
    ['6/7/26', '2026-06-07'],
    ['06/07/2026', '2026-06-07'],
    ['Jun 7, 2026', '2026-06-07'],
    ['7 June 2026', '2026-06-07'],
    ['Sept 30 2026', '2026-09-30'],
    ['2/30/26', ''],
    ['June 7', ''],
    ['', ''],
    [null, ''],
  ])('%s → %s', (input, out) => expect(toIso(input)).toBe(out));

  test('writes ISO back in the shape a record keeps', () => {
    expect(fromIso('2026-06-07')).toBe('2026-06-07');
    expect(fromIso('2026-06-07', 'mdy')).toBe('06/07/26');
    expect(fromIso('')).toBe('');
  });

  test("the serving schedule's month and day labels", () => {
    expect(monthLabelOf('2026-06-07')).toBe('June 2026');
    expect(monthDayOf('2026-06-07')).toBe('June 7');
    expect(parseMonth('June 2026')).toEqual({ year: 2026, month: 5 });
    expect(isoFromMonthDay('June 2026', 'June 7')).toBe('2026-06-07');
    expect(isoFromMonthDay('April 2025', 'Apr 6')).toBe('2025-04-06');
    // A slot over the turn of the year belongs to the next or last one.
    expect(isoFromMonthDay('December 2026', 'January 3')).toBe('2027-01-03');
    expect(isoFromMonthDay('January 2027', 'December 27')).toBe('2026-12-27');
    expect(isoFromMonthDay('June 2026', '')).toBe('');
  });
});

function Harness({ initial, format }) {
  const [value, setValue] = useState(initial);
  return <><DateInput aria-label="When" value={value} format={format} onChange={setValue} /><output>{value}</output></>;
}

describe('DateInput', () => {
  test('is a date picker showing an older record as the date it is', () => {
    render(<Harness initial="6/7/26" />);
    const input = screen.getByLabelText('When');
    expect(input).toHaveAttribute('type', 'date');
    expect(input).toHaveValue('2026-06-07');
  });

  test('hands back the picked date in the record\'s own shape', () => {
    render(<Harness initial="" format="mdy" />);
    fireEvent.change(screen.getByLabelText('When'), { target: { value: '2025-05-04' } });
    expect(document.querySelector('output')).toHaveTextContent('05/04/25');
  });

  test('never blanks an entry it cannot read: says what is saved', () => {
    render(<Harness initial="the second Sunday" />);
    expect(screen.getByLabelText('When')).toHaveValue('');
    expect(screen.getByText(/Saved as “the second Sunday”/)).toBeInTheDocument();
  });
});

describe('MonthInput', () => {
  test('picks a month and a year as "June 2026"', () => {
    const onChange = vi.fn();
    render(<MonthInput label="Month" value="May 2026" onChange={onChange} />);
    expect(screen.getByLabelText('Month: month')).toHaveValue('4');
    fireEvent.change(screen.getByLabelText('Month: month'), { target: { value: '5' } });
    expect(onChange).toHaveBeenLastCalledWith('June 2026');
    fireEvent.change(screen.getByLabelText('Month: year'), { target: { value: '2025' } });
    expect(onChange).toHaveBeenLastCalledWith('May 2025');
  });
});

describe('Serving Schedule: picking a day', () => {
  test('saves "June 7" and sets the month to match', async () => {
    const body = {
      success: true, months: [{ month: 'April 2025', slots: 0 }], month: 'April 2025', assignments: [],
      jobs: ['Song Leader'], services: ['Sunday Worship'], serviceJobs: [], canManage: true, blackouts: [],
      me: { directoryId: null, name: '', gender: '', blackouts: [] }, assignment: { month: 'June 2026' },
    };
    const fetchMock = vi.fn(() => Promise.resolve({ json: () => Promise.resolve(body) }));
    vi.stubGlobal('fetch', fetchMock);
    render(<ServingSchedule />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add a job' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: '2026-06-07' } });
    expect(within(dialog).getByLabelText('Month: month')).toHaveValue('5');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, o]) => String(url).endsWith('/assignments') && o?.method === 'POST');
      expect(JSON.parse(call[1].body)).toMatchObject({ month: 'June 2026', date: 'June 7' });
    });
  });
});
