// Jobs on the site: what changes for somebody an admin has given an area to
// look after. Each area is the Add and Edit buttons on one part of the site
// (client/src/lib/roles.js, AREAS), handed out on Members & Access. This guide
// covers four of them:
//
//   Serving Schedule  (serving-schedule)  Worship → Service Roster: build the
//                     month, fill or change any slot, Preferences and Analysis tabs
//   Worship Organizer (worship-order)     Worship → Upcoming Service: Confirm a
//                     submitted service, the Service Parts tab, the printed order
//   Guest Tracker     (visitors)          Our Church Family → Guests: Record
//                     guests, record a visit, edit a guest's details
//   Weekly Newsletter (bulletin)          Church Office → Weekly Newsletter: the
//                     page itself only appears for this area (App.jsx OFFICE_ITEMS)
//
// The signed-in account is an admin, so it holds every area and sees all of
// these at once.
//
// Staged:
//   - "Save" and "Export PDF" on the Weekly Newsletter are shown, not pressed.
//     Saving writes the evangelists bug (#94) into the data, and Export saves
//     first. The page shown after the Export press is the one the export
//     endpoint itself produced during `prepare` (the same as tour.js).
// Everything else is pressed for real in the run's throwaway copy of the site.
// No email is ever sent (lib/servers.js blanks the mail settings).
const fs = require('fs');
const path = require('path');

const thisSunday = () => {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - now.getUTCDay()));
  return d.toISOString().slice(0, 10);
};

module.exports = {
  description: 'Jobs on the site: the schedule keeper, worship organizer, guests and newsletter',
  pace: 0.9,
  // Every caption stays up for at least this long, so it can be read.
  stepSeconds: 10,

  cards: {
    title: {
      kicker: 'MEMBER PORTAL · HOW TO',
      heading: 'Jobs on the site',
      sub: 'For anyone the church office has given an area to look after',
      note: 'All names and details shown are sample data.',
    },
    end: {
      heading: 'One area, one job',
      items: [
        'Admins give areas on Members & Access', 'Serving Schedule: fill any slot', 'Worship Organizer: Confirm',
        'Guest Tracker: Record guests', 'Weekly Newsletter: Church Office', 'Ask an admin for an area',
      ],
      note: 'Capshaw Church of Christ · Member Portal',
    },
  },

  // The newsletter as its own export produces it, for the scene to show
  // without pressing Export (see Staged above).
  async prepare({ request, work, python }) {
    const pdf = await request.get(`/api/bulletin/${thisSunday()}/export.pdf`);
    if (!pdf.ok()) throw new Error(`Exporting the newsletter failed: ${pdf.status()}`);
    fs.writeFileSync(path.join(work, 'assets', 'newsletter.pdf'), await pdf.body());
    await python('setup/pdf_page.py', [path.join(work, 'assets', 'newsletter.pdf'), path.join(work, 'assets', 'newsletter-p1.png')]);
  },

  segments: [
    // ─── Where areas come from ──────────────────────────────────────────────
    {
      name: 'areas',
      device: 'desktop',
      start: '/?page=users',
      ready: ({ page }) => page.getByRole('heading', { name: 'Members & Access' }),
      async run({ d, page }) {
        // Any ordinary member's row: the badge reads "Member".
        const row = page.locator('tbody tr').filter({ has: page.getByText('Member', { exact: true }) }).first();
        await row.waitFor({ timeout: 15000 });
        await d.click(row.getByRole('button', { name: /^Manage / }));
        const panel = page.getByRole('dialog', { name: /^Details for / });
        await panel.waitFor({ timeout: 10000 });
        await d.sleep(600);
        const heading = panel.getByRole('heading', { name: /looks after$/ });
        await heading.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'start' }));
        await d.sleep(900);
        const picker = panel.getByRole('checkbox', { name: 'Serving Schedule', exact: true }).locator('xpath=ancestor::label[1]');

        d.mark('areas');
        await d.callout([heading, picker], 'Each tick is one job', { where: 'below' });
        await d.caption({ chip: 'JOBS ON THE SITE', title: 'An area is a job', text: 'An admin hands out jobs on Members & Access, one area at a time. Each area adds the buttons on one part of the site, and nothing else.' });
        await d.hold(4600);
        await d.clear();
        await page.keyboard.press('Escape');
        await d.sleep(500);
      },
    },

    // ─── Serving Schedule ───────────────────────────────────────────────────
    {
      name: 'serving-schedule',
      device: 'desktop',
      start: '/?page=service-roster',
      ready: ({ page }) => page.getByRole('heading', { name: 'Service Roster' }),
      async run({ d, page, facts }) {
        const build = page.getByRole('button', { name: 'Build a month' });
        await build.waitFor({ timeout: 15000 });
        await d.sleep(600);

        d.mark('keeper');
        await d.callout([page.getByRole('tab', { name: 'Scheduled' }), page.getByRole('tab', { name: 'Analysis' })], 'Only for the schedule keeper', { where: 'above' });
        await d.callout(build, 'Lay out a whole month', { where: 'below', alignRight: true });
        await d.caption({ chip: 'SERVING SCHEDULE AREA', title: 'The schedule keeper', text: 'With the Serving Schedule area, Worship → Service Roster gains Build a month, the Preferences and Analysis tabs, and any name can be changed.' });
        await d.hold(4600);
        await d.clear();

        d.mark('open-slot');
        const open = page.getByRole('button', { name: /: open — change$/ }).first();
        if (await open.count()) {
          await d.reveal(open);
          await d.callout(open, 'Nobody yet', { where: 'above' });
          await d.caption({ chip: 'SERVING SCHEDULE AREA', title: 'Fill an open slot', text: 'Open slots stand out in orange. Click one to see who is free that day and has said they will do that job.' });
          await d.hold(2400);
          await d.clear();
          await d.click(open);
          const picker = page.getByRole('dialog');
          await picker.waitFor({ timeout: 10000 });
          const list = picker.getByRole('list', { name: 'Who could take it' });
          await list.waitFor({ timeout: 10000 }).catch(() => {});
          await d.sleep(800);
          const best = list.getByRole('button').first();
          if ((await best.count()) && await best.isEnabled().catch(() => false)) {
            await d.callout(best, 'Best fit', { where: 'below' });
            await d.hold(1800);
            await d.clear();
            await d.click(best);
          } else {
            await d.click(picker.getByLabel('Or type a name'), { ms: 500 });
            await d.type(facts.volunteer, 60);
            await d.click(picker.getByRole('button', { name: 'Put in' }), { ms: 500 });
          }
          await picker.waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
          await d.sleep(900);
          await d.caption({ chip: 'SERVING SCHEDULE AREA', title: 'They hear about it', text: 'Whoever you put in is told on their bell, and by email if they have an address. Whoever was taken off is told too.' });
          await d.hold(4400);
          await d.clear();
        }
      },
    },

    // ─── Worship Organizer ──────────────────────────────────────────────────
    {
      name: 'worship-organizer',
      device: 'desktop',
      start: '/?page=upcoming',
      ready: ({ page }) => page.getByRole('heading', { name: 'Upcoming Service' }),
      async run({ d, page }) {
        const waiting = page.getByRole('region').filter({ has: page.getByRole('button', { name: 'Confirm', exact: true }) }).first();
        await waiting.waitFor({ timeout: 15000 });
        await d.sleep(600);

        d.mark('submitted');
        await d.reveal(waiting.getByText('Waiting to be confirmed'));
        await d.callout(waiting.locator('header'), 'Waiting to be confirmed', { where: 'below' });
        await d.caption({ chip: 'WORSHIP ORGANIZER AREA', title: 'A service to confirm', text: 'When a song leader submits a service, the worship organizer is told. It waits on Upcoming Service for the organizer to confirm.' });
        await d.hold(4400);
        await d.clear();

        d.mark('confirm');
        const confirm = waiting.getByRole('button', { name: 'Confirm', exact: true });
        await d.click(confirm);
        const done = page.getByRole('status').filter({ hasText: 'Confirmed the' });
        await done.waitFor({ timeout: 15000 });
        await d.sleep(500);
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
        await d.sleep(800);
        await d.callout(done, 'Confirmed', { where: 'below' });
        await d.caption({ chip: 'WORSHIP ORGANIZER AREA', title: 'Confirm it', text: 'Confirm puts its songs in the song tracker and tells the song leader who submitted it. You can still choose Change it afterwards.' });
        await d.hold(4400);
        await d.clear();
      },
    },

    // ─── Guest Tracker ──────────────────────────────────────────────────────
    {
      name: 'guests',
      device: 'desktop',
      start: '/?page=visitors',
      ready: ({ page }) => page.getByRole('heading', { name: 'Our Guests' }),
      async run({ d, page, facts }) {
        const record = page.getByRole('button', { name: 'Record guests', exact: true });
        await record.waitFor({ timeout: 15000 });
        await d.sleep(600);

        d.mark('record');
        await d.callout(record, 'Guest Tracker area', { where: 'below', alignRight: true });
        await d.caption({ chip: 'GUEST TRACKER AREA', title: 'Record who visited', text: 'Everyone can see Guests. With the Guest Tracker area you also get Record guests, for everyone who visited one service.' });
        await d.hold(2400);
        await d.clear();
        await d.click(record);
        const dialog = page.getByRole('dialog', { name: 'Record guests' });
        await dialog.waitFor({ timeout: 10000 });
        await d.sleep(500);

        const everyday = dialog.getByRole('group', { name: 'Everyday services' }).getByRole('button').first();
        if (await everyday.isVisible().catch(() => false)) {
          await d.click(everyday, { ms: 500 });
        } else {
          await d.click(dialog.getByLabel('Service', { exact: true }), { ms: 500 });
          await d.type('Sunday AM Worship', 50);
        }
        await d.click(dialog.getByPlaceholder(/Search returning guests/), { ms: 500 });
        await d.type(facts.guest, 70);
        await d.sleep(500);
        const match = dialog.locator('li > button').filter({ has: page.locator('span', { hasText: facts.guest }) }).first();
        await match.waitFor({ timeout: 10000 });
        await d.callout(match, 'Been before', { where: 'below' });
        await d.caption({ chip: 'GUEST TRACKER AREA', title: 'Returning or new', text: 'Pick the day and the service, then search for guests who have been before. Someone new is added with how to reach them.' });
        await d.hold(2600);
        await d.clear();
        await d.click(match, { ms: 500 });
        await d.sleep(500);
        await d.click(dialog.getByRole('button', { name: /^Record \d+ guests?$/ }), { ms: 600 });
        await dialog.waitFor({ state: 'detached', timeout: 15000 });
        // The list reloads after a save (a spinner, then the table again).
        await page.locator('tbody tr').first().waitFor({ timeout: 15000 });
        await d.sleep(700);
        const notice = page.getByRole('status').filter({ hasText: 'Recorded' });
        if (await notice.isVisible().catch(() => false)) await d.callout(notice, 'Saved', { where: 'below' });
        await d.hold(1200);
        await d.clear();

        d.mark('follow-up');
        const followUp = page.locator('tbody').getByRole('button', { name: /^Follow up( again)?$/ }).first();
        if (await followUp.isVisible().catch(() => false)) {
          await d.click(followUp);
          const start = page.getByRole('dialog', { name: /^Follow up with / });
          await start.waitFor({ timeout: 10000 });
          await d.sleep(600);
          const who = start.getByLabel(/Who should reach out/);
          await who.waitFor({ timeout: 10000 });
          await d.click(who, { ms: 500 });
          await who.selectOption({ label: facts.me.name }).catch(() => who.selectOption({ index: 1 }));
          await d.sleep(500);
          await d.caption({ chip: 'GUESTS', title: 'Ask someone to follow up', text: 'Any member can ask someone to reach out. They are emailed and find it in My Inbox. Phoned them or Emailed them closes it.' });
          await d.click(start.getByRole('button', { name: 'Start workflow' }), { ms: 600 });
          const phoned = start.getByRole('button', { name: 'Phoned them' }).first();
          if (await phoned.waitFor({ timeout: 10000 }).then(() => true, () => false)) {
            await d.hold(2200);
            await d.click(phoned, { ms: 600 });
          }
          await d.hold(2400);
          await page.keyboard.press('Escape');
          await d.sleep(500);
        }
      },
    },

    // ─── Weekly Newsletter ──────────────────────────────────────────────────
    {
      name: 'newsletter',
      device: 'desktop',
      start: '/?page=my-week',
      // The Church Office menu, which the first step opens.
      ready: ({ page }) => page.locator('button').filter({ has: page.locator('span', { hasText: /^Church Office$/ }) }).first(),
      async run({ d, page, facts }) {
        await d.nav('Church Office', 'Weekly Newsletter');
        await page.getByRole('heading', { name: 'Weekly Newsletter' }).waitFor({ timeout: 15000 });
        await d.sleep(600);

        d.mark('write');
        const updates = page.getByLabel(/^Updates/);
        await d.click(updates);
        await page.keyboard.press('Control+End');
        await d.caption({ chip: 'WEEKLY NEWSLETTER AREA', title: 'The newsletter', text: 'With the Weekly Newsletter area, Church Office → Weekly Newsletter appears. Type this week\'s prayer lists, one entry to a line.' });
        await d.type(`\nWelcome home to the ${facts.otherFamily} family!`, 45);
        await d.hold(2600);
        await d.step();

        await d.callout(page.getByText('Filled in from the site').locator('..'), 'Pulled in automatically', { where: 'above', alignRight: true });
        await d.caption({ chip: 'WEEKLY NEWSLETTER AREA', title: 'The rest fills itself in', text: 'Reminders, last week\'s numbers, the duty roster, elders and deacons come from the pages that own them. Change them there.' });
        await d.hold(4400);
        await d.clear();

        d.mark('export');
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
        await d.sleep(700);
        // Staged (see the top of the file): Save and Export both write issue #94.
        await d.click(page.getByRole('button', { name: 'Save', exact: true }), { real: false });
        await d.sleep(400);
        await d.click(page.getByRole('button', { name: 'Export PDF' }), { real: false });
        await d.showImage('newsletter-p1.png');
        await d.caption({ chip: 'WEEKLY NEWSLETTER AREA', title: 'Save, then export', text: 'Save keeps this week\'s lists. Export it as a PDF or Word document, or choose Email newsletter to send it to a mailing list.' });
        await d.hold(4600);
        await d.step();
        await d.hideImage();
        await d.sleep(500);
      },
    },
  ],
};
