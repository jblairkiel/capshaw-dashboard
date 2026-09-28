// The opening and closing cards, drawn as 1920x1080 stills in the portal's
// navy and gold. A guide supplies the words (see guides/tour.js); these are
// the layouts.
const path = require('path');

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const STYLE = `<style>
html,body{margin:0;height:100%;overflow:hidden;background:radial-gradient(1100px 650px at 50% 42%, #26395f 0%, #16213b 55%, #0d1426 100%);
 color:#fff;font-family:"DejaVu Sans",sans-serif;display:flex;align-items:center;justify-content:center;text-align:center}
.cross{width:54px;height:54px;margin:0 auto 26px;position:relative}.cross:before,.cross:after{content:'';position:absolute;background:#c9a84c;border-radius:2px}
.cross:before{left:24px;top:0;width:6px;height:54px}.cross:after{left:8px;top:14px;width:38px;height:6px}
h1{font:700 58px/1.1 Georgia,serif;margin:0 0 10px}.kicker{color:#c9a84c;font-weight:700;letter-spacing:.3em;font-size:15px;margin-bottom:34px}
.rule{width:120px;height:3px;background:#c9a84c;margin:0 auto 30px;border-radius:2px}.sub{font-size:24px;color:#cfd7e6}
.small{margin-top:40px;font-size:14px;color:#8d9ab3;letter-spacing:.04em}
.grid{display:grid;grid-template-columns:repeat(3,auto);gap:12px 44px;justify-content:center;margin:6px 0 0;font-size:19px;color:#dfe5f0;text-align:left}
.grid span:before{content:'';display:inline-block;width:8px;height:8px;border-radius:50%;background:#c9a84c;margin-right:12px;vertical-align:middle}
</style>`;

function titleCard({ kicker = 'MEMBER PORTAL', heading, sub = '', note = '' }) {
  return `${STYLE}<div><div class="cross"></div><div class="kicker">${esc(kicker)}</div><h1>${esc(heading)}</h1><div class="rule"></div>
<div class="sub">${esc(sub)}</div>${note ? `<div class="small">${esc(note)}</div>` : ''}</div>`;
}

function endCard({ heading, items = [], note = '' }) {
  return `${STYLE}<div><div class="cross"></div><h1 style="font-size:46px">${esc(heading)}</h1><div class="rule" style="margin-top:22px"></div>
<div class="grid">${items.map(i => `<span>${esc(i)}</span>`).join('')}</div>${note ? `<div class="small" style="margin-top:46px">${esc(note)}</div>` : ''}</div>`;
}

// Renders whichever cards the guide defines into the run's assets folder.
async function renderCards(browser, cards, assets) {
  const ctx = await browser.newContext({ viewport: null });
  const page = await ctx.newPage();
  const made = {};
  for (const [kind, html] of [['title', cards.title && titleCard(cards.title)], ['end', cards.end && endCard(cards.end)]]) {
    if (!html) continue;
    await page.setContent(html);
    made[kind] = path.join(assets, `card-${kind}.png`);
    await page.screenshot({ path: made[kind] });
  }
  await ctx.close();
  return made;
}

module.exports = { renderCards };
