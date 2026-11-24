// Church Calendar and Announcements (client/src/components/CalendarView.jsx,
// AnnouncementsView.jsx and its full-screen slideshow).
//
// The calendar is a view over the announcements: every dated announcement
// shows on its day, and an event added on the calendar is an announcement
// too. Sign-ups from the Sign-Ups page show alongside, read only. Anyone
// signed in can read both and comment; adding and changing events is for
// whoever looks after the calendar or announcements, so those captions are
// marked. The signed-in account is an admin, so it sees the editing form when
// it opens an event; a member sees the same details and comments, read only.
//
// The seeded events fall from three days to two months out, so the scene
// steps forward a month at a time until one shows. The event it adds goes on
// the 20th of that month, which is always ahead of today.
//
// Staged: nothing. The comment and the new event are real in the run's
// throwaway copy of the site. Fullscreen is the guide layer's page overlay
// (see the README), not the browser's own full screen.
const NEW_EVENT = { title: 'Church work day', time: '9:00 AM', location: 'Fellowship Hall', details: 'Bring gloves and a rake. Lunch is provided.' };

module.exports = {
  description: 'Church Calendar and Announcements, and the foyer slideshow',
  pace: 0.9,
  // Every caption stays up for at least this long, so it can be read.
  stepSeconds: 10,

  cards: {
    title: {
      kicker: 'MEMBER PORTAL · HOW TO',
      heading: 'Church Calendar and Announcements',
      sub: 'What is coming up, and how it reaches the foyer screen',
      note: 'All names and details shown are sample data.',
    },
    end: {
      heading: 'Typed once, seen everywhere',
      items: [
        'Our Church Family → Church Calendar', 'Events and sign-ups by day', 'Open an event to comment',
        'Calendar keepers click a day to add one', 'The same item on Announcements', 'Fullscreen Display for the foyer TV',
      ],
      note: 'Capshaw Church of Christ · Member Portal',
    },
  },

  segments: [
    {
      name: 'calendar',
      device: 'desktop',
      start: '/?page=my-week',
      ready: ({ page }) => page.locator('button').filter({ has: page.locator('span', { hasText: /^Our Church Family$/ }) }).first(),
      async run({ d, page }) {
        // A callout is drawn where the element is now, so bring it on screen first.
        const show = async (loc, label, opts) => { await d.reveal([].concat(loc)[0]); await d.callout(loc, label, opts); };
        const grid = page.locator('main div.bg-white.rounded-xl.overflow-hidden').filter({ has: page.locator('div.grid.grid-cols-7') }).first();
        const events = page.locator('main div.grid.grid-cols-7 button:not([aria-label^="Sign-up"])');

        // ── The month ───────────────────────────────────────────────────────
        d.mark('calendar');
        await d.nav('Our Church Family', 'Church Calendar');
        await page.getByRole('heading', { name: 'Church Calendar' }).waitFor({ timeout: 15000 });
        await grid.waitFor({ timeout: 15000 });
        await d.sleep(700);
        await show([page.getByRole('button', { name: 'Previous month' }), page.getByRole('button', { name: 'Next month' })], 'Move between months', { where: 'below' });
        await d.caption({ chip: 'CHURCH CALENDAR', title: 'What is coming up', text: 'Church Calendar is under Our Church Family. Today is highlighted. The arrows move a month at a time, and Today comes back.' });
        await d.hold(3000);
        await d.clear();

        // Step forward until a month has an event in it.
        for (let i = 0; i < 3 && !(await events.count()); i++) {
          await d.click(page.getByRole('button', { name: 'Next month' }), { ms: 450 });
          await d.sleep(700);
        }
        const event = events.first();
        await show(event, 'An event, with its time', { where: 'above' });
        const signup = page.locator('main div.grid.grid-cols-7 button[aria-label^="Sign-up"]').first();
        if (await signup.isVisible().catch(() => false)) await d.callout(signup, 'A sign-up', { where: 'below' });
        await d.caption({ chip: 'CHURCH CALENDAR', title: 'Events and sign-ups, by day', text: 'Dated announcements show on their day. Sign-ups from the Sign-Ups page show with a dashed border, and say how many people are still needed.' });
        await d.hold(4200);
        await d.clear();

        // ── One event, and its comments ─────────────────────────────────────
        d.mark('event');
        await d.click(event, { ms: 550 });
        const comment = page.getByLabel('Write a comment');
        await comment.waitFor({ timeout: 15000 });
        await d.sleep(600);
        await d.caption({ chip: 'CHURCH CALENDAR', title: 'Open an event', text: 'Click an event for its details and the comments under it. Anyone can join in. Calendar keepers can also change it here.' });
        await d.hold(2000);
        await d.click(comment, { ms: 500 });
        await d.type('Count us in. We can bring drinks.', 50);
        await d.click(page.getByRole('button', { name: 'Post', exact: true }), { ms: 450 });
        await page.getByText('Count us in. We can bring drinks.').last().waitFor({ timeout: 10000 }).catch(() => {});
        await d.hold(2200);
        const close = page.getByRole('button', { name: 'Cancel', exact: true }).or(page.getByRole('button', { name: 'Close', exact: true })).first();
        await d.step();
        await d.click(close, { ms: 450 });
        await d.sleep(600);

        // ── Adding an event (calendar keepers) ──────────────────────────────
        d.mark('add');
        const day = page.locator('main div.grid.grid-cols-7 > div > span').filter({ hasText: /^20$/ }).first();
        await d.click(day, { ms: 550 });
        const title = page.getByRole('heading', { name: 'New event' });
        await title.waitFor({ timeout: 15000 });
        await d.sleep(500);
        await d.caption({ chip: 'FOR CALENDAR KEEPERS', title: 'Click a day to add an event', text: 'Whoever looks after the calendar or announcements clicks a day, or Add event. The date is filled in. Add the time, place and details.' });
        await d.click(page.getByRole('textbox', { name: 'Title' }), { ms: 450 });
        await d.type(NEW_EVENT.title, 55);
        await d.click(page.getByPlaceholder('6:00 PM'), { ms: 450 });
        await d.type(NEW_EVENT.time, 60);
        await d.click(page.getByPlaceholder('Fellowship Hall'), { ms: 450 });
        await d.type(NEW_EVENT.location, 50);
        await d.click(page.getByLabel('Details'), { ms: 450 });
        await d.type(NEW_EVENT.details, 40);
        await d.step();
        await d.click(page.getByRole('button', { name: 'Save', exact: true }), { ms: 450 });
        await title.waitFor({ state: 'detached', timeout: 15000 });
        await d.sleep(800);

        const added = page.getByRole('button', { name: new RegExp(NEW_EVENT.title) }).first();
        await added.waitFor({ timeout: 15000 });
        await show(added, 'Just added', { where: 'above' });
        await d.caption({ chip: 'FOR CALENDAR KEEPERS', title: 'Typed once', text: 'The new event is saved as an announcement too. It shows on the calendar, on the Announcements page and on the foyer slideshow.' });
        await d.hold(4000);
        await d.clear();

        // ── Announcements ───────────────────────────────────────────────────
        d.mark('announcements');
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
        await d.sleep(500);
        await d.nav('Our Church Family', 'Announcements');
        await page.getByRole('heading', { name: /Announcements & Events/ }).waitFor({ timeout: 15000 });
        await d.sleep(800);
        const item = page.locator('main div.card', { hasText: NEW_EVENT.title }).first();
        await show(item, 'The same event', { where: 'below' });
        await d.caption({ chip: 'ANNOUNCEMENTS', title: 'Every notice and event', text: 'Announcements lists everything on the board. Show just announcements or just events, and open the comments on any of them.' });
        await d.hold(4000);
        await d.clear();

        // ── The foyer slideshow ─────────────────────────────────────────────
        d.mark('display');
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
        await d.sleep(500);
        const fullscreen = page.getByRole('button', { name: /Fullscreen Display/ });
        await show(fullscreen, 'For the foyer TV', { where: 'below' });
        await d.caption({ chip: 'ANNOUNCEMENTS', title: 'On the foyer TV', text: 'Fullscreen Display turns every active item into a slideshow. The arrow keys move between slides, Space pauses, and Esc ends it.' });
        await d.hold(2600);
        await d.clear();
        await d.click(fullscreen, { ms: 500 });
        await d.hold(3000);
        await page.keyboard.press('ArrowRight');
        await d.hold(2600);
        await page.keyboard.press('ArrowRight');
        await d.hold(2200);
        await page.keyboard.press('Escape');
        await d.sleep(700);
      },
    },
  ],
};
