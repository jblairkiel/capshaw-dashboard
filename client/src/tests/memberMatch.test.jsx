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
  { photo: 'ray.jpg', members: [{ id: 1, name: 'Ray Harris' }] },
  { photo: 'harris-family.jpg', members: [{ id: 2, name: 'Jan Harris' }, { id: 3, name: 'Tommy Harris' }] },
];

function mockRounds(rounds = ROUNDS) {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
    json: () => Promise.resolve({ success: true, rounds }),
  })));
}

beforeEach(() => { withStableShuffle(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('MemberMatchView — getting going', () => {
  test('a single photo asks "Who is this?", a family photo counts the person', async () => {
    mockRounds();
    render(<MemberMatchView />);

    expect(await screen.findByText('Who is this?')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Who is this?' })).toHaveAttribute('src', '/api/member-match/photo/ray.jpg');
    fireEvent.click(screen.getByRole('button', { name: 'Ray Harris' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByText(/person 1 of 2 in this photo/)).toBeInTheDocument();
  });

  test('a family photo is asked about one member at a time, same photo throughout', async () => {
    mockRounds();
    render(<MemberMatchView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ray Harris' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByText(/person 1 of 2/)).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute('src', '/api/member-match/photo/harris-family.jpg');
    fireEvent.click(screen.getByRole('button', { name: 'Jan Harris' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByText(/person 2 of 2/)).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute('src', '/api/member-match/photo/harris-family.jpg');
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
  test('the right choice is marked correct and the score moves', async () => {
    mockRounds();
    render(<MemberMatchView />);

    expect(await screen.findByText('0 / 0 correct')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ray Harris' }));

    expect(screen.getByRole('button', { name: 'Ray Harris' })).toHaveClass('bg-emerald-50');
    expect(screen.getByText('1 / 1 correct')).toBeInTheDocument();
  });

  test('a wrong choice is marked wrong, and the real answer is shown', async () => {
    mockRounds();
    render(<MemberMatchView />);

    await screen.findByText('Who is this?');
    fireEvent.click(screen.getByRole('button', { name: 'Jan Harris' }));

    expect(screen.getByRole('button', { name: 'Jan Harris' })).toHaveClass('bg-red-50');
    expect(screen.getByRole('button', { name: 'Ray Harris' })).toHaveClass('bg-emerald-50');
    expect(screen.getByText('0 / 1 correct')).toBeInTheDocument();
  });

  test('once answered, the choices lock and only Next moves you on', async () => {
    mockRounds();
    render(<MemberMatchView />);
    await screen.findByText('Who is this?');

    fireEvent.click(screen.getByRole('button', { name: 'Ray Harris' }));
    fireEvent.click(screen.getByRole('button', { name: 'Jan Harris' }));

    // The second click did nothing: still counted as one answer, one correct.
    expect(screen.getByText('1 / 1 correct')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Harris/ }).every(b => b.disabled)).toBe(true);
  });
});

describe('MemberMatchView — finishing and playing again', () => {
  async function finishGame() {
    render(<MemberMatchView />);
    for (const round of ROUNDS) {
      for (const member of round.members) {
        await screen.findByRole('img');
        fireEvent.click(screen.getByRole('button', { name: member.name }));
        fireEvent.click(screen.getByRole('button', { name: /Next|See results/ }));
      }
    }
  }

  test('finishing shows a final score and offers to play again', async () => {
    mockRounds();
    await finishGame();

    expect(await screen.findByText('You matched 3 of 3!')).toBeInTheDocument();
    const playAgain = screen.getByRole('button', { name: 'Play again' });
    fireEvent.click(playAgain);

    await waitFor(() => expect(screen.getByText('Question 1 of 3')).toBeInTheDocument());
    expect(screen.getByText('0 / 0 correct')).toBeInTheDocument();
  });
});
