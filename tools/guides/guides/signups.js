// Sign-Ups (Our Church Family → Sign-Ups) and Communion Preparation
// (Worship → Communion Preparation): putting your name down for something the
// church needs, and for preparing the Lord's Supper in a month.
//
// Any member signs up, takes their own name off, and can make a sign-up of
// their own (server/routes/signups.js). Whoever made a sign-up, and the
// Sign-Up Manager, can edit it, email about it and put somebody else down;
// the signed-in account is an admin, so it sees those buttons too, and the
// captions mark them.
//
// Communion Preparation is one name a month for a year. Late in the year this
// year's months may all be taken or begun, so `prepare` starts next year's
// list when this year's has no open month (as whoever keeps the list would),
// and the scene moves to that year.
//
// Nothing is staged: signing up is a real press in the throwaway site.
// "Take my name off" is not pressed, because it asks the browser to confirm.

module.exports = {
  description: 'Sign-Ups and Communion Preparation: putting your name down',
  pace: 0.9,
  // Every caption stays up for at least this long, so it can be read.
  stepSeconds: 10,

  cards: {
    title: {
      kicker: 'MEMBER PORTAL · HOW TO',
      heading: 'Sign-Ups and Communion Preparation',
      sub: 'Putting your name down for what the church needs',
      note: 'All names and details shown are sample data.',
    },
    end: {
      heading: 'Signed up in one press',
      items: [
        'Our Church Family → Sign-Ups', 'Press Sign up beside what you will do', 'Write in what you will bring',
        'Anybody can make a sign-up', 'Worship → Communion Preparation', 'A reminder a week before your month',
      ],
      note: 'Capshaw Church of Christ · Member Portal',
    },
  },

  // A communion preparation month somebody can still sign up for.
  async prepare({ request }) {
    const res = await request.get('/api/communion-prep');
    if (!res.ok()) throw new Error(`Reading communion preparation failed: ${res.status()}`);
    const prep = await res.json();
    const open = (prep.months || []).some(m => !m.signup && !m.started);
    const next = prep.startable.find(y => y > prep.year);
    if (!open && next) {
      const start = await request.post('/api/communion-prep/years', { data: { year: next } });
      if (!start.ok()) throw new Error(`Starting the ${next} communion preparation list failed: ${start.status()}`);
    }
  },

  segments: [
    {
      name: 'signups',
      device: 'desktop',
      start: '/?page=my-week',
      // The Our Church Family menu, which the first step opens.
      ready: ({ page }) => page.locator('button').filter({ has: page.locator('span', { hasText: /^Our Church Family$/ }) }).first(),
      async run({ d, page }) {
        d.mark('index');
        await d.caption({ chip: 'SIGN-UPS', title: 'What the church needs people for', text: 'Sign-Ups, under Our Church Family, lists meals, meal trains and anything else that needs people, with how many places are filled.' });
        await d.hold(1800);
        await d.nav('Our Church Family', 'Sign-Ups');
        await page.getByRole('heading', { name: 'Sign-Ups', exact: true }).waitFor({ timeout: 15000 });
        const coming = page.getByRole('region', { name: 'Coming up', exact: true });
        await coming.waitFor({ timeout: 15000 });
        await d.sleep(600);
        await d.callout(coming, 'Coming up', { where: 'above' });
        await d.hold(3200);
        await d.clear();

        d.mark('open');
        const rows = coming.getByRole('button');
        const meal = rows.filter({ hasText: 'Fellowship meal' }).first();
        await d.click((await meal.isVisible().catch(() => false)) ? meal : rows.first());
        const back = page.getByRole('button', { name: '← All sign-ups' });
        await back.waitFor({ timeout: 15000 });
        await d.sleep(700);
        // The first place still open. Its label is "Sign up for <what>, <day>"; the
        // write-in one stays disabled until something is typed, so it is skipped.
        const firstOpen = page.getByRole('button', { name: /^Sign up for /, disabled: false }).first();
        const slot = firstOpen.locator('xpath=ancestor::li[1]');
        await d.reveal(slot);
        await d.callout(slot.locator('xpath=ancestor::section[1]'), 'Each date, and what it needs', { where: 'above' });
        await d.caption({ chip: 'SIGN-UPS', title: 'What is still needed', text: 'Each date lists what is needed, who is already down, and how many are still needed.' });
        await d.hold(4000);
        await d.clear();

        d.mark('sign-up');
        await d.callout(firstOpen, 'Put your name down', { where: 'below' });
        await d.caption({ chip: 'SIGN-UPS', title: 'Press Sign up', text: 'Press Sign up beside what you will do. Your name goes on, marked as you, and the small cross beside it takes it off again.' });
        await d.hold(2400);
        await d.clear();
        await d.click(firstOpen);
        const you = page.getByText('(you)', { exact: false }).first();
        await you.waitFor({ timeout: 10000 }).catch(() => {});
        await d.sleep(500);
        if (await you.isVisible().catch(() => false)) await d.callout(you, 'You are down', { where: 'below' });
        await d.hold(3000);
        await d.clear();

        d.mark('free');
        const bring = page.getByPlaceholder('What will you bring or do?').first();
        if (await bring.isVisible().catch(() => false)) {
          await d.reveal(bring);
          await d.caption({ chip: 'SIGN-UPS', title: 'Bringing something else?', text: 'Some sign-ups let you write in what you will bring or do, then press Sign up beside it.' });
          await d.click(bring, { ms: 500 });
          await d.type('Paper plates and cups', 60);
          await d.click(bring.locator('xpath=following-sibling::button[1]'), { ms: 500 });
          await d.hold(3000);
          await d.clear();
        }

        d.mark('make');
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
        await d.sleep(700);
        await d.click(back);
        const make = page.getByRole('button', { name: 'New sign-up', exact: true });
        await make.waitFor({ timeout: 15000 });
        await d.sleep(600);
        await d.callout(make, 'Anybody can make one', { where: 'below', alignRight: true });
        await d.caption({ chip: 'SIGN-UPS', title: 'Need help with something?', text: 'Anybody can make a sign-up and send its link around. Whoever made it can change it and email everyone signed up.' });
        await d.hold(4000);
        await d.clear();

        d.mark('communion');
        await d.nav('Worship', 'Communion Preparation');
        await page.getByRole('heading', { name: 'Communion Preparation', exact: true }).waitFor({ timeout: 15000 });
        await d.sleep(800);
        // No open month this year: the list prepare started for next year.
        const monthButton = page.getByRole('button', { name: /^Sign up for / });
        const year = page.getByRole('combobox', { name: 'Year' });
        if (!(await monthButton.first().isVisible().catch(() => false)) && await year.isVisible().catch(() => false)) {
          const last = await year.locator('option').last().getAttribute('value');
          await d.click(year, { ms: 500 });
          await year.selectOption(last);
          await monthButton.first().waitFor({ timeout: 10000 });
          await d.sleep(600);
        }
        const months = page.getByRole('list', { name: /^Communion preparation \d{4}$/ });
        await months.waitFor({ timeout: 15000 });
        await d.callout(months, 'One name a month', { where: 'above' });
        await d.caption({ chip: 'COMMUNION PREPARATION', title: 'Preparing the Lord\'s Supper', text: 'Under Worship, Communion Preparation shows who prepares the Lord\'s Supper each month of the year. Months nobody has taken say Open.' });
        await d.hold(4000);
        await d.clear();

        d.mark('communion-sign-up');
        const month = monthButton.first();
        const card = month.locator('xpath=ancestor::li[1]');
        await d.reveal(card);
        await d.callout(card, 'An open month', { where: 'below' });
        await d.caption({ chip: 'COMMUNION PREPARATION', title: 'Sign up for an open month', text: 'Press Sign up on an open month and your name goes on. You can take it off again until the month begins.' });
        await d.hold(2400);
        await d.clear();
        await d.click(month);
        const mine = page.locator('li.ring-2').first();
        await mine.waitFor({ timeout: 10000 }).catch(() => {});
        await d.sleep(500);
        if (await mine.isVisible().catch(() => false)) await d.callout(mine, 'Your month', { where: 'below' });
        await d.hold(3000);
        await d.clear();

        d.mark('reminder');
        await d.caption({ chip: 'COMMUNION PREPARATION', title: 'A reminder before your month', text: 'You are emailed a reminder a week before your month begins. Whoever keeps the list can also put anyone down.' });
        if (await mine.isVisible().catch(() => false)) await d.callout(mine, 'Reminded a week before', { where: 'below' });
        await d.hold(4000);
        await d.clear();
      },
    },
  ],
};
