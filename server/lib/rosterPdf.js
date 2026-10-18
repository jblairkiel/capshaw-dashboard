// ─── The month's serving schedule as a PDF ────────────────────────────────────
//
// What "Email everyone (PDF)" attaches and "Download PDF" hands over: one
// month of the Serving Schedule, a table per service, in the portal's own
// colours — the navy banner, the gold rule, the cream rows — and set large, so
// it reads easily on a phone, printed on the fridge, or held at arm's length in
// the foyer.
//
// The page is landscape and laid out as a duty roster: a table for each
// service, the jobs down the left and that service's dates across the top, so
// every Sunday of the month reads side by side and the month fits on a page or
// two. Every job is one line: a name too long for its column is set a little
// smaller, and failing that shortened to an initial (F. Quarrington), so a
// Sunday's fourteen jobs always stack evenly.
//
// Drawn with pdfkit, as the newsletter is (lib/bulletinPdf.js), so it costs the
// runtime image nothing but the dependency it already has. pdfkit draws rather
// than flows, so every table is measured before it is placed, and a table that
// runs over carries its header with it.

const PDFDocument = require('pdfkit');
const blackouts = require('./blackouts');
const { SERVICES } = require('../workflows/scheduling');

// The portal's theme (client/tailwind.config.js → church.*).
const THEME = {
  navy:  '#1a2744',
  gold:  '#c9a84c',
  cream: '#f9f6f0',
  text:  '#374151',
  muted: '#6b7280',
  open:  '#b45309',   // amber, as the page marks a slot still open
  line:  '#e5dccb',
};

const PAGE = { width: 792, height: 612 };          // US Letter, landscape
const M = 36;                                      // margin
const W = PAGE.width - M * 2;
const BOTTOM = PAGE.height - 34;                   // room for the footer, low in the margin
// At most this many dates across: a run of nights longer than that (a gospel
// meeting) continues in a second table. The job column is as wide as the
// longest job needs, within these bounds.
const MAX_DATES = 5;
const JOB_COL = { min: 110, max: 190 };

// Large on purpose: these are read by everybody, at every age. Sized so a
// Sunday morning's full roster, six communion assists and all, sits on the
// first page with every job on one line.
const SIZE = {
  banner:  30,
  month:   24,
  church:  11,
  service: 18,   // each table's title
  date:    12,   // the dates across the top
  job:     12,   // the jobs down the left
  name:    13,   // who is doing each
  minName: 10,   // the smallest a long name is set before it is shortened
  footer:  10,
};

const SERIF_B = 'Times-Bold';
const SANS    = 'Helvetica';
const SANS_B  = 'Helvetica-Bold';
const SANS_I  = 'Helvetica-Oblique';

const CELL = { padX: 7, padY: 5, head: 24, gap: 14, title: 28 };
// Every row is one line, so every row is the same height.
const ROW = Math.ceil(SIZE.name * 1.2) + CELL.padY * 2;

function longDay(iso, fallback) {
  if (!iso) return fallback;
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

// The month's rows as services in the order they happen: by day, then Sunday
// morning before evening before Wednesday, then anything else; the jobs inside
// each in the order the schedule lists them. A job that belongs to the month
// rather than a day (the visual preparation) comes last, under the month.
function occasionsOf(draft) {
  const order = name => {
    const i = SERVICES.findIndex(s => s.toLowerCase() === String(name || '').toLowerCase());
    return i < 0 ? SERVICES.length : i;
  };
  const byKey = new Map();
  (draft?.rows || []).forEach((row, at) => {
    const iso = blackouts.dateOf(draft.month, row.date) || '';
    const key = `${iso || `~${row.date || ''}`}|${row.service || ''}`;
    if (!byKey.has(key)) byKey.set(key, { iso, date: row.date || '', service: row.service || '', rows: [], first: at });
    byKey.get(key).rows.push({ job: row.job || '', name: String(row.name || '').trim() });
  });
  return [...byKey.values()].sort((a, b) =>
    (a.iso ? 0 : 1) - (b.iso ? 0 : 1)
    || a.iso.localeCompare(b.iso)
    || order(a.service) - order(b.service)
    || a.first - b.first);
}

const shortDay = iso => new Date(`${iso}T12:00:00Z`)
  .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

// The month as tables: one per service, in the order services come (Sunday
// Worship, Sunday Evening, Wednesday, then anything else), each with its dates
// across and its jobs down. A job a service needs twice (two Communion
// Assists) is two rows. A job that belongs to the month rather than a day is a
// last, two-column table of its own.
function tablesOf(draft) {
  const occasions = occasionsOf(draft);
  const tables = [];
  const byService = new Map();
  for (const o of occasions) {
    if (!o.iso) continue;
    if (!byService.has(o.service)) {
      const table = { service: o.service, dates: [], cells: new Map(), rows: [] };
      byService.set(o.service, table);
      tables.push(table);
    }
    const table = byService.get(o.service);
    table.dates.push({ iso: o.iso, label: shortDay(o.iso) });
    const seen = new Map();
    for (const r of o.rows) {
      const n = (seen.get(r.job) || 0) + 1;
      seen.set(r.job, n);
      const key = `${r.job}#${n}`;
      if (!table.rows.some(row => row.key === key)) table.rows.push({ key, job: r.job });
      table.cells.set(`${key}|${o.iso}`, r.name);
    }
  }
  // Services in their usual order, whichever happens first in the month.
  const order = name => {
    const i = SERVICES.findIndex(sv => sv.toLowerCase() === String(name || '').toLowerCase());
    return i < 0 ? SERVICES.length : i;
  };
  tables.sort((a, b) => order(a.service) - order(b.service));
  // A long run of dates is split, so no column gets too narrow to read.
  const split = [];
  for (const t of tables) {
    for (let i = 0; i < t.dates.length; i += MAX_DATES) {
      split.push({ ...t, dates: t.dates.slice(i, i + MAX_DATES), continued: i > 0 });
    }
  }
  const monthly = occasions.filter(o => !o.iso).flatMap(o => o.rows);
  if (monthly.length) split.push({ service: 'For the month', monthly });
  return split;
}

// "Fennimore Quarrington" → "F. Quarrington".
function initialed(name) {
  const words = name.split(/\s+/);
  return words.length > 1 ? `${words[0][0]}. ${words.slice(1).join(' ')}` : name;
}

// The text and size that put `text` on one line `width` wide: full size if it
// fits, a touch smaller if that does, then (for a name) the initialed form
// before anything gets really small, and as a last resort cut short with an
// ellipsis. Names stay close to one size, so no one's looks like an afterthought.
const NUDGE = 1.5;

function fitLine(doc, text, width, { font, size, min = SIZE.minName, initial = false }) {
  doc.font(font);
  const tries = initial
    ? [[text, size - NUDGE], [initialed(text), min], [text, min]]
    : [[text, min]];
  for (const [form, floor] of tries) {
    for (let s = size; s >= floor; s -= 0.5) {
      if (doc.fontSize(s).widthOfString(form) <= width) return { text: form, size: s };
    }
  }
  let cut = initial ? initialed(text) : text;
  doc.fontSize(min);
  while (cut.length > 1 && doc.widthOfString(`${cut}…`) > width) cut = cut.slice(0, -1);
  return { text: `${cut.trimEnd()}…`, size: min };
}

// The job column wide enough for the month's longest job, and the height of a
// table whose rows are all one line.
function jobColumn(doc, tables) {
  doc.font(SANS).fontSize(SIZE.job);
  const jobs = tables.flatMap(t => (t.monthly || t.rows).map(r => r.job));
  const widest = Math.max(0, ...jobs.map(j => doc.widthOfString(j)));
  return Math.min(JOB_COL.max, Math.max(JOB_COL.min, Math.ceil(widest) + CELL.padX * 2 + 4));
}

function measureTable(doc, table, jobCol = JOB_COL.min) {
  const count = (table.monthly || table.rows).length;
  const colW = table.monthly ? W - jobCol : (W - jobCol) / table.dates.length;
  const rows = Array(count).fill(ROW);
  return { colW, jobCol, rows, height: CELL.title + (table.monthly ? 0 : CELL.head) + count * ROW };
}

function drawBanner(doc, month) {
  doc.rect(0, 0, PAGE.width, 80).fill(THEME.navy);
  doc.rect(0, 80, PAGE.width, 4).fill(THEME.gold);
  doc.fillColor(THEME.gold).font(SANS_B).fontSize(SIZE.church)
    .text('CAPSHAW CHURCH OF CHRIST', M, 16, { width: W, characterSpacing: 1.5 });
  doc.fillColor('#ffffff').font(SERIF_B).fontSize(SIZE.banner)
    .text('Worship Schedule', M, 33, { width: W, lineBreak: false });
  doc.fillColor(THEME.gold).font(SERIF_B).fontSize(SIZE.month)
    .text(month, M, 37, { width: W, align: 'right', lineBreak: false });
  return 100;
}

// Later pages carry a slimmer band, so a loose page still says what it is.
const RUNNING_HEAD = 62;

function drawRunningHead(doc, month) {
  doc.rect(0, 0, PAGE.width, 44).fill(THEME.navy);
  doc.rect(0, 44, PAGE.width, 3).fill(THEME.gold);
  doc.fillColor('#ffffff').font(SERIF_B).fontSize(16)
    .text(`Worship Schedule · ${month}`, M, 15, { width: W });
  return RUNNING_HEAD;
}

function drawTitle(doc, table, y) {
  const title = `${table.service}${table.continued ? ' (continued)' : ''}`;
  doc.fillColor(THEME.navy).font(SERIF_B).fontSize(SIZE.service).text(title, M, y, { width: W, lineBreak: false });
  doc.rect(M, y + 24, 46, 3).fill(THEME.gold);
  return y + CELL.title;
}

// The navy row of dates across the top of a table.
function drawHeader(doc, table, y, colW, jobCol) {
  doc.rect(M, y, W, CELL.head).fill(THEME.navy);
  table.dates.forEach((d, i) => {
    doc.fillColor('#ffffff').font(SANS_B).fontSize(SIZE.date)
      .text(d.label, M + jobCol + i * colW + CELL.padX, y + (CELL.head - SIZE.date) / 2 + 1, { width: colW - CELL.padX * 2, lineBreak: false });
  });
  return y + CELL.head;
}

// One line of text, centred in its row whatever size it ended up. fitLine has
// already made it fit; given a width, pdfkit would still wrap at a space.
function drawLine(doc, fit, font, color, x, y) {
  doc.fillColor(color).font(font).fontSize(fit.size)
    .text(fit.text, x, y + (ROW - fit.size) / 2 + 1, { lineBreak: false });
}

function drawCell(doc, name, x, y, w) {
  const width = w - CELL.padX * 2;
  if (name) drawLine(doc, fitLine(doc, name, width, { font: SANS_B, size: SIZE.name, initial: true }), SANS_B, THEME.navy, x + CELL.padX, y);
  else drawLine(doc, fitLine(doc, 'Needs someone', width, { font: SANS_I, size: SIZE.name - 1 }), SANS_I, THEME.open, x + CELL.padX, y);
}

// Draws one table from `y`, moving to a new page between rows if it has to.
// Returns where it ended.
function drawTable(doc, table, y, month, { pageHasContent = true, jobCol = JOB_COL.min } = {}) {
  const m = measureTable(doc, table, jobCol);
  const firstRow = table.monthly ? 0 : CELL.head;
  // A table that would fit whole on a page of its own is not split: it goes
  // over to the next page instead. Only one too long for any page is split, and
  // then the title, header and first row always start together.
  const freshPage = BOTTOM - RUNNING_HEAD;
  const splitAnyway = m.height > freshPage || !pageHasContent;
  if ((!splitAnyway && y + m.height > BOTTOM) || y + CELL.title + firstRow + (m.rows[0] || 0) > BOTTOM) {
    doc.addPage();
    y = drawRunningHead(doc, month);
  }
  y = drawTitle(doc, table, y);
  if (!table.monthly) y = drawHeader(doc, table, y, m.colW, jobCol);

  const rows = table.monthly || table.rows;
  rows.forEach((row, i) => {
    const h = m.rows[i];
    if (y + h > BOTTOM) {
      doc.addPage();
      y = drawRunningHead(doc, month);
      // The rest of the table says whose it is, and carries its dates.
      y = drawTitle(doc, { ...table, continued: true }, y);
      if (!table.monthly) y = drawHeader(doc, table, y, m.colW, jobCol);
    }
    doc.rect(M, y, W, h).fill(i % 2 ? '#ffffff' : THEME.cream);
    doc.rect(M, y, 4, h).fill(THEME.gold);
    const jobWidth = jobCol - CELL.padX * 2 - 4;
    drawLine(doc, fitLine(doc, row.job, jobWidth, { font: SANS, size: SIZE.job, min: 9 }), SANS, THEME.text, M + CELL.padX + 4, y);
    if (table.monthly) {
      drawCell(doc, row.name, M + jobCol, y, m.colW);
    } else {
      table.dates.forEach((d, c) => {
        const x = M + jobCol + c * m.colW;
        doc.moveTo(x, y).lineTo(x, y + h).lineWidth(0.5).strokeColor(THEME.line).stroke();
        const key = `${row.key}|${d.iso}`;
        // A date that does not have this job at all (a special night that
        // needs fewer) is left blank, not marked as needing someone.
        if (table.cells.has(key)) drawCell(doc, table.cells.get(key), x, y, m.colW);
      });
    }
    y += h;
  });
  return y + CELL.gap;
}

function drawFooters(doc, month) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    // Below the bottom margin pdfkit would start a new page for the text, so
    // the margin is lifted while the footer is written.
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.fillColor(THEME.muted).font(SANS).fontSize(SIZE.footer)
      .text(`Capshaw Church of Christ · Worship schedule for ${month} · Page ${i + 1} of ${range.count}`,
        M, PAGE.height - 24, { width: W, align: 'center', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
}

// The PDF as a Buffer, made synchronously: nothing is listening for pdfkit's
// stream, so once the document ends every byte is already in its buffer and
// can be read straight out. That lets the Monthly Worship Schedule workflow,
// whose publish step runs inside one transaction, attach it to the emails it
// sends there and then.
function rosterPdf(draft) {
  const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margin: M, bufferPages: true, info: {
    Title: `Worship Schedule: ${draft.month}`, Author: 'Capshaw Church of Christ',
  } });

  let y = drawBanner(doc, draft.month);
  const tables = tablesOf(draft);
  if (!tables.length) {
    doc.fillColor(THEME.muted).font(SANS).fontSize(SIZE.name).text('Nothing is on the schedule for this month yet.', M, y + 10, { width: W });
  }
  const jobCol = jobColumn(doc, tables);
  tables.forEach((table, i) => { y = drawTable(doc, table, y, draft.month, { pageHasContent: i > 0, jobCol }); });
  drawFooters(doc, draft.month);
  doc.end();

  const chunks = [];
  let chunk;
  while ((chunk = doc.read()) !== null) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const pdfFilename = month => `Worship Schedule - ${String(month).replace(/[^\w ,.-]/g, '').trim() || 'month'}.pdf`;

module.exports = { THEME, SIZE, PAGE, MAX_DATES, occasionsOf, tablesOf, measureTable, fitLine, initialed, rosterPdf, pdfFilename };
