// The Serving Schedule (Worship → Service Roster, Scheduled tab): seeing your
// own jobs, asking to be replaced on one you cannot do, and blocking out time
// away. Then, for the schedule keeper, who is away and the request arriving in
// My Inbox.
//
// Members can no longer take their own name off a slot: they ask to be
// replaced (server/workflows/definitions/servingReplacement.js), their name
// stays on, and whoever keeps the schedule settles it from My Inbox
// (ReplacementSuggestions.jsx lists who could take it).
//
// The signed-in account is an admin, so it also sees what a schedule keeper
// sees: names as buttons, the Preferences and Analysis tabs, and Who is away.
// Captions that describe those are marked as the keeper's.
//
// `prepare` puts facts.me on one job next month, so "Your jobs" has something
// to ask about. Nothing is staged: every press is real in the run's throwaway
// site, and no email it writes is ever sent (lib/servers.js).

// "December 2026", the way the roster names a month.
const monthLabel = offset => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return `${d.toLocaleString('en-US', { month: 'long' })} ${d.getFullYear()}`;
};
// A local date a number of days from today, as the date box wants it.
const isoIn = days => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

module.exports = {
  description: 'The Serving Schedule: your jobs, asking to be replaced, and time away',
  pace: 0.9,
  // Every caption stays up for at least this long, so it can be read.
  stepSeconds: 10,

  cards: {
    title: {
      kicker: 'MEMBER PORTAL · HOW TO',
      heading: 'Serving Schedule',
      sub: 'Your jobs, asking to be replaced, and time away',
      note: 'All names and details shown are sample data.',
    },
    end: {
      heading: 'Serving, sorted',
      items: [
        'Worship → Service Roster', 'Your jobs are at the top', 'Can\'t make it? Ask to be replaced',
        'Your name stays on until it is settled', 'My time away blocks out days', 'Keepers settle it in My Inbox',
      ],
      note: 'Capshaw Church of Christ · Member Portal',
    },
  },

  // The sample roster rosters the men, and facts.me may not be on it. Put them
  // on one job next month (the seed always builds next month), so Your jobs
  // has a job to ask to be replaced on.
  async prepare({ request, facts }) {
    const month = monthLabel(1);
    const res = await request.get(`/api/serving?month=${encodeURIComponent(month)}`);
    if (!res.ok()) throw new Error(`Reading the serving schedule failed: ${res.status()}`);
    const roster = await res.json();
    if (roster.month !== month) throw new Error(`The sample serving schedule has no ${month}`);
    const key = s => String(s || '').trim().toLowerCase();
    if (roster.assignments.some(a => key(a.name) === key(facts.me.name))) return;
    const dated = roster.assignments.filter(a => a.date && a.job !== 'Visual Preparation');
    const slot = ['Announcements', 'Scripture Reading', 'Usher', 'Opening Prayer']
      .map(job => dated.find(a => a.job === job)).find(Boolean) || dated[0];
    if (!slot) throw new Error(`The sample serving schedule has no dated slot in ${month}`);
    const put = await request.patch(`/api/serving/assignments/${slot.id}`, { data: { name: facts.me.name } });
    if (!put.ok()) throw new Error(`Putting ${facts.me.name} on the schedule failed: ${put.status()}`);
  },

  segments: [
    {
      name: 'serving',
      device: 'desktop',
      start: '/?page=my-week',
      // The Worship menu, which the first step opens.
      ready: ({ page }) => page.locator('button').filter({ has: page.locator('span', { hasText: /^Worship$/ }) }).first(),
      async run({ d, page, facts }) {
        await d.caption({ chip: 'SERVING SCHEDULE', title: 'Who is serving, and when', text: 'The serving schedule is under Worship, on Service Roster. It shows each worship job and who is down for it.' });
        await d.hold(3600);
        await d.step();

        d.mark('your-jobs');
        await d.nav('Worship', 'Service Roster');
        await page.getByRole('heading', { name: 'Service Roster', exact: true }).waitFor({ timeout: 15000 });
        const yours = page.getByRole('region', { name: 'Your jobs', exact: true });
        await yours.waitFor({ timeout: 15000 });
        await d.sleep(600);
        await d.reveal(yours);
        await d.callout(yours, 'What you are down for', { where: 'below' });
        await d.caption({ chip: 'SERVING SCHEDULE', title: 'Your jobs, at the top', text: 'Your jobs this month and next are listed first. Show takes you to that service on the schedule.' });
        await d.hold(4000);
        await d.clear();

        d.mark('service-card');
        const show = yours.getByRole('button', { name: /^Show / }).first();
        if (await show.isVisible().catch(() => false)) {
          await d.click(show);
          await page.locator('section.ring-2').first().waitFor({ timeout: 15000 }).catch(() => {});
          await d.sleep(900);
        }
        const card = (await page.locator('section.ring-2').first().isVisible().catch(() => false))
          ? page.locator('section.ring-2').first()
          : page.locator('section[id^="service-"]').first();
        await d.reveal(card);
        await d.callout(card, 'One card per service', { where: 'above' });
        await d.caption({ chip: 'SERVING SCHEDULE', title: 'A card for each service', text: 'Each card lists that service\'s jobs and who is down for each. Open slots are shaded, and each service has its own link.' });
        await d.hold(4400);
        await d.clear();

        d.mark('ask');
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
        await d.sleep(800);
        const ask = yours.getByRole('button', { name: 'Ask to be replaced', exact: true }).first();
        await d.reveal(ask);
        await d.callout(ask, 'Can\'t make it?', { where: 'below' });
        await d.caption({ chip: 'ASK TO BE REPLACED', title: 'Can\'t make it? Ask', text: 'You can no longer take your own name off a job. If you cannot do one, choose Ask to be replaced beside it.' });
        await d.hold(4000);
        await d.clear();
        await d.click(ask);
        const dialog = page.getByRole('dialog', { name: 'Ask to be replaced' });
        await dialog.waitFor({ timeout: 10000 });
        await d.sleep(500);

        d.mark('why');
        await d.callout(dialog, 'Why is optional', { where: 'above' });
        await d.caption({ chip: 'ASK TO BE REPLACED', title: 'Say why, if you like', text: 'Whoever keeps the schedule is emailed and finds it in My Inbox. Your name stays on until they have found someone.' });
        await d.click(dialog.getByPlaceholder('Out of town that weekend'), { ms: 500 });
        await d.type('Away that weekend', 60);
        await d.hold(2400);
        await d.clear();
        await d.click(dialog.getByRole('button', { name: 'Ask to be replaced', exact: true }), { ms: 500 });
        await dialog.waitFor({ state: 'detached', timeout: 15000 });
        await d.sleep(800);

        d.mark('asked');
        const asked = yours.getByText('replacement asked for', { exact: true }).first();
        await asked.waitFor({ timeout: 15000 });
        await d.reveal(asked);
        await d.callout(asked.locator('xpath=ancestor::li[1]'), 'Waiting on a replacement', { where: 'below' });
        await d.caption({ chip: 'ASK TO BE REPLACED', title: 'Asked, and waiting', text: 'The job now says replacement asked for. Once it is settled, you are told by email and on your bell.' });
        await d.hold(4000);
        await d.clear();

        d.mark('time-away');
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
        await d.sleep(800);
        await d.click(page.getByRole('button', { name: /^My time away/ }));
        const away = page.getByRole('dialog', { name: 'Time away' });
        await away.waitFor({ timeout: 10000 });
        await d.sleep(500);
        await d.caption({ chip: 'TIME AWAY', title: 'Block out time away', text: 'Choose My time away and enter the first and last days you will be gone. The month builder will not put you on a job then.' });
        const first = away.getByLabel('First day away');
        const last = away.getByLabel('Last day away');
        await d.click(first, { ms: 500 }); await first.fill(isoIn(40)); await d.sleep(300);
        await d.click(last, { ms: 500 }); await last.fill(isoIn(44)); await d.sleep(300);
        await d.click(away.getByPlaceholder(/Away with family/), { ms: 500 });
        await d.type('Visiting family', 60);
        await d.click(away.getByRole('button', { name: 'Block out these days' }), { ms: 500 });
        const blocked = away.locator('li', { hasText: 'Visiting family' }).first();
        await blocked.waitFor({ timeout: 10000 });
        await d.sleep(400);
        await d.callout(blocked, 'Blocked out', { where: 'below' });
        await d.hold(2600);
        await d.clear();
        await page.keyboard.press('Escape');
        await away.waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
        await d.sleep(400);

        d.mark('who-is-away');
        const whoAway = page.getByRole('heading', { name: 'Who is away' });
        if (await whoAway.isVisible().catch(() => false)) {
          const panel = whoAway.locator('xpath=ancestor::div[contains(@class,"card")][1]');
          await d.reveal(whoAway);
          const calendar = page.getByRole('group', { name: 'How to show who is away' }).getByRole('button', { name: 'Calendar' });
          if (await calendar.isVisible().catch(() => false)) {
            await d.click(calendar, { ms: 500 });
            await d.sleep(700);
          }
          await d.reveal(whoAway);
          await d.callout(panel, 'Schedule keepers only', { where: 'above' });
          await d.caption({ chip: 'FOR SCHEDULE KEEPERS', title: 'Everyone\'s time away', text: 'Whoever keeps the schedule sees who is away, as a list or a calendar. Anyone down for a day they are away is marked away.' });
          await d.hold(4400);
          await d.clear();
        }

        d.mark('inbox');
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
        await d.sleep(600);
        await d.nav('My Church', 'My Inbox');
        await page.getByRole('heading', { name: 'My Inbox', exact: true }).waitFor({ timeout: 15000 });
        // Titled "Replace <name>: <job>, <when>", at the step "Find a replacement".
        const named = page.locator('div.card').filter({ hasText: `Replace ${facts.me.name}:` }).first();
        const task = (await named.waitFor({ timeout: 8000 }).then(() => true, () => false))
          ? named
          : page.locator('div.card').filter({ hasText: 'Find a replacement' }).first();
        await task.waitFor({ timeout: 15000 });
        await d.sleep(600);
        await d.reveal(task);
        await d.callout(task, 'The request, with who could take it', { where: 'above' });
        await d.caption({ chip: 'FOR SCHEDULE KEEPERS', title: 'Settling the request', text: 'The keeper finds it in My Inbox, with who is free and willing listed first. They pick someone, leave it open, or keep you on.' });
        await d.hold(4600);
        await d.clear();
      },
    },
  ],
};
