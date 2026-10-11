import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import MemberMatchView from '../components/MemberMatchView';

// The game shuffles at three points: which photo comes up next, whose turn it
// is within a family, and the order choices are offered in. Math.random
// pinned just under 1 makes every Fisher-Yates swap a no-op (j always lands
// on i itself), so the game plays out in the exact order the fixture below
// is written in — without that, a click has no way to know which button is
// the right one to press.
function withStableShuffle() {
  vi.spyOn(Math, 'random').mockReturnValue(0.999999);
}

const ROUNDS = [
  { photo: 'ray.jpg', members: [{ id: 1, name: 'Ray Owens' }] },
  { photo: 'harris-family.jpg', members: [{ id: 2, name: 'Jan Harris' }, { id: 3, name: 'Tommy Harris' }] },
  { photo: 'ann.jpg', members: [{ id: 4, name: 'Ann Lee' }] },
];
const HARRIS = ['Jan Harris', 'Tommy Harris'];

function mockRounds(rounds = ROUNDS) {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
    json: () => Promise.resolve({ success: true, rounds }),
  })));
}

// Which name the question on screen is asking for. The order is the game's to
// choose, so the tests read it off the page: the photo, and for a family
// photo which of its people (the stable shuffle keeps each family in the
// order written above).
function answer(rounds = ROUNDS) {
  const photo = decodeURIComponent(screen.getByRole('img').getAttribute('src').split('/').pop());
  const round = rounds.find(r => r.photo === photo);
  const nth = screen.queryByText(/person \d+ of \d+/)?.textContent.match(/person (\d+)/)[1];
  return round.members[nth ? Number(nth) - 1 : 0].name;
}
const choiceNames = () => screen.getAllByRole('button')
  .map(b => b.textContent).filter(t => !/^(Next|See results|Play again)$/.test(t));

beforeEach(() => { withStableShuffle(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function play(rounds = ROUNDS) {
  render(<MemberMatchView />);
  const seen = [];
  for (let i = 0; i < rounds.reduce((n, r) => n + r.members.length, 0); i++) {
    await screen.findByRole('img');
    await waitFor(() => expect(choiceNames().length).toBeGreaterThan(1));
    const target = answer(rounds);
    seen.push({ photo: screen.getByRole('img').getAttribute('src'), target, choices: choiceNames() });
    fireEvent.click(screen.getByRole('button', { name: target }));
    fireEvent.click(screen.getByRole('button', { name: /Next|See results/ }));
  }
  return seen;
}

describe('MemberMatchView — getting going', () => {
  test('a single photo asks "Who is this?", a family photo counts the person', async () => {
    mockRounds();
    render(<MemberMatchView />);
    await screen.findByRole('img', { name: 'Who is this?' });
    const prompts = [];
    for (let i = 0; i < 4; i++) {
      await waitFor(() => expect(choiceNames().length).toBeGreaterThan(1));
      prompts.push(screen.getByText(/^Who is this/).textContent);
      fireEvent.click(screen.getByRole('button', { name: answer() }));
      fireEvent.click(screen.getByRole('button', { name: /Next|See results/ }));
    }
    expect(prompts.filter(p => p === 'Who is this?')).toHaveLength(2);
    expect(prompts.filter(p => /person 1 of 2 in this photo/.test(p))).toHaveLength(1);
    expect(prompts.filter(p => /person 2 of 2 in this photo/.test(p))).toHaveLength(1);
  });

  test('a family is spread through the game, never asked back to back', async () => {
    mockRounds();
    const seen = await play();
    expect(seen.map(q => q.target).sort()).toEqual(['Ann Lee', 'Jan Harris', 'Ray Owens', 'Tommy Harris']);
    const photos = seen.map(q => q.photo);
    expect(photos.some((p, i) => i > 0 && p === photos[i - 1])).toBe(false);
    // And a family's own people still come in turn: person 1, then person 2.
    expect(seen.filter(q => q.photo.endsWith('harris-family.jpg')).map(q => q.target)).toEqual(HARRIS);
  });

  test('no question offers two names from one family, nor a relative of the person asked about', async () => {
    mockRounds();
    const seen = await play();
    for (const q of seen) {
      expect(q.choices).toContain(q.target);
      expect(q.choices.filter(n => HARRIS.includes(n)).length).toBeLessThanOrEqual(1);
      if (HARRIS.includes(q.target)) expect(q.choices.filter(n => HARRIS.includes(n))).toEqual([q.target]);
      expect(new Set(q.choices).size).toBe(q.choices.length);
    }
  });

  test('an empty library says so rather than showing a broken game', async () => {
    mockRounds([]);
    render(<MemberMatchView />);
    expect(await screen.findByText(/No member photos are on file yet/i)).toBeInTheDocument();
  });

  test('a load failure (e.g. account pending approval) is reported', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      json: () => Promise.resolve({ success: false, error: 'Account pending approval' }),
    })));
    render(<MemberMatchView />);
    expect(await screen.findByText('Account pending approval')).toBeInTheDocument();
  });
});

describe('MemberMatchView — answering', () => {
  async function ready() {
    mockRounds();
    render(<MemberMatchView />);
    await screen.findByRole('img');
    await waitFor(() => expect(choiceNames().length).toBeGreaterThan(1));
    const target = answer();
    return { target, wrong: choiceNames().find(n => n !== target) };
  }

  test('the right choice is marked correct and the score moves', async () => {
    const { target } = await ready();
    expect(screen.getByText('0 / 0 correct')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: target }));
    expect(screen.getByRole('button', { name: target })).toHaveClass('bg-emerald-50');
    expect(screen.getByText('1 / 1 correct')).toBeInTheDocument();
  });

  test('a wrong choice is marked wrong, and the real answer is shown', async () => {
    const { target, wrong } = await ready();
    fireEvent.click(screen.getByRole('button', { name: wrong }));
    expect(screen.getByRole('button', { name: wrong })).toHaveClass('bg-red-50');
    expect(screen.getByRole('button', { name: target })).toHaveClass('bg-emerald-50');
    expect(screen.getByText('0 / 1 correct')).toBeInTheDocument();
  });

  test('once answered, the choices lock and only Next moves you on', async () => {
    const { target, wrong } = await ready();
    fireEvent.click(screen.getByRole('button', { name: target }));
    fireEvent.click(screen.getByRole('button', { name: wrong }));
    // The second click did nothing: still counted as one answer, one correct.
    expect(screen.getByText('1 / 1 correct')).toBeInTheDocument();
    expect(choiceNames().every(n => screen.getByRole('button', { name: n }).disabled)).toBe(true);
  });
});

describe('MemberMatchView — finishing and playing again', () => {
  test('finishing shows a final score and offers to play again', async () => {
    mockRounds();
    await play();

    expect(await screen.findByText('You matched 4 of 4!')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Play again' }));

    await waitFor(() => expect(screen.getByText('Question 1 of 4')).toBeInTheDocument());
    expect(screen.getByText('0 / 0 correct')).toBeInTheDocument();
  });
});
