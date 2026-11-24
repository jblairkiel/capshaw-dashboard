// For admins: the three tools only an admin can reach, on the Admin menu.
//
//   Bug Reports     everything filed from "Report a problem" at the foot of
//                   every page (BugReportDialog), and moving each through triage
//   View as         seeing the portal exactly as one member does, from Members &
//                   Access, with a banner on top until "Back to my own account"
//   Action History  every change anybody has made through the portal
//
// View as changes the signed-in session itself (server-side, and every segment
// shares the one session), so it has a segment of its own and always ends by
// pressing "Back to my own account". Action History comes last, so the entries
// the earlier segments made (the report, its new status, starting and stopping
// View as) are there to look at: the sample data seeds neither bug reports nor
// history, on purpose (server/seed/index.js).
//
// Nothing is staged: every press is real, in the run's throwaway copy of the
// site. Nobody is emailed (lib/servers.js blanks the mail settings).
const REPORT = {
  title: 'Song numbers run off the edge on my phone',
  description: 'On the Song Tracker, the hymnal numbers are cut off at the right-hand side of the screen.',
};

module.exports = {
  description: 'For admins: Bug Reports, viewing the portal as a member, and the Action History',
  pace: 0.9,
  // Every caption stays up for at least this long, so it can be read.
  stepSeconds: 10,

  cards: {
    title: {
      kicker: 'MEMBER PORTAL · FOR ADMINS',
      heading: 'Admin-only tools',
      sub: 'Bug reports, seeing the portal as a member, and the history of every change',
      note: 'All names and details shown are sample data.',
    },
    end: {
      heading: 'The tools behind the portal',
      items: [
        'Report a problem, on every page', 'Admin → Bug Reports', 'Status and a note for the reporter',
        'View as, from Members & Access', 'Back to my own account', 'Admin → Action History',
      ],
      note: 'Capshaw Church of Christ · Member Portal',
    },
  },

  // A report filed earlier, so the list is not just the one the scene files.
  async prepare({ request }) {
    const filed = await request.post('/api/bug-reports', {
      multipart: {
        title: 'The week arrows are hard to tap',
        description: 'On the Weekly Newsletter the arrows beside the date are very small on a phone.',
        severity: 'minor',
        page: 'bulletin',
        pageLabel: 'Weekly Newsletter',
      },
    });
    if (!filed.ok()) throw new Error(`Filing the sample bug report failed: ${filed.status()}`);
  },

  segments: [
    // ─── Bug reports ────────────────────────────────────────────────────────
    {
      name: 'bug-reports',
      device: 'desktop',
      start: '/?page=my-week',
      ready: ({ page }) => page.getByRole('button', { name: 'Report a problem', exact: true }),
      async run({ d, page }) {
        const link = page.getByRole('button', { name: 'Report a problem', exact: true });
        await d.reveal(link);
        await d.callout(link, 'At the foot of every page', { where: 'above' });
        await d.caption({ chip: 'BUG REPORTS', title: 'Anyone can report a problem', text: 'Every page ends with Report a problem. It notes which page they were on, the address and their browser, so they only say what happened.' });
        await d.hold(2400);
        await d.clear();
        await d.click(link);
        const dialog = page.getByRole('dialog', { name: 'Report a problem' });
        await dialog.waitFor({ timeout: 10000 });
        await d.sleep(500);

        d.mark('file');
        await d.click(dialog.getByPlaceholder(/^The week dropdown/), { ms: 500 });
        await d.type(REPORT.title, 45);
        await d.click(dialog.getByPlaceholder('What you saw, and what you expected instead'), { ms: 500 });
        await d.type(REPORT.description, 35);
        await d.click(dialog.getByRole('radio', { name: 'Just a little something' }), { ms: 500 });
        await d.caption({ chip: 'BUG REPORTS', title: 'Say what went wrong', text: 'A few words, what happened, and how much it is in the way. A screenshot can be added too. Every admin gets a notification.' });
        await d.hold(2200);
        await d.click(dialog.getByRole('button', { name: 'Send report' }), { ms: 600 });
        await dialog.getByText('been filed', { exact: false }).waitFor({ timeout: 15000 });
        await d.hold(2200);
        await d.click(dialog.getByRole('button', { name: 'Done' }), { ms: 500 });
        await dialog.waitFor({ state: 'detached', timeout: 10000 });
        await d.sleep(400);

        d.mark('triage');
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
        await d.sleep(700);
        await d.nav('Admin', 'Bug Reports');
        await page.getByRole('heading', { name: 'Bug Reports' }).waitFor({ timeout: 15000 });
        await d.sleep(600);
        const row = page.getByRole('button', { name: `Bug report: ${REPORT.title}` });
        await row.waitFor({ timeout: 15000 });
        await d.callout(row, 'Newest first', { where: 'below' });
        await d.caption({ chip: 'FOR ADMINS', title: 'Bug Reports', text: 'Admin → Bug Reports lists everything filed, newest first, with how much it is in the way. Only admins can see it.' });
        await d.hold(2600);
        await d.clear();
        await d.click(row);
        const status = page.getByLabel('Status');
        await status.waitFor({ timeout: 10000 });
        await d.sleep(500);
        await d.click(status, { ms: 500 });
        await status.selectOption('in_progress');
        await d.sleep(400);
        await d.click(page.getByPlaceholder('What was done about it'), { ms: 500 });
        await d.type('Thanks, we are looking into it.', 50);
        await d.caption({ chip: 'FOR ADMINS', title: 'Move it along', text: 'Set the status and leave a note. When the status changes, whoever filed it gets a notification with your note.' });
        await d.hold(2000);
        await d.click(page.getByRole('button', { name: 'Save', exact: true }), { ms: 500 });
        await d.sleep(800);
        const badge = row.getByText('In progress', { exact: true });
        if (await badge.isVisible().catch(() => false)) await d.callout(badge, 'Updated', { where: 'below' });
        await d.hold(2400);
        await d.clear();
      },
    },

    // ─── View as a member ───────────────────────────────────────────────────
    // Its own segment, ended by "Back to my own account": see the top.
    {
      name: 'view-as',
      device: 'desktop',
      start: '/?page=users',
      ready: ({ page }) => page.getByRole('heading', { name: 'Members & Access' }),
      async run({ d, page }) {
        // Any ordinary member's row: the badge reads "Member".
        const row = page.locator('tbody tr').filter({ has: page.getByText('Member', { exact: true }) }).first();
        await row.waitFor({ timeout: 15000 });
        const viewAs = row.getByRole('button', { name: /^View as / });
        await d.reveal(viewAs);
        await d.callout(viewAs, 'On every member\'s row', { where: 'below', alignRight: true });
        await d.caption({ chip: 'FOR ADMINS', title: 'See what a member sees', text: 'When someone says a button is missing, choose View as on their row in Members & Access. It is offered for members, not for other admins.' });
        await d.hold(2800);
        await d.clear();

        d.mark('viewing');
        // The portal reloads as them.
        await d.click(viewAs);
        const back = page.getByRole('button', { name: 'Back to my own account' });
        // If the pointer press missed (the button sits in a wide table), press it directly.
        if (!(await back.waitFor({ timeout: 4000 }).then(() => true, () => false))) await viewAs.click();
        await back.waitFor({ timeout: 20000 });
        await d.sleep(900);
        await d.callout(back.locator('..'), 'Always on screen', { where: 'below' });
        await d.caption({ chip: 'VIEW AS', title: 'Their portal, your keyboard', text: 'Every page now shows exactly what they see, and the banner stays up. Anything you change is theirs, and is recorded against you.' });
        await d.hold(4400);
        await d.clear();

        d.mark('their-guests');
        await d.nav('Our Church Family', 'Guests');
        await page.getByRole('heading', { name: 'Our Guests' }).waitFor({ timeout: 15000 });
        await d.sleep(800);
        await d.callout(page.getByRole('heading', { name: 'Our Guests' }).locator('..'), 'No Record guests button', { where: 'below' });
        await d.caption({ chip: 'VIEW AS', title: 'Only their buttons', text: 'Guests shows no Record guests here, because this member has not been given the Guest Tracker area. Admin is gone from the menu too.' });
        await d.hold(4400);
        await d.clear();

        d.mark('back');
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
        await d.sleep(600);
        await d.click(back);
        await back.waitFor({ state: 'detached', timeout: 15000 });
        await d.sleep(800);
        await d.caption({ chip: 'VIEW AS', title: 'Back to your own account', text: 'Back to my own account ends it, and you are an admin again. Starting and stopping are both kept in the Action History.' });
        await d.hold(4400);
      },
    },

    // ─── Action History ─────────────────────────────────────────────────────
    {
      name: 'history',
      device: 'desktop',
      start: '/?page=my-week',
      // The Admin menu, which the first step opens.
      ready: ({ page }) => page.locator('button').filter({ has: page.locator('span', { hasText: /^Admin$/ }) }).first(),
      async run({ d, page }) {
        await d.nav('Admin', 'Action History');
        await page.getByRole('heading', { name: 'Action History' }).waitFor({ timeout: 15000 });
        await page.locator('tbody tr').first().waitFor({ timeout: 15000 });
        await d.sleep(700);

        d.mark('list');
        const filters = page.locator('div.card').filter({ has: page.getByText('What happened', { exact: true }) }).first();
        await d.callout(filters, 'Narrow it down', { where: 'below' });
        await d.caption({ chip: 'FOR ADMINS', title: 'Who changed what, and when', text: 'Admin → Action History lists every change made through the portal. Filter by area, by what happened, or by who, or search.' });
        await d.hold(4600);
        await d.clear();

        d.mark('entry');
        const marked = page.locator('tbody tr').filter({ hasText: 'Marked "' }).first();
        const entry = (await marked.count()) ? marked : page.locator('tbody tr').first();
        await d.click(entry);
        const detail = page.getByRole('dialog');
        await detail.waitFor({ timeout: 10000 });
        await d.sleep(600);
        await d.callout(detail, 'What it was, and what it became', { where: 'above' });
        await d.caption({ chip: 'FOR ADMINS', title: 'Open any entry', text: 'Each entry opens to show what changed, field by field. A change made while viewing as a member names you and them both.' });
        await d.hold(4600);
        await d.clear();
        await page.keyboard.press('Escape');
        await d.sleep(500);
      },
    },
  ],
};
