// For admins: approving somebody who has signed up, on Members & Access, and
// pairing them with their entry in the member directory at the same time.
//
// `facts.pending` is a sample Google sign-up whose email address matches a
// directory entry (setup/index.js), so the dialog suggests that entry, the
// way it does for a real member. Nothing is staged: every press is real, in
// the run's throwaway copy of the site, and the approval email it writes is
// never sent (lib/servers.js blanks the mail settings).
module.exports = {
  description: 'For admins: approving a new member and pairing them with the directory',
  pace: 0.9,

  cards: {
    title: {
      kicker: 'MEMBER PORTAL · FOR ADMINS',
      heading: 'Approve a new member',
      sub: 'Let someone in, and say who they are in the directory',
      note: 'All names and details shown are sample data.',
    },
    end: {
      heading: 'Approved in one step',
      items: [
        'Admin → Members & Access', 'Click the orange banner', 'Approve on their row',
        'Pick their directory entry', 'Member, or Admin', 'Areas now or later',
      ],
      note: 'Capshaw Church of Christ · Member Portal',
    },
  },

  segments: [
    {
      name: 'approve',
      device: 'desktop',
      start: '/?page=my-week',
      // The Admin menu, which the first step opens.
      ready: ({ page }) => page.locator('button').filter({ has: page.locator('span', { hasText: /^Admin$/ }) }).first(),
      async run({ d, page, facts }) {
        await d.caption({ chip: 'FOR ADMINS', title: 'Someone new has signed up', text: 'When somebody signs up, the admins are emailed. Their account waits until one of you approves it.' });
        await d.hold(3600);

        d.mark('members-access');
        await d.nav('Admin', 'Members & Access');
        await page.getByRole('heading', { name: 'Members & Access' }).waitFor({ timeout: 15000 });
        await d.sleep(600);
        const banner = page.getByRole('button', { name: /waiting to be\s+confirmed/ });
        await d.callout(banner, 'Who is waiting', { where: 'below' });
        await d.caption({ chip: 'MEMBERS & ACCESS', title: 'Everyone waiting, at the top', text: 'Members & Access is under Admin in the menu. The orange banner counts who is waiting. Click it to show just them.' });
        await d.hold(4000);
        await d.clear();
        await d.click(banner);
        await d.sleep(800);

        d.mark('approve');
        const row = page.locator('tr', { hasText: facts.pending });
        await d.callout(row, 'Waiting to be approved', { where: 'below' });
        await d.hold(2200);
        await d.clear();
        const approve = row.getByRole('button', { name: 'Approve', exact: true });
        await d.click(approve);
        const dialog = page.getByRole('dialog', { name: `Approve ${facts.pending}` });
        // If the pointer's press missed (the table can still be settling after
        // the filter), press the button itself.
        if (!(await dialog.waitFor({ timeout: 3000 }).then(() => true, () => false))) await approve.click();
        await dialog.waitFor({ timeout: 10000 });
        await d.sleep(600);

        d.mark('who');
        await d.callout(dialog.locator('fieldset').first(), 'Who is this?', { where: 'above' });
        await d.caption({ chip: 'APPROVE', title: 'Say who they are', text: 'Pair them with their entry in the member directory, or add them as somebody new. Approving always does one or the other.' });
        await d.hold(4400);
        await d.clear();
        const suggestion = dialog.getByText('Suggested because it matches this account', { exact: false });
        if (await suggestion.isVisible().catch(() => false)) {
          await d.callout(dialog.getByRole('combobox', { name: 'Member directory entry' }), 'Matched by email address', { where: 'below' });
          await d.caption({ chip: 'APPROVE', title: 'Check the suggestion', text: 'If their email address matches someone in the directory, that entry is picked for you. Make sure it is the right person.' });
          await d.hold(4400);
          await d.clear();
        }

        d.mark('role');
        await d.callout(dialog.locator('#approve-role'), 'What may they do?', { where: 'below' });
        await d.caption({ chip: 'APPROVE', title: 'Member is right for most people', text: 'Members keep their own household up to date and sign up to serve. Admin can do everything, so keep it for the few who run the site.' });
        await d.hold(4600);
        await d.clear();
        await d.callout(dialog.getByText('Anything for them to look after?'), 'Optional', { where: 'above' });
        await d.caption({ chip: 'APPROVE', title: 'Jobs on the site, if any', text: 'Tick an area, like Guest Tracker or Serving Schedule, to let them add and edit there. You can skip this and add areas later.' });
        await d.hold(4400);
        await d.clear();

        d.mark('done');
        await d.click(dialog.getByRole('button', { name: `Approve ${facts.pending}` }), { ms: 600 });
        await dialog.waitFor({ state: 'detached', timeout: 15000 });
        await d.sleep(800);
        await d.caption({ chip: 'APPROVE', title: 'They\'re in', text: 'They are emailed straight away that their account is ready. The approval is recorded with who did it and when.' });
        const approvedRow = page.locator('tr', { hasText: facts.pending });
        if (await approvedRow.isVisible().catch(() => false)) {
          await d.callout(approvedRow, 'Now a member', { where: 'below' });
        }
        await d.hold(4400);
        await d.clear();
      },
    },
  ],
};
