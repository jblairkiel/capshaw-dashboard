// ─── The month's serving schedule as a PDF ────────────────────────────────────
//
// What "Email everyone (PDF)" attaches and "Download PDF" hands over: one
// month of the Serving Schedule, a card per service, in the portal's own
// colours — the navy banner, the gold rule, the cream cards — and set large, so
// it reads easily on a phone, printed on the fridge, or held at arm's length in
// the foyer.
//
// The page is landscape and laid out as a duty roster: a table for each
// service, the jobs down the left and that service's dates across the top, so
// every Sunday of the month reads side by side and the month fits on a page or
// two. A name too long for its column wraps onto a second line rather than
// shrinking.
//
// Drawn with pdfkit, as the newsletter is (lib/bulletinPdf.js), so it costs the
// runtime image nothing but the dependency it already has. pdfkit draws rather
// than flows, so every row is measured before it is placed: a row never splits
// across pages, and a table that runs over carries its header with it.

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
// The job names down the left, and at most this many dates across: a run of
// nights longer than that (a gospel meeting) continues in a second table.
const JOB_COL = 150;
const MAX_DATES = 5;

// Large on purpose: these are read by everybody, at every age.
const SIZE = {
  banner:  30,
  month:   24,
  church:  11,
  service: 20,   // each table's title
  date:    14,   // the dates across the top
  job:     14,   // the jobs down the left
  name:    15,   // who is doing each
  footer:  10,
};

const SERIF_B = 'Times-Bold';
const SANS    = 'Helvetica';
const SANS_B  = 'Helvetica-Bold';
const SANS_I  = 'Helvetica-Oblique';

const CELL = { padX: 8, padY: 5, head: 28, gap: 16, title: 30 };

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

// How wide each date column is, and how tall each job's row has to be for its
// longest name.
function measureTable(doc, table) {
  if (table.monthly) {
    const colW = W - JOB_COL;
    doc.font(SANS_B).fontSize(SIZE.name);
    const rows = table.monthly.map(r => Math.max(
      doc.heightOfString(r.name || 'Needs someone', { width: colW - CELL.padX * 2 }),
      doc.font(SANS).fontSize(SIZE.job).heightOfString(r.job, { width: JOB_COL - CELL.padX * 2 }),
    ) + CELL.padY * 2);
    return { colW, rows, height: CELL.title + rows.reduce((a, b) => a + b, 0) };
  }
  const colW = (W - JOB_COL) / table.dates.length;
  const rows = table.rows.map(row => {
    doc.font(SANS).fontSize(SIZE.job);
    let h = doc.heightOfString(row.job, { width: JOB_COL - CELL.padX * 2 });
    doc.font(SANS_B).fontSize(SIZE.name);
    for (const d of table.dates) {
      const name = table.cells.get(`${row.key}|${d.iso}`);
      h = Math.max(h, doc.heightOfString(name || 'Needs someone', { width: colW - CELL.padX * 2 }));
    }
    return h + CELL.padY * 2;
  });
  return { colW, rows, height: CELL.title + CELL.head + rows.reduce((a, b) => a + b, 0) };
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
function drawHeader(doc, table, y, colW) {
  doc.rect(M, y, W, CELL.head).fill(THEME.navy);
  table.dates.forEach((d, i) => {
    doc.fillColor('#ffffff').font(SANS_B).fontSize(SIZE.date)
      .text(d.label, M + JOB_COL + i * colW + CELL.padX, y + 8, { width: colW - CELL.padX * 2, lineBreak: false });
  });
  return y + CELL.head;
}

function drawCell(doc, name, x, y, w) {
  if (name) doc.fillColor(THEME.navy).font(SANS_B).fontSize(SIZE.name).text(name, x + CELL.padX, y + CELL.padY, { width: w - CELL.padX * 2 });
  else doc.fillColor(THEME.open).font(SANS_I).fontSize(SIZE.name - 1).text('Needs someone', x + CELL.padX, y + CELL.padY + 1, { width: w - CELL.padX * 2 });
}

// Draws one table from `y`, moving to a new page between rows if it has to.
// Returns where it ended.
function drawTable(doc, table, y, month, { pageHasContent = true } = {}) {
  const m = measureTable(doc, table);
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
  if (!table.monthly) y = drawHeader(doc, table, y, m.colW);

  const rows = table.monthly || table.rows;
  rows.forEach((row, i) => {
    const h = m.rows[i];
    if (y + h > BOTTOM) {
      doc.addPage();
      y = drawRunningHead(doc, month);
      // The rest of the table says whose it is, and carries its dates.
      y = drawTitle(doc, { ...table, continued: true }, y);
      if (!table.monthly) y = drawHeader(doc, table, y, m.colW);
    }
    doc.rect(M, y, W, h).fill(i % 2 ? '#ffffff' : THEME.cream);
    doc.rect(M, y, 4, h).fill(THEME.gold);
    doc.fillColor(THEME.text).font(SANS).fontSize(SIZE.job).text(row.job, M + CELL.padX + 4, y + CELL.padY + 1, { width: JOB_COL - CELL.padX * 2 - 4 });
    if (table.monthly) {
      drawCell(doc, row.name, M + JOB_COL, y, m.colW);
    } else {
      table.dates.forEach((d, c) => {
        const x = M + JOB_COL + c * m.colW;
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
  tables.forEach((table, i) => { y = drawTable(doc, table, y, draft.month, { pageHasContent: i > 0 }); });
  drawFooters(doc, draft.month);
  doc.end();

  const chunks = [];
  let chunk;
  while ((chunk = doc.read()) !== null) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const pdfFilename = month => `Worship Schedule - ${String(month).replace(/[^\w ,.-]/g, '').trim() || 'month'}.pdf`;

module.exports = { THEME, SIZE, PAGE, MAX_DATES, occasionsOf, tablesOf, measureTable, rosterPdf, pdfFilename };
