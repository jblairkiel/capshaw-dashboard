// Reads an Excel workbook (.xlsx) far enough to see what each cell says and
// what colour it is filled with — which is what an attendance sheet kept by
// colouring in cells needs, and what the common spreadsheet libraries' free
// versions leave out.
//
// An .xlsx is a zip of XML parts. This reads them with jszip, which the project
// already has (server/lib/bulletinDocx.js), rather than adding a dependency:
//
//   xl/workbook.xml (+ its _rels)  which sheets there are, and where
//   xl/sharedStrings.xml           the text cells point into
//   xl/styles.xml                  each cell's style → its fill → its colour
//   xl/theme/theme1.xml            the colours a "theme" fill refers to
//   xl/worksheets/sheetN.xml       the cells
//
// Only a cell's own fill is read. Colour that comes from conditional
// formatting is worked out by Excel as it draws and is not stored on the cell.

const JSZip = require('jszip');

const MAX_UNCOMPRESSED = 60 * 1024 * 1024;

// ─── XML ──────────────────────────────────────────────────────────────────────

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decode(text) {
  return String(text ?? '').replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (all, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e] ?? all;
  });
}

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([\w:]+)\s*=\s*"([^"]*)"/g)) out[m[1].replace(/^\w+:/, '')] = decode(m[2]);
  return out;
}

// Every element called `name` (namespace prefix ignored), with its attributes
// and inner XML.
function elements(xml, name) {
  const re = new RegExp(`<(?:\\w+:)?${name}(\\s[^>]*?)?(?:/>|>([\\s\\S]*?)</(?:\\w+:)?${name}>)`, 'g');
  return [...xml.matchAll(re)].map(m => ({ attrs: attrs(m[1] || ''), inner: m[2] || '' }));
}

const textOf = inner => elements(inner, 't').map(t => decode(t.inner)).join('');

// ─── Colours ──────────────────────────────────────────────────────────────────

// Excel's legacy palette, for fills given as indexed="n".
const INDEXED = [
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080',
  '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF',
  '000080', 'FF00FF', 'FFFF00', '00FFFF', '800080', '800000', '008080', '0000FF',
  '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99',
  '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696',
  '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333',
];

// A theme colour's index counts light-before-dark, the reverse of the order the
// theme file lists them in.
const THEME_ORDER = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];

function themeColours(xml) {
  const scheme = elements(xml || '', 'clrScheme')[0]?.inner || '';
  const out = {};
  for (const name of ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink']) {
    const inner = elements(scheme, name)[0]?.inner || '';
    const srgb = elements(inner, 'srgbClr')[0]?.attrs.val;
    const sys = elements(inner, 'sysClr')[0]?.attrs.lastClr;
    out[name] = (srgb || sys || '').toUpperCase() || null;
  }
  return THEME_ORDER.map(n => out[n]);
}

// Excel lightens or darkens a theme colour by a tint between -1 and 1, in HSL.
function applyTint(hex, tint) {
  if (!tint) return hex;
  const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  l = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
  const hue = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let out;
  if (s === 0) out = [l, l, l];
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    out = [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)];
  }
  return out.map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}

function colourOf(a, { theme, indexed }) {
  if (!a) return null;
  let hex = null;
  if (a.rgb) hex = a.rgb.slice(-6).toUpperCase();
  else if (a.theme !== undefined) hex = theme[Number(a.theme)] || null;
  else if (a.indexed !== undefined) hex = indexed[Number(a.indexed)] || null; // 64/65 are "automatic"
  if (!hex || !/^[0-9A-F]{6}$/.test(hex)) return null;
  return applyTint(hex, Number(a.tint) || 0);
}

// The fill colour for each style index (a cell's s="n"), or null for none.
function fillsByStyle(stylesXml, theme) {
  if (!stylesXml) return [];
  const custom = elements(elements(stylesXml, 'indexedColors')[0]?.inner || '', 'rgbColor').map(c => c.attrs.rgb?.slice(-6).toUpperCase());
  const indexed = custom.length ? custom : INDEXED;

  const fills = elements(elements(stylesXml, 'fills')[0]?.inner || '', 'fill').map(f => {
    const pattern = elements(f.inner, 'patternFill')[0];
    if (pattern) {
      const type = pattern.attrs.patternType || 'none';
      if (type === 'none' || type === 'gray125') return null;
      const fg = elements(pattern.inner, 'fgColor')[0]?.attrs;
      const bg = elements(pattern.inner, 'bgColor')[0]?.attrs;
      return colourOf(fg, { theme, indexed }) || colourOf(bg, { theme, indexed });
    }
    // A gradient: its first stop stands for it.
    const stop = elements(f.inner, 'stop')[0];
    return stop ? colourOf(elements(stop.inner, 'color')[0]?.attrs, { theme, indexed }) : null;
  });

  return elements(elements(stylesXml, 'cellXfs')[0]?.inner || '', 'xf')
    .map(xf => fills[Number(xf.attrs.fillId) || 0] ?? null);
}

// ─── Cells ────────────────────────────────────────────────────────────────────

function columnIndex(ref) {
  const letters = String(ref).match(/^[A-Z]+/i)?.[0].toUpperCase() || 'A';
  return [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
}

function columnName(index) {
  let n = index + 1, out = '';
  while (n > 0) { const r = (n - 1) % 26; out = String.fromCharCode(65 + r) + out; n = Math.floor((n - 1) / 26); }
  return out;
}

function readSheet(xml, { strings, fills }) {
  const rows = [];
  for (const row of elements(xml, 'row')) {
    const r = Number(row.attrs.r) - 1;
    const cells = [];
    let next = 0;
    for (const c of elements(row.inner, 'c')) {
      const col = c.attrs.r ? columnIndex(c.attrs.r) : next;
      next = col + 1;
      const raw = elements(c.inner, 'v')[0]?.inner;
      let value = null;
      switch (c.attrs.t) {
        case 's':         value = strings[Number(raw)] ?? ''; break;
        case 'inlineStr': value = textOf(elements(c.inner, 'is')[0]?.inner || ''); break;
        case 'str':
        case 'e':         value = raw !== undefined ? decode(raw) : null; break;
        case 'b':         value = raw === '1'; break;
        default:          value = raw !== undefined && raw !== '' ? Number(raw) : null;
      }
      const colour = fills[Number(c.attrs.s) || 0] ?? null;
      if (value === null && !colour) continue;
      cells[col] = { value, colour: colour ? `#${colour}` : null };
    }
    if (!Number.isNaN(r) && r >= 0) rows[r] = cells;
  }
  return rows;
}

// ─── The workbook ─────────────────────────────────────────────────────────────

async function readWorkbook(buffer) {
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    return { error: 'That is not an Excel workbook (.xlsx). Save it from Excel as "Excel Workbook" and try again.' };
  }
  const total = Object.values(zip.files).reduce((n, f) => n + (f._data?.uncompressedSize || 0), 0);
  if (total > MAX_UNCOMPRESSED) return { error: 'That workbook is too large to read.' };

  const part = async name => (zip.file(name) ? zip.file(name).async('string') : null);
  const workbook = await part('xl/workbook.xml');
  if (!workbook) return { error: 'That is not an Excel workbook (.xlsx). An older .xls file needs saving as .xlsx first.' };

  const rels = Object.fromEntries(elements(await part('xl/_rels/workbook.xml.rels') || '', 'Relationship')
    .map(r => [r.attrs.Id, r.attrs.Target]));
  const date1904 = /date1904="(1|true)"/.test(workbook);

  const strings = elements(await part('xl/sharedStrings.xml') || '', 'si').map(si => textOf(si.inner));
  const theme = themeColours(await part('xl/theme/theme1.xml'));
  const fills = fillsByStyle(await part('xl/styles.xml'), theme);

  const sheets = [];
  for (const s of elements(workbook, 'sheet')) {
    const target = rels[s.attrs.id];
    if (!target) continue;
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    const xml = await part(path);
    if (xml === null) continue;
    sheets.push({ name: s.attrs.name, hidden: s.attrs.state === 'hidden' || s.attrs.state === 'veryHidden', rows: readSheet(xml, { strings, fills }) });
  }
  if (!sheets.length) return { error: 'There are no sheets in that workbook.' };
  return { sheets, date1904 };
}

// An Excel date is a count of days from 1899-12-30 (or 1904-01-01).
function serialToIso(serial, date1904 = false) {
  if (typeof serial !== 'number' || !Number.isFinite(serial) || serial < 1) return null;
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  return new Date(base + Math.floor(serial) * 86400000).toISOString().slice(0, 10);
}

module.exports = { readWorkbook, serialToIso, columnName, columnIndex, applyTint };
