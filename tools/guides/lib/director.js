// What a guide's scenes are written against: a browser page with the guide
// layer on it, and a Director that moves a visible cursor, clicks, types,
// captions and points at things — slowly enough for somebody to follow.
const fs = require('fs');
const path = require('path');

// Laid out as a 1280x720 screen, drawn at 1.5x. Chrome's screencast ignores
// an emulated scale factor, so the browser is launched at a real one instead
// and no viewport is emulated: frames then arrive as true 1920x1080.
const VIEW = { width: 1280, height: 720 };
const LAUNCH_ARGS = ['--window-size=1280,720', '--force-device-scale-factor=1.5', '--hide-scrollbars'];

const OVERLAY = fs.readFileSync(path.join(__dirname, 'overlay.js'), 'utf8');
const STAGE = fs.readFileSync(path.join(__dirname, 'stage.html'), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Every frame Chrome paints, stamped with wall-clock time, so the clip can be
// rebuilt at an exact frame rate afterwards (build/segment.py).
class Capture {
  constructor(page, dir) { Object.assign(this, { page, dir, frames: [], n: 0 }); }
  async start() {
    fs.rmSync(this.dir, { recursive: true, force: true });
    fs.mkdirSync(this.dir, { recursive: true });
    this.cdp = await this.page.context().newCDPSession(this.page);
    this.cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
      const file = path.join(this.dir, `${String(this.n++).padStart(6, '0')}.jpg`);
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
      this.frames.push({ file, ts: metadata.timestamp });
      this.cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    });
    await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 93, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  }
  async stop() {
    await this.cdp.send('Page.stopScreencast').catch(() => {});
    fs.writeFileSync(path.join(this.dir, 'frames.json'), JSON.stringify(this.frames));
  }
}

class Director {
  constructor(page, { name, pace = 1, phone = null }) {
    Object.assign(this, { page, name, pace, phone, marks: [], frameRect: null });
  }

  mark(label) {
    this.marks.push({ label, epoch: Date.now() / 1000 });
    console.log(`  [${this.name}] ${label}`);
  }

  sleep(ms) { return sleep(ms); }
  // A pause for reading. Scaled by --pace; the cursor's own movement is not.
  hold(ms) { return sleep(ms * this.pace); }
  ui(fn, arg) { return this.page.evaluate(fn, arg); }

  async cursorTo(x, y, ms = 650) {
    await this.ui(([x, y, ms]) => window.__guide.place(x, y, ms), [x, y, ms]);
    await this.page.mouse.move(x, y, { steps: 8 });
    await sleep(ms);
  }

  // Scrolls smoothly until the element is comfortably on screen — clear of
  // the header and the caption — and returns where it ended up.
  async reveal(loc) {
    await loc.waitFor({ state: 'visible', timeout: 15000 });
    const r = this.frameRect || { x: 0, y: 0, ...VIEW };
    const top = r.y + (this.frameRect ? 120 : 150), bottom = r.y + r.height - (this.frameRect ? 40 : 170);
    let b = await loc.boundingBox();
    if (!b || b.y < top || b.y + b.height > bottom) {
      await loc.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      await sleep(900);
      b = await loc.boundingBox();
    }
    return b;
  }

  async point(loc, ms = 650) {
    const b = await this.reveal(loc);
    const x = b.x + b.width / 2, y = b.y + b.height / 2;
    await this.cursorTo(x, y, ms);
    return { x, y, b };
  }

  // `real: false` shows the press without sending it — for a button whose
  // effect a guide should not cause, with the result shown some other way.
  async click(loc, { ms = 650, real = true } = {}) {
    const { x, y } = await this.point(loc, ms);
    await sleep(120);
    await this.ui(([x, y]) => window.__guide.ripple(x, y), [x, y]);
    if (real) await this.page.mouse.click(x, y);
    await sleep(300);
  }

  async type(text, delay = 55) { await this.page.keyboard.type(text, { delay }); }

  // { chip, title, text } — a lower-third on the desktop, or with `side: true`
  // the large panel beside the phone.
  async caption(opts) { await this.ui(o => window.__guide.caption(o), opts); }
  async hideCaption() { await this.ui(() => window.__guide.hideCaption()); }

  // A gold box around one element, or around everything from the first to the
  // last of several, with a label above or below it.
  async callout(locs, label, opts = {}) {
    const boxes = [];
    for (const l of [].concat(locs)) boxes.push(await l.boundingBox());
    const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
    const w = Math.max(...boxes.map(b => b.x + b.width)) - x, h = Math.max(...boxes.map(b => b.y + b.height)) - y;
    await this.ui(o => window.__guide.callout(o), { x, y, w, h, label, ...opts });
  }
  async clear() { await this.ui(() => window.__guide.clearCallouts()); await sleep(300); }

  // An image from the run's assets, dimmed in over the page.
  async showImage(file) { await this.ui(src => window.__guide.showImage(src), `/__asset/${file}`); }
  async hideImage() { await this.ui(() => window.__guide.hideImage()); }

  async scroll(dy, frame) {
    await (frame || this.page).evaluate(dy => window.scrollBy({ top: dy, behavior: 'smooth' }), dy);
    await sleep(900);
  }

  // ─── Desktop ───────────────────────────────────────────────────────────────

  // Opens a group in the top navigation and picks a page from it.
  async nav(group, item) {
    const page = this.page;
    await this.click(page.locator('button').filter({ has: page.locator('span', { hasText: new RegExp(`^${group}$`) }) }).first(), { ms: 600 });
    await sleep(350);
    await this.click(page.locator('div.absolute.top-full').getByRole('button', { name: item, exact: true }), { ms: 500 });
    await sleep(900);
  }

  // ─── Phone ─────────────────────────────────────────────────────────────────

  // The app's own window inside the phone, for scrolling it.
  phoneFrame() {
    return this.page.frames().find(f => f !== this.page.mainFrame());
  }

  // Opens the phone's page menu and picks a page from it.
  async menu(item) {
    await this.click(this.phone.locator('button[aria-controls="mobile-nav-panel"]'), { ms: 550 });
    await sleep(500);
    await this.click(this.phone.locator('#mobile-nav-panel').getByRole('button', { name: item, exact: true }), { ms: 550 });
    await sleep(900);
  }

  // A finger dragging up the screen while the page scrolls under it.
  async swipe(dy) {
    const r = this.frameRect, x = r.x + r.width * 0.62, y0 = r.y + r.height * 0.72;
    await this.cursorTo(x, y0, 450);
    await this.ui(([x, y]) => window.__guide.ripple(x, y), [x, y0]);
    await this.ui(([x, y, ms]) => window.__guide.place(x, y, ms), [x, y0 - Math.min(260, dy * 0.5), 700]);
    await this.phoneFrame().evaluate(dy => window.scrollBy({ top: dy, behavior: 'smooth' }), dy);
    await sleep(950);
  }

  // Loads a different page into the phone, as if a link had been followed.
  async openOnPhone(url) {
    await this.page.evaluate(u => { document.getElementById('phone').src = u; }, url);
  }

  // An email beside the phone, with its link ready to be tapped.
  async showEmail(opts) { await this.ui(o => window.__guide.showEmail(o), opts); }
  async hideEmail() { await this.ui(() => window.__guide.hideEmail()); }
  async tapEmailLink() {
    const r = await this.ui(() => window.__guide.linkRect());
    const x = r.x + r.w * 0.55, y = r.y + r.h / 2;
    await this.cursorTo(x, y, 800);
    await this.ui(([x, y]) => window.__guide.ripple(x, y), [x, y]);
    await sleep(300);
  }
}

// One recorded segment: a fresh browser context — signed in or not, desktop
// or phone — with the guide layer on every page and every frame captured.
async function openSegment(browser, { base, work, name, device = 'desktop', storageState, start = '/', pace = 1 }) {
  const ctx = await browser.newContext({ viewport: null, storageState });
  await ctx.addInitScript({ content: `window.__guideMode=${JSON.stringify(device === 'phone' ? 'touch' : 'mouse')};\n${OVERLAY}` });
  await ctx.route(`${base}/__stage*`, r => r.fulfill({ contentType: 'text/html', body: STAGE }));
  await ctx.route(`${base}/__asset/*`, r => {
    const file = path.join(work, 'assets', path.basename(new URL(r.request().url()).pathname));
    return fs.existsSync(file) ? r.fulfill({ path: file }) : r.fulfill({ status: 404, body: 'no such asset' });
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log(`  [${name}] page error:`, e.message));

  const cap = new Capture(page, path.join(work, 'rec', name));
  await cap.start();

  const phone = device === 'phone' ? page.frameLocator('#phone') : null;
  const d = new Director(page, { name, pace, phone });
  if (phone) {
    await page.goto(`${base}/__stage`);
    await d.openOnPhone(start);
    await phone.locator('body').waitFor();
    d.frameRect = await page.locator('#phone').boundingBox();
  } else {
    await page.goto(`${base}${start}`);
  }

  const close = async () => { await sleep(300); await cap.stop(); await ctx.close(); };
  return { page, d, phone, close };
}

module.exports = { VIEW, LAUNCH_ARGS, Director, openSegment, sleep };
