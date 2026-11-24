// Church Groups: saying whether you can come to your group's meeting,
// signing up to bring something, replying under it, and, for a group's
// leaders, posting a meeting.
//
// `facts.group` is a group the signed-in account leads, and `facts.event` its
// next meeting, which takes answers and sign-ups (setup/index.js). The member
// half opens that meeting from "Coming up" on the landing page, which shows it
// as any member of the group sees it (no leader buttons). The leader half posts
// a new meeting of its own to the same group.
//
// Nothing is staged: every press is real, in the run's throwaway copy of the
// site. Posting a meeting asks "Post this to the group?" in a browser dialog,
// which the scene accepts; the group's email is never sent (lib/servers.js
// blanks the mail settings, and sample groups have no mailing list anyway).

// A date a few weeks out, worked out on the day, never typed in as a date.
const isoInDays = n => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// What the leader scene posts. Not a person or a date, so it can be fixed.
const MEETING = { title: 'Supper and a short devotional', where: 'Fellowship Hall', bring: 'Bread rolls' };

module.exports = {
  description: 'Church Groups: RSVP, bring something, reply, and (for leaders) post a meeting',
  pace: 0.9,
  // Every caption stays up for at least this long, so it can be read.
  stepSeconds: 10,

  cards: {
    title: {
      kicker: 'MEMBER PORTAL · HOW TO',
      heading: 'Church Groups',
      sub: 'Say if you can come, bring something, and post a meeting',
      note: 'All names and details shown are sample data.',
    },
    end: {
      heading: 'Your group, all in one place',
      items: [
        'Our Church Family → Church Groups', 'Open a meeting under Coming up', 'Coming, Maybe or Can\'t make it',
        'I\'ll bring it', 'Reply under the meeting', 'Leaders: Post a meeting',
      ],
      note: 'Capshaw Church of Christ · Member Portal',
    },
  },

  segments: [
    // ─── As a member of the group ───────────────────────────────────────────
    {
      name: 'member',
      device: 'desktop',
      start: '/?page=my-week',
      // The Our Church Family menu, which the first step opens.
      ready: ({ page }) => page.locator('button').filter({ has: page.locator('span', { hasText: /^Our Church Family$/ }) }).first(),
      async run({ d, page, facts }) {
        await d.caption({ chip: 'CHURCH GROUPS', title: 'Your groups, in one place', text: 'Church Groups is under Our Church Family. It shows the groups you are in and what each one has coming up.' });
        await d.hold(3600);
        await d.step();

        d.mark('coming-up');
        await d.nav('Our Church Family', 'Church Groups');
        await page.getByRole('heading', { name: 'Church Groups' }).waitFor({ timeout: 15000 });
        await d.sleep(600);
        const comingUp = page.locator('section').filter({ has: page.getByRole('heading', { name: /^coming up$/i }) });
        const card = comingUp.locator('div.card').filter({ hasText: facts.event.title }).first();
        await card.waitFor({ timeout: 15000 });
        await d.callout(card, 'Your group\'s next meeting', { where: 'below' });
        await d.caption({ chip: 'CHURCH GROUPS', title: 'Coming up', text: 'Meetings in your groups are listed first, with when and where. Open one to see everything about it.' });
        await d.hold(3800);
        await d.clear();
        await d.click(card.getByRole('button', { name: 'Open', exact: true }));
        const canCome = card.getByText('Can you come?');
        await canCome.waitFor({ timeout: 15000 });
        await d.sleep(600);

        d.mark('rsvp');
        const rsvp = canCome.locator('..');
        await d.reveal(rsvp);
        await d.callout(rsvp, 'Can you come?', { where: 'above' });
        await d.caption({ chip: 'CHURCH GROUPS', title: 'Say if you can come', text: 'Choose Coming, Maybe or Can\'t make it, and say how many others you are bringing. The leaders get a notification when you answer.' });
        await d.hold(2400);
        await d.click(rsvp.getByRole('button', { name: 'Coming', exact: true }));
        await d.hold(2400);
        await d.clear();

        d.mark('bring');
        const bring = card.getByPlaceholder('what you\'ll bring').first();
        if (await bring.isVisible().catch(() => false)) {
          const item = bring.locator('xpath=ancestor::li[1]');
          await d.reveal(item);
          await d.callout(item, 'Still needed', { where: 'above' });
          await d.caption({ chip: 'CHURCH GROUPS', title: 'Bring something', text: 'Pick something still needed, say what you will bring, and choose I\'ll bring it. The leaders are told. Plans change? Choose I can\'t after all.' });
          await d.hold(1600);
          await d.click(bring, { ms: 600 });
          await d.type('Banana bread', 80);
          await d.click(bring.locator('xpath=following::button[1]'), { ms: 450 });
          await d.hold(2600);
          await d.clear();
        }

        d.mark('reply');
        const reply = card.getByPlaceholder('Say something…');
        await d.click(reply, { ms: 600 });
        await d.caption({ chip: 'CHURCH GROUPS', title: 'Talk it over', text: 'Ask a question or reply under the meeting. The leaders, and anyone who has answered or replied, get a notification.' });
        await d.type('Looking forward to it. Should we bring folding chairs?', 50);
        await d.click(card.getByRole('button', { name: 'Post', exact: true }), { ms: 450 });
        await d.sleep(800);
        const posted = card.getByText('Should we bring folding chairs?').first();
        if (await posted.isVisible().catch(() => false)) {
          await d.callout(posted.locator('xpath=ancestor::li[1]'), 'Your reply', { where: 'above' });
        }
        await d.hold(2600);
        await d.clear();
      },
    },

    // ─── As the group's leader ───────────────────────────────────────────────
    {
      name: 'leader',
      device: 'desktop',
      start: '/?page=groups',
      ready: ({ page }) => page.getByRole('heading', { name: 'Church Groups' }),
      async run({ d, page, facts }) {
        const mine = page.locator('section').filter({ has: page.getByRole('heading', { name: /^my groups$/i }) });
        await d.click(mine.getByText(facts.group.name, { exact: true }).first());
        const postButton = page.getByRole('button', { name: 'Post a meeting', exact: true });
        await postButton.waitFor({ timeout: 15000 });
        await d.sleep(600);

        d.mark('post-a-meeting');
        await d.callout(postButton, 'For the group\'s leaders', { where: 'below' });
        await d.caption({ chip: 'FOR GROUP LEADERS', title: 'Post a meeting', text: 'A group\'s leaders and co-leaders get Post a meeting on its page. Say what, when and where, and list anything people could bring.' });
        await d.hold(2000);
        await d.clear();
        await d.click(postButton);
        const form = page.locator('form').filter({ has: page.getByRole('heading', { name: 'A new meeting' }) });
        await form.waitFor({ timeout: 10000 });
        await d.sleep(400);

        await d.click(form.getByLabel('What is it'), { ms: 500 });
        await d.type(MEETING.title, 50);
        const date = form.getByLabel('Date', { exact: true });
        await d.click(date, { ms: 500 }); await date.fill(isoInDays(24)); await d.sleep(300);
        const starts = form.getByLabel('Starts', { exact: true });
        await d.click(starts, { ms: 500 }); await starts.fill('18:00'); await d.sleep(300);
        await d.click(form.getByLabel('Where', { exact: true }), { ms: 500 });
        await d.type(MEETING.where, 50);
        await d.click(form.getByRole('button', { name: 'Add something needed' }), { ms: 500 });
        await d.click(form.getByPlaceholder('Dessert').last(), { ms: 500 });
        await d.type(MEETING.bring, 60);
        await d.hold(1200);

        d.mark('draft');
        const save = form.getByRole('button', { name: 'Save as a draft' });
        await d.callout(save, 'Nobody is told yet', { where: 'above' });
        await d.caption({ chip: 'FOR GROUP LEADERS', title: 'Saved as a draft first', text: 'Save as a draft keeps it to the group\'s leaders. Nobody else sees it, or is told about it, until you post it.' });
        await d.hold(2200);
        await d.clear();
        await d.click(save);
        await form.waitFor({ state: 'detached', timeout: 15000 });
        const draft = page.locator('div.card').filter({ hasText: MEETING.title }).first();
        await draft.waitFor({ timeout: 15000 });
        await d.sleep(600);
        await d.click(draft.getByRole('button', { name: 'Open', exact: true }));
        const post = draft.getByRole('button', { name: 'Post it to the group' });
        await post.waitFor({ timeout: 10000 });
        await d.sleep(500);

        d.mark('post');
        await d.callout(post, 'When it is ready', { where: 'below' });
        await d.caption({ chip: 'FOR GROUP LEADERS', title: 'Post it to the group', text: 'Everyone on the roll with an account gets a notification, and the group\'s mailing list is emailed with a link to the meeting.' });
        await d.hold(2600);
        await d.clear();
        // The press asks "Post this to the group?" in a browser dialog: say yes.
        page.once('dialog', dialog => dialog.accept().catch(() => {}));
        await d.click(post);
        await draft.getByText('Posted', { exact: true }).waitFor({ timeout: 15000 });
        await d.sleep(600);
        await d.callout(draft.locator('span', { hasText: /^Posted$/ }).first(), 'Posted', { where: 'above' });
        await d.hold(2000);
        await d.clear();

        d.mark('in-person');
        const meeting = page.locator('div.card').filter({ hasText: facts.event.title }).first();
        const open = meeting.getByRole('button', { name: 'Open', exact: true });
        if (await open.isVisible().catch(() => false)) {
          await d.click(open);
          await meeting.getByText('Can you come?').waitFor({ timeout: 15000 }).catch(() => {});
          await d.sleep(600);
        }
        const answerBox = meeting.getByText(/^Write down an answer/).locator('..');
        const putDown = meeting.getByRole('combobox', { name: /^Put somebody down for / }).first();
        const shown = (await answerBox.isVisible().catch(() => false)) ? answerBox
          : (await putDown.isVisible().catch(() => false)) ? putDown : null;
        if (shown) {
          await d.reveal(shown);
          await d.callout(shown, 'For the leaders', { where: 'above' });
          await d.caption({ chip: 'FOR GROUP LEADERS', title: 'Answers given in person', text: 'Someone told you at church? Write down their answer, or put them down to bring something, for anyone on the roll.' });
          await d.hold(2000);
          if (shown === answerBox) {
            const who = answerBox.getByRole('combobox', { name: 'Who told you' });
            await d.click(who, { ms: 500 });
            await who.selectOption({ index: 1 });
            await d.sleep(400);
            await d.click(answerBox.getByRole('button', { name: 'Coming', exact: true }), { ms: 500 });
          }
          await d.hold(2400);
          await d.clear();
        }
      },
    },
  ],
};
