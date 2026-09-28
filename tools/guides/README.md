# Guides

Captioned video guides of the member portal, recorded from scripts. Each run
builds a throwaway copy of the site filled with made-up sample data, drives it
in a browser with a visible cursor (and a fingertip on the phone), and writes
a 1920×1080 MP4.

```sh
node tools/guides/run.js tour          # → tools/guides/output/tour.mp4
```

Nothing here touches the real database. The portal it starts can't scrape the
church site or send email: `lib/servers.js` blanks those settings from `.env`.
Everything a run writes goes in `tools/guides/work/<guide>/` and
`tools/guides/output/`, and git ignores both folders.

## Setup, once

```sh
(cd tools/guides && npm install && npx playwright install chromium)
pip install -r tools/guides/requirements.txt
```

The app's own dependencies need to be installed too (`npm run install:all`).
No system ffmpeg is needed, because `imageio-ffmpeg` brings its own.

## Running

```sh
node tools/guides/run.js tour                        # the whole guide
node tools/guides/run.js tour --only=phone           # just one segment: a clip, no cards
node tools/guides/run.js tour --pace=0.7             # shorter reading pauses
```

Each run also writes contact sheets to `output/<guide>-review/`: sixteen
frames, four to a sheet, with timestamps. Check those before sharing a video.
If a segment fails, the run stops and saves a screenshot of the moment it
failed to `work/<guide>/failed-<segment>.png`.

The API runs on port 3101 and the client on 5175. Both are stopped at the end
of the run, and neither gets in the way of `npm run dev`.

## Writing a guide

A guide is one file in `guides/`. `guides/tour.js` is the example to copy:

```js
module.exports = {
  duration: 180,     // exact length in seconds, or leave it out for the natural length
  pace: 0.85,        // scales the reading pauses
  cards: { title: { heading, sub, note }, end: { heading, items: [...] } },
  async prepare({ request, work, facts, python }) { /* uploads etc., signed in */ },
  segments: [
    {
      name: 'desktop-1',
      device: 'desktop',            // or 'phone'
      signedIn: false,              // default true
      start: '/',                   // where the browser opens; ?page=<tab> works
      ready: ({ page }) => page.locator('input[type=email]'),
      async run({ d, page, phone, facts }) { ... },
    },
  ],
};
```

Inside `run`, `d` (see `lib/director.js`) does the work:

| | |
|---|---|
| `d.click(locator)` | moves the cursor there, shows the press, clicks. `{ real: false }` shows the press without clicking |
| `d.type(text)` | types into whatever has focus, at reading speed |
| `d.caption({ chip, title, text })` | the lower-third caption; add `side: true` for the big panel beside the phone |
| `d.callout(locator \| [first, last], label)` | a gold box around the element(s), with a label |
| `d.clear()` | removes the callouts |
| `d.hold(ms)` | a reading pause (scaled by `--pace`) |
| `d.sleep(ms)` | a pause that isn't scaled, for waiting on the app |
| `d.nav('Church Office', 'Weekly Newsletter')` | picks a page from the desktop menu |
| `d.menu('My Inbox')` | picks a page from the phone menu |
| `d.swipe(px)` | scrolls the phone with a finger drag |
| `d.showImage(file)` | shows an image from `work/<guide>/assets/` over the page |
| `d.showEmail({...})`, `d.tapEmailLink()` | an email beside the phone, and tapping its link |
| `d.mark(label)` | a named point in the timeline, printed as it passes |

On the phone, `phone` is the app's own frame. Use `phone.getByText(...)` and
so on there, rather than `page`.

### The sample data changes every run

The seeder draws names from a random seed and sets dates relative to today.
So scenes must never type a name or a date directly. Two ways around it:

- **`facts`**: `setup/index.js` chooses what to feature and saves it to
  `work/<guide>/facts.json`: the account to sign in as (a group leader, with
  an upcoming meeting), a family to search for, a guest with a follow-up
  history, a member still waiting for approval, and the email that went out
  about the meeting. If a new guide needs something else, add it there.
- **Position**: "the second service in the list"
  (`page.locator('main div.card.py-3 > button').nth(1)`), "the first open
  slot" (`tr` containing "Nobody yet"), and so on.

Inside the phone, randomness is fixed, so Member Match always offers the right
answer first.

## Known workarounds

- **Export PDF is shown, not pressed.** Exporting the newsletter saves the form
  first, and saving writes the `[object Object]` evangelists bug (#94) into
  the data. The tour shows the press without clicking, then shows page 1 of the
  PDF that the export endpoint produced during `prepare`. Once #94 is fixed,
  the click can be real.
- **The bulletin sample data is rewritten.** The bulletin seeder uses
  real-looking names (#95). `setup/index.js` replaces them with made-up
  directory names until the seeder is fixed.
- **Fullscreen is a page overlay.** The foyer slideshow would normally ask the
  browser for true fullscreen, which hides the captions and cursor. So the
  guide layer turns that off, and the slideshow runs as an overlay on the page.

## How it works

- `setup/`: seeds the throwaway database with `server/seed`, adds accounts and
  cartoon portraits, and writes `facts.json`. It also writes the sample order
  of service and turns PDFs into images for scenes to show.
- `lib/servers.js`, `lib/web.mjs`: start the API and the client against the
  throwaway data.
- `lib/overlay.js`: the cursor, captions and callouts, injected into every
  page. It adds nothing to the page's own elements and takes no clicks.
- `lib/director.js`: records each segment through Chrome's screencast. The
  browser is launched at a real 1.5× scale, so a 1280×720 layout arrives as
  true 1080p frames, each stamped with the time it was painted.
- `build/segment.py`: rebuilds each segment at a steady 30fps from those
  timestamps.
- `build/assemble.py`: adds the title and closing cards. If the guide sets a
  duration, it plays the footage up to 12% faster to fit, and the closing card
  fills whatever time is left.
- `build/review.py`: writes the contact sheets.
