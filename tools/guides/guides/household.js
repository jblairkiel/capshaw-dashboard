// For members: My Household & Preferences. Keeping your own household's
// details up to date (MyProfileView.jsx), your worship role preferences
// (WorshipPreferences.jsx), how the site looks for you (DisplaySettings.jsx)
// and which emails you get; then, on a phone, putting the church directory in
// your contacts and searching the Member Directory.
//
// The signed-in account (`facts.me`) is linked to their directory entry, so the
// page shows their household. Every press is real, in the run's throwaway copy
// of the site; the text size is put back to Standard before the scene moves on,
// because it is saved to the account and would carry into the phone segment.
//
// Staged: "Add the directory to my phone" is shown, not pressed. It downloads
// a contacts file, which the phone in the recording has nowhere to open.
module.exports = {
  description: 'For members: keeping your household, worship preferences and display settings up to date, and the directory on a phone',
  pace: 0.9,
  // Every caption stays up for at least this long, so it can be read.
  stepSeconds: 10,

  cards: {
    title: {
      kicker: 'MEMBER PORTAL · HOW TO',
      heading: 'My Household & Preferences',
      sub: 'Keep your details, worship preferences and display settings up to date',
      note: 'All names and details shown are sample data.',
    },
    end: {
      heading: 'Your details, kept up to date',
      items: [
        'My Church → My Household & Preferences', 'Everyone at your address', 'Save details, Save preferences',
        'Glad to, Willing or Rather not', 'Text size and colors follow you', 'The directory in your phone\'s contacts',
      ],
      note: 'Capshaw Church of Christ · Member Portal',
    },
  },

  segments: [
    // ─── Desktop ──────────────────────────────────────────────────────────────
    {
      name: 'household',
      device: 'desktop',
      start: '/?page=my-week',
      ready: ({ page }) => page.locator('button').filter({ has: page.locator('span', { hasText: /^My Church$/ }) }).first(),
      async run({ d, page }) {
        const show = async (loc, label, opts) => { await d.reveal(loc); await d.callout(loc, label, opts); };

        d.mark('menu');
        await d.nav('My Church', 'My Household & Preferences');
        await page.getByRole('heading', { name: 'My Household', exact: true }).waitFor({ timeout: 15000 });
        await d.sleep(700);

        d.mark('household');
        // Your own card, open from the start and marked "You".
        const me = page.locator('main div.card').filter({ has: page.locator('span', { hasText: /^You$/ }) }).first();
        await show(me.locator('button[aria-expanded]').first(), 'Your own entry', { where: 'below' });
        await d.caption({ chip: 'MY HOUSEHOLD', title: 'You and your household', text: 'My Household & Preferences, under My Church, lists you and everyone at your street address. You can keep all their details up to date.' });
        await d.hold(4000);
        await d.clear();

        d.mark('details');
        const cell = me.getByLabel('Cell Phone');
        await d.click(cell);
        await page.keyboard.press('Control+A');
        await d.type('(256) 555-0147', 70);
        await d.sleep(300);
        const saveDetails = me.getByRole('button', { name: 'Save details' });
        await show(saveDetails, 'Then save', { where: 'below' });
        await d.caption({ chip: 'CONTACT DETAILS', title: 'Change a detail', text: 'Change anything, like a cell number, and press Save details. It goes straight into the member directory.' });
        await d.hold(3000);
        await d.clear();
        await d.click(saveDetails);
        await me.getByText('Saved', { exact: true }).first().waitFor({ timeout: 10000 });
        await d.sleep(500);
        await d.callout(me.getByText('Saved', { exact: true }).first(), 'Saved', { where: 'below' });
        await d.caption({ chip: 'CONTACT DETAILS', title: 'Your change stays put', text: 'What you save here is kept when the directory is next refreshed from the church website.' });
        await d.hold(3400);
        await d.clear();

        d.mark('worship');
        const choose = async (role, level) => {
          const button = me.getByRole('group', { name: `${role} preference` }).getByRole('button', { name: level, exact: true });
          // Pressing the level a job already has clears it, so leave it be.
          if ((await button.getAttribute('aria-pressed')) !== 'true') await d.click(button, { ms: 500 });
          else await d.point(button, 500);
        };
        const firstRow = me.getByRole('group', { name: 'Scripture Reading preference' }).locator('..');
        const lastRow = me.getByRole('group', { name: 'Speaker preference' }).locator('..');
        await d.reveal(lastRow);
        await d.callout([firstRow, lastRow], 'One choice for each job', { where: 'above' });
        await d.caption({ chip: 'WORSHIP PREFERENCES', title: 'Which jobs suit you', text: 'Tell whoever builds the Serving Schedule how you feel about each job: Glad to, Willing, or Rather not. Leave a job blank for no preference.' });
        await choose('Scripture Reading', 'Glad to');
        await choose('Speaker', 'Rather not');
        await d.hold(2400);
        await d.clear();
        const savePrefs = me.getByRole('button', { name: 'Save preferences' });
        await d.click(savePrefs);
        await d.sleep(800);
        await show(savePrefs, 'Saved for the schedule keeper', { where: 'below' });
        await d.caption({ chip: 'WORSHIP PREFERENCES', title: 'How they are used', text: 'When a month is filled in automatically, people glad to do a job come first, and nobody is put down for one they marked Rather not.' });
        await d.hold(4000);
        await d.clear();

        d.mark('display');
        const display = page.getByRole('region', { name: 'Display' });
        const textSize = display.locator('fieldset').filter({ hasText: 'Text size' });
        await show(display, 'Just for you', { where: 'below' });
        await d.caption({ chip: 'DISPLAY', title: 'Bigger text, if you like', text: 'Choose the text size, colors and motion you like. They are saved to your account, so they follow you to your phone too.' });
        await d.click(textSize.locator('label').filter({ hasText: /^Large$/ }));
        await d.hold(3400);
        await d.clear();
        // Back to Standard: it is saved to the account, and the rest of the
        // video should look as it normally does.
        await d.click(textSize.locator('label').filter({ hasText: /^Standard$/ }), { ms: 500 });
        await d.sleep(700);

        d.mark('email');
        const email = page.locator('main div.card').filter({ has: page.getByRole('heading', { name: 'Email', exact: true }) }).first();
        await show(email, 'Your emails', { where: 'below' });
        await d.caption({ chip: 'EMAIL', title: 'Choose your emails', text: 'Untick the monthly schedule summary or the Sunday My Week email to stop them. Emails about jobs you are personally given still come.' });
        await d.hold(4000);
        await d.clear();
      },
    },

    // ─── Phone ────────────────────────────────────────────────────────────────
    {
      name: 'phone',
      device: 'phone',
      start: '/?page=profile',
      ready: ({ phone }) => phone.getByRole('heading', { name: 'My Household', exact: true }),
      async run({ d, phone, facts }) {
        d.mark('contacts');
        const add = phone.getByRole('link', { name: 'Add the directory to my phone' });
        await d.point(add, 700);
        await d.callout(phone.getByRole('region', { name: 'The directory on your phone' }), 'Every member has this', { where: 'below' });
        await d.caption({ side: true, chip: 'ON A PHONE', title: 'The directory in your contacts', text: 'Any member can add the whole church directory to their phone\'s contacts. Then you can call or text anyone from your Contacts app.' });
        await d.hold(3400);
        await d.click(add, { real: false });
        await d.hold(1600);
        await d.clear();

        d.mark('directory');
        await d.phoneFrame().evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
        await d.sleep(700);
        await d.menu('Member Directory');
        const search = phone.getByPlaceholder(/Search name, address/);
        await search.waitFor({ timeout: 15000 });
        await d.click(search);
        await d.type(facts.otherFamily, 90);
        await d.sleep(700);
        const mail = phone.locator('a[href^="mailto:"]').first();
        if (await mail.isVisible().catch(() => false)) {
          await d.callout(mail, 'Tap to email', { where: 'below' });
        } else {
          await d.callout(phone.getByRole('heading', { name: `${facts.otherFamily} Family` }).first().locator('../..'), 'One card per household', { where: 'below' });
        }
        await d.caption({ side: true, chip: 'MEMBER DIRECTORY', title: 'Search the directory', text: 'Admins and whoever keeps the directory also have Member Directory, under Church Office. Search, then tap an email address to write to them.' });
        await d.hold(4000);
        await d.clear();
      },
    },
  ],
};
