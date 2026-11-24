// How a new member gets into the portal: why Google or Facebook is the way in
// we recommend, the page they see while the church office approves them, and
// signing up with an email address and password instead.
//
// Staged: the press on "Sign in with Google" is shown, not followed, because
// a recording can't (and shouldn't) sign in to a real Google account. The
// guide's portal has placeholder Google and Facebook keys only so the buttons
// appear (lib/servers.js). The waiting page is shown by signing in as
// `facts.waiting`, an email-and-password account that has already confirmed
// its address: a Google or Facebook sign-up lands on the same page.
//
// Google and Facebook only: while the live portal's email is in test mode,
// members can't finish the email-and-password route, so that part is its own
// guide (create-account-email.js), to record once real email is on.
module.exports = {
  description: 'Creating an account with Google or Facebook, and the waiting page',
  pace: 0.9,

  cards: {
    title: {
      kicker: 'MEMBER PORTAL · HOW TO',
      heading: 'Create your account',
      sub: 'Go to members.capshaw.org and sign in with Google or Facebook',
      note: 'All names and details shown are sample data.',
    },
    end: {
      heading: 'You\'re on your way in',
      items: [
        'Sign in with Google or Facebook', 'No new password to remember', 'The church office approves you',
        'An email when you\'re in', 'Call or text an admin to hurry it', 'members.capshaw.org',
      ],
      note: 'Capshaw Church of Christ · Member Portal',
    },
  },

  segments: [
    // ─── Google or Facebook ─────────────────────────────────────────────────
    {
      name: 'google',
      device: 'desktop',
      signedIn: false,
      start: '/',
      ready: ({ page }) => page.locator('#signin-email'),
      async run({ d, page }) {
        await d.caption({ chip: 'CREATE YOUR ACCOUNT', title: 'Members only', text: 'Go to members.capshaw.org. The portal is just for our church family: sign in once, and the church office approves you.' });
        await d.hold(3400);

        const google = page.getByRole('link', { name: 'Sign in with Google' });
        const facebook = page.getByRole('link', { name: 'Sign in with Facebook' });
        await d.callout([google, facebook], 'The way in we recommend', { where: 'above' });
        await d.caption({ chip: 'WHY GOOGLE OR FACEBOOK', title: 'Use an account you already have', text: 'Sign in with Google or Facebook and there is no new password to remember or reset.' });
        await d.hold(3800);
        await d.clear();

        await d.callout(page.getByText('is the safer', { exact: false }), 'Your password stays with Google or Facebook', { where: 'below' });
        await d.caption({ chip: 'WHY GOOGLE OR FACEBOOK', title: 'Safer for everyone', text: 'Google or Facebook checks your password, so this site never sees or stores it. Their own protections, like two-step sign-in, guard the portal too.' });
        await d.hold(4600);
        await d.clear();

        // Shown, not followed: Google's own pages are not part of the portal.
        await d.click(google, { real: false });
        await d.caption({ chip: 'WHY GOOGLE OR FACEBOOK', title: 'No email to wait for', text: 'Pick your Google account, or let Facebook share your email address. Google and Facebook vouch for it, so you go straight to waiting for approval.' });
        await d.hold(4600);
      },
    },

    // ─── Waiting for approval ───────────────────────────────────────────────
    {
      name: 'waiting',
      device: 'desktop',
      // Signed in off camera as the sample newcomer: the page a new Google or
      // Facebook sign-up lands on.
      signInAs: 'waiting',
      start: '/',
      ready: ({ page }) => page.getByRole('heading', { name: /waiting to be approved/ }),
      async run({ d, page }) {
        const heading = page.getByRole('heading', { name: /waiting to be approved/ });

        await d.caption({ chip: 'WAITING FOR APPROVAL', title: 'Almost there', text: 'New accounts wait for the church office. This page is all you see until one of the admins approves you.' });
        await d.callout(heading, 'Nothing more for you to do', { where: 'above' });
        await d.hold(4000);
        await d.clear();
        await d.caption({ chip: 'WAITING FOR APPROVAL', title: 'The admins already know', text: 'They are told automatically, and you get an email the moment one of them approves you.' });
        await d.hold(3600);

        const admins = page.getByRole('list', { name: 'Admins you can contact' });
        if (await admins.isVisible().catch(() => false)) {
          await d.callout(admins, 'Call or text to hurry it along', { where: 'below' });
          await d.caption({ chip: 'WAITING FOR APPROVAL', title: 'In a hurry?', text: 'The admins\' cellphone numbers are right here if you\'d like to call or text one of them.' });
          await d.hold(3800);
          await d.clear();
        }

        await d.click(page.getByRole('button', { name: 'Check again' }));
        await page.getByText('Not yet — still waiting.').waitFor({ timeout: 10000 }).catch(() => {});
        await d.caption({ chip: 'WAITING FOR APPROVAL', title: 'Check again any time', text: 'Once you\'re approved, sign in again or tap Check again, and the whole portal opens.' });
        await d.hold(3600);
      },
    },

  ],
};
