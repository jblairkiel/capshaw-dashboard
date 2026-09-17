import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import AnnouncementsDisplay from '../components/AnnouncementsDisplay';

// The foyer slideshow: it runs unattended on a screen in the building, so what
// matters is that it cycles, that it can be driven from a keyboard, and that it
// does something sensible when there is nothing to show.

const announcement = over => ({
  id: 1, type: 'announcement', title: 'Potluck Sunday', body: 'Bring a dish.',
  event_date: null, event_time: null, location: null, priority: 'normal', active: 1, ...over,
});

function mockApi(items) {
  const fetchMock = vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ success: true, items }) }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

// jsdom implements neither fullscreen API, and the component reaches for
// whichever is present, so a stub stands in for it.
beforeEach(() => {
  Element.prototype.requestFullscreen = vi.fn(() => Promise.resolve());
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete Element.prototype.requestFullscreen;
});

describe('AnnouncementsDisplay', () => {
  test('shows the first announcement once it has loaded', async () => {
    mockApi([announcement()]);
    render(<AnnouncementsDisplay />);

    expect(await screen.findByText('Potluck Sunday')).toBeInTheDocument();
    expect(screen.getByText('Bring a dish.')).toBeInTheDocument();
    expect(screen.getByText('📢 Announcement')).toBeInTheDocument();
  });

  test('leaves out anything that has been switched off', async () => {
    mockApi([announcement(), announcement({ id: 2, title: 'Retired notice', active: 0 })]);
    render(<AnnouncementsDisplay />);

    await screen.findByText('Potluck Sunday');
    expect(screen.queryByText('Retired notice')).not.toBeInTheDocument();
    expect(screen.getByText('1 / 1')).toBeInTheDocument();
  });

  test('says so when there is nothing to announce', async () => {
    mockApi([]);
    render(<AnnouncementsDisplay />);
    expect(await screen.findByText(/No active announcements or events/i)).toBeInTheDocument();
  });

  test('an unreachable API leaves the screen empty rather than stuck loading', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    render(<AnnouncementsDisplay />);
    expect(await screen.findByText(/No active announcements or events/i)).toBeInTheDocument();
  });

  test('an event is labelled as one, with its date, time and place', async () => {
    mockApi([announcement({
      type: 'event', title: 'Gospel Meeting', event_date: '2025-04-20',
      event_time: '6:00 PM', location: 'Auditorium',
    })]);
    render(<AnnouncementsDisplay />);

    expect(await screen.findByText('📅 Upcoming Event')).toBeInTheDocument();
    expect(screen.getByText(/April 20, 2025/)).toBeInTheDocument();
    expect(screen.getByText('🕐 6:00 PM')).toBeInTheDocument();
    expect(screen.getByText('📍 Auditorium')).toBeInTheDocument();
  });

  test('an event with no details shows only its title', async () => {
    mockApi([announcement({ type: 'event', title: 'Gospel Meeting', body: '' })]);
    render(<AnnouncementsDisplay />);

    expect(await screen.findByText('📅 Upcoming Event')).toBeInTheDocument();
    expect(screen.queryByText(/🕐/)).not.toBeInTheDocument();
  });

  test('an urgent notice is marked differently from an ordinary one', async () => {
    mockApi([announcement({ priority: 'urgent', title: 'Building closed' })]);
    render(<AnnouncementsDisplay />);
    expect(await screen.findByText('⚠ Urgent Announcement')).toBeInTheDocument();
  });

  test('a long title is set smaller so it still fits the screen', async () => {
    const long = 'A very long announcement title that will not fit on one line at all';
    mockApi([announcement({ title: long })]);
    render(<AnnouncementsDisplay />);
    expect((await screen.findByText(long)).className).toContain('text-3xl');
  });

  test('with a single slide there are no navigation controls', async () => {
    mockApi([announcement()]);
    render(<AnnouncementsDisplay />);
    await screen.findByText('Potluck Sunday');
    expect(screen.getByText('1 / 1')).toBeInTheDocument();
  });

  describe('with several slides', () => {
    const ITEMS = [
      announcement({ id: 1, title: 'First' }),
      announcement({ id: 2, title: 'Second' }),
      announcement({ id: 3, title: 'Third' }),
    ];

    // The slideshow listens on the window, and the listener it registers knows
    // how many slides there are — so until the effect that registers it has run
    // against the loaded slides, an arrow key moves nothing. Seeing the first
    // slide on screen is not that moment: the render happens first and the
    // effect follows it. Settling the effects here makes the difference, which
    // otherwise shows up as a key press that does nothing on a loaded machine.
    async function showing(title) {
      await screen.findByText(title);
      await act(async () => {});
    }

    // A slide arriving is a state change away, not a network call away, so a
    // second is normally an age. On a build machine running two dozen test
    // files at once it is not, and the difference between "the key did
    // nothing" and "the machine was busy" is invisible from the failure. This
    // waits long enough that only the first of those can fail it.
    const SOON = { timeout: 5000 };

    const slide = title => screen.findByText(title, {}, SOON);

    test('the arrow keys move between them', async () => {
      mockApi(ITEMS);
      render(<AnnouncementsDisplay />);
      await showing('First');

      fireEvent.keyDown(window, { key: 'ArrowRight' });
      expect(await slide('Second')).toBeInTheDocument();
      expect(screen.getByText('2 / 3')).toBeInTheDocument();

      fireEvent.keyDown(window, { key: 'ArrowLeft' });
      expect(await slide('First')).toBeInTheDocument();
    });

    test('the arrows wrap around at either end', async () => {
      mockApi(ITEMS);
      render(<AnnouncementsDisplay />);
      await showing('First');

      fireEvent.keyDown(window, { key: 'ArrowLeft' });
      expect(await slide('Third')).toBeInTheDocument();

      fireEvent.keyDown(window, { key: 'ArrowRight' });
      expect(await slide('First')).toBeInTheDocument();
    });

    test('a key it does not use is ignored', async () => {
      mockApi(ITEMS);
      render(<AnnouncementsDisplay />);
      await showing('First');

      fireEvent.keyDown(window, { key: 'Enter' });
      expect(screen.getByText('First')).toBeInTheDocument();
    });

    test('a dot jumps straight to its slide', async () => {
      mockApi(ITEMS);
      const { container } = render(<AnnouncementsDisplay />);
      await showing('First');

      const dots = [...container.querySelectorAll('button.rounded-full')];
      expect(dots).toHaveLength(3);
      fireEvent.click(dots[2]);
      expect(await slide('Third')).toBeInTheDocument();
    });

    test('it advances on its own, and stops once paused', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      mockApi(ITEMS);
      render(<AnnouncementsDisplay />);
      await screen.findByText('First');

      // The default dwell is eight seconds
      await act(async () => { vi.advanceTimersByTime(8000); });
      expect(screen.getByText('Second')).toBeInTheDocument();

      fireEvent.click(screen.getByText('8s').closest('div').querySelector('button:last-child'));
      await act(async () => { vi.advanceTimersByTime(30000); });
      expect(screen.getByText('Second')).toBeInTheDocument();
    });

    test('the space bar pauses and resumes', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      mockApi(ITEMS);
      render(<AnnouncementsDisplay />);
      await showing('First');

      fireEvent.keyDown(window, { key: ' ' });
      await act(async () => { vi.advanceTimersByTime(20000); });
      expect(screen.getByText('First')).toBeInTheDocument();

      fireEvent.keyDown(window, { key: ' ' });
      await act(async () => { vi.advanceTimersByTime(8000); });
      expect(screen.getByText('Second')).toBeInTheDocument();
    });

    test('the dwell time can be changed, and the new one takes effect', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      mockApi(ITEMS);
      render(<AnnouncementsDisplay />);
      await screen.findByText('First');

      fireEvent.click(screen.getByText('20s'));
      await act(async () => { vi.advanceTimersByTime(8000); });
      expect(screen.getByText('First')).toBeInTheDocument();

      await act(async () => { vi.advanceTimersByTime(12000); });
      expect(screen.getByText('Second')).toBeInTheDocument();
    });

    test('the controls fade out when the room is still, and come back on movement', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      mockApi(ITEMS);
      const { container } = render(<AnnouncementsDisplay />);
      await screen.findByText('First');

      const topBar = container.querySelector('.flex.items-center.justify-between');
      expect(topBar.className).toContain('opacity-100');

      await act(async () => { vi.advanceTimersByTime(3500); });
      await waitFor(() => expect(topBar.className).toContain('opacity-0'));

      fireEvent.mouseMove(container.firstChild);
      await waitFor(() => expect(topBar.className).toContain('opacity-100'));
    });
  });
});
