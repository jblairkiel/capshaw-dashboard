// Upcoming Service: how a member sees what is planned for Sunday and asks for
// a song, and how a song leader submits a service (client/src/components/
// UpcomingServiceView.jsx and upcoming/*, OrderOfService.jsx).
//
// The seed has next Sunday's morning service submitted and waiting to be
// confirmed, and a few song requests from other members. `prepare` uploads the
// sample order of service (as tour.js does) and picks, from the run's song
// list, a song nobody has asked for yet for the request scene, plus the rest
// of the list for filling the service's song slots. Those are added to
// `facts` (as `facts.songs`), which run.js hands on to the scenes unchanged.
//
// The signed-in account is an admin, so it may submit any service and also
// sees the worship organizer's Confirm button and Service Parts tab. The
// captions say who an ordinary member is and who a song leader is.
//
// Staged: nothing. Every press is real, in the run's throwaway copy of the
// site; the email that submitting a service writes is never sent
// (lib/servers.js blanks the mail settings). Print is not pressed.
const path = require('path');
const fs = require('fs');

module.exports = {
  description: 'Upcoming Service: Sunday\'s order of worship, asking for a song, and submitting a service',
  pace: 0.9,
  // Every caption stays up for at least this long, so it can be read.
  stepSeconds: 10,

  cards: {
    title: {
      kicker: 'MEMBER PORTAL · HOW TO',
      heading: 'Upcoming Service and song requests',
      sub: 'See Sunday\'s service, ask for a song, and submit a service',
      note: 'All names and details shown are sample data.',
    },
    end: {
      heading: 'Sunday, planned together',
      items: [
        'Worship → Upcoming Service', 'Order of Worship for the next two weeks', 'Present the printed order',
        'Song Requests: ask for a song', 'Song leaders: Submit a Service', 'The organizer confirms it',
      ],
      note: 'Capshaw Church of Christ · Member Portal',
    },
  },

  async prepare({ request, work, facts }) {
    const upload = await request.post('/api/documents/upload', {
      multipart: {
        document: {
          name: 'order-of-service.docx',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          buffer: fs.readFileSync(path.join(work, 'assets', 'order-of-service.docx')),
        },
      },
    });
    if (!upload.ok()) throw new Error(`Uploading the order of service failed: ${upload.status()}`);

    const library = await request.get('/api/songs/library?limit=50');
    if (!library.ok()) throw new Error(`Reading the song list failed: ${library.status()}`);
    const { songs = [] } = await library.json();
    const requests = await request.get('/api/worship/requests');
    if (!requests.ok()) throw new Error(`Reading the song requests failed: ${requests.status()}`);
    const asked = new Set(((await requests.json()).requests || []).map(r => r.song.id));
    const fresh = songs.find(s => !asked.has(s.id));
    if (!fresh || songs.length < 2) throw new Error('The sample song list has no song left to request.');
    facts.songs = { request: fresh.title, others: songs.filter(s => s.id !== fresh.id).map(s => s.title) };
  },

  segments: [
    {
      name: 'upcoming',
      device: 'desktop',
      start: '/?page=my-week',
      ready: ({ page }) => page.locator('button').filter({ has: page.locator('span', { hasText: /^Worship$/ }) }).first(),
      async run({ d, page, facts }) {
        // A callout is drawn where the element is now, so bring it on screen first.
        const show = async (loc, label, opts) => { await d.reveal([].concat(loc)[0]); await d.callout(loc, label, opts); };

        // ── Order of Worship ────────────────────────────────────────────────
        d.mark('order');
        await d.nav('Worship', 'Upcoming Service');
        await page.getByRole('heading', { name: 'Upcoming Service', exact: true }).waitFor({ timeout: 15000 });
        await d.sleep(800);
        const submitted = page.locator('main section[aria-label]').filter({ hasText: 'Submitted by' }).first();
        await show(submitted, 'As the song leader submitted it', { where: 'above' });
        await d.caption({ chip: 'UPCOMING SERVICE', title: 'Sunday, laid out ahead', text: 'Upcoming Service is under Worship. Order of Worship shows each service in the next two weeks, with every song and who is doing what.' });
        await d.hold(4200);
        await d.clear();

        const notYet = page.locator('main section[aria-label]').filter({ hasText: 'has not submitted this service yet' }).first();
        if (await notYet.isVisible().catch(() => false)) {
          await show(notYet, 'Not submitted yet', { where: 'above' });
          await d.caption({ chip: 'UPCOMING SERVICE', title: 'Not planned yet?', text: 'Until its song leader submits a service, it says so, along with anyone the Serving Schedule has down for it.' });
          await d.hold(4000);
          await d.clear();
        }

        // ── The printed order of service ────────────────────────────────────
        d.mark('printed');
        const printed = page.getByRole('heading', { name: 'Printed order of service' });
        await d.reveal(printed);
        const present = page.getByRole('button', { name: 'Present', exact: true });
        await present.waitFor({ timeout: 15000 });
        await show(present, 'Full screen', { where: 'below' });
        await d.caption({ chip: 'ORDER OF WORSHIP', title: 'The printed order of service', text: 'Underneath is the order of service the worship organizer uploads. Present shows it full screen, for a TV or projector.' });
        await d.hold(3200);
        await d.clear();
        await d.click(present);
        await d.hold(3000);
        await page.keyboard.press('Escape');
        await d.sleep(800);
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
        await d.sleep(800);

        // ── Asking for a song ───────────────────────────────────────────────
        d.mark('request');
        await d.click(page.getByRole('tab', { name: /^Song Requests/ }));
        const form = page.getByRole('form', { name: 'Ask for a song' });
        await form.waitFor({ timeout: 15000 });
        await d.sleep(500);
        await show(form, 'Ask for a song', { where: 'above' });
        await d.caption({ chip: 'SONG REQUESTS', title: 'Ask for a song', text: 'Anyone can ask for a song on the Song Requests tab. Search by title or number, and choose a day if it matters.' });
        await d.hold(2400);
        await d.click(form.getByLabel('Song to request'));
        await d.type(facts.songs.request, 70);
        const option = page.getByRole('option').filter({ hasText: facts.songs.request }).first();
        await option.waitFor({ timeout: 10000 });
        await d.click(option, { ms: 500 });
        await d.sleep(400);
        const when = form.getByRole('combobox');
        await d.point(when, 500);
        await when.selectOption({ index: 1 }).catch(() => {});
        await d.sleep(400);
        await d.click(form.getByRole('textbox', { name: /Why, or anything/ }), { ms: 500 });
        await d.type('One of my favorites', 60);
        await d.clear();
        await d.click(form.getByRole('button', { name: 'Ask for this song' }), { ms: 500 });
        await form.getByRole('status').waitFor({ timeout: 10000 });
        await d.sleep(600);

        const mine = page.getByRole('region', { name: 'Requested songs' }).locator('li', { hasText: 'Asked by you' }).first();
        await show(mine, 'Your request', { where: 'below' });
        await d.caption({ chip: 'SONG REQUESTS', title: 'On the list for the song leaders', text: 'Your request waits here, beside everyone else\'s. Song leaders see it when they plan a service, and you can withdraw it while it waits.' });
        await d.hold(4200);
        await d.clear();

        // ── Submitting a service (song leaders) ─────────────────────────────
        d.mark('submit');
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
        await d.sleep(600);
        await d.click(page.getByRole('tab', { name: /^Submit a Service/ }));
        const order = page.getByRole('list', { name: 'Order of the service' });
        await order.waitFor({ timeout: 15000 });
        await d.sleep(700);
        await show(page.getByLabel('Which service'), 'Choose the service', { where: 'below' });
        await d.caption({ chip: 'FOR SONG LEADERS', title: 'Submit a Service', text: 'Song leaders lay out a service here. Only the song leader on the Serving Schedule for it, or whoever keeps the songs, can submit it.' });
        await d.hold(4200);
        await d.clear();

        const parts = order.locator(':scope > li');
        await show([parts.nth(0), parts.nth(Math.min(3, (await parts.count()) - 1))], 'The usual order', { where: 'above' });
        await d.caption({ chip: 'SUBMIT A SERVICE', title: 'The usual order, filled in', text: 'Every part is laid out in the usual order, with names from the Serving Schedule. Change any name, and move, remove or add parts.' });
        await d.hold(4400);
        await d.clear();

        const requested = page.getByRole('region', { name: 'Requested songs' });
        await show(requested, 'Songs people asked for', { where: 'above' });
        await d.caption({ chip: 'SUBMIT A SERVICE', title: 'Requested songs, one click away', text: 'Requests sit beside the service. Use puts one in the first empty song slot. Search for the other songs by title or number.' });
        await d.hold(2000);
        const use = requested.locator('li', { hasText: facts.songs.request }).getByRole('button', { name: 'Use' });
        if (await use.isVisible().catch(() => false)) {
          await d.click(use, { ms: 500 });
          await d.sleep(600);
        }
        const emptySongs = order.locator('input[aria-label^="Song for"]');
        const others = facts.songs.others;
        if (await emptySongs.count()) {
          await d.click(emptySongs.first(), { ms: 550 });
          await d.type(others[0], 70);
          const pick = page.getByRole('option').filter({ hasText: others[0] }).first();
          await pick.waitFor({ timeout: 10000 });
          await d.click(pick, { ms: 450 });
          await d.sleep(400);
        }
        // Every song part needs a song before the service can be submitted:
        // the rest are filled in quickly while the caption is up.
        for (let n = 1; n < 20 && await emptySongs.count(); n++) {
          await emptySongs.first().fill(others[n % others.length]);
          const next = page.getByRole('option').first();
          await next.waitFor({ timeout: 10000 });
          await next.click();
          await d.sleep(250);
        }
        await d.clear();

        d.mark('send');
        const submit = page.getByRole('button', { name: 'Submit service', exact: true });
        await d.click(submit, { ms: 550 });
        await page.getByRole('status').filter({ hasText: /^Submitted\./ }).waitFor({ timeout: 15000 });
        await d.sleep(600);
        const confirm = page.getByRole('button', { name: 'Confirm', exact: true });
        if (await confirm.isVisible().catch(() => false)) {
          await show(confirm, 'For the worship organizer', { where: 'below' });
        }
        await d.caption({ chip: 'SUBMIT A SERVICE', title: 'Submitted, then confirmed', text: 'The worship organizer is told, and confirms it. Its songs then go into the Song Tracker. Anyone who asked for a song in it is told.' });
        await d.hold(4600);
        await d.clear();
      },
    },
  ],
};
