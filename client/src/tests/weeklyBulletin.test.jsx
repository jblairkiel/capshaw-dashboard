import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import WeeklyBulletinView from '../components/WeeklyBulletinView';

// One composed week, as GET /api/bulletin/:week returns it.
function bulletinFor(overrides = {}) {
  return {
    sunday: '2026-05-03',
    sundayLabel: 'May 3, 2026',
    masthead: 'Capshaw Church of Christ Newsletter',
    saved: false,
    carriedFrom: null,
    quote: 'Let us not become weary in doing good',
    quoteRef: 'Gal. 6:9',
    reminders: ['Potluck May 10 at 6:00 PM'],
    prayer: {
      updates: ['Elise Mowrer home from hospital'],
      ongoing: ['Dean Coffield', 'Ruby Rundt'],
      shutIns: [], pregnancies: [], evangelists: [],
    },
    lastWeek: { sunday: 250, wednesday: 190, offering: '$7,125', building: '$87,450 (35%)' },
    anniversaries: ['John & Sarah Miller – 15 yrs'],
    birthdays: ['John Smith – May 3'],
    groups: [{ key: 'group-1', name: 'Group 1', email: 'group1@capshawchurch.org', leader: 'Hunter Reece', note: '' }],
    serviceTimes: 'Sunday AM Classes – 9:00',
    elders: [{ name: 'Barry Britnell', duties: [] }],
    deacons: [{ name: 'Blair Kiel', duties: ['Grounds'] }],
    emailContacts: [{ key: 'elders', label: 'Elder Correspondence', email: 'elders@capshawchurch.org' }],
    footer: { address: [], phone: '', website: '', social: [] },
    ...overrides,
  };
}

function mockApi(bulletin = bulletinFor()) {
  const fetchMock = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, bulletin }) })
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => { vi.restoreAllMocks(); });

// Testing Library collapses whitespace when matching, which would make a
// two-line prayer list indistinguishable from a one-line one. These lists are
// one entry per line, so the newlines are the thing under test.
const exactly = value => (_content, element) => element.value === value;

describe('the weekly newsletter screen', () => {
  test('shows the week it is composing, and both halves of it', async () => {
    mockApi();
    render(<WeeklyBulletinView canWrite />);

    expect(await screen.findByText('May 3, 2026')).toBeInTheDocument();

    // The typed half arrives in editable boxes, one entry per line.
    expect(screen.getByDisplayValue(exactly('Dean Coffield\nRuby Rundt'))).toBeInTheDocument();
    expect(screen.getByDisplayValue('$7,125')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Hunter Reece')).toBeInTheDocument();

    // The queried half is shown, not offered for editing, and says where it
    // comes from so nobody retypes it here.
    expect(screen.getByText('• Potluck May 10 at 6:00 PM')).toBeInTheDocument();
    expect(screen.getByText('• Sunday attendance: 250')).toBeInTheDocument();
    expect(screen.getByText('• Blair Kiel — Grounds')).toBeInTheDocument();
    expect(screen.getAllByText(/^from /).length).toBeGreaterThan(3);
  });

  test('says when a week is only carried forward, so it is not mistaken for saved', async () => {
    mockApi(bulletinFor({ saved: false, carriedFrom: '2026-04-26' }));
    render(<WeeklyBulletinView canWrite />);
    expect(await screen.findByText(/showing the prayer lists from 2026-04-26/)).toBeInTheDocument();
  });

  test('says when a week is saved', async () => {
    mockApi(bulletinFor({ saved: true }));
    render(<WeeklyBulletinView canWrite />);
    expect(await screen.findByText('Saved for this week.')).toBeInTheDocument();
  });

  test('saving sends the typed half back, and nothing else', async () => {
    const fetchMock = mockApi();
    render(<WeeklyBulletinView canWrite />);
    await screen.findByText('May 3, 2026');

    fireEvent.change(screen.getByDisplayValue(exactly('Dean Coffield\nRuby Rundt')), {
      target: { value: 'Dean Coffield' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(([, opts]) => opts?.method === 'PUT');
      expect(put).toBeTruthy();
      const body = JSON.parse(put[1].body);
      expect(body.ongoing).toBe('Dean Coffield');
      expect(body.offering).toBe('$7,125');
      expect(body.group_notes['group-1'].leader).toBe('Hunter Reece');
      // The queried sections are not the screen's to send back.
      expect(body.reminders).toBeUndefined();
      expect(body.elders).toBeUndefined();
    });
  });

  test('moving weeks asks for the Sunday of whatever day is picked', async () => {
    const fetchMock = mockApi();
    render(<WeeklyBulletinView canWrite />);
    await screen.findByText('May 3, 2026');

    // A Wednesday belongs to the Sunday before it.
    fireEvent.change(screen.getByDisplayValue(/^\d{4}-\d{2}-\d{2}$/), { target: { value: '2026-05-13' } });

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/api/bulletin/2026-05-10'))).toBe(true);
    });
  });

  test('somebody who may not write it gets no Save button and no editable boxes', async () => {
    mockApi();
    render(<WeeklyBulletinView canWrite={false} />);
    await screen.findByText('May 3, 2026');

    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.getByDisplayValue(exactly('Dean Coffield\nRuby Rundt'))).toBeDisabled();
    expect(screen.getByText(/You can read the newsletter but not write it/)).toBeInTheDocument();

    // Exporting is still offered — the server decides whether it is allowed.
    expect(screen.getByRole('button', { name: 'Export Word' })).toBeInTheDocument();
  });

  test('an error from the server is shown rather than swallowed', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({ ok: false, json: () => Promise.resolve({ success: false, error: 'Nope' }) })
    ));
    render(<WeeklyBulletinView canWrite />);
    expect(await screen.findByText('Nope')).toBeInTheDocument();
  });
});
