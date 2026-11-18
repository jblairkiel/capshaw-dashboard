import { render, screen, fireEvent } from '@testing-library/react';
import { test, expect, vi, afterEach } from 'vitest';
import MyWeekView from '../components/MyWeekView';

// My Week: one member's next two weeks, a day at a time, each row opening the
// page it came from.

function mockWeek(week) {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ success: true, ...week }) })));
}

afterEach(() => vi.unstubAllGlobals());

const WEEK = {
  from: '2026-11-11', to: '2026-11-24', linked: true, name: 'Tom Reed', nextUp: [{ rotationId: 4, title: 'Flowers' }],
  items: [
    { kind: 'job', id: 1, date: '2026-11-11', service: 'Wed Bible Class', job: 'Song Leader', replacementAsked: true },
    { kind: 'signup', id: 2, date: '2026-11-13', time: '17:00', listId: 9, title: 'Meals for the Hales', item: 'Supper', note: '' },
    { kind: 'meeting', id: 3, groupId: 1, date: '2026-11-20', time: '', title: 'Hike', group: 'Young Families', location: '', rsvp: 'unanswered', guests: 0, bringing: [] },
  ],
};

test('splits the fortnight into this week and next, by day', async () => {
  mockWeek(WEEK);
  render(<MyWeekView />);
  expect(await screen.findByRole('heading', { name: "Tom's week" })).toBeInTheDocument();
  expect(screen.getByText('Today · Wednesday, November 11')).toBeInTheDocument();
  expect(screen.getByText('Friday, November 13')).toBeInTheDocument();
  expect(screen.getByText('Song Leader')).toBeInTheDocument();
  expect(screen.getByText('Wed Bible Class')).toBeInTheDocument();
  expect(screen.getByText(/asked for somebody to take this one/)).toBeInTheDocument();
  expect(screen.getByText('Supper · 5:00 PM')).toBeInTheDocument();
  expect(screen.getByText(/waiting on your answer/, { selector: 'p' })).toBeInTheDocument();
  expect(screen.getByText(/1 waiting on your answer/)).toBeInTheDocument();
});

test('each row opens where it came from', async () => {
  mockWeek(WEEK);
  const onOpen = vi.fn();
  render(<MyWeekView onOpen={onOpen} />);
  fireEvent.click(await screen.findByRole('button', { name: /Sign-Ups/ }));
  expect(onOpen).toHaveBeenLastCalledWith({ page: 'signups', list: 9 });
  fireEvent.click(screen.getByRole('button', { name: /Service Roster/ }));
  expect(onOpen).toHaveBeenLastCalledWith({ page: 'assignments' });
  fireEvent.click(screen.getByRole('button', { name: 'Flowers' }));
  expect(onOpen).toHaveBeenLastCalledWith({ page: 'rotations', rotation: 4 });
});

test('an empty fortnight, and an account not linked to the directory, say so', async () => {
  mockWeek({ ...WEEK, linked: false, name: '', nextUp: [], items: [] });
  render(<MyWeekView />);
  expect(await screen.findByText(/Nothing on your list for the next two weeks/)).toBeInTheDocument();
  expect(screen.getByText(/not linked to your entry in the church directory/)).toBeInTheDocument();
  expect(screen.getAllByText('Nothing on your list.')).toHaveLength(2);
});
