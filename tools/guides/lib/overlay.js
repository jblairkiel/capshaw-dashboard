// The presentation layer, injected into every page a guide records: a visible
// cursor (or a fingertip on the phone), captions, callouts, and panels for an
// image or an email. It sits above the app and takes no clicks, so the app
// underneath behaves exactly as it would for a real person.
//
// Inside the phone frame nothing is drawn — the stage page around it carries
// the layer — but randomness is pinned there, so a shuffled screen (Member
// Match) always comes up in the same order and a guide knows which answer is
// right. Math.random pinned just under 1 makes every Fisher-Yates swap a no-op,
// the same trick the app's own tests use.
(() => {
  if (window.top !== window) {
    Math.random = () => 0.999999;
    return;
  }

  // Native fullscreen puts one element in the top layer and hides everything
  // else, captions included; the slideshow is just as good as a page overlay.
  Element.prototype.requestFullscreen = function () { return Promise.reject(new Error('demo')); };

  const NAVY = '#1a2744', GOLD = '#c9a84c';
  const css = `
  #__d-root { position: fixed; inset: 0; pointer-events: none; z-index: 2147483646; font-family: "Inter", "Segoe UI", "DejaVu Sans", system-ui, sans-serif; }
  #__d-root * { box-sizing: border-box; }
  .__d-cursor { position: fixed; left: 0; top: 0; width: 30px; height: 30px; z-index: 3; will-change: transform;
    transition-property: transform; transition-timing-function: cubic-bezier(.45,.05,.25,1); filter: drop-shadow(0 2px 3px rgba(0,0,0,.45)); }
  .__d-touch { position: fixed; left: 0; top: 0; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%; z-index: 3;
    background: rgba(255,255,255,.55); border: 2px solid rgba(26,39,68,.55); box-shadow: 0 4px 14px rgba(0,0,0,.35);
    transition-property: transform, opacity; transition-timing-function: cubic-bezier(.45,.05,.25,1); }
  .__d-touch.pressed { background: rgba(201,168,76,.75); }
  .__d-ripple { position: fixed; width: 20px; height: 20px; margin: -10px 0 0 -10px; border-radius: 50%; border: 3px solid ${GOLD};
    z-index: 2; animation: __d-ripple .55s ease-out forwards; }
  @keyframes __d-ripple { from { transform: scale(.4); opacity: 1 } to { transform: scale(3.2); opacity: 0 } }

  .__d-cap { position: fixed; left: 28px; bottom: 28px; max-width: 540px; padding: 16px 22px 18px 24px; border-radius: 14px;
    background: rgba(18,28,52,.94); color: #fff; box-shadow: 0 14px 40px rgba(0,0,0,.35); border-left: 6px solid ${GOLD};
    transform: translateY(24px); opacity: 0; transition: transform .45s cubic-bezier(.2,.8,.2,1), opacity .45s; }
  .__d-cap.right { left: auto; right: 28px; }
  .__d-cap.show { transform: none; opacity: 1; }
  .__d-chip { display: inline-block; font-size: 11px; letter-spacing: .14em; font-weight: 700; color: ${NAVY}; background: ${GOLD};
    padding: 3px 9px; border-radius: 999px; margin-bottom: 8px; }
  .__d-title { font-family: Georgia, "Times New Roman", serif; font-size: 27px; font-weight: 700; line-height: 1.15; margin: 0 0 6px; }
  .__d-text { font-size: 16px; line-height: 1.45; color: #dde3ef; margin: 0; }

  .__d-side { position: fixed; left: 70px; top: 50%; width: 560px; transform: translate(-16px, -50%); opacity: 0;
    transition: transform .5s cubic-bezier(.2,.8,.2,1), opacity .5s; color: #fff; }
  .__d-side.show { transform: translate(0, -50%); opacity: 1; }
  .__d-side .__d-title { font-size: 44px; margin-bottom: 14px; }
  .__d-side .__d-text { font-size: 21px; line-height: 1.5; color: #cfd7e6; }
  .__d-side .__d-chip { font-size: 13px; margin-bottom: 16px; }

  .__d-callout { position: fixed; border: 3px solid ${GOLD}; border-radius: 12px; z-index: 1;
    box-shadow: 0 0 0 4000px rgba(10,16,32,.0), 0 0 0 6px rgba(201,168,76,.28), 0 0 22px rgba(201,168,76,.55);
    opacity: 0; transform: scale(1.06); transition: opacity .35s, transform .35s; }
  .__d-callout.show { opacity: 1; transform: none; }
  .__d-callout.dim { box-shadow: 0 0 0 4000px rgba(10,16,32,.38), 0 0 0 6px rgba(201,168,76,.28), 0 0 22px rgba(201,168,76,.55); }
  .__d-label { position: absolute; left: -3px; white-space: nowrap; background: ${GOLD}; color: ${NAVY}; font-weight: 700; font-size: 15px;
    padding: 6px 12px; border-radius: 8px; box-shadow: 0 6px 16px rgba(0,0,0,.25); }
  .__d-label.above { bottom: calc(100% + 10px); }
  .__d-label.below { top: calc(100% + 10px); }
  .__d-label.alignright { left: auto; right: -3px; }

  .__d-shade { position: fixed; inset: 0; background: rgba(8,12,24,.72); opacity: 0; transition: opacity .45s; display: flex;
    align-items: center; justify-content: flex-end; padding-right: 110px; }
  .__d-shade.show { opacity: 1; }
  .__d-shade img { max-height: 92vh; max-width: 70vw; border-radius: 6px; box-shadow: 0 30px 80px rgba(0,0,0,.6);
    transform: scale(.86) translateY(20px); transition: transform .6s cubic-bezier(.2,.8,.2,1); }
  .__d-shade.show img { transform: none; }

  .__d-email { position: fixed; left: 70px; top: 50%; width: 600px; transform: translate(-16px,-50%); opacity: 0;
    transition: transform .5s cubic-bezier(.2,.8,.2,1), opacity .5s; }
  .__d-email .head { color: #fff; margin-bottom: 18px; }
  .__d-email .head .__d-title { font-size: 34px; }
  .__d-email .card { background: #fff; border-radius: 14px; overflow: hidden; box-shadow: 0 24px 60px rgba(0,0,0,.45); color: #1f2937; }
  .__d-email.show { transform: translate(0,-50%); opacity: 1; }
  .__d-email .bar { background: #eef1f6; padding: 12px 18px; font-size: 13px; color: #5b6475; border-bottom: 1px solid #dde2ea; }
  .__d-email .bar b { color: #1f2937; }
  .__d-email .subj { font-family: Georgia, serif; font-size: 21px; font-weight: 700; color: ${NAVY}; padding: 16px 20px 4px; }
  .__d-email pre { margin: 0; padding: 8px 20px 20px; font: 14.5px/1.55 "DejaVu Sans Mono", monospace; white-space: pre-wrap; color: #374151; }
  .__d-email a { color: #1d4ed8; text-decoration: underline; }
  `;

  const state = { root: null, cursor: null, cap: null, callouts: [], mode: 'mouse', x: 640, y: 400 };

  function build() {
    if (state.root || !document.documentElement) return;
    const style = document.createElement('style'); style.textContent = css;
    const root = document.createElement('div'); root.id = '__d-root';
    root.appendChild(style);
    document.documentElement.appendChild(root);
    state.root = root;
    setMode(window.__guideMode || 'mouse');
  }

  function setMode(mode) {
    state.mode = mode;
    if (state.cursor) state.cursor.remove();
    let el;
    if (mode === 'touch') {
      el = document.createElement('div'); el.className = '__d-touch';
    } else {
      el = document.createElement('div'); el.className = '__d-cursor';
      el.innerHTML = '<svg width="30" height="30" viewBox="0 0 24 24"><path d="M4 2.5 L4 19.5 L8.6 15.3 L11.6 22 L14.5 20.7 L11.5 14.2 L17.6 14.2 Z" fill="#fff" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    }
    state.root.appendChild(el);
    state.cursor = el;
    place(state.x, state.y, 0);
  }

  function place(x, y, ms) {
    state.x = x; state.y = y;
    const c = state.cursor; if (!c) return;
    c.style.transitionDuration = `${ms}ms`;
    // The arrow's tip is its top-left corner; the touch dot is centred by margin.
    c.style.transform = state.mode === 'touch' ? `translate(${x}px, ${y}px)` : `translate(${x - 4}px, ${y - 2}px)`;
  }

  function ripple(x, y) {
    const r = document.createElement('div'); r.className = '__d-ripple';
    r.style.left = `${x}px`; r.style.top = `${y}px`;
    state.root.appendChild(r); setTimeout(() => r.remove(), 700);
    if (state.mode === 'touch') {
      state.cursor.classList.add('pressed');
      state.cursor.style.transitionDuration = '120ms';
      state.cursor.style.transform = `translate(${x}px, ${y}px) scale(.8)`;
      setTimeout(() => { state.cursor.classList.remove('pressed'); place(x, y, 150); }, 180);
    }
  }

  function caption({ chip = '', title = '', text = '', pos = 'left', side = false } = {}) {
    hideCaption(true);
    const el = document.createElement('div');
    el.className = side ? '__d-side' : `__d-cap ${pos === 'right' ? 'right' : ''}`;
    el.innerHTML = `${chip ? `<div class="__d-chip">${chip}</div>` : ''}<div class="__d-title"></div><p class="__d-text"></p>`;
    el.querySelector('.__d-title').textContent = title;
    el.querySelector('.__d-text').textContent = text;
    state.root.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
    state.cap = el;
  }

  function hideCaption(immediate) {
    const el = state.cap; if (!el) return;
    state.cap = null;
    el.classList.remove('show');
    setTimeout(() => el.remove(), immediate ? 450 : 500);
  }

  function callout({ x, y, w, h, label = '', where = 'above', dim = false, alignRight = false, pad = 6 }) {
    const el = document.createElement('div');
    el.className = `__d-callout${dim ? ' dim' : ''}`;
    Object.assign(el.style, { left: `${x - pad}px`, top: `${y - pad}px`, width: `${w + pad * 2}px`, height: `${h + pad * 2}px` });
    if (label) {
      const l = document.createElement('div');
      l.className = `__d-label ${where}${alignRight ? ' alignright' : ''}`;
      l.textContent = label; el.appendChild(l);
    }
    state.root.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
    state.callouts.push(el);
  }

  function clearCallouts() {
    for (const el of state.callouts) { el.classList.remove('show'); setTimeout(() => el.remove(), 400); }
    state.callouts = [];
  }

  let shade = null;
  function showImage(src) {
    shade = document.createElement('div'); shade.className = '__d-shade';
    shade.innerHTML = `<img src="${src}">`;
    state.root.insertBefore(shade, state.cursor);
    requestAnimationFrame(() => requestAnimationFrame(() => shade.classList.add('show')));
  }
  function hideImage() { if (!shade) return; const s = shade; shade = null; s.classList.remove('show'); setTimeout(() => s.remove(), 500); }

  let email = null;
  function showEmail({ from, to, subject, body, link, chip, heading }) {
    hideCaption(true);
    email = document.createElement('div'); email.className = '__d-email';
    email.innerHTML = `<div class="head"><div class="__d-chip"></div><div class="__d-title"></div></div><div class="card"><div class="bar"><b></b> &lt;<span class="f"></span>&gt;<br>to <span class="t"></span></div><div class="subj"></div><pre></pre></div>`;
    email.querySelector('.__d-chip').textContent = chip;
    email.querySelector('.__d-title').textContent = heading;
    email.querySelector('b').textContent = from.name;
    email.querySelector('.f').textContent = from.email;
    email.querySelector('.t').textContent = to;
    email.querySelector('.subj').textContent = subject;
    const pre = email.querySelector('pre');
    const at = body.indexOf(link);
    pre.append(document.createTextNode(body.slice(0, at)));
    const a = document.createElement('a'); a.id = '__d-link'; a.textContent = link; pre.append(a);
    pre.append(document.createTextNode(body.slice(at + link.length)));
    state.root.appendChild(email);
    requestAnimationFrame(() => requestAnimationFrame(() => email.classList.add('show')));
  }
  function linkRect() { const r = document.getElementById('__d-link')?.getBoundingClientRect(); return r && { x: r.x, y: r.y, w: r.width, h: r.height }; }
  function hideEmail() { if (!email) return; const e = email; email = null; e.classList.remove('show'); setTimeout(() => e.remove(), 500); }

  window.__guide = { place, ripple, caption, hideCaption, callout, clearCallouts, showImage, hideImage, showEmail, hideEmail, linkRect };
  if (document.documentElement) build();
  document.addEventListener('DOMContentLoaded', build);
})();
