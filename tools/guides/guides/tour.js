// A three-minute tour of the portal: desktop, then a phone, then desktop
// again. The template for any other guide — copy it, keep the segments you
// need, and change what each one does.
//
// Scenes never name a person or a date directly: the sample data is different
// on every run, so they use `facts` (what setup/index.js chose to feature) or
// pick things by position ("the second service in the list").
const path = require('path');

const thisSunday = () => {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - now.getUTCDay()));
  return d.toISOString().slice(0, 10);
};

module.exports = {
  description: 'Three-minute tour of the member portal on desktop and a phone',
  duration: 180,
  pace: 0.85,

  cards: {
    title: {
      kicker: 'MEMBER PORTAL',
      heading: 'Capshaw Church of Christ',
      sub: 'A three-minute tour, on desktop and on a phone',
      note: 'All names, photos and details shown are sample data.',
    },
    end: {
      heading: 'One place for the whole church family',
      items: [
        'Upcoming Service', 'Serving Schedule & time away', 'Church Groups & RSVPs',
        'Song Tracker', 'Weekly Newsletter', 'Inbox & follow-ups',
        'Member Directory', 'Guests', 'Church Calendar',
        'Member Match', 'Email links to the exact thing', 'Announcements on the foyer TV',
      ],
      note: 'Capshaw Church of Christ · Member Portal',
    },
  },

  // Anything the scenes show that has to exist first.
  async prepare({ request, work, python }) {
    const upload = await request.post('/api/documents/upload', {
      multipart: {
        document: {
          name: 'order-of-service.docx',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          buffer: require('fs').readFileSync(path.join(work, 'assets', 'order-of-service.docx')),
        },
      },
    });
    if (!upload.ok()) throw new Error(`Uploading the order of service failed: ${upload.status()}`);

    // The newsletter as its own export produces it, for the scene to show.
    const pdf = await request.get(`/api/bulletin/${thisSunday()}/export.pdf`);
    if (!pdf.ok()) throw new Error(`Exporting the newsletter failed: ${pdf.status()}`);
    require('fs').writeFileSync(path.join(work, 'assets', 'newsletter.pdf'), await pdf.body());
    await python('setup/pdf_page.py', [path.join(work, 'assets', 'newsletter.pdf'), path.join(work, 'assets', 'newsletter-p1.png')]);
  },

  segments: [
    // ─── Desktop ──────────────────────────────────────────────────────────────
    {
      name: 'desktop-1',
      device: 'desktop',
      signedIn: false,
      start: '/',
      ready: ({ page }) => page.locator('input[type=email]'),
      async run({ d, page, facts }) {
        await d.caption({ chip: 'DESKTOP', title: 'Welcome home', text: 'Members sign in with Google, Facebook, or an email and password. New accounts wait for the church office to approve them.' });
        await d.hold(1800);
        await d.click(page.locator('input[type=email]'));
        await d.type(facts.login.email, 38);
        await d.click(page.locator('input[type=password]'), { ms: 400 });
        await d.type(facts.login.password, 28);
        await d.click(page.locator('button[type=submit]'), { ms: 450 });
        await page.getByText('Order of Worship').first().waitFor({ timeout: 15000 });
        await d.sleep(500);

        d.mark('upcoming-service');
        await d.caption({ chip: 'UPCOMING SERVICE', title: 'Sunday, planned ahead', text: 'The song leader submits the whole service, part by part. The worship organizer is emailed and confirms it.' });
        await d.callout(page.getByRole('region', { name: /Sunday AM Worship/ }).first(), 'As the song leader submitted it', { where: 'above' });
        await d.hold(3000);
        await d.clear();

        d.mark('songs');
        await d.click(page.getByRole('tab', { name: 'Song Tracker' }));
        await d.caption({ chip: 'SONG TRACKER', title: 'Songs we sing', text: 'Every service: what was sung, who led it, and where to find it in the hymnal.' });
        await d.click(page.locator('main div.card.py-3 > button').nth(1));
        await d.sleep(700);
        await d.callout(page.locator('main div.card.py-3 ul').first(), 'Hymnal numbers and books', { where: 'below' });
        await d.hold(2600);
        await d.clear();
        await d.click(page.getByRole('button', { name: 'Analytics', exact: true }));
        await d.sleep(800);
        await d.caption({ chip: 'SONG TRACKER', title: 'What we sing most', text: 'Analytics show the most-sung songs, who leads singing, and how often each service sings.' });
        await d.callout(page.getByRole('heading', { name: 'Most Sung Songs' }).locator('..'), 'Most-sung songs', { where: 'above' });
        await d.hold(2200);
        await d.clear();
        await d.scroll(260);
        await d.callout(page.getByRole('heading', { name: 'Top Leaders' }).locator('..'), 'Top song leaders', { where: 'above' });
        await d.hold(2000);
        await d.clear();

        d.mark('directory');
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
        await d.nav('Church Office', 'Member Directory');
        await d.caption({ chip: 'MEMBER DIRECTORY', title: 'Our church family', text: 'Every household with photos, phone numbers and email. Search by name, address, phone or email.' });
        await d.click(page.getByPlaceholder(/Search name, address/));
        await d.type(facts.family, 85);
        await d.sleep(700);
        await d.callout(page.getByRole('heading', { name: `${facts.family} Family` }).first().locator('../..'), 'One card per household', { where: 'above' });
        await d.hold(2400);
        await d.clear();
        await page.getByPlaceholder(/Search name, address/).fill('');

        d.mark('guests');
        await d.nav('Our Church Family', 'Guests');
        await d.caption({ chip: 'GUESTS', title: 'Everyone who visits', text: 'Each guest, every visit, who invited them — and whether somebody has reached out yet.' });
        await d.callout([page.getByText('Visits recorded'), page.getByText('Most recent visit')], 'At a glance', { where: 'below', pad: 34 });
        await d.hold(2200);
        await d.clear();
        await d.click(page.getByText(facts.guest, { exact: true }).first());
        await d.sleep(700);
        const history = page.getByText('Follow-ups on record', { exact: false }).first();
        if (await history.isVisible().catch(() => false)) {
          await d.callout(history.locator('..'), 'Every attempt is kept', { where: 'above' });
        }
        await d.hold(2600);
        await d.clear();
        await page.keyboard.press('Escape');
        await d.sleep(400);
        await d.click(page.getByRole('button', { name: 'Follow Up', exact: true }).first());
        await d.sleep(700);
        await d.caption({ chip: 'GUESTS', title: 'Follow-ups that get done', text: 'Follow-ups are small workflows — assigned to whoever looks after guests and tracked until someone reaches out.' });
        await d.hold(1200);
        await d.click(page.getByRole('button', { name: 'Phoned them' }).first());
        await d.hold(1800);
        await page.keyboard.press('Escape');
        await d.sleep(400);

        d.mark('serving');
        await d.nav('Our Church Family', 'Serving Schedule');
        await d.caption({ chip: 'SERVING SCHEDULE', title: 'Who is serving when', text: 'Next month\'s worship jobs, week by week — built automatically and filled in by the schedule keeper.' });
        await d.hold(1600);
        await d.click(page.getByRole('button', { name: /Time away/ }));
        await d.sleep(600);
        await d.caption({ chip: 'SERVING SCHEDULE', title: 'Time away', text: 'Members block out the days they will be gone, and nobody can put them down for a job on those days.' });
        const away = new Date(); away.setDate(away.getDate() + 49);
        const back = new Date(away); back.setDate(back.getDate() + 7);
        const iso = x => x.toISOString().slice(0, 10);
        const dates = page.locator('input[type=date]');
        await d.click(dates.nth(0), { ms: 500 }); await dates.nth(0).fill(iso(away)); await d.sleep(300);
        await d.click(dates.nth(1), { ms: 500 }); await dates.nth(1).fill(iso(back)); await d.sleep(300);
        await d.click(page.getByPlaceholder(/Away with family/), { ms: 500 });
        await d.type('Visiting family', 60);
        await d.click(page.getByRole('button', { name: 'Block out these days' }), { ms: 500 });
        await d.hold(1600);
        await page.keyboard.press('Escape');
        await d.sleep(300);
        const open = page.locator('tr', { hasText: 'Nobody yet' }).first();
        if (await open.count()) {
          await d.caption({ chip: 'SERVING SCHEDULE', title: 'Fill an open slot', text: 'Anything nobody has taken yet is easy to spot and fill.' });
          await d.click(open.getByRole('button', { name: 'Edit' }));
          await d.sleep(500);
          await d.click(page.getByPlaceholder(/Leave blank for somebody/), { ms: 500 });
          await d.type(facts.volunteer, 60);
          await d.click(page.getByRole('button', { name: 'Save', exact: true }), { ms: 500 });
          await d.hold(1400);
        }
        await d.callout(page.getByText('Who is away').first(), 'Everyone\'s time away, in one place', { where: 'above' });
        await d.hold(2000);
        await d.clear();

        d.mark('newsletter');
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
        await d.nav('Church Office', 'Weekly Newsletter');
        await d.caption({ chip: 'WEEKLY NEWSLETTER', title: 'The newsletter, half-written already', text: 'Type this week\'s prayer list. Reminders, the duty roster, elders and deacons fill in from the rest of the site.' });
        await d.click(page.locator('textarea').first());
        await page.keyboard.press('Control+End');
        await d.type(`\nWelcome home to the ${facts.otherFamily} family!`, 45);
        await d.sleep(400);
        await d.callout(page.getByText('Filled in from the site').locator('..'), 'Pulled in automatically', { where: 'above', alignRight: true });
        await d.hold(2600);
        await d.clear();
        // Export saves the form first, and saving writes the evangelists bug
        // (issue #94) into the data — so the press is shown but not sent, and
        // the page shown is the one the export endpoint itself produced.
        await d.click(page.getByRole('button', { name: 'Export PDF' }), { real: false });
        await d.showImage('newsletter-p1.png');
        await d.caption({ chip: 'WEEKLY NEWSLETTER', title: 'One click, print-ready', text: 'Export the finished newsletter as a PDF or a Word document, laid out and ready to print or email.' });
        await d.hold(5200);
        await d.hideImage();
      },
    },

    // ─── Phone ────────────────────────────────────────────────────────────────
    {
      name: 'phone',
      device: 'phone',
      start: '/?page=order',
      ready: ({ phone }) => phone.getByText('Order of Worship').first(),
      async run({ d, phone, facts }) {
        await d.caption({ side: true, chip: 'ON A PHONE', title: 'The whole portal, in your pocket', text: 'Every page works on a phone. One menu at the top reaches all of it.' });
        await d.hold(1500);
        await d.click(phone.locator('button[aria-controls="mobile-nav-panel"]'));
        await d.hold(1400);
        await d.click(phone.locator('#mobile-nav-panel').getByRole('button', { name: 'Member Match', exact: true }), { ms: 700 });
        await d.sleep(900);

        d.mark('member-match');
        await d.caption({ side: true, chip: 'MEMBER MATCH', title: 'Put a name to a face', text: 'A quick game for learning who is who. Family photos ask about each person in turn.' });
        // Randomness is pinned inside the phone (lib/overlay.js), so the
        // right answer is always offered first.
        const choices = phone.locator('main div.grid.grid-cols-1 > button');
        await choices.first().waitFor();
        await d.hold(1000);
        await d.click(choices.nth(0));
        await d.hold(1500);
        await d.click(phone.getByRole('button', { name: 'Next' }), { ms: 500 });
        await d.sleep(700);
        await d.caption({ side: true, chip: 'MEMBER MATCH', title: 'Learn as you go', text: 'Miss one and it shows you who it really was. The score keeps count.' });
        await d.click(choices.nth(2));
        await d.hold(2400);

        d.mark('email');
        await d.showEmail({
          chip: 'EMAIL NOTIFICATIONS', heading: 'Every email links to the exact thing',
          from: { name: 'Capshaw Church of Christ', email: 'portal@capshawchurch.org' }, to: facts.me.name,
          subject: facts.email.subject, body: facts.email.body, link: facts.email.link,
        });
        await d.hold(3200);
        await d.tapEmailLink();
        await d.openOnPhone(facts.email.path);
        await phone.getByText('Can you come?', { exact: false }).first().waitFor({ timeout: 20000 });
        await d.sleep(600);
        await d.hideEmail();
        await d.cursorTo(d.frameRect.x + 250, d.frameRect.y + 420, 700);
        await d.caption({ side: true, chip: 'CHURCH GROUPS', title: 'Straight to the meeting', text: 'The link opens that group\'s meeting, already expanded: RSVP, see who is coming, and sign up to bring something.' });
        await d.hold(2200);
        const bring = phone.getByPlaceholder('what you\'ll bring').last();
        await d.swipe(900);
        await d.click(bring, { ms: 600 });
        await d.type('Brownies', 80);
        await d.click(bring.locator('xpath=following::button[1]'), { ms: 450 });
        await d.hold(2200);

        d.mark('inbox');
        await d.caption({ side: true, chip: 'MY INBOX', title: 'Everything waiting on you', text: 'Tasks from every page land in one inbox. One tap says it is done.' });
        await d.phoneFrame().evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
        await d.sleep(700);
        await d.menu('My Inbox');
        await d.click(phone.getByRole('button', { name: 'Emailed them' }).first());
        await d.hold(1800);

        d.mark('directory');
        await d.caption({ side: true, chip: 'DIRECTORY', title: 'The directory in your pocket', text: 'Search the whole church family from your phone: every number, address and email. Tap an address to write to them.' });
        await d.menu('Member Directory');
        await d.click(phone.getByPlaceholder(/Search name, address/));
        await d.type(facts.otherFamily, 90);
        await d.sleep(600);
        await d.callout(phone.locator('a[href^="mailto:"]').first(), 'Tap to email', { where: 'below' });
        await d.hold(2600);
        await d.clear();
      },
    },

    // ─── Desktop again ────────────────────────────────────────────────────────
    {
      name: 'desktop-2',
      device: 'desktop',
      start: '/?page=calendar',
      ready: ({ page }) => page.getByRole('heading', { name: 'Church Calendar' }),
      async run({ d, page, facts }) {
        await d.caption({ chip: 'CHURCH CALENDAR', title: 'What is coming up', text: 'The calendar shares its events with Announcements, so nothing is typed twice.' });
        await d.click(page.getByRole('button', { name: 'Next month' }));
        await d.sleep(600);
        const event = page.getByText(/^\d{1,2}:\d{2}\s/).first();
        if (await event.count()) await d.callout(event, 'From Announcements', { where: 'above' });
        await d.hold(2400);
        await d.clear();

        d.mark('display');
        await d.nav('Worship', 'Announcements');
        await d.caption({ chip: 'ANNOUNCEMENTS', title: 'On the foyer TV', text: 'One button turns the announcements into a full-screen slideshow for the screen in the foyer.' });
        await d.hold(900);
        await d.click(page.getByRole('button', { name: /Fullscreen Display/ }));
        await d.hold(2200);
        await page.keyboard.press('ArrowRight');
        await d.hold(1800);
        await page.keyboard.press('Escape');
        await d.sleep(600);

        d.mark('access');
        await d.nav('Church Office', 'Members & Access');
        await d.caption({ chip: 'MEMBERS & ACCESS', title: 'The right keys for each person', text: 'The office approves new accounts and grants each person only the areas they look after.' });
        await d.callout(page.getByText('waiting to be confirmed', { exact: false }).first(), 'New sign-ups wait here', { where: 'below', alignRight: true });
        await d.hold(1200);
        await d.point(page.locator('tr', { hasText: facts.pending }).first().getByText('Awaiting confirmation'), 800);
        await d.hold(2200);
        await d.clear();
      },
    },
  ],
};
