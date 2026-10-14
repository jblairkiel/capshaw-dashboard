import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, test, expect, vi, afterEach } from 'vitest';
import RotationsView from '../components/RotationsView';

const PEOPLE = [
  { id: 1, name: 'Ann Bell' }, { id: 2, name: 'Beth Cole' }, { id: 3, name: 'Cara Dean' }, { id: 4, name: 'Ruth Hale' },
];

const card = (over = {}) => ({
  id: 7, name: 'Baby showers', description: 'Hosting the next baby shower.', active: true, memberCount: 3,
  nextUp: { directoryId: 1, name: 'Ann Bell' }, nextTurn: null, youAreNext: false, youAreIn: false, canRun: false, ...over,
});

const member = (directoryId, name, place, over = {}) => ({
  directoryId, name, place, sittingOut: false, next: place === 1, mine: false, ...over,
});

const detail = (over = {}) => ({
  id: 7, name: 'Baby showers', description: 'Hosting the next baby shower.', active: true,
  canRun: false, canManage: false,
  nextUp: { directoryId: 1, name: 'Ann Bell' },
  members: [member(1, 'Ann Bell', 1), member(2, 'Beth Cole', 2), member(3, 'Cara Dean', 3)],
  coordinators: [{ directoryId: 4, name: 'Ruth Hale' }],
  upcoming: [],
  history: [{ id: 50, directoryId: 3, name: 'Cara Dean', date: '2026-09-01', note: 'Fellowship hall', upcoming: false, mine: false }],
  ...over,
});

// Answers each request from `routes` — a function of (url, options) — and
// records them.
function mockApi(routes) {
  const fetchMock = vi.fn((url, opts = {}) => {
    const body = routes(String(url), opts);
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const calls = (fetchMock, method, path) => fetchMock.mock.calls.filter(([u, o = {}]) => (o.method || 'GET') === method && String(u) === path);

afterEach(() => vi.unstubAllGlobals());

describe('the list of rotations', () => {
  test('shows each rotation with who is next, and says when it is you', async () => {
    mockApi(() => ({ success: true, canManage: false, rotations: [
      card(),
      card({ id: 8, name: 'Ladies\' class teachers', nextUp: { directoryId: 9, name: 'Me Myself' }, youAreNext: true,
        nextTurn: { id: 1, name: 'Ruth Hale', date: '2026-11-08' } }),
    ] }));
    render(<RotationsView />);

    const list = await screen.findByRole('list', { name: 'Rotations' });
    expect(within(list).getByRole('button', { name: 'Open Baby showers' })).toHaveTextContent('Next up: Ann Bell');
    expect(within(list).getByRole('button', { name: 'Open Ladies\' class teachers' })).toHaveTextContent('That\'s you');
    expect(screen.getByText(/Coming up: Ruth Hale/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('You are next up on Ladies\' class teachers');
    expect(screen.queryByRole('button', { name: 'Start a rotation' })).not.toBeInTheDocument();
  });

  test('whoever holds Rotations can start one, with coordinators', async () => {
    const fetchMock = mockApi((url, opts) => {
      if (url === '/api/rotations/people') return { success: true, people: PEOPLE };
      if (url === '/api/rotations' && opts.method === 'POST') return { success: true, rotation: detail({ id: 9, name: 'Teachers', canRun: true, canManage: true, members: [], nextUp: null }) };
      if (url === '/api/rotations/9') return { success: true, rotation: detail({ id: 9, name: 'Teachers', canRun: true, canManage: true, members: [], nextUp: null }) };
      return { success: true, canManage: true, rotations: [] };
    });
    render(<RotationsView />);

    fireEvent.click(await screen.findByRole('button', { name: 'Start a rotation' }));
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Teachers' } });
    fireEvent.change(screen.getByLabelText('Choose a coordinator'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start it' }));

    await waitFor(() => expect(calls(fetchMock, 'POST', '/api/rotations')).toHaveLength(1));
    expect(JSON.parse(calls(fetchMock, 'POST', '/api/rotations')[0][1].body)).toEqual({ name: 'Teachers', description: '', coordinatorIds: [4] });
    // It opens on the new rotation.
    expect(await screen.findByRole('heading', { name: 'Teachers' })).toBeInTheDocument();
  });
});

describe('one rotation, as a member', () => {
  test('shows next up, the line, and the history, with no controls', async () => {
    mockApi(url => url === '/api/rotations/7'
      ? { success: true, rotation: detail() }
      : { success: true, canManage: false, rotations: [card()] });
    render(<RotationsView initialRotationId={7} />);

    expect(await screen.findByRole('heading', { name: 'Baby showers' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Next up' })).toHaveTextContent('Ann Bell');
    const line = screen.getByRole('list', { name: 'Baby showers in order' });
    expect(within(line).getAllByRole('listitem').map(li => li.textContent)).toEqual([
      expect.stringContaining('Ann Bell'), expect.stringContaining('Beth Cole'), expect.stringContaining('Cara Dean'),
    ]);
    expect(screen.getByText('Coordinated by Ruth Hale')).toBeInTheDocument();
    expect(screen.getByText('Fellowship hall')).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Give a turn' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Move .* up/ })).not.toBeInTheDocument();
  });
});

describe('one rotation, as its coordinator', () => {
  function coordinator(extra = () => null) {
    let current = detail({ canRun: true, members: detail().members.map(m => ({ ...m, hasEmail: m.directoryId !== 2 })) });
    return mockApi((url, opts) => {
      const answer = extra(url, opts);
      if (answer) { if (answer.rotation) current = answer.rotation; return answer; }
      if (url === '/api/rotations/people') return { success: true, people: PEOPLE };
      if (url === '/api/rotations/7') return { success: true, rotation: current };
      return { success: true, canManage: false, rotations: [card({ canRun: true })] };
    });
  }

  test('gives the turn to whoever is next, and says who has been told', async () => {
    const after = detail({
      canRun: true, nextUp: { directoryId: 2, name: 'Beth Cole' },
      members: [member(2, 'Beth Cole', 1), member(3, 'Cara Dean', 2), member(1, 'Ann Bell', 3, { next: false })],
    });
    const fetchMock = coordinator((url, opts) => (url === '/api/rotations/7/turns' && opts.method === 'POST'
      ? { success: true, rotation: after, told: { directoryId: 2, name: 'Beth Cole', emailed: true, notified: true } }
      : null));
    render(<RotationsView initialRotationId={7} />);

    const form = await screen.findByRole('form', { name: 'Give a turn' });
    fireEvent.change(within(form).getByLabelText('Note (optional)'), { target: { value: 'At church' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Give the turn to Ann Bell' }));

    expect(await screen.findByText('Beth Cole is next up and has been emailed to say so.')).toBeInTheDocument();
    const sent = JSON.parse(calls(fetchMock, 'POST', '/api/rotations/7/turns')[0][1].body);
    expect(sent).toMatchObject({ note: 'At church' });
    expect(sent.directoryId).toBeUndefined();
    expect(sent.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(screen.getByRole('region', { name: 'Next up' })).toHaveTextContent('Beth Cole');
  });

  test('can give it to somebody else instead, who is named on the button', async () => {
    const fetchMock = coordinator((url, opts) => (url === '/api/rotations/7/turns' && opts.method === 'POST'
      ? { success: true, rotation: detail({ canRun: true }), told: null }
      : null));
    render(<RotationsView initialRotationId={7} />);

    const form = await screen.findByRole('form', { name: 'Give a turn' });
    fireEvent.change(within(form).getByLabelText('To'), { target: { value: '3' } });
    expect(within(form).getByText(/Cara Dean goes to the back of the line, and Ann Bell stays next up/)).toBeInTheDocument();
    fireEvent.click(within(form).getByRole('button', { name: 'Give the turn to Cara Dean' }));
    await waitFor(() => expect(calls(fetchMock, 'POST', '/api/rotations/7/turns')).toHaveLength(1));
    expect(JSON.parse(calls(fetchMock, 'POST', '/api/rotations/7/turns')[0][1].body).directoryId).toBe(3);
  });

  test('moves people, sends them to the back, sits them out, and flags who has no email', async () => {
    const fetchMock = coordinator(url => (url.startsWith('/api/rotations/7/') && url !== '/api/rotations/7/turns'
      ? { success: true, rotation: detail({ canRun: true }), told: null }
      : null));
    render(<RotationsView initialRotationId={7} />);
    const line = await screen.findByRole('list', { name: 'Baby showers in order' });

    expect(within(line).getAllByText('No email')).toHaveLength(1);

    fireEvent.click(within(line).getByRole('button', { name: 'Move Beth Cole up' }));
    await waitFor(() => expect(calls(fetchMock, 'PUT', '/api/rotations/7/order')).toHaveLength(1));
    expect(JSON.parse(calls(fetchMock, 'PUT', '/api/rotations/7/order')[0][1].body)).toEqual({ order: [2, 1, 3] });

    fireEvent.click(within(line).getAllByRole('button', { name: 'Send to the back' })[0]);
    await waitFor(() => expect(calls(fetchMock, 'POST', '/api/rotations/7/members/1/back')).toHaveLength(1));

    fireEvent.click(within(screen.getByRole('list', { name: 'Baby showers in order' })).getAllByRole('button', { name: 'Sit out' })[1]);
    await waitFor(() => expect(calls(fetchMock, 'PATCH', '/api/rotations/7/members/2')).toHaveLength(1));
    expect(JSON.parse(calls(fetchMock, 'PATCH', '/api/rotations/7/members/2')[0][1].body)).toEqual({ sittingOut: true });
  });

  test('adds somebody from the directory, offering only people not already in it', async () => {
    const fetchMock = coordinator((url, opts) => (url === '/api/rotations/7/members' && opts.method === 'POST'
      ? { success: true, rotation: detail({ canRun: true }), told: null }
      : null));
    render(<RotationsView initialRotationId={7} />);

    const picker = await screen.findByLabelText('Add somebody to the back');
    await waitFor(() => expect(within(picker).getAllByRole('option').map(o => o.textContent)).toEqual(['Add somebody to the back…', 'Ruth Hale']));
    fireEvent.change(picker, { target: { value: '4' } });
    fireEvent.click(within(picker.closest('form')).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(calls(fetchMock, 'POST', '/api/rotations/7/members')).toHaveLength(1));
    expect(JSON.parse(calls(fetchMock, 'POST', '/api/rotations/7/members')[0][1].body)).toEqual({ directoryIds: [4] });
  });

  test('cancelling an upcoming turn puts them back at the front', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const booked = detail({ canRun: true, upcoming: [{ id: 60, directoryId: 1, name: 'Ann Bell', date: '2026-11-08', note: '', upcoming: true, mine: false }] });
    let current = booked;
    const fetchMock = mockApi((url, opts) => {
      if (url === '/api/rotations/7/turns/60?requeue=1' && opts.method === 'DELETE') { current = detail({ canRun: true }); return { success: true, rotation: current }; }
      if (url === '/api/rotations/people') return { success: true, people: PEOPLE };
      if (url === '/api/rotations/7') return { success: true, rotation: current };
      return { success: true, canManage: false, rotations: [card({ canRun: true })] };
    });
    render(<RotationsView initialRotationId={7} />);

    const upcoming = await screen.findByRole('region', { name: 'Upcoming' });
    fireEvent.click(within(upcoming).getByRole('button', { name: 'Cancel' }));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/back to the front of the line/));
    await waitFor(() => expect(calls(fetchMock, 'DELETE', '/api/rotations/7/turns/60?requeue=1')).toHaveLength(1));
  });

  test('a coordinator cannot retire, delete or change coordinators', async () => {
    coordinator();
    render(<RotationsView initialRotationId={7} />);
    await screen.findByRole('region', { name: 'Look after this rotation' });
    expect(screen.getByRole('button', { name: 'Change the name or description' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retire it' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete it' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Add a coordinator')).not.toBeInTheDocument();
  });

  test('"Let them know" tells whoever is next', async () => {
    const fetchMock = coordinator((url, opts) => (url === '/api/rotations/7/remind' && opts.method === 'POST'
      ? { success: true, rotation: detail({ canRun: true }), told: { name: 'Ann Bell', emailed: false, notified: false } }
      : null));
    render(<RotationsView initialRotationId={7} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Let Ann Bell know they are next' }));
    expect(await screen.findByText(/Ann Bell is next up, but has no email address or account here — please let them know in person/)).toBeInTheDocument();
    expect(calls(fetchMock, 'POST', '/api/rotations/7/remind')).toHaveLength(1);
  });
});

describe('one rotation, as whoever holds Rotations', () => {
  test('retires it and changes its coordinators', async () => {
    let current = detail({ canRun: true, canManage: true });
    const fetchMock = mockApi((url, opts) => {
      if (url === '/api/rotations/people') return { success: true, people: PEOPLE };
      if (url === '/api/rotations/7' && opts.method === 'PATCH') { current = { ...current, active: false }; return { success: true, rotation: current }; }
      if (url === '/api/rotations/7/coordinators') { current = { ...current, coordinators: [] }; return { success: true, rotation: current }; }
      if (url === '/api/rotations/7') return { success: true, rotation: current };
      return { success: true, canManage: true, rotations: [card({ canRun: true })] };
    });
    render(<RotationsView initialRotationId={7} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Remove Ruth Hale as coordinator' }));
    await waitFor(() => expect(calls(fetchMock, 'PUT', '/api/rotations/7/coordinators')).toHaveLength(1));
    expect(JSON.parse(calls(fetchMock, 'PUT', '/api/rotations/7/coordinators')[0][1].body)).toEqual({ directoryIds: [] });

    fireEvent.click(screen.getByRole('button', { name: 'Retire it' }));
    expect(await screen.findByRole('button', { name: 'Bring it back' })).toBeInTheDocument();
    expect(JSON.parse(calls(fetchMock, 'PATCH', '/api/rotations/7')[0][1].body)).toEqual({ active: false });
  });
});
