import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { describe, test, expect, vi } from 'vitest';
import GroupsView from '../components/GroupsView';

// The page shows three different people three different things, and the server
// is what decides which — `canManage` and each group's `perms` come back with
// the data. So the tests below vary the payload rather than the account.

const GROUPS = [
  {
    id: 1, key: 'group-1', name: 'North Harvest', description: '', meets: 'Second Sunday',
    location: 'The Harris home', email: 'group-1@capshawchurch.org', active: true, memberCount: 8,
    leaders: [{ name: 'Lee Leader', role: 'leader', roleLabel: 'Leader' }],
  },
  {
    id: 2, key: 'group-2', name: 'Wall Triana', description: '', meets: '', location: '',
    email: '', active: true, memberCount: 5, leaders: [],
  },
];

const UPCOMING = [{
  id: 90, groupId: 1, groupName: 'North Harvest', title: 'Fellowship meal',
  date: '2099-05-01', time: '17:00', location: 'The Harris home', hostName: '',
  status: 'published', rsvpEnabled: true, signupEnabled: true, signupTitle: 'What to bring',
  comments: 2, summary: { yes: 3, no: 0, maybe: 1, guests: 2, attending: 5 }, rsvp: null,
}];

const EVENT_DETAIL = {
  success: true,
  event: {
    ...UPCOMING[0],
    description: 'Come and eat.',
    rsvps: [{ id: 1, userId: 5, directoryId: 5, name: 'Lee Leader', response: 'yes', guests: 2, note: '', recorded: false }],
    signups: [
      { id: 7, label: 'Dessert', notes: '', needed: 1, claimed: 0, remaining: 1, claims: [] },
      { id: 8, label: 'Drinks',  notes: '', needed: 2, claimed: 2, remaining: 0,
        claims: [{ id: 3, userId: null, directoryId: 6, mine: false, recorded: true, name: 'Jo Member', detail: 'lemonade', quantity: 2 }] },
    ],
    comments: [],
    canManage: false,
  },
};

function landing(overrides = {}) {
  return {
    success: true,
    groups: GROUPS,
    mine: [{ ...GROUPS[0], myRole: 'member' }],
    upcoming: UPCOMING,
    roles: [],
    canManage: false,
    linkedToDirectory: true,
    ...overrides,
  };
}

function detail(overrides = {}) {
  return {
    success: true,
    group: GROUPS[0],
    perms: { manages: false, leads: false, belongs: true, myRole: 'member', canSeeRoll: true },
    members: [
      { id: 11, directoryId: 5, name: 'Lee Leader', email: 'lee@example.com', role: 'leader', roleLabel: 'Leader' },
      { id: 12, directoryId: 6, name: 'Jo Member',  email: '',                role: 'member', roleLabel: 'Member' },
    ],
    events: UPCOMING,
    candidates: [],
    roles: [],
    ...overrides,
  };
}

function mockApi({ list = landing(), one = detail(), event = EVENT_DETAIL, onCall } = {}) {
  const fetchMock = vi.fn((url, options) => {
    onCall?.(url, options);
    let body = list;
    if (/\/events\/\d+$/.test(url))          body = event;
    else if (url.includes('/generate'))      body = { success: true, created: [{ key: 'group-1' }], skipped: [], assigned: { placed: 12 }, groups: GROUPS };
    else if (url.includes('/comments/'))     body = { success: true, comments: [], canReply: true, canModerate: false, maxLength: 2000 };
    else if (url.includes('/rsvp'))          body = { success: true, rsvp: { response: 'yes', guests: 0 }, summary: UPCOMING[0].summary, rsvps: [] };
    else if (url.includes('/signups'))       body = { success: true, signups: event.event.signups };
    else if (url.includes('/sync-mail'))     body = { success: true, synced: 8, mailGroupId: 3 };
    else if (url.includes('/members'))       body = { success: true, members: one.members };
    else if (/\/api\/groups\/\d+$/.test(url)) body = one;
    return Promise.resolve({ json: () => Promise.resolve(body) });
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('confirm', () => true);
  return fetchMock;
}

const MEMBER = { id: 5, name: 'Jo Member', role: 'approved', areas: [] };

describe('the landing page', () => {
  test('separates the groups somebody is in from the rest', async () => {
    mockApi();
    render(<GroupsView user={MEMBER} />);

    expect(await screen.findByText('My groups')).toBeInTheDocument();
    const mine = screen.getByText('My groups').closest('section');
    expect(within(mine).getByText('North Harvest')).toBeInTheDocument();

    const others = screen.getByText('The other groups').closest('section');
    expect(within(others).getByText('Wall Triana')).toBeInTheDocument();
  });

  test('shows what is coming up in those groups', async () => {
    mockApi();
    render(<GroupsView user={MEMBER} />);
    expect(await screen.findByText('Fellowship meal')).toBeInTheDocument();
    expect(screen.getByText('5 expected')).toBeInTheDocument();
    expect(screen.getByText(/💬 2/)).toBeInTheDocument();
  });

  test('an account not yet matched to the directory is told why it is in nothing', async () => {
    mockApi({ list: landing({ mine: [], upcoming: [], linkedToDirectory: false }) });
    render(<GroupsView user={MEMBER} />);
    expect(await screen.findByText(/has not been matched to a directory entry/i)).toBeInTheDocument();
  });

  test('a member in no group is told who can add them', async () => {
    mockApi({ list: landing({ mine: [], upcoming: [] }) });
    render(<GroupsView user={MEMBER} />);
    expect(await screen.findByText(/not in a group yet/i)).toBeInTheDocument();
  });

  test('the generator is shown only to whoever looks after every group', async () => {
    mockApi();
    const { unmount } = render(<GroupsView user={MEMBER} />);
    expect(await screen.findByText('My groups')).toBeInTheDocument();
    expect(screen.queryByText('Generate the groups')).not.toBeInTheDocument();
    unmount();

    mockApi({ list: landing({ canManage: true }) });
    render(<GroupsView user={MEMBER} />);
    expect(await screen.findByText('Generate the groups')).toBeInTheDocument();
  });

  test('a failure to load says so rather than showing an empty page', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ success: false, error: 'Database is away' }) })));
    render(<GroupsView user={MEMBER} />);
    expect(await screen.findByText('Database is away')).toBeInTheDocument();
  });
});

describe('generating a set of groups', () => {
  test('sends what was asked for and reports what it made', async () => {
    const fetchMock = mockApi({ list: landing({ canManage: true }) });
    render(<GroupsView user={MEMBER} />);

    fireEvent.change(await screen.findByLabelText('How many'), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText('Email domain'), { target: { value: 'capshawchurch.org' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c => String(c[0]).includes('/generate'));
      expect(JSON.parse(post[1].body)).toMatchObject({
        count: 8, prefix: 'Group', emailDomain: 'capshawchurch.org', assignMembers: true,
      });
    });
    expect(await screen.findByText(/placing 12 people/)).toBeInTheDocument();
  });

  test('says plainly that households are kept together and nobody is moved', async () => {
    mockApi({ list: landing({ canManage: true }) });
    render(<GroupsView user={MEMBER} />);
    expect(await screen.findByText(/Households stay together/i)).toBeInTheDocument();
    expect(screen.getByText(/nobody already on a roll is moved/i)).toBeInTheDocument();
  });
});

describe('one group', () => {
  async function openGroup(options) {
    const fetchMock = mockApi(options);
    render(<GroupsView user={MEMBER} />);
    fireEvent.click(await screen.findByText('My groups'));
    const mine = screen.getByText('My groups').closest('section');
    fireEvent.click(within(mine).getByText('North Harvest'));
    await screen.findByText('Who is in it');
    return fetchMock;
  }

  test('a member sees the roll and the meetings but no leader buttons', async () => {
    await openGroup();
    expect(screen.getByText('Lee Leader')).toBeInTheDocument();
    expect(screen.getByText(/No address on file/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Post a meeting' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
  });

  test('a leader gets the post button and the roll controls', async () => {
    await openGroup({
      one: detail({
        perms: { manages: false, leads: true, belongs: true, myRole: 'leader', canSeeRoll: true },
        candidates: [{ id: 9, name: 'Sam New', email: 'sam@example.com' }],
      }),
    });

    expect(screen.getByRole('button', { name: 'Post a meeting' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit the group' })).toBeInTheDocument();
    expect(screen.getByLabelText("Jo Member's part in the group")).toBeInTheDocument();
  });

  test('a leader cannot hand the group to somebody — only the group manager can', async () => {
    await openGroup({
      one: detail({ perms: { manages: false, leads: true, belongs: true, myRole: 'leader', canSeeRoll: true } }),
    });

    const picker = screen.getByLabelText("Jo Member's part in the group");
    expect(within(picker).getByRole('option', { name: 'Leader' })).toBeDisabled();
    expect(within(picker).getByRole('option', { name: 'Host' })).not.toBeDisabled();
  });

  test('only the group manager is offered the mailing-list sync', async () => {
    await openGroup({
      one: detail({ perms: { manages: false, leads: true, belongs: true, myRole: 'leader', canSeeRoll: true } }),
    });
    expect(screen.queryByRole('button', { name: 'Sync the mailing list' })).not.toBeInTheDocument();
  });

  test('the group manager can put the mailing list back in step with the roll', async () => {
    const fetchMock = await openGroup({
      one: detail({ perms: { manages: true, leads: true, belongs: true, myRole: null, canSeeRoll: true } }),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Sync the mailing list' }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(c => String(c[0]).includes('/sync-mail') && c[1]?.method === 'POST')).toBe(true);
    });
  });

  test('somebody outside the group is told why they see nothing', async () => {
    mockApi({
      one: detail({
        perms: { manages: false, leads: false, belongs: false, myRole: null, canSeeRoll: false },
        members: [], events: [],
      }),
    });
    render(<GroupsView user={MEMBER} />);
    const others = (await screen.findByText('The other groups')).closest('section');
    fireEvent.click(within(others).getByText('Wall Triana'));

    expect(await screen.findByText(/You are not in this group/i)).toBeInTheDocument();
  });
});

// A generated email links straight to a group and, often, one meeting within
// it (server/mail/notify.js's groupLink). App.jsx reads that back and passes
// it down as these two props — the page should open right there rather than
// making the reader find it themselves.
describe('a deep link', () => {
  test('opens straight to the linked group, skipping the landing page', async () => {
    mockApi();
    render(<GroupsView user={MEMBER} initialGroupId={1} />);

    expect(await screen.findByText('Who is in it')).toBeInTheDocument();
    expect(screen.queryByText('My groups')).not.toBeInTheDocument();
  });

  test('and expands the linked meeting within it', async () => {
    mockApi();
    render(<GroupsView user={MEMBER} initialGroupId={1} initialEventId={90} />);

    await screen.findByText('Fellowship meal');
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  test('a group id with no matching meeting still opens the group, just not expanded', async () => {
    mockApi();
    render(<GroupsView user={MEMBER} initialGroupId={1} initialEventId={999} />);

    await screen.findByText('Fellowship meal');
    expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument();
  });
});

describe('a meeting', () => {
  async function openMeeting(options = {}) {
    const fetchMock = mockApi(options);
    render(<GroupsView user={MEMBER} />);
    fireEvent.click(await screen.findByText('Fellowship meal'));
    await screen.findByText('Come and eat.');
    return fetchMock;
  }

  test('opens into the invitation, the list and the conversation', async () => {
    await openMeeting();
    expect(screen.getByText('Can you come?')).toBeInTheDocument();
    expect(screen.getByText('What to bring')).toBeInTheDocument();
    expect(screen.getByText('Who is coming')).toBeInTheDocument();
    expect(screen.getByText('Comments')).toBeInTheDocument();
  });

  test('answering sends the response and the people being brought', async () => {
    const fetchMock = await openMeeting();

    fireEvent.change(screen.getByLabelText('People you are bringing'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Coming' }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c => String(c[0]).includes('/rsvp'));
      expect(JSON.parse(post[1].body)).toEqual({ response: 'yes', guests: 2 });
    });
  });

  test('the head count counts the people being brought, not just the answers', async () => {
    await openMeeting();
    expect(screen.getByText(/3 answered, 2 brought along/)).toBeInTheDocument();
  });

  test('something still needed can be claimed; something covered cannot', async () => {
    const fetchMock = await openMeeting();

    expect(screen.getByText('1 of 1 still needed')).toBeInTheDocument();
    expect(screen.getByText('Covered, thank you')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /I.{0,3}ll bring it/ })).toHaveLength(1);

    fireEvent.change(screen.getByLabelText('What you will bring for Dessert'), { target: { value: 'a pecan pie' } });
    fireEvent.click(screen.getByRole('button', { name: /I.{0,3}ll bring it/ }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c => String(c[0]).includes('/signups') && c[1]?.method === 'POST');
      expect(JSON.parse(post[1].body)).toMatchObject({ itemId: 7, detail: 'a pecan pie' });
    });
  });

  test('a member gets no leader controls on it', async () => {
    await openMeeting();
    expect(screen.queryByRole('button', { name: 'Post it to the group' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  test('a draft is marked as one, and its leader can post it', async () => {
    const draft = { ...UPCOMING[0], status: 'draft' };
    const fetchMock = mockApi({
      list: landing({ upcoming: [] }),
      one: detail({
        perms: { manages: false, leads: true, belongs: true, myRole: 'leader', canSeeRoll: true },
        events: [draft],
      }),
      event: { success: true, event: { ...EVENT_DETAIL.event, status: 'draft', canManage: true } },
    });

    render(<GroupsView user={MEMBER} />);
    const mine = (await screen.findByText('My groups')).closest('section');
    fireEvent.click(within(mine).getByText('North Harvest'));

    expect(await screen.findByText(/only leaders can see it/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Fellowship meal'));
    fireEvent.click(await screen.findByRole('button', { name: 'Post it to the group' }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(c => String(c[0]).includes('/publish'))).toBe(true);
    });
  });
});

// ─── Answers a leader writes down ─────────────────────────────────────────────
//
// Most of a congregation will never sign in. Their leader still has to be able
// to count them, so the meeting carries a way to write an answer down — and it
// is the leaders' alone.

describe('writing somebody down', () => {
  const LEADS = { manages: false, leads: true, belongs: true, myRole: 'leader', canSeeRoll: true };

  async function openAsLeader(extra = {}) {
    const fetchMock = mockApi({
      list: landing({ upcoming: [] }),
      one: detail({ perms: LEADS }),
      event: { success: true, event: { ...EVENT_DETAIL.event, canManage: true, ...extra } },
    });
    render(<GroupsView user={MEMBER} />);
    const mine = (await screen.findByText('My groups')).closest('section');
    fireEvent.click(within(mine).getByText('North Harvest'));
    fireEvent.click(await screen.findByText('Fellowship meal'));
    await screen.findByText('Come and eat.');
    return fetchMock;
  }

  test('a leader is shown who has not answered yet', async () => {
    await openAsLeader();
    // Lee has answered in the fixture, so only Jo is still to be heard from.
    expect(screen.getByText(/1 still to hear from/)).toBeInTheDocument();
    const picker = screen.getByLabelText('Who told you');
    expect(within(picker).getByRole('option', { name: 'Jo Member' })).toBeInTheDocument();
    expect(within(picker).queryByRole('option', { name: 'Lee Leader' })).not.toBeInTheDocument();
  });

  test('writing one down sends the person, not the account', async () => {
    const fetchMock = await openAsLeader();

    fireEvent.change(screen.getByLabelText('Who told you'), { target: { value: '6' } });
    fireEvent.click(within(screen.getByText(/still to hear from/).closest('div')).getByRole('button', { name: 'Coming' }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c => String(c[0]).includes('/rsvp'));
      expect(JSON.parse(post[1].body)).toEqual({ directoryId: 6, response: 'yes' });
    });
  });

  test('a member is never offered it', async () => {
    mockApi();
    render(<GroupsView user={MEMBER} />);
    fireEvent.click(await screen.findByText('Fellowship meal'));
    await screen.findByText('Come and eat.');

    expect(screen.queryByLabelText('Who told you')).not.toBeInTheDocument();
    expect(screen.queryByText(/still to hear from/)).not.toBeInTheDocument();
  });

  test('an answer held for you says who put it there', async () => {
    mockApi({
      event: { success: true, event: { ...EVENT_DETAIL.event, rsvp: { response: 'yes', guests: 0, recorded: true } } },
    });
    render(<GroupsView user={MEMBER} />);
    fireEvent.click(await screen.findByText('Fellowship meal'));

    expect(await screen.findByText(/leader wrote you down as coming/i)).toBeInTheDocument();
  });

  test('your own answer is not described as written down', async () => {
    mockApi({
      event: { success: true, event: { ...EVENT_DETAIL.event, rsvp: { response: 'yes', guests: 0, recorded: false } } },
    });
    render(<GroupsView user={MEMBER} />);
    fireEvent.click(await screen.findByText('Fellowship meal'));

    expect(await screen.findByText(/You said coming/i)).toBeInTheDocument();
    expect(screen.queryByText(/wrote you down/i)).not.toBeInTheDocument();
  });

  test('a leader can put somebody down for something still needed', async () => {
    const fetchMock = await openAsLeader();

    fireEvent.change(screen.getByLabelText('Put somebody down for Dessert'), { target: { value: '6' } });

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c => String(c[0]).includes('/signups') && c[1]?.method === 'POST');
      expect(JSON.parse(post[1].body)).toMatchObject({ itemId: 7, directoryId: 6 });
    });
  });

  test('nobody is offered for something already covered', async () => {
    await openAsLeader();
    expect(screen.queryByLabelText('Put somebody down for Drinks')).not.toBeInTheDocument();
  });

  test('a sign-up somebody else wrote down is marked as such', async () => {
    mockApi();
    render(<GroupsView user={MEMBER} />);
    fireEvent.click(await screen.findByText('Fellowship meal'));
    await screen.findByText('Come and eat.');

    expect(screen.getByText(/written down/)).toBeInTheDocument();
  });
});

describe('writing a meeting', () => {
  test('saves as a draft, with the sign-up list attached', async () => {
    const fetchMock = mockApi({
      one: detail({ perms: { manages: false, leads: true, belongs: true, myRole: 'leader', canSeeRoll: true } }),
    });
    render(<GroupsView user={MEMBER} />);
    const mine = (await screen.findByText('My groups')).closest('section');
    fireEvent.click(within(mine).getByText('North Harvest'));

    fireEvent.click(await screen.findByRole('button', { name: 'Post a meeting' }));
    fireEvent.change(screen.getByPlaceholderText('Fellowship meal'), { target: { value: 'Singing night' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add something needed' }));
    fireEvent.change(screen.getByPlaceholderText('Dessert'), { target: { value: 'Song books' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save as a draft' }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c => c[1]?.method === 'POST' && String(c[0]).endsWith('/events'));
      const sent = JSON.parse(post[1].body);
      expect(sent.title).toBe('Singing night');
      expect(sent.signupEnabled).toBe(true);
      expect(sent.signupItems).toEqual([{ label: 'Song books', notes: '', needed: 1 }]);
    });
  });

  test('says that nobody is told until it is posted', async () => {
    mockApi({ one: detail({ perms: { manages: false, leads: true, belongs: true, myRole: 'leader', canSeeRoll: true } }) });
    render(<GroupsView user={MEMBER} />);
    const mine = (await screen.findByText('My groups')).closest('section');
    fireEvent.click(within(mine).getByText('North Harvest'));

    fireEvent.click(await screen.findByRole('button', { name: 'Post a meeting' }));
    expect(screen.getByText(/Nobody is told until you post it/i)).toBeInTheDocument();
  });

  test('a title is required, and nothing is sent without one', async () => {
    const fetchMock = mockApi({ one: detail({ perms: { manages: false, leads: true, belongs: true, myRole: 'leader', canSeeRoll: true } }) });
    render(<GroupsView user={MEMBER} />);
    const mine = (await screen.findByText('My groups')).closest('section');
    fireEvent.click(within(mine).getByText('North Harvest'));

    fireEvent.click(await screen.findByRole('button', { name: 'Post a meeting' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save as a draft' }));

    expect(await screen.findByText(/a title is required/i)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(c => c[1]?.method === 'POST' && String(c[0]).endsWith('/events'))).toBe(false);
  });
});
