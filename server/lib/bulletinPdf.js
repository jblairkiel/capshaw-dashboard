// ─── The newsletter as a PDF ──────────────────────────────────────────────────
//
// Drawn with pdfkit, which is pure JavaScript and so costs the slim runtime
// image nothing but a dependency — the alternative, rendering HTML in a
// headless browser, would have put Chromium in a container that is otherwise
// node and a SQLite addon.
//
// This walks the same composed object as server/lib/bulletinDocx.js and lays
// the same sections out in the same order. The two renderers are deliberately
// parallel: a section added to one belongs in the other, and the export tests
// assert that both carry the same content.
//
// The layout is the printed newsletter's: a banner, a quote, a narrow column of
// grey cards beside a wide prayer panel, a duty roster over two weeks, and the
// leadership and contacts below it. pdfkit draws rather than flows, so a card
// has to know its height before it can be filled — hence measure() below, which
// runs the very same block list through a throwaway document and reports where
// it ended. Measuring and drawing from one list is what stops a card being
// sized for content it does not end up holding.
const PDFDocument = require('pdfkit');
const fs          = require('fs');
const config      = require('./bulletinConfig');

const PAGE = { width: 612, height: 792 };
const M    = 9;                            // the printed newsletter's own margin
const W    = PAGE.width - M * 2;           // 594pt of content

// Page one's two columns, and the navy spine down the left edge.
const SPINE_W = 16;
const LEFT_X  = 28,  LEFT_W  = 204;
const RIGHT_X = 243, RIGHT_W = PAGE.width - M - RIGHT_X;

const C = config.colors;
const navy  = `#${C.navy}`;
const card  = `#${C.card}`;
const rule  = `#${C.rule}`;
const peach = `#${C.peach}`;
const link  = `#${C.link}`;

const FONT    = 'Helvetica';
const FONT_B  = 'Helvetica-Bold';
const FONT_I  = 'Helvetica-Oblique';
const FONT_BI = 'Helvetica-BoldOblique';

// ─── Blocks ───────────────────────────────────────────────────────────────────
//
// A card's contents as data, so the same list can be measured and then drawn.
// Every block reports where it left the cursor.

const B = {
  heading: (text, opts = {})   => ({ type: 'heading', text, ...opts }),
  bullets: (items, opts = {})  => ({ type: 'bullets', items, ...opts }),
  lines:   (items, opts = {})  => ({ type: 'lines',   items, ...opts }),
  para:    (segments, opts = {}) => ({ type: 'para',  segments, ...opts }),
  gap:     h                   => ({ type: 'gap', h }),
};

// A paragraph whose words change weight partway through — a bold name followed
// by a plain telephone number, repeated.
//
// pdfkit can do this with `continued: true`, but after a continued run doc.y
// does not reliably land below the last line, which put one heading on top of
// the paragraph before it. Laying the words out by hand is a dozen lines and
// gives an exact end position, which the enclosing card needs in order to size
// itself.
function drawPara(doc, block, x, y, width) {
  const size    = block.size ?? 9;
  const segments = block.segments || [];
  if (!segments.length) return y;

  doc.font(FONT).fontSize(size);
  const lineHeight = doc.currentLineHeight(true);

  // Words, each remembering the weight it was written in. The split keeps the
  // whitespace so that a space between two segments is not lost.
  const words = [];
  for (const seg of segments) {
    for (const part of String(seg.text).split(/(\s+)/)) {
      if (part !== '') words.push({ text: part, bold: !!seg.bold, space: /^\s+$/.test(part) });
    }
  }

  const right = x + width;
  let cx = x, cy = y;

  for (const word of words) {
    doc.font(word.bold ? FONT_B : FONT).fontSize(size);
    const w = doc.widthOfString(word.text);

    if (word.space) {
      // A space that would run off the end is where the line ends; a space at
      // the start of a line is dropped rather than indenting it.
      if (cx + w > right) { cy += lineHeight; cx = x; }
      else if (cx > x) { cx += w; }
      continue;
    }

    if (cx > x && cx + w > right) { cy += lineHeight; cx = x; }

    doc.fillColor(block.color || '#000000');
    doc.text(word.text, cx, cy, { lineBreak: false });
    cx += w;
  }

  return cy + lineHeight + (block.after ?? 2);
}

function drawBlock(doc, block, x, y, width) {
  switch (block.type) {
    case 'gap':
      return y + block.h;

    case 'heading': {
      const size = block.size ?? 12;
      let top = y;
      if (block.rule) {
        // Divides one section from the next now that the left column is a
        // single card rather than three.
        top += 5;
        doc.moveTo(x, top).lineTo(x + width, top).lineWidth(0.5).stroke(rule);
        top += 4;
      }
      doc.font(block.plain ? FONT_B : FONT_BI).fontSize(size).fillColor(navy);
      doc.text(block.text, x, top, { width });
      return doc.y + (block.after ?? 3);
    }

    case 'lines': {
      const size = block.size ?? 9;
      let cursor = y;
      for (const item of block.items) {
        doc.font(block.bold ? FONT_B : FONT).fontSize(size).fillColor(block.color || '#000000');
        doc.text(item, x, cursor, { width });
        cursor = doc.y + (block.spacing ?? 1);
      }
      return cursor;
    }

    case 'bullets': {
      const size   = block.size ?? 9;
      const indent = block.indent ?? 12;
      let cursor = y;
      for (const item of block.items) {
        const sub  = typeof item === 'object' && item.level;
        const text = typeof item === 'object' ? item.text : item;
        const off  = sub ? indent : 0;
        // Both markers must exist in WinAnsi, which is what pdfkit encodes the
        // built-in Helvetica with: ◦ (U+25E6) is not in it and comes out as a
        // stray glyph on top of the text.
        doc.font(FONT).fontSize(size).fillColor('#000000');
        doc.text(sub ? '·' : '•', x + off, cursor, { width: 8 });
        doc.font(sub ? FONT_I : FONT).fontSize(size).fillColor('#000000');
        doc.text(text, x + off + indent, cursor, { width: width - off - indent });
        cursor = doc.y + (block.spacing ?? 2);
      }
      return cursor;
    }

    case 'para':
      return drawPara(doc, block, x, y, width);

    default:
      return y;
  }
}

function drawBlocks(doc, blocks, x, y, width) {
  let cursor = y;
  for (const block of blocks) cursor = drawBlock(doc, block, x, cursor, width);
  return cursor;
}

// How tall a block list will be. The same list is run through a scratch
// document tall enough that nothing paginates, so the answer is exact rather
// than an estimate that a bold run could overflow.
function measure(blocks, width) {
  const scratch = new PDFDocument({ size: [PAGE.width, 20000], margin: 0, autoFirstPage: true });
  const end = drawBlocks(scratch, blocks, 0, 0, width);
  scratch.end();
  return end;
}

// ─── Cards ────────────────────────────────────────────────────────────────────

// One panel: a filled, bordered box sized to the blocks it holds. The printed
// newsletter gives these a soft shadow, which is a second rectangle behind.
function panel(doc, { x, y, width, blocks, fill = '#FFFFFF', border = navy, padding = 8, shadow = true }) {
  const inner  = width - padding * 2;
  const height = measure(blocks, inner) + padding * 2;

  if (shadow) doc.rect(x + 2, y + 2, width, height).fill('#C9C9C9');
  doc.rect(x, y, width, height).fill(fill);
  doc.rect(x, y, width, height).lineWidth(0.8).stroke(border);

  drawBlocks(doc, blocks, x + padding, y + padding, inner);
  return y + height;
}

// A panel that may not fit on one page.
//
// The large-print edition sets the body at 16pt, so a prayer list runs past the
// foot of the page and the box holding it has to continue on the next. pdfkit
// draws rather than flows, and a box's fill has to go down before the text on
// top of it, so the blocks are measured first and dealt onto pages; only then
// is each page's box drawn and filled.
function flowPanel(doc, { x, y, width, blocks, fill = '#FFFFFF', border = navy, padding = 8 }) {
  const inner  = width - padding * 2;
  const bottom = PAGE.height - M;

  // Deal the blocks onto pages, keeping each block whole.
  const pages = [];
  let current = { blocks: [], height: 0 };
  let room    = bottom - y - padding * 2;

  // A panel with no room left for even its first block belongs at the top of
  // the next page, not hanging off the bottom of this one.
  let fresh = blocks.length > 0 && measure([blocks[0]], inner) > room;
  if (fresh) room = bottom - M - padding * 2;

  for (const block of blocks) {
    const h = measure([block], inner);
    if (current.blocks.length && current.height + h > room) {
      pages.push(current);
      current = { blocks: [], height: 0 };
      // Every page after the first starts at the top margin.
      room = bottom - M - padding * 2;
    }
    current.blocks.push(block);
    current.height += h;
  }
  pages.push(current);

  let top = y;
  pages.forEach((page, i) => {
    if (i || fresh) { doc.addPage(); top = M; }
    const height = page.height + padding * 2;
    doc.rect(x, top, width, height).fill(fill);
    doc.rect(x, top, width, height).lineWidth(0.8).stroke(border);
    drawBlocks(doc, page.blocks, x + padding, top + padding, inner);
    top += height;
  });

  return top;
}

// A full-width band of colour with one centred line on it.
// Where something of a known height can start without running off the page.
// Only the large-print editions run long enough to need it: at 16pt a heading
// can land in the last few points of a page, and pdfkit would print it there
// rather than move it.
function roomFor(doc, y, height) {
  if (y + height <= PAGE.height - M) return y;
  doc.addPage();
  return M;
}

function band(doc, { x, y, width, text, fill, color, size, italic = true, border = null, padding = 6, align = 'center', flow = false }) {
  doc.font(italic ? FONT_BI : FONT_B).fontSize(size);
  const height = doc.heightOfString(text, { width: width - padding * 2, align }) + padding * 2;
  if (flow) y = roomFor(doc, y, height);

  doc.rect(x, y, width, height).fill(fill);
  if (border) doc.rect(x, y, width, height).lineWidth(0.8).stroke(border);

  doc.font(italic ? FONT_BI : FONT_B).fontSize(size).fillColor(color);
  doc.text(text, x + padding, y + padding, { width: width - padding * 2, align });
  return y + height;
}

// ─── Page one ─────────────────────────────────────────────────────────────────

function masthead(doc, b, t) {
  const y = 6, height = 101;

  // The banner artwork, cropped to the box by a clipped draw so an image of a
  // different aspect never distorts the title behind it.
  try {
    if (fs.existsSync(config.mastheadImage)) {
      doc.save();
      doc.rect(M, y, W, height).clip();
      doc.image(config.mastheadImage, M, y, { width: W, height });
      doc.restore();
    } else {
      doc.rect(M, y, W, height).fill(card);
    }
  } catch {
    // A missing or unreadable banner is a plainer newsletter, not a failed one.
    doc.rect(M, y, W, height).fill(card);
  }

  doc.rect(M, y, W, height).lineWidth(0.8).stroke(navy);

  doc.font(FONT_B).fontSize(t.banner * 1.16).fillColor(navy);
  doc.text(b.masthead, M + 10, y + 16, { width: W - 20, align: 'center' });

  doc.font(FONT_B).fontSize(t.date).fillColor(navy);
  doc.text(b.sundayLabel, M + 10, y + 70, { width: W - 20, align: 'center' });

  return y + height;
}

function pageOne(doc, b, t, large) {
  let y = masthead(doc, b, t) + 3;

  // ── The verse, across the full width ──
  if (b.quote) {
    const text = b.quoteRef ? `“${b.quote}” – ${b.quoteRef}` : `“${b.quote}”`;
    doc.font(FONT_BI).fontSize(t.quote).fillColor(navy);
    doc.text(text, M, y, { width: W, align: 'center' });
    y = doc.y + 6;
  }

  const bodyTop = y;

  // ── Left column ──
  //
  // One grey card holding all three sections. The .docx cannot put three
  // separate boxes beside one tall panel without a nested table or a vertical
  // merge, and both misrender in Word; the two files have to agree, so the
  // sections are divided by their headings here as well.
  const groupItems = [];
  for (const g of b.groups) {
    groupItems.push(g.leader ? `${g.name} \u2013 Leader: ${g.leader}` : g.name);
    if (g.note) groupItems.push({ text: g.note, level: 1 });
  }

  const leftBlocks = [
      B.heading('Reminders:', { size: t.cardHead, plain: true }),
      B.bullets(b.reminders.length ? b.reminders : ['—'], { size: t.small }),
      B.heading('Last Week\u2019s Data:', { size: t.cardHead, plain: true, rule: true }),
      B.bullets(lastWeekLines(b), { size: t.small }),
      B.heading('Anniversaries:', { size: t.cardHead, plain: true, rule: true }),
      B.bullets(b.anniversaries.length ? b.anniversaries : ['—'], { size: t.small }),
      B.heading('Birthdays:', { size: t.cardHead, plain: true, rule: true }),
      B.bullets(b.birthdays.length ? b.birthdays : ['—'], { size: t.small }),
      B.heading('Groups:', { size: t.cardHead, plain: true, rule: true }),
      B.bullets(groupItems.length ? groupItems : ['—'], { size: t.small }),
  ];

  // ── The prayer panel ──
  const prayerBlocks = [];
  const add = (title, items) => {
    // An empty heading in a printed newsletter reads as a mistake rather than
    // as good news, so a block with nothing in it is left out entirely.
    if (!items.length) return;
    prayerBlocks.push(B.heading(title, { size: t.section }), B.bullets(items, { size: t.body, spacing: 3 }), B.gap(3));
  };
  add('Updates',     b.prayer.updates);
  add('Ongoing',     b.prayer.ongoing);
  add('Shut-Ins',    b.prayer.shutIns);
  add('Pregnancies', b.prayer.pregnancies);
  if (b.prayer.evangelists.length) {
    prayerBlocks.push(
      B.heading('Evangelists We Support', { size: t.section }),
      B.para(b.prayer.evangelists, { size: t.body }),
    );
  }
  if (!prayerBlocks.length) prayerBlocks.push(B.lines(['\u2014'], { color: '#888888' }));

  if (large) {
    // One column down the page. At 16pt the narrow column would hold about a
    // dozen characters a line, so the two are stacked and the panels flow onto
    // as many pages as they need.
    let ly = flowPanel(doc, { x: M, y: bodyTop, width: W, blocks: leftBlocks, fill: card });

    ly = band(doc, {
      x: M, y: ly + 10, width: W, flow: true,
      text: 'Prayer Requests', fill: navy, color: '#FFFFFF',
      size: t.panelTitle, italic: false, align: 'left', padding: 9, border: navy,
    }) + 5;

    ly = flowPanel(doc, { x: M, y: ly, width: W, blocks: prayerBlocks });

    // Service times follow the prayer list rather than sitting at the foot of
    // the page: there is no single foot to pin them to once page one runs on.
    band(doc, {
      x: M, y: ly + 10, width: W, flow: true,
      text: b.serviceTimes, fill: peach, color: navy, size: t.times, border: navy,
    });
    return;
  }

  const ly = panel(doc, { x: LEFT_X, y: bodyTop, width: LEFT_W, blocks: leftBlocks, fill: card });

  let ry = band(doc, {
    x: RIGHT_X, y: bodyTop, width: RIGHT_W,
    text: 'Prayer Requests', fill: navy, color: '#FFFFFF',
    size: t.panelTitle, italic: false, align: 'left', padding: 9, border: navy,
  }) + 5;

  ry = panel(doc, { x: RIGHT_X, y: ry, width: RIGHT_W, blocks: prayerBlocks });

  // ── The spine, the full height of the body ──
  // Tied to the service-times bar rather than to whichever column ran longer,
  // so a short week does not print a stub of navy down the side.
  doc.rect(M, bodyTop, SPINE_W, (PAGE.height - 36) - 8 - bodyTop).fill(navy);

  // ── Service times, along the foot ──
  band(doc, {
    x: M, y: PAGE.height - 36, width: W,
    text: b.serviceTimes, fill: peach, color: navy, size: t.times, border: navy,
  });
}

function lastWeekLines(b) {
  const lines = [
    b.lastWeek.sunday    != null ? `Sunday attendance: ${b.lastWeek.sunday}`       : null,
    b.lastWeek.wednesday != null ? `Wednesday attendance: ${b.lastWeek.wednesday}` : null,
    b.lastWeek.offering          ? `Offering: ${b.lastWeek.offering}`              : null,
    b.lastWeek.building          ? `Building progress: ${b.lastWeek.building}`     : null,
  ].filter(Boolean);
  return lines.length ? lines : ['—'];
}

// ─── Page two ─────────────────────────────────────────────────────────────────

// The duty roster: two weeks side by side, a row per job, and a blank cell
// where nobody is down yet — which is how a gap gets noticed.
//
// Drawn in two passes. A row's fill is opaque, so painting each row's rules as
// it went meant the next row's fill covered half of them and the grid came out
// broken; every fill is laid down first and the whole grid ruled over the top.
function roster(doc, b, top, t, large) {
  const labelW = large ? 240 : 200;
  const colW   = (W - labelW) / 2;
  const cols   = [M, M + labelW, M + labelW + colW];
  const widths = [labelW, colW, colW];
  const MIN_ROW = 17;

  const rows = [];
  let y = top;

  function push(cells, opts = {}) {
    const { fill = '#FFFFFF', bold = false, size = t.roster, italic = false,
            align = ['left', 'center', 'center'], span = false } = opts;

    doc.font(bold ? (italic ? FONT_BI : FONT_B) : FONT).fontSize(size);
    const height = span
      ? Math.max(doc.heightOfString(String(cells[0] || ' '), { width: W - 8 }) + 6, MIN_ROW)
      : Math.max(
          Math.max(...cells.map((c, i) => doc.heightOfString(String(c || ' '), { width: widths[i] - 8 }))) + 6,
          MIN_ROW
        );

    rows.push({ y, height, cells, fill, bold, size, italic, align, span });
    y += height;
  }

  push(['Duty Roster'], { fill: rule, bold: true, italic: true, size: t.rosterTitle, span: true });

  const section = (label, part) => {
    push([label, ...part.dates.map(longLabel)], { fill: card, bold: true });
    for (const job of part.jobs) push([job.job, ...job.names]);
  };
  section('Sunday',    b.dutyRoster.sunday);
  section('Wednesday', b.dutyRoster.wednesday);

  const bottom = y;

  // Pass one: the fills.
  for (const r of rows) doc.rect(M, r.y, W, r.height).fill(r.fill);

  // Pass two: the text.
  for (const r of rows) {
    doc.font(r.bold ? (r.italic ? FONT_BI : FONT_B) : FONT).fontSize(r.size)
       .fillColor(r.bold ? navy : '#000000');
    if (r.span) {
      doc.text(String(r.cells[0]), M + 4, r.y + 3, { width: W - 8, align: 'center' });
    } else {
      r.cells.forEach((c, i) => {
        if (c === null || c === undefined) return;
        doc.text(String(c), cols[i] + 4, r.y + 3, { width: widths[i] - 8, align: r.align[i] });
      });
    }
  }

  // Pass three: the grid, over the top of every fill.
  doc.lineWidth(0.6);
  for (const r of rows) doc.moveTo(M, r.y).lineTo(M + W, r.y).stroke('#000000');
  doc.moveTo(M, bottom).lineTo(M + W, bottom).stroke('#000000');

  // The column rules stop short of the title row, which spans the table.
  const gridTop = rows[0].y + rows[0].height;
  for (const x of [cols[1], cols[2]]) doc.moveTo(x, gridTop).lineTo(x, bottom).stroke('#000000');
  doc.rect(M, top, W, bottom - top).stroke('#000000');

  return bottom;
}

// 'May 3, 2026' for a roster heading.
function longLabel(iso) {
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December'];
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : '';
}

function pageTwo(doc, b, t, large) {
  let y = roster(doc, b, 18, t, large) + 8;

  // ── Leadership, across the width ──
  //
  // Full width rather than beside the contacts, matching the .docx: putting a
  // tall panel next to a stack of short ones needs a vertical merge there, and
  // Word renders that badly enough to lose the card's borders.
  const leadership = [B.heading('Elders', { size: t.section })];
  leadership.push(b.leadership.elders.length
    ? B.para(b.leadership.elders, { size: t.lead })
    : B.lines(['\u2014'], { color: '#888888' }));

  if (b.leadership.evangelist?.name) {
    leadership.push(B.gap(4), B.heading('Evangelist', { size: t.section }), B.para([
      { text: b.leadership.evangelist.name, bold: true },
      { text: ` ${b.leadership.evangelist.phone}` },
    ], { size: t.lead }));
  }

  leadership.push(B.gap(4), B.heading('Deacons', { size: t.section }));
  leadership.push(b.leadership.deacons.length
    ? B.para(b.leadership.deacons, { size: t.lead })
    : B.lines(['\u2014'], { color: '#888888' }));

  y = flowPanel(doc, { x: M, y, width: W, blocks: leadership }) + 10;

  // ── Contacts beside the address ──
  const gap    = 10;
  const halfL  = 300;
  const halfR  = W - halfL - gap;
  const rightX = M + halfL + gap;

  const contacts = [B.heading('Key Email Contacts', { size: t.section })];
  for (const c of b.contacts.groups) {
    contacts.push(
      B.lines([`${c.label}:`], { size: t.lead, bold: true }),
      B.lines([c.email], { size: t.lead, color: link }),
      B.gap(3),
    );
  }
  if (b.contacts.admins.length) {
    contacts.push(B.lines(['Website Admins'], { size: t.lead, bold: true }), B.gap(2));
    for (const a of b.contacts.admins) {
      contacts.push(B.para([{ text: `${a.name} - ` }, { text: a.email }], { size: t.lead }));
    }
  }

  const findUs = [
    B.lines(b.footer.address, { size: t.lead, color: '#FFFFFF', spacing: 4 }),
    B.gap(3),
    B.lines([b.footer.phone, b.footer.website], { size: t.lead, color: '#FFFFFF', spacing: 4 }),
    B.gap(3),
    B.lines(b.footer.social.map(([k, v]) => `${k}: ${v}`), { size: t.small, color: '#FFFFFF', spacing: 3 }),
  ];

  if (large) {
    let ly = flowPanel(doc, { x: M, y, width: W, blocks: contacts });
    ly = band(doc, {
      x: M, y: ly + 10, width: W, flow: true,
      text: 'FIND US:', fill: card, color: navy, size: t.cardHead, italic: false, border: navy,
    });
    return flowPanel(doc, { x: M, y: ly, width: W, blocks: findUs, fill: navy, border: navy });
  }

  const contactsBottom = panel(doc, { x: M, y, width: halfL, blocks: contacts, shadow: false });

  // The grey heading sits inside the navy card, as it does in the .docx.
  const findUsTop = band(doc, {
    x: rightX, y, width: halfR,
    text: 'FIND US:', fill: card, color: navy, size: t.cardHead, italic: false, border: navy,
  });

  const findUsBottom = panel(doc, {
    x: rightX, y: findUsTop, width: halfR, blocks: findUs,
    fill: navy, border: navy, shadow: false,
  });

  return Math.max(contactsBottom, findUsBottom);
}

// ─── The document ─────────────────────────────────────────────────────────────

// 'normal' or 'large'. An unknown name falls back rather than throwing: an
// export is not worth failing over a query string.
function typeFor(edition) {
  return config.type[edition] || config.type.normal;
}

function draw(doc, b, edition) {
  const t     = typeFor(edition);
  const large = edition === 'large';
  pageOne(doc, b, t, large);
  doc.addPage();
  pageTwo(doc, b, t, large);
}

function render(bulletin, { edition = 'normal' } = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: M, autoFirstPage: true });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      draw(doc, bulletin, edition);
    } catch (err) {
      return reject(err);
    }

    doc.end();
  });
}

function filename(bulletin, { edition = 'normal' } = {}) {
  const suffix = edition === 'large' ? '-large-print' : '';
  return `capshaw-newsletter-${bulletin.sunday}${suffix}.pdf`;
}

module.exports = { render, filename };
