// For members: My Week, the page everyone lands on when they sign in. Their
// own serving jobs, sign-ups, group meetings and rotation turns over today and
// the next thirteen days (server/lib/myWeek.js), each opening the page it came
// from.
//
// The sample data's dates are random, so `prepare` puts a few things in the
// signed-in member's fortnight with the app's own API: a serving job on the
// coming Sunday, a night on the sample meal train, a group meeting they have
// not answered yet, and one they said yes to and are bringing something to.
//
// Nothing is staged: every press is real, in the run's throwaway copy of the
// site, and nothing it would email is sent (lib/servers.js blanks the mail
// settings).
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// The church's today, as the server reckons it (lib/recordKeeping.js).
const churchToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const weekday = iso => new Date(`${iso}T12:00:00Z`).getUTCDay();

// A JSON call as the signed-in admin, which fails loudly.
const caller = request => async (method, url, data) => {
  const res = await request[method](url, data === undefined ? undefined : { data });
  const json = await res.json().catch(() => ({}));
  if (!res.ok() || json.success === false) throw new Error(`${method.toUpperCase()} ${url} failed: ${res.status()} ${json.error || ''}`);
  return json;
};

module.exports = {
  description: 'For members: My Week, your own serving jobs, sign-ups and meetings for the next two weeks',
  pace: 0.9,
  // Every caption stays up for at least this long, so it can be read.
  stepSeconds: 10,

  cards: {
    title: {
      kicker: 'MEMBER PORTAL · HOW TO',
      heading: 'My Week',
      sub: 'Everything you are doing over the next two weeks, in one place',
      note: 'All names and details shown are sample data.',
    },
    end: {
      heading: 'Your two weeks at a glance',
      items: [
        'My Church → My Week', 'Today and the next 13 days', 'Serving, Sign-up, Group, Rotation',
        'Red means waiting on your answer', 'Each row opens its own page', 'Emailed on Sunday mornings',
      ],
      note: 'Capshaw Church of Christ · Member Portal',
    },
  },

  async prepare({ request, facts }) {
    const api = caller(request);
    const today = churchToday();

    // A serving job on the coming Sunday, under the member's own name, which
    // is how My Week finds it.
    const sunday = addDays(today, 7 - weekday(today) || 7);
    const [y, m, day] = sunday.split('-').map(Number);
    await api('post', '/api/serving/assignments', {
      month: `${MONTHS[m - 1]} ${y}`, date: `${MONTHS[m - 1]} ${day}`,
      service: 'Sunday Worship', job: 'Scripture Reading', name: facts.me.name,
    });

    // A night on the sample meal train (five to eleven days out) that nobody
    // has taken yet.
    const { lists } = await api('get', '/api/signups');
    const train = lists.find(l => l.title === 'Meal train') || lists.find(l => !l.past && !l.closed);
    if (train) {
      const { list } = await api('get', `/api/signups/${train.id}`);
      const last = addDays(today, 13);
      for (const date of list.dates.filter(dt => dt.date >= today && dt.date <= last)) {
        const open = date.items.find(i => !i.full);
        if (!open) continue;
        await api('post', `/api/signups/${list.id}/entries`, { dateId: date.id, itemId: open.itemId });
        break;
      }
    }

    // Two meetings of the member's own group: one they have not answered, and
    // one they are going to and bringing something to.
    const meeting = async ({ title, daysOut, time }) => {
      const { event } = await api('post', `/api/groups/${facts.group.id}/events`, {
        title, description: 'A sample meeting for the guide.', date: addDays(today, daysOut), time,
        location: 'Fellowship Hall', rsvpEnabled: true, signupEnabled: true,
        signupItems: [{ label: 'Dessert', needed: 3 }, { label: 'Drinks', needed: 2 }],
      });
      await api('post', `/api/groups/${facts.group.id}/events/${event.id}/publish`, {});
      return event;
    };
    await meeting({ title: 'Supper and singing', daysOut: 3, time: '18:00' });
    const going = await meeting({ title: 'Prayer breakfast', daysOut: 9, time: '08:00' });
    await api('post', `/api/groups/${facts.group.id}/events/${going.id}/rsvp`, { response: 'yes', guests: 0 });
    const { event } = await api('get', `/api/groups/${facts.group.id}/events/${going.id}`);
    const dessert = event.signups.find(s => s.label === 'Dessert');
    if (dessert) await api('post', `/api/groups/${facts.group.id}/events/${going.id}/signups`, { itemId: dessert.id });
  },

  segments: [
    {
      name: 'my-week',
      device: 'desktop',
      start: '/?page=my-week',
      // The page's own heading, "<first name>'s week".
      ready: ({ page }) => page.locator('main h1').filter({ hasText: /week$/ }),
      async run({ d, page }) {
        const main = page.locator('main');
        const row = re => main.locator('li').filter({ has: page.locator('span', { hasText: re }) });
        const show = async (loc, label, opts) => { await d.reveal(loc); await d.callout(loc, label, opts); };

        d.mark('landing');
        await d.callout(main.locator('header').first(), 'Your week at a glance', { where: 'below' });
        await d.caption({ chip: 'MY WEEK', title: 'Your next two weeks', text: 'My Week is the first page you see when you sign in. It gathers what you are doing today and over the next thirteen days.' });
        await d.hold(3800);
        await d.clear();

        d.mark('days');
        const firstDay = main.locator('div.card').filter({ has: page.locator('h3') }).first();
        await show(firstDay, 'One card for each day', { where: 'below' });
        await d.caption({ chip: 'MY WEEK', title: 'Day by day', text: 'Only days with something on them are shown. Each row is labeled Serving, Sign-up, Group or Rotation.' });
        await d.hold(3800);
        await d.clear();

        const job = row(/^serving$/i).first();
        if (await job.isVisible().catch(() => false)) {
          d.mark('serving');
          await show(job, 'From the Service Roster', { where: 'below' });
          await d.caption({ chip: 'SERVING', title: 'Your worship jobs', text: 'When your name is on the Service Roster, the job shows here on its day. The link beside it opens the schedule.' });
          await d.hold(3800);
          await d.clear();
        }

        const waiting = main.locator('li').filter({ hasText: 'They are waiting on your answer' }).first();
        if (await waiting.isVisible().catch(() => false)) {
          d.mark('waiting');
          await show(waiting, 'Not answered yet', { where: 'below' });
          await d.caption({ chip: 'CHURCH GROUPS', title: 'Waiting on your answer', text: 'A group meeting you have not answered shows in red and is counted at the top. Answer opens Church Groups, where you reply.' });
          await d.hold(4000);
          await d.clear();
        }

        const going = main.locator('li').filter({ hasText: 'You said you are coming' }).first();
        if (await going.isVisible().catch(() => false)) {
          d.mark('going');
          await show(going, 'You said yes', { where: 'below' });
          await d.caption({ chip: 'CHURCH GROUPS', title: 'Meetings you are going to', text: 'Meetings you said yes to are listed too, with what you signed up to bring.' });
          await d.hold(3600);
          await d.clear();
        }

        const signup = row(/^sign-up$/i).first();
        if (await signup.isVisible().catch(() => false)) {
          d.mark('signup');
          await show(signup, 'From Sign-Ups', { where: 'below' });
          await d.caption({ chip: 'SIGN-UPS', title: 'Your sign-ups', text: 'Anything you put your name to on Sign-Ups is here, with what you are bringing and when.' });
          await d.hold(3400);
          await d.clear();
          await d.click(signup.getByRole('button', { name: /^Sign-Ups/ }));
          await page.locator('li', { hasText: '(you)' }).first().waitFor({ timeout: 15000 });
          await d.sleep(700);
          await show(page.locator('li', { hasText: '(you)' }).first(), 'Your name on the list', { where: 'below' });
          await d.caption({ chip: 'SIGN-UPS', title: 'Straight to where it lives', text: 'Each row opens the page it came from, on that very sign-up. Change it or take your name off there.' });
          await d.hold(3800);
          await d.clear();
          await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
          await d.sleep(600);
          await d.nav('My Church', 'My Week');
          await page.locator('main h1').filter({ hasText: /week$/ }).waitFor({ timeout: 15000 });
          await d.sleep(600);
        }

        d.mark('email');
        const emailed = main.getByText('This page is emailed to you', { exact: false });
        await show(emailed, 'Every Sunday morning', { where: 'above' });
        await d.caption({ chip: 'MY WEEK', title: 'A copy every Sunday', text: 'My Week is emailed to you on Sunday mornings when there is something on it. Turn that off under My Household & Preferences.' });
        await d.hold(3800);
        await d.clear();

        d.mark('missing');
        await show(main.getByText('Something missing?', { exact: false }), 'Matched by your name', { where: 'above' });
        await d.caption({ chip: 'MY WEEK', title: 'Something missing?', text: 'Serving jobs are matched by your name on the Service Roster, so a different spelling there will not show. Your sign-in must be linked to the directory too.' });
        await d.hold(4000);
        await d.clear();
      },
    },
  ],
};
