// Display themes a member can pick on My Household → Display.
//
// Every Tailwind color the site uses reads a CSS variable instead of a fixed
// value, so a theme only has to change variables — no component carries any
// theme-specific class. The variables come in three layers:
//
//   --c-<name>     the color itself, used by borders, rings, dividers and the like
//   --bg-<name>    used by bg-* utilities; falls back to --c-<name>
//   --text-<name>  used by text-* utilities; falls back to --c-<name>
//
// The separate background and text layers are what let Dark turn bg-white into
// a pale tint into a dark one while text-white on a navy button stays white.
//
// The Standard theme sets every --c-* to Tailwind's own value (and the church
// colors to their usual hex), so it looks exactly like the site always has.
import twColors from 'tailwindcss/colors.js';

export const FAMILIES = [
  'gray', 'slate', 'red', 'amber', 'emerald', 'green', 'blue', 'yellow', 'sky',
  'indigo', 'purple', 'orange', 'teal', 'rose', 'pink',
];
export const SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'];

export const CHURCH = {
  navy:  '#1a2744',
  gold:  '#c9a84c',
  cream: '#f9f6f0',
  brown: '#5c3d2e',
  sage:  '#7b9e87',
};

// '#1a2744' → '26 39 68', the form rgb(var(--x) / <alpha-value>) needs.
export function triplet(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16)).join(' ');
}

function mix(a, b, weightOfA) {
  const pa = triplet(a).split(' ').map(Number);
  const pb = triplet(b).split(' ').map(Number);
  return '#' + pa.map((v, i) => Math.round(v * weightOfA + pb[i] * (1 - weightOfA))
    .toString(16).padStart(2, '0')).join('');
}

const tw = (family, shade) => twColors[family][shade];

// ─── Tailwind side ───────────────────────────────────────────────────────────

const ref = (layer, name) => (layer === 'c'
  ? `rgb(var(--c-${name}) / <alpha-value>)`
  : `rgb(var(--${layer}-${name}, var(--c-${name})) / <alpha-value>)`);

function scale(layer) {
  const out = {
    white: ref(layer, 'white'),
    black: ref(layer, 'black'),
    church: Object.fromEntries(Object.keys(CHURCH).map(k => [k, ref(layer, `church-${k}`)])),
  };
  for (const f of FAMILIES) {
    out[f] = Object.fromEntries(SHADES.map(s => [s, ref(layer, `${f}-${s}`)]));
  }
  return out;
}

export const tailwindColors = {
  colors:          scale('c'),
  backgroundColor: scale('bg'),
  textColor:       scale('text'),
};

// ─── The themes ──────────────────────────────────────────────────────────────

function standard() {
  const vars = { white: '#ffffff', black: '#000000' };
  for (const [k, v] of Object.entries(CHURCH)) vars[`church-${k}`] = v;
  for (const f of FAMILIES) for (const s of SHADES) vars[`${f}-${s}`] = tw(f, s);
  return { c: vars };
}

const DARK_PAGE    = '#0f1a2e';
const DARK_SURFACE = '#152038';

function dark() {
  const c = {}, bg = {}, text = {};

  // Grays turn over: the light tints become dark surfaces and borders, the
  // dark shades become light text.
  Object.assign(c, {
    'gray-50': '#1b2742', 'gray-100': '#22304d', 'gray-200': '#2c3b5a', 'gray-300': '#3c4d6e',
    'gray-400': '#94a3b8', 'gray-500': '#a9b5c7', 'gray-600': '#c3ccd9', 'gray-700': '#d5dce6',
    'gray-800': '#e2e8f0', 'gray-900': '#f1f5f9', 'gray-950': '#f8fafc',
  });
  for (const s of SHADES) c[`slate-${s}`] = c[`gray-${s}`];
  // Faint text, and text already meant for a dark panel (presentation screens),
  // must stay readable rather than turning dark.
  for (const f of ['gray', 'slate']) {
    for (const s of ['50', '100', '200']) text[`${f}-${s}`] = tw(f, s);
    text[`${f}-300`] = '#7c8aa0';
    // Dark gray fills (tooltips, toggles) keep their dark color under white text.
    for (const s of ['600', '700', '800', '900', '950']) bg[`${f}-${s}`] = tw(f, s);
  }

  // Colored families: pale backgrounds become deep tints, deep text becomes
  // light, and solid buttons (500 and darker) keep their real color so white
  // text on them still reads.
  for (const f of FAMILIES.filter(f => f !== 'gray' && f !== 'slate')) {
    const deep = tw(f, '900');
    c[`${f}-50`]  = mix(deep, DARK_SURFACE, 0.30);
    c[`${f}-100`] = mix(deep, DARK_SURFACE, 0.45);
    c[`${f}-200`] = mix(tw(f, '800'), DARK_SURFACE, 0.65);
    c[`${f}-300`] = mix(tw(f, '700'), DARK_SURFACE, 0.80);
    c[`${f}-600`] = tw(f, '400');
    c[`${f}-700`] = tw(f, '300');
    c[`${f}-800`] = tw(f, '200');
    c[`${f}-900`] = tw(f, '100');
    c[`${f}-950`] = tw(f, '50');
    for (const s of ['50', '100', '200', '300', '400']) text[`${f}-${s}`] = tw(f, s);
    for (const s of ['500', '600', '700', '800', '900', '950']) bg[`${f}-${s}`] = tw(f, s);
  }

  Object.assign(c, {
    'church-navy':  '#c7d2e8',   // borders and rings around navy things
    'church-cream': DARK_PAGE,
  });
  // bg-white itself (cards) turns dark in src/index.css rather than here:
  // the see-through bg-white/10 highlights sit on navy panels and must stay
  // white.
  Object.assign(bg, {
    'church-navy':  '#2b4170',    // header and buttons, lifted off the dark page
  });
  Object.assign(text, {
    white:          '#ffffff',
    'church-navy':  '#f1ead8',    // headings and labels: warm off-white
  });
  return { c, bg, text };
}

function contrast() {
  const c = {}, bg = {}, text = {};
  // Stronger borders and darker secondary text on the usual light page.
  Object.assign(c, {
    'gray-100': '#6b7280', 'gray-200': '#6b7280', 'gray-300': '#4b5563', 'gray-400': '#374151',
  });
  for (const s of ['50', '100', '200', '300', '400']) bg[`gray-${s}`] = tw('gray', s);
  Object.assign(text, {
    'gray-50': tw('gray', '50'), 'gray-100': tw('gray', '100'), 'gray-200': tw('gray', '200'),
    'gray-300': '#4b5563', 'gray-400': '#374151', 'gray-500': '#1f2937', 'gray-600': '#111827',
    'gray-700': '#111827', 'gray-800': '#030712', 'gray-900': '#030712',
  });
  for (const f of FAMILIES.filter(f => f !== 'gray' && f !== 'slate')) {
    text[`${f}-400`] = tw(f, '800');
    text[`${f}-500`] = tw(f, '800');
    text[`${f}-600`] = tw(f, '800');
    text[`${f}-700`] = tw(f, '900');
    text[`${f}-800`] = tw(f, '900');
  }
  // Gold on white is too faint to read; a deeper gold keeps the look.
  Object.assign(c, {
    'church-gold':  '#7a5a12',
    'church-navy':  '#0d1730',
    'church-cream': '#ffffff',
  });
  return { c, bg, text };
}

export const THEMES = { standard: standard(), dark: dark(), contrast: contrast() };

// The CSS custom properties for one theme, as a { '--name': 'r g b' } object
// ready for Tailwind's addBase.
export function cssVars(theme) {
  const out = {};
  for (const layer of ['c', 'bg', 'text']) {
    for (const [name, hex] of Object.entries(theme[layer] || {})) out[`--${layer}-${name}`] = triplet(hex);
  }
  return out;
}
