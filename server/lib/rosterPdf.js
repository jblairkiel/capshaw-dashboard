// ─── The month's serving schedule as a PDF ────────────────────────────────────
//
// What "Email everyone (PDF)" attaches and "Download PDF" hands over: one
// month of the Serving Schedule, a card per service, in the portal's own
// colours — the navy banner, the gold rule, the cream cards — and set large, so
// it reads easily on a phone, printed on the fridge, or held at arm's length in
// the foyer.
//
// Drawn with pdfkit, as the newsletter is (lib/bulletinPdf.js), so it costs the
// runtime image nothing but the dependency it already has. pdfkit draws rather
// than flows, so every card is measured before it is placed: a card never
// splits across a page, and a page break happens between services.

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

const PAGE = { width: 612, height: 792 };          // US Letter, portrait
const M = 40;                                      // margin
const W = PAGE.width - M * 2;

// Large on purpose: these are read by everybody, at every age.
const SIZE = {
  banner:  30,
  month:   20,
  church:  11,
  day:     19,
  service: 14,
  job:     14,
  name:    17,
  footer:  10,
};

const SERIF_B = 'Times-Bold';
const SANS    = 'Helvetica';
const SANS_B  = 'Helvetica-Bold';
const SANS_I  = 'Helvetica-Oblique';

const CARD = { pad: 14, bar: 6, head: 30, row: 27, gap: 14, jobW: 0.42 };

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

// How tall a card is, from how many lines each row wraps to.
function measureCard(doc, occasion) {
  const nameW = W - CARD.bar - CARD.pad * 2 - Math.round((W - CARD.bar - CARD.pad * 2) * CARD.jobW);
  doc.font(SANS_B).fontSize(SIZE.name);
  const rows = occasion.rows.map(r => Math.max(CARD.row, doc.heightOfString(r.name || 'Needs someone', { width: nameW }) + 8));
  return { rows, height: CARD.pad + CARD.head + rows.reduce((s, h) => s + h, 0) + CARD.pad - 6 };
}

function drawBanner(doc, month) {
  doc.rect(0, 0, PAGE.width, 112).fill(THEME.navy);
  doc.rect(0, 112, PAGE.width, 4).fill(THEME.gold);
  doc.fillColor(THEME.gold).font(SANS_B).fontSize(SIZE.church)
    .text('CAPSHAW CHURCH OF CHRIST', M, 26, { width: W, characterSpacing: 1.5 });
  doc.fillColor('#ffffff').font(SERIF_B).fontSize(SIZE.banner)
    .text('Worship Schedule', M, 44, { width: W });
  doc.fillColor(THEME.gold).font(SERIF_B).fontSize(SIZE.month)
    .text(month, M, 80, { width: W });
  return 136;
}

// Later pages carry a slimmer band, so a loose page still says what it is.
function drawRunningHead(doc, month) {
  doc.rect(0, 0, PAGE.width, 46).fill(THEME.navy);
  doc.rect(0, 46, PAGE.width, 3).fill(THEME.gold);
  doc.fillColor('#ffffff').font(SERIF_B).fontSize(16)
    .text(`Worship Schedule · ${month}`, M, 16, { width: W });
  return 66;
}

function drawCard(doc, occasion, y, measured) {
  const x = M;
  doc.roundedRect(x, y, W, measured.height, 8).fill(THEME.cream);
  doc.roundedRect(x, y, CARD.bar + 8, measured.height, 8).fill(THEME.gold);
  doc.rect(x + CARD.bar, y, 8, measured.height).fill(THEME.cream);

  const inner = x + CARD.bar + CARD.pad;
  const innerW = W - CARD.bar - CARD.pad * 2;
  const jobW = Math.round(innerW * CARD.jobW);

  const day = occasion.iso ? longDay(occasion.iso) : (occasion.date || 'For the month');
  doc.fillColor(THEME.navy).font(SERIF_B).fontSize(SIZE.day).text(day, inner, y + CARD.pad, { width: innerW, lineBreak: false });
  if (occasion.service) {
    doc.fillColor(THEME.muted).font(SANS).fontSize(SIZE.service)
      .text(occasion.service, inner, y + CARD.pad + 4, { width: innerW, align: 'right', lineBreak: false });
  }

  let ry = y + CARD.pad + CARD.head;
  occasion.rows.forEach((row, i) => {
    if (i > 0) doc.moveTo(inner, ry - 4).lineTo(inner + innerW, ry - 4).lineWidth(0.5).strokeColor(THEME.line).stroke();
    doc.fillColor(THEME.text).font(SANS).fontSize(SIZE.job).text(row.job, inner, ry + 2, { width: jobW - 8 });
    if (row.name) doc.fillColor(THEME.navy).font(SANS_B).fontSize(SIZE.name).text(row.name, inner + jobW, ry, { width: innerW - jobW });
    else doc.fillColor(THEME.open).font(SANS_I).fontSize(SIZE.name - 1).text('Needs someone', inner + jobW, ry + 1, { width: innerW - jobW });
    ry += measured.rows[i];
  });
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
        M, PAGE.height - M + 12, { width: W, align: 'center', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
}

// The PDF as a Buffer, made synchronously: nothing is listening for pdfkit's
// stream, so once the document ends every byte is already in its buffer and
// can be read straight out. That lets the Monthly Worship Schedule workflow,
// whose publish step runs inside one transaction, attach it to the emails it
// sends there and then.
function rosterPdf(draft) {
  const doc = new PDFDocument({ size: 'LETTER', margin: M, bufferPages: true, info: {
    Title: `Worship Schedule: ${draft.month}`, Author: 'Capshaw Church of Christ',
  } });

  let y = drawBanner(doc, draft.month);
  const occasions = occasionsOf(draft);
  if (!occasions.length) {
    doc.fillColor(THEME.muted).font(SANS).fontSize(SIZE.name).text('Nothing is on the schedule for this month yet.', M, y + 10, { width: W });
  }
  for (const occasion of occasions) {
    const measured = measureCard(doc, occasion);
    if (y + measured.height > PAGE.height - M - 10) {
      doc.addPage();
      y = drawRunningHead(doc, draft.month);
    }
    drawCard(doc, occasion, y, measured);
    y += measured.height + CARD.gap;
  }
  drawFooters(doc, draft.month);
  doc.end();

  const chunks = [];
  let chunk;
  while ((chunk = doc.read()) !== null) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const pdfFilename = month => `Worship Schedule - ${String(month).replace(/[^\w ,.-]/g, '').trim() || 'month'}.pdf`;

module.exports = { THEME, SIZE, occasionsOf, rosterPdf, pdfFilename };
