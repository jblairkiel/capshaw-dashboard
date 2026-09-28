#!/usr/bin/env node
// Records a guide end to end:
//
//   node tools/guides/run.js <guide> [--only=seg1,seg2] [--pace=0.85] [--no-video]
//
// 1. a fresh throwaway database in tools/guides/work/<guide>/, filled with the
//    app's own sample data plus portraits, accounts and a few documents
// 2. the API and the client started against it on their own ports
// 3. each segment of guides/<guide>.js recorded in its own browser, with a
//    visible cursor and captions, at 1920x1080
// 4. the clips joined with title and closing cards into output/<guide>.mp4,
//    and contact sheets written beside it for checking the result
//
// Nothing here reads or writes the real database, and the portal it starts
// can neither scrape the church site nor send mail (see lib/servers.js).
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const HERE = __dirname;
const args = process.argv.slice(2);
const guideName = args.find(a => !a.startsWith('--'));
const flag = name => args.find(a => a.startsWith(`--${name}`))?.split('=')[1] ?? (args.includes(`--${name}`) ? true : undefined);

function die(message) { console.error(`\n${message}\n`); process.exit(1); }

if (!guideName) {
  const guides = fs.readdirSync(path.join(HERE, 'guides')).filter(f => f.endsWith('.js')).map(f => f.replace(/\.js$/, ''));
  die(`Which guide? node tools/guides/run.js <${guides.join('|')}> [--only=segment,…] [--pace=0.85] [--no-video]`);
}
const guideFile = path.join(HERE, 'guides', `${path.basename(guideName)}.js`);
if (!fs.existsSync(guideFile)) die(`There is no guide called "${guideName}" in tools/guides/guides/.`);

let chromium;
try { ({ chromium } = require('playwright')); } catch {
  die('Playwright is missing. Run: (cd tools/guides && npm install && npx playwright install chromium)');
}
const PYTHON = process.env.PYTHON || 'python3';
const pyCheck = spawnSync(PYTHON, ['-c', 'import PIL, imageio_ffmpeg, docx, pymupdf'], { encoding: 'utf8' });
if (pyCheck.status !== 0) die(`Python packages are missing. Run: pip install -r tools/guides/requirements.txt\n${pyCheck.stderr}`);

const guide = require(guideFile);
const { start: startServers, portalEnv } = require('./lib/servers');
const { LAUNCH_ARGS, openSegment, sleep } = require('./lib/director');
const { renderCards } = require('./lib/cards');

const only = typeof flag('only') === 'string' ? flag('only').split(',') : null;
const pace = Number(flag('pace') ?? guide.pace ?? 1);
const segments = guide.segments.filter(s => !only || only.includes(s.name));
if (!segments.length) die(`No segments match --only=${only}. This guide has: ${guide.segments.map(s => s.name).join(', ')}`);

const work = path.join(HERE, 'work', path.basename(guideName));
const output = path.join(HERE, 'output');

function step(message) { console.log(`\n▸ ${message}`); }
function run(cmd, cmdArgs, options = {}) {
  const r = spawnSync(cmd, cmdArgs, { cwd: HERE, stdio: 'inherit', ...options });
  if (r.status !== 0) throw new Error(`${path.basename(cmd)} ${cmdArgs.join(' ')} failed`);
}
const python = async (script, scriptArgs = []) => run(PYTHON, [path.join(HERE, script), ...scriptArgs]);

(async () => {
  step(`Setting up a fresh copy of the site in ${path.relative(process.cwd(), work)}`);
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(path.join(work, 'assets'), { recursive: true });
  run(process.execPath, [path.join(HERE, 'setup/index.js'), work], { env: portalEnv(work) });
  await python('setup/portraits.py', [work]);
  await python('setup/order_of_service.py', [work]);
  const facts = JSON.parse(fs.readFileSync(path.join(work, 'facts.json'), 'utf8'));

  step('Starting the portal');
  const portal = await startServers(work);
  const browser = await chromium.launch({ args: LAUNCH_ARGS });
  const stopAll = async () => { await browser.close().catch(() => {}); portal.stop(); };
  process.on('SIGINT', async () => { await stopAll(); process.exit(130); });

  const marks = {};
  try {
    // Signed in once, off camera: the session the signed-in segments reuse,
    // and the requests `prepare` makes.
    const session = await browser.newContext({ viewport: null, baseURL: portal.base, extraHTTPHeaders: { Origin: portal.base } });
    const page = await session.newPage();
    await page.goto('/');
    await page.fill('input[type=email]', facts.login.email);
    await page.fill('input[type=password]', facts.login.password);
    await page.click('button[type=submit]');
    await page.locator('input[type=password]').waitFor({ state: 'detached', timeout: 15000 });
    const storageState = path.join(work, 'session.json');
    await session.storageState({ path: storageState });
    if (guide.prepare) {
      step('Preparing what the scenes show');
      await guide.prepare({ request: session.request, work, facts, base: portal.base, python });
    }
    await session.close();

    if (guide.cards) await renderCards(browser, guide.cards, path.join(work, 'assets'));

    for (const seg of segments) {
      step(`Recording ${seg.name} (${seg.device || 'desktop'})`);
      const s = await openSegment(browser, {
        base: portal.base, work, name: seg.name, device: seg.device, pace, start: seg.start || '/',
        storageState: seg.signedIn === false ? undefined : storageState,
      });
      try {
        await seg.ready({ page: s.page, phone: s.phone }).waitFor({ timeout: 20000 });
        await s.d.cursorTo(s.phone ? 1060 : 900, s.phone ? 520 : 560, 0);
        await sleep(600);
        s.d.mark('start');
        await seg.run({ d: s.d, page: s.page, phone: s.phone, facts });
        await s.d.hideCaption();
        await sleep(700);
        s.d.mark('end');
        marks[seg.name] = s.d.marks;
      } catch (e) {
        const shot = path.join(work, `failed-${seg.name}.png`);
        await s.page.screenshot({ path: shot }).catch(() => {});
        throw new Error(`${seg.name} failed: ${e.message.split('\n')[0]}\nThe screen at that moment: ${shot}`);
      } finally {
        await s.close();
      }
    }
  } finally {
    fs.writeFileSync(path.join(work, 'marks.json'), JSON.stringify(marks, null, 2));
    await stopAll();
  }

  step('Building the video');
  for (const seg of segments) await python('build/segment.py', [work, seg.name]);
  const clips = segments.map(seg => path.join(work, 'rec', `${seg.name}.mp4`));

  if (only || flag('no-video')) {
    console.log(`\nSegment clips:\n${clips.map(c => `  ${c}`).join('\n')}`);
    return;
  }

  fs.mkdirSync(output, { recursive: true });
  const out = path.join(output, `${path.basename(guideName)}.mp4`);
  const plan = path.join(work, 'plan.json');
  fs.writeFileSync(plan, JSON.stringify({
    segments: clips,
    titleCard: guide.cards?.title && path.join(work, 'assets', 'card-title.png'),
    endCard: guide.cards?.end && path.join(work, 'assets', 'card-end.png'),
    titleSeconds: 4, endSeconds: 5, total: guide.duration || null, out,
  }));
  await python('build/assemble.py', [plan]);
  await python('build/review.py', [out, path.join(output, `${path.basename(guideName)}-review`)]);
  console.log(`\nDone: ${out}`);
})().catch(e => die(e.message));
