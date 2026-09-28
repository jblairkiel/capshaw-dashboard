---
name: record-guide
description: Record a captioned video guide, walkthrough, tutorial or demo of the Capshaw member portal (desktop and/or phone) using tools/guides. Use when asked for a video, screencast, how-to, training clip or feature tour of the site, or to update an existing guide after the UI changes.
---

# Recording a guide of the portal

`tools/guides/` records guides from scripts. Each run seeds a throwaway copy of
the site with made-up sample data, drives it in a browser with a visible
cursor and captions, and writes a 1080p MP4. Read `tools/guides/README.md`
first: it has the setup commands and the full `Director` API. `guides/tour.js`
is the worked example.

## Steps

1. **Check the setup.** Run `node tools/guides/run.js` with no arguments. It
   lists the guides that exist, or reports exactly what is missing (Playwright,
   or the Python packages).
2. **Look before you script.** For each page the guide covers, read the
   component under `client/src/components/` to learn what it does and what its
   buttons, placeholders and headings are called. A scene only works, and a
   caption is only true, if it matches the real UI.
3. **Write or extend the guide** in `tools/guides/guides/<name>.js`, following
   `tour.js`. Keep each segment to one device. Use a `phone` segment for
   anything that should be seen on a phone.
4. **Record one segment at a time while you work:**
   `node tools/guides/run.js <name> --only=<segment>`. If it fails, open
   `tools/guides/work/<name>/failed-<segment>.png` to see the screen at that
   moment.
5. **Record the whole guide** with `node tools/guides/run.js <name>`. Then
   open the contact sheets in `tools/guides/output/<name>-review/` and check
   them. Look for captions that match what is on screen, callouts in the right
   place, and no stray dialogs.
   Pull extra frames with `python3 tools/guides/build/review.py <video> <dir> 40`
   when a moment needs a closer look.
6. **Deliver** `tools/guides/output/<name>.mp4` to the user, and say plainly
   anything that was staged (see below).

## Rules

- **Sample data only.** Never point the tool at the real database, and never
  put a real person's name, photo or contact details in a scene. If a seeder
  turns out to carry real-looking data, scrub it in `setup/index.js` and tell
  the user, the way #95 was handled.
- **No hard-coded names or dates in scenes.** The sample data changes every
  run. Use `facts` (add what you need to `setup/index.js`), or pick rows by
  position.
- **Captions must be true.** Only describe what the feature really does. For
  example, directory phone numbers are plain text but email addresses are
  links, so the tour says "tap to email", not "tap to call". If a caption
  promises something, check it in the code.
- **Say what's staged.** If a scene fakes anything, say so in the guide's
  comments and when delivering it: a press shown with `{ real: false }`, an
  image standing in for a download, fixed randomness. If a button would set
  off a known bug, show the press without clicking rather than recording the
  bug, and point to the issue.
- **Pacing.** A caption needs about 3–5 seconds of `d.hold()` to be read. If a
  guide sets `duration`, the footage can only be sped up by 12%. Beyond that,
  cut scenes or lower `pace`; don't let a guide get rushed.
- `tools/guides/work/` and `output/` are scratch folders, ignored by git.
  Never commit a video or a recording to the repo.
