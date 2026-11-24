// Signing up with an email address and password instead of Google or
// Facebook. Kept apart from create-account.js because, while the live
// portal's email is in test mode, members can't finish this route: record it
// once real email is on. `facts.newcomer` is what the form is filled with.
module.exports = {
  description: 'Creating an account with an email address and password',
  pace: 0.9,

  cards: {
    title: {
      kicker: 'MEMBER PORTAL · HOW TO',
      heading: 'Sign up with an email address',
      sub: 'For anyone without Google or Facebook, at members.capshaw.org',
      note: 'All names and details shown are sample data.',
    },
    end: {
      heading: 'You\'re on your way in',
      items: ['Tap Create one', 'A password of 10 characters or more', 'Open the link we email you', 'The church office approves you', 'An email when you\'re in', 'members.capshaw.org'],
      note: 'Capshaw Church of Christ · Member Portal',
    },
  },

  segments: [
    // ─── Email and password ─────────────────────────────────────────────────
    {
      name: 'email',
      device: 'desktop',
      signedIn: false,
      start: '/',
      ready: ({ page }) => page.locator('#signin-email'),
      async run({ d, page, facts }) {
        await d.caption({ chip: 'EMAIL AND PASSWORD', title: 'No Google or Facebook? That\'s fine', text: 'Tap Create one, under the sign-in form, to make an account with your email address.' });
        await d.hold(2400);
        await d.click(page.getByRole('button', { name: 'Create one' }));
        await page.locator('#register-name').waitFor();
        await d.sleep(500);
        await d.click(page.locator('#register-name'), { ms: 500 });
        await d.type(facts.newcomer.name, 70);
        await d.click(page.locator('#register-email'), { ms: 450 });
        await d.type(facts.newcomer.email, 45);
        await d.caption({ chip: 'EMAIL AND PASSWORD', title: 'Choose a password', text: 'At least 10 characters. A few ordinary words together make a good one.' });
        await d.click(page.locator('#register-password'), { ms: 450 });
        await d.type(facts.newcomer.password, 40);
        await d.click(page.locator('#register-confirm'), { ms: 450 });
        await d.type(facts.newcomer.password, 30);
        await d.hold(1400);

        await d.callout(page.getByText('Two things happen after this', { exact: false }), 'What happens next', { where: 'above' });
        await d.caption({ chip: 'EMAIL AND PASSWORD', title: 'Two steps before you\'re in', text: 'First you open the link we email you. Then the church office approves you and connects you to the member directory.' });
        await d.hold(4600);
        await d.clear();
        await d.click(page.getByRole('button', { name: 'Create my account' }), { ms: 500 });
        await page.getByRole('heading', { name: 'Check your email' }).waitFor({ timeout: 15000 });
        await d.sleep(500);
        await d.caption({ chip: 'EMAIL AND PASSWORD', title: 'Check your email', text: 'Open the link in the email within 48 hours to confirm the address is yours. Then you wait for approval, just like a Google sign-up.' });
        await d.hold(4600);
      },
    },
  ],
};
