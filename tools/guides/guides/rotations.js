// Rotations (Our Church Family → Rotations): what a rotation is, how a member
// sees whether they are next up, and what the line, Upcoming and History mean.
// Then, for a rotation's coordinators, giving a turn.
//
// A rotation is a line of people from the directory who take something in
// turns; the first one not sitting out is next up (server/lib/rotations.js).
// Members read every rotation; a rotation's coordinators (and whoever holds
// the Rotations area) run it. The signed-in account is an admin, so it sees
// the coordinators' controls too, and the captions mark them.
//
// `prepare` puts facts.me at the front of the first rotation's line, so the
// page shows "That's you". Reordering tells nobody (server/routes/rotations.js).
// Nothing is staged: giving the turn is a real press in the throwaway site,
// and the email it writes is never sent (lib/servers.js).

// A local date a number of days from today, as the date box wants it.
const isoIn = days => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

module.exports = {
  description: 'Rotations: what they are, seeing when you are next up, and how turns are given',
  pace: 0.9,
  // Every caption stays up for at least this long, so it can be read.
  stepSeconds: 10,

  cards: {
    title: {
      kicker: 'MEMBER PORTAL · HOW TO',
      heading: 'Rotations',
      sub: 'The things we take in turns, and when yours comes round',
      note: 'All names and details shown are sample data.',
    },
    end: {
      heading: 'Your turn, never a surprise',
      items: [
        'Our Church Family → Rotations', 'A gold card means you are next up', 'First in line is next up',
        'Upcoming and History show the turns', 'Emailed when you are next up', 'Coordinators give the turns',
      ],
      note: 'Capshaw Church of Christ · Member Portal',
    },
  },

  // facts.me to the front of the first rotation still in use, joining it first
  // if they are not in it.
  async prepare({ request, facts }) {
    const res = await request.get('/api/rotations');
    if (!res.ok()) throw new Error(`Reading the rotations failed: ${res.status()}`);
    const rotation = (await res.json()).rotations.find(r => r.active);
    if (!rotation) throw new Error('The sample data has no rotation to show');
    const me = facts.me.directoryId;
    const detail = (await (await request.get(`/api/rotations/${rotation.id}`)).json()).rotation;
    let ids = detail.members.map(m => m.directoryId);
    if (!ids.includes(me)) {
      const add = await request.post(`/api/rotations/${rotation.id}/members`, { data: { directoryIds: [me] } });
      if (!add.ok()) throw new Error(`Adding ${facts.me.name} to the rotation failed: ${add.status()}`);
      ids = (await add.json()).rotation.members.map(m => m.directoryId);
    }
    const order = await request.put(`/api/rotations/${rotation.id}/order`, { data: { order: [me, ...ids.filter(id => id !== me)] } });
    if (!order.ok()) throw new Error(`Putting ${facts.me.name} at the front failed: ${order.status()}`);
  },

  segments: [
    {
      name: 'rotations',
      device: 'desktop',
      start: '/?page=my-week',
      // The Our Church Family menu, which the first step opens.
      ready: ({ page }) => page.locator('button').filter({ has: page.locator('span', { hasText: /^Our Church Family$/ }) }).first(),
      async run({ d, page }) {
        await d.caption({ chip: 'ROTATIONS', title: 'The things we take in turns', text: 'A rotation is a line of people who take turns at something, like teaching a class or hosting a baby shower.' });
        await d.hold(3600);
        await d.step();

        d.mark('index');
        await d.nav('Our Church Family', 'Rotations');
        await page.getByRole('heading', { name: 'Rotations', exact: true }).waitFor({ timeout: 15000 });
        const list = page.getByRole('list', { name: 'Rotations', exact: true });
        await list.waitFor({ timeout: 15000 });
        await d.sleep(600);
        const banner = page.getByRole('status').filter({ hasText: 'You are next up on' }).first();
        const mineCard = list.getByRole('button').filter({ hasText: 'That\'s you' }).first();
        const hasMine = await mineCard.isVisible().catch(() => false);
        if (await banner.isVisible().catch(() => false)) await d.callout(banner, 'Your turn is coming', { where: 'below' });
        else await d.callout(list, 'Every rotation', { where: 'above' });
        await d.caption({ chip: 'ROTATIONS', title: 'Are you next up?', text: 'Each card shows who is next up. When it is you, a banner says so and that card is outlined in gold.' });
        await d.hold(3000);
        await d.clear();
        if (hasMine) {
          await d.callout(mineCard, 'That\'s you', { where: 'below' });
          await d.hold(1800);
          await d.clear();
        }

        d.mark('open');
        await d.click(hasMine ? mineCard : list.getByRole('button').first());
        const nextUp = page.getByRole('region', { name: 'Next up', exact: true });
        await nextUp.waitFor({ timeout: 15000 });
        await d.sleep(600);
        await d.callout(nextUp, 'Who goes next', { where: 'below' });
        await d.caption({ chip: 'ROTATIONS', title: 'Open one to see it all', text: 'A rotation shows what a turn is, who coordinates it, and who is next up. Members can see every rotation.' });
        await d.hold(4000);
        await d.clear();

        d.mark('line');
        const line = page.getByRole('region', { name: 'The line', exact: true });
        await d.reveal(line);
        await d.callout(line, 'In order', { where: 'above' });
        await d.caption({ chip: 'THE LINE', title: 'First in line is next up', text: 'After a turn, that person goes to the back of the line. Anyone sitting out this time is skipped.' });
        await d.hold(4000);
        await d.clear();

        d.mark('turns');
        const upcoming = page.getByRole('region', { name: 'Upcoming', exact: true });
        const history = page.getByRole('region', { name: 'History', exact: true });
        await d.reveal(upcoming);
        await d.callout([upcoming, history], 'Turns given', { where: 'above' });
        await d.caption({ chip: 'TURNS', title: 'Upcoming, and History', text: 'Upcoming lists turns already given a date. History shows who has taken a turn, and when.' });
        await d.hold(4000);
        await d.clear();

        d.mark('told');
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
        await d.sleep(800);
        await d.callout(nextUp, 'You will hear', { where: 'below' });
        await d.caption({ chip: 'ROTATIONS', title: 'You are told when it is your turn', text: 'When the line moves on and you are next up, you are emailed and told on your bell. A dated turn gets a reminder a week before.' });
        await d.hold(4000);
        await d.clear();

        d.mark('give');
        const give = page.getByRole('form', { name: 'Give a turn' });
        if (await give.isVisible().catch(() => false)) {
          await d.reveal(give);
          await d.callout(give, 'Coordinators only', { where: 'below' });
          await d.caption({ chip: 'FOR COORDINATORS', title: 'Giving a turn', text: 'A rotation\'s coordinators give the turns, usually to whoever is next up. A date still to come shows it as upcoming.' });
          const on = give.locator('input[type=date]');
          await d.click(on, { ms: 500 });
          await on.fill(isoIn(21));
          await d.sleep(300);
          await d.hold(2000);
          await d.clear();
          await d.click(give.getByRole('button', { name: /^Give the turn/ }), { ms: 500 });
          // Says who was told: "<name> is next up and has been emailed to say so."
          const told = page.getByRole('status').filter({ hasText: /next up/ }).first();
          await told.waitFor({ timeout: 15000 }).catch(() => {});
          await d.sleep(700);

          d.mark('given');
          if (await told.isVisible().catch(() => false)) await d.callout(told, 'Who was told', { where: 'below' });
          await d.caption({ chip: 'FOR COORDINATORS', title: 'The line moves on', text: 'That person goes to the back, and the turn shows under Upcoming. Whoever is now next up is told, so they can get ready.' });
          await d.hold(4400);
          await d.clear();
        }
      },
    },
  ],
};
