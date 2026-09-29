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
      shutIns: [], pregnancies: [],
      // The exports set this one as a paragraph, so it arrives as bold/plain runs.
      evangelists: [{ text: 'Samuel Lopez', bold: true }, { text: ' – Ocosingo, Mexico', bold: false }],
      evangelistLines: ['Samuel Lopez – Ocosingo, Mexico'],
    },
    lastWeek: { sunday: 250, wednesday: 190, offering: '$7,125', building: '$87,450 (35%)' },
    anniversaries: ['John & Sarah Miller – 15 yrs'],
    birthdays: ['John Smith – May 3'],
    groups: [{ key: 'group-1', name: 'Group 1', email: 'group1@capshawchurch.org', leader: 'Hunter Reece', note: '' }],
    serviceTimes: 'Sunday AM Classes – 9:00',
    dutyRoster: {
      sunday: {
        dates: ['2026-05-03', '2026-05-10'],
        jobs: [
          { job: 'Song Leader', names: ['Blair Kiel', ''] },
          { job: 'Sermon',      names: ['', ''] },
        ],
      },
      wednesday: { dates: ['2026-05-06', '2026-05-13'], jobs: [{ job: 'Speaker', names: ['', ''] }] },
    },
    leadership: {
      elders:  [{ text: 'Barry Britnell', bold: true }, { text: ' (256) 541-3405', bold: false }],
      evangelist: { name: 'Buc Chumbley', phone: '(256) 777-1065' },
      deacons: [{ text: 'Blair Kiel', bold: true }, { text: ' (Grounds)', bold: false }],
    },
    contacts: {
      groups: [{ key: 'elders', label: 'Elder correspondence', email: 'elders@capshawchurch.org' }],
      admins: [{ name: 'Blair Kiel', email: 'jblairkiel@gmail.com' }],
    },
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
    expect(screen.getByText('• Blair Kiel (Grounds)')).toBeInTheDocument();
    // Only the filled roster slots are previewed; the exports print the blanks.
    expect(screen.getByText('• Song Leader, May 3: Blair Kiel')).toBeInTheDocument();
    expect(screen.queryByText(/Sermon/)).toBeNull();
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

  test('the evangelists arrive as the lines that were typed, not as export segments (#94)', async () => {
    const fetchMock = mockApi();
    render(<WeeklyBulletinView canWrite />);
    await screen.findByText('May 3, 2026');
    expect(screen.getByDisplayValue('Samuel Lopez – Ocosingo, Mexico')).toBeInTheDocument();
    expect(screen.queryByDisplayValue(/object Object/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      const put = fetchMock.mock.calls.find(([, opts]) => opts?.method === 'PUT');
      expect(JSON.parse(put[1].body).evangelists).toBe('Samuel Lopez – Ocosingo, Mexico');
    });
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

  test('when Contributions has last week’s total, the offering comes from there and is not typed', async () => {
    mockApi(bulletinFor({
      lastWeek: { sunday: 250, wednesday: 190, offering: '$6,210', offeringTyped: '$7,125', offeringFromContributions: '$6,210', building: '' },
    }));
    render(<WeeklyBulletinView canWrite />);
    await screen.findByText('May 3, 2026');

    expect(screen.getByText('• Offering: $6,210')).toBeInTheDocument();
    expect(screen.getByText(/from Contributions\. To change it, change it there/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('$7,125')).not.toBeInTheDocument();
  });

  test('without a total on file, the offering is typed and says where it could come from', async () => {
    mockApi();
    render(<WeeklyBulletinView canWrite />);
    await screen.findByText('May 3, 2026');
    expect(screen.getByPlaceholderText('$7,125')).toHaveValue('$7,125');
    expect(screen.getByText(/No total for last week is on the Contributions page yet/)).toBeInTheDocument();
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

  describe('emailing it', () => {
    const LISTS = [
      { key: 'elders', name: 'Elders', reachable: 3, missing: 0 },
      { key: 'announcements', name: 'Announcements', reachable: 120, missing: 4 },
    ];

    // Answers each call by what it is for; `sent` is what this week already went to.
    function mockEmailApi({ bulletin = bulletinFor(), sent = [], sendFails = false } = {}) {
      const reply = body => Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, ...body }) });
      const fetchMock = vi.fn((url, options = {}) => {
        const u = String(url);
        if (u.endsWith('/mail-lists')) return reply({ lists: LISTS });
        if (u.endsWith('/emails'))     return reply({ sent });
        if (u.endsWith('/email')) {
          if (sendFails) return Promise.resolve({ ok: false, json: () => Promise.resolve({ success: false, error: 'No such mailing list' }) });
          return reply({ queued: 120, missing: [], list: { key: 'announcements', name: 'Announcements' },
                         sent: [{ list: 'announcements', count: 120, at: '2026-05-01 14:00:00' }] });
        }
        if (options.method === 'PUT') return reply({ bulletin: { ...bulletin, saved: true } });
        return reply({ bulletin });
      });
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    }

    test('is only offered to whoever writes the newsletter', async () => {
      mockEmailApi();
      render(<WeeklyBulletinView canWrite={false} />);
      await screen.findByText('May 3, 2026');
      expect(screen.queryByRole('button', { name: 'Email newsletter' })).toBeNull();
    });

    test('picks Announcements, says how many can be reached, and who cannot', async () => {
      mockEmailApi();
      render(<WeeklyBulletinView canWrite />);
      fireEvent.click(await screen.findByRole('button', { name: 'Email newsletter' }));

      expect(await screen.findByRole('button', { name: 'Send to 120 people' })).toBeInTheDocument();
      expect(screen.getByText(/4 on this list have no email address/)).toBeInTheDocument();

      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'elders' } });
      expect(screen.getByRole('button', { name: 'Send to 3 people' })).toBeInTheDocument();
    });

    test('saves what is typed first, then sends to the chosen list', async () => {
      const fetchMock = mockEmailApi();
      render(<WeeklyBulletinView canWrite />);
      fireEvent.click(await screen.findByRole('button', { name: 'Email newsletter' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Send to 120 people' }));

      expect(await screen.findByText(/Queued for 120 people on Announcements/)).toBeInTheDocument();
      const calls = fetchMock.mock.calls.map(([url, o = {}]) => `${o.method || 'GET'} ${url}`);
      // The week is whichever Sunday it is today; the order is what matters.
      const put  = calls.findIndex(c => /^PUT \/api\/bulletin\/\d{4}-\d{2}-\d{2}$/.test(c));
      const post = calls.findIndex(c => /^POST \/api\/bulletin\/\d{4}-\d{2}-\d{2}\/email$/.test(c));
      expect(put).toBeGreaterThan(-1);
      expect(post).toBeGreaterThan(put);
      const [, options] = fetchMock.mock.calls[post];
      expect(JSON.parse(options.body)).toEqual({ list: 'announcements' });
    });

    test('warns before sending the same week to the same list twice', async () => {
      mockEmailApi({ sent: [{ list: 'announcements', count: 118, at: '2026-05-01 14:00:00' }] });
      render(<WeeklyBulletinView canWrite />);
      fireEvent.click(await screen.findByRole('button', { name: 'Email newsletter' }));

      expect(await screen.findByText(/This week already went to Announcements \(118\)/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Send again to 120 people' })).toBeInTheDocument();
    });

    test('a refusal from the server is shown', async () => {
      mockEmailApi({ sendFails: true });
      render(<WeeklyBulletinView canWrite />);
      fireEvent.click(await screen.findByRole('button', { name: 'Email newsletter' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Send to 120 people' }));
      expect(await screen.findByText('No such mailing list')).toBeInTheDocument();
    });
  });
});
