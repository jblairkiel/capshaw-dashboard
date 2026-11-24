// For members: the bell in the header (NotificationsBell.jsx), what lands in
// it and how it is marked read, and My Inbox (InboxView.jsx), where the things
// waiting on you are done.
//
// Nobody writes to your bell about your own doing (lib/notifications.js), so
// `prepare` has somebody else in the signed-in member's group answer a new
// meeting: the admin session views the portal as that member (the app's own
// "view as" for admins), says yes, signs up to bring something and replies,
// then stops viewing as them. That puts three unread notifications in the bell.
// It also asks the signed-in member to follow up with a guest, which is what
// their inbox shows.
//
// Nothing is staged: every press is real, in the run's throwaway copy of the
// site, and nothing it would email is sent (lib/servers.js blanks the mail
// settings).
const churchToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// A JSON call as the signed-in admin, which fails loudly.
const caller = request => async (method, url, data) => {
  const res = await request[method](url, data === undefined ? undefined : { data });
  const json = await res.json().catch(() => ({}));
  if (!res.ok() || json.success === false) throw new Error(`${method.toUpperCase()} ${url} failed: ${res.status()} ${json.error || ''}`);
  return json;
};

module.exports = {
  description: 'For members: the bell and My Inbox, what lands there and marking it done',
  pace: 0.9,
  // Every caption stays up for at least this long, so it can be read.
  stepSeconds: 10,

  cards: {
    title: {
      kicker: 'MEMBER PORTAL · HOW TO',
      heading: 'The bell and My Inbox',
      sub: 'What is new for you, and what is waiting on you to do',
      note: 'All names and details shown are sample data.',
    },
    end: {
      heading: 'Nothing slips through',
      items: [
        'The bell counts what is new', 'Pick one to go to its page', 'Mark all read clears the count',
        'My Church → My Inbox', 'Open a request for the details', 'Press how it went to close it',
      ],
      note: 'Capshaw Church of Christ · Member Portal',
    },
  },

  async prepare({ request, facts }) {
    const api = caller(request);
    const group = facts.group.id;

    // Somebody else with an account, to do the things that ring the bell.
    const { users } = await api('get', '/api/auth/users');
    const other = users.find(u => u.role === 'approved' && u.directory_id && u.directory_id !== facts.me.directoryId);
    if (!other) throw new Error('The sample data has no other approved member with a directory entry.');
    // Already on the roll is fine.
    await request.post(`/api/groups/${group}/members`, { data: { directoryId: other.directory_id, role: 'member' } });

    // A new meeting of the member's own group, with things to bring.
    const { event } = await api('post', `/api/groups/${group}/events`, {
      title: 'Supper and singing', description: 'A sample meeting for the guide.', date: addDays(churchToday(), 6), time: '18:00',
      location: 'Fellowship Hall', rsvpEnabled: true, signupEnabled: true,
      signupItems: [{ label: 'Dessert', needed: 3 }, { label: 'Drinks', needed: 2 }],
    });
    await api('post', `/api/groups/${group}/events/${event.id}/publish`, {});

    // A guest follow-up for the signed-in member to do.
    const { visitors } = await api('get', '/api/visitors');
    const guest = visitors.find(v => v.phone || v.email) || visitors[0];
    if (!guest) throw new Error('The sample data has no guests to follow up with.');
    await api('post', '/api/workflows', {
      definitionId: 'visitor-follow-up',
      data: { visitorId: String(guest.id), assigneePersonId: String(facts.me.directoryId), notes: 'They asked about the Wednesday evening class.' },
    });

    // The other member answers, signs up and replies: three notifications for
    // the group's leaders, the signed-in member among them.
    await api('post', '/api/auth/impersonate', { userId: other.id });
    try {
      await api('post', `/api/groups/${group}/events/${event.id}/rsvp`, { response: 'yes', guests: 2 });
      const { event: full } = await api('get', `/api/groups/${group}/events/${event.id}`);
      const dessert = full.signups.find(s => s.label === 'Dessert') || full.signups[0];
      if (dessert) await api('post', `/api/groups/${group}/events/${event.id}/signups`, { itemId: dessert.id });
      await api('post', `/api/comments/group-event/${event.id}`, { body: 'Looking forward to it. What time should we come to help set up?' });
    } finally {
      // The recorded segments reuse this session, so it must be the admin's own again.
      await api('delete', '/api/auth/impersonate');
    }
  },

  segments: [
    {
      name: 'inbox',
      device: 'desktop',
      start: '/?page=my-week',
      ready: ({ page }) => page.getByRole('button', { name: /^Notifications/ }),
      async run({ d, page }) {
        const show = async (loc, label, opts) => { await d.reveal(loc); await d.callout(loc, label, opts); };
        const bell = page.getByRole('button', { name: /^Notifications/ });
        // The bell's panel, while it is open.
        const panel = page.locator('div.absolute').filter({ has: page.locator('p', { hasText: /^Notifications$/ }) }).first();

        d.mark('bell');
        await d.callout(bell, 'New for you', { where: 'below', alignRight: true });
        await d.caption({ chip: 'THE BELL', title: 'The bell, top right', text: 'The number on the bell counts what is new for you. It checks for more every minute while the portal is open.' });
        await d.hold(3600);
        await d.clear();

        d.mark('panel');
        await d.click(bell);
        await panel.waitFor({ timeout: 10000 });
        await d.sleep(800);
        await d.callout(panel, 'Newest first', { where: 'below', alignRight: true });
        await d.caption({ chip: 'THE BELL', title: 'What lands in the bell', text: 'Meetings posted for your groups, replies on them, and changes to your serving jobs, sign-ups and rotations. Group leaders also hear who is coming.' });
        await d.hold(4200);
        await d.clear();

        d.mark('read');
        const markAll = panel.getByRole('button', { name: 'Mark all read' });
        if (await markAll.isVisible().catch(() => false)) {
          await d.callout(markAll, 'Clears the count', { where: 'below', alignRight: true });
        }
        await d.caption({ chip: 'THE BELL', title: 'Looking is not the same as done', text: 'Opening the bell marks nothing read. Unread ones stay highlighted until you pick them, or press Mark all read.' });
        await d.hold(3800);
        await d.clear();

        d.mark('pick');
        await d.click(panel.locator('div.max-h-96 > button').first());
        await d.sleep(1200);
        await d.callout(bell, 'One fewer', { where: 'below', alignRight: true });
        await d.caption({ chip: 'THE BELL', title: 'One click takes you there', text: 'Picking one marks it read and opens the page it is about, so you can answer or take a look.' });
        await d.hold(3600);
        await d.clear();

        d.mark('inbox');
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
        await d.sleep(500);
        await d.nav('My Church', 'My Inbox');
        await page.getByRole('heading', { name: 'My Inbox' }).waitFor({ timeout: 15000 });
        await d.sleep(700);
        // The task asked of this member by name, rather than one for a job they hold.
        const mine = page.locator('main div.card')
          .filter({ has: page.getByRole('button', { name: 'Phoned them', exact: true }) })
          .filter({ hasNotText: 'anyone who is' })
          .first();
        await show(mine, 'Waiting on you', { where: 'below' });
        await d.caption({ chip: 'MY INBOX', title: 'Things waiting on you', text: 'The bell says what happened. My Inbox, under My Church, holds what is waiting on you to do, like a guest to follow up.' });
        await d.hold(4000);
        await d.clear();

        d.mark('detail');
        await d.click(mine.getByRole('button', { name: /^Follow up with/ }));
        const waiting = page.locator('main div.card').filter({ has: page.getByRole('heading', { name: 'Waiting on you', exact: true }) });
        await waiting.waitFor({ timeout: 15000 });
        await d.sleep(600);
        await d.callout(page.locator('main div.card').first(), 'Who to contact', { where: 'below' });
        await d.caption({ chip: 'MY INBOX', title: 'Everything about it', text: 'Open one to see who to contact, how it runs, and its history so far. The email you get about it links straight here.' });
        await d.hold(4000);
        await d.clear();
        await d.click(page.getByRole('button', { name: '← Back' }));
        await page.getByRole('heading', { name: 'My Inbox' }).waitFor({ timeout: 15000 });
        await d.sleep(600);

        d.mark('done');
        const emailed = mine.getByRole('button', { name: 'Emailed them', exact: true });
        const decline = mine.getByRole('button', { name: 'I cannot do this', exact: true });
        await d.reveal(emailed);
        await d.callout([emailed, decline], 'Say how it went', { where: 'below' });
        await d.caption({ chip: 'MY INBOX', title: 'Mark it done', text: 'Reached them? Press Emailed them or Phoned them. That closes it and notes it on the guest\'s record.' });
        await d.hold(3600);
        await d.clear();
        await d.click(mine.getByRole('button', { name: 'Phoned them', exact: true }));
        await d.sleep(1500);
        await d.caption({ chip: 'MY INBOX', title: 'Off your list', text: 'It leaves your inbox straight away. No answer keeps it for another try, and I cannot do this passes it to whoever looks after guests.' });
        await d.hold(4000);
        await d.step();

        const forJob = page.locator('main div.card').filter({ hasText: 'anyone who is' }).first();
        if (await forJob.isVisible().catch(() => false)) {
          d.mark('jobs');
          await show(forJob.getByText('anyone who is', { exact: false }).first(), 'For whoever holds the job', { where: 'below' });
          await d.caption({ chip: 'FOR JOB HOLDERS', title: 'Jobs you look after', text: 'If you look after part of the site, like Guests, its requests land here too, for anyone who holds that job.' });
          await d.hold(3800);
          await d.clear();
        }
      },
    },
  ],
};
