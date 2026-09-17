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
// pdfkit draws rather than flows, so the side-by-side regions are done by hand
// — render the left column, note where it ended, rewind to the top for the
// right column, then continue below whichever ran longer.
const PDFDocument = require('pdfkit');

const PAGE   = { width: 612, height: 792 };   // US Letter, points
const MARGIN = 72;                            // the draft's one inch
const WIDTH  = PAGE.width - MARGIN * 2;       // 468pt of content

const NAVY = '#1F3864';
const RULE = '#C9C9C9';
const MUTED = '#595959';

const FONT      = 'Helvetica';
const FONT_B    = 'Helvetica-Bold';
const FONT_I    = 'Helvetica-Oblique';
const FONT_BI   = 'Helvetica-BoldOblique';

// ─── Drawing helpers ──────────────────────────────────────────────────────────

// A full-width navy band with centred text, as the masthead and the service
// times are set. Returns the y below it.
function band(doc, lines, y) {
  const padding = 8;
  // Measure first so the rectangle fits the text rather than a guess.
  let height = padding * 2;
  for (const l of lines) {
    doc.font(l.bold ? FONT_BI : FONT).fontSize(l.size);
    height += doc.heightOfString(l.text, { width: WIDTH - padding * 2, align: 'center' });
  }

  doc.rect(MARGIN, y, WIDTH, height).fill(NAVY);

  let cursor = y + padding;
  for (const l of lines) {
    doc.font(l.bold ? FONT_BI : FONT).fontSize(l.size).fillColor('#FFFFFF');
    doc.text(l.text, MARGIN + padding, cursor, { width: WIDTH - padding * 2, align: 'center' });
    cursor = doc.y;
  }
  doc.fillColor('#000000');
  return y + height;
}

// A section heading: bold italic navy with a rule under it, as in the draft.
function heading(doc, text, x, y, width) {
  doc.font(FONT_BI).fontSize(11).fillColor(NAVY);
  doc.text(text, x, y, { width });
  const bottom = doc.y + 2;
  doc.moveTo(x, bottom).lineTo(x + width, bottom).lineWidth(0.5).stroke(RULE);
  doc.fillColor('#000000');
  return bottom + 5;
}

// One bullet. The marker is drawn separately from the text so that a wrapped
// line lines up under the first word rather than under the dot.
//
// Both markers have to exist in WinAnsi, which is what pdfkit encodes the
// built-in Helvetica with: the obvious choice for a sub-bullet, ◦ (U+25E6), is
// not in it and comes out as a stray glyph on top of the text.
function bullet(doc, text, x, y, width, { level = 0, italic = false } = {}) {
  const indent = 12 + level * 12;
  doc.font(FONT).fontSize(9).fillColor(level ? MUTED : '#000000');
  doc.text(level ? '·' : '•', x + level * 12, y, { width: 8 });
  doc.font(italic ? FONT_I : FONT).fontSize(9).fillColor('#000000');
  doc.text(text, x + indent, y, { width: width - indent });
  return doc.y + 2;
}

function bullets(doc, items, x, y, width, opts) {
  if (!items.length) {
    doc.font(FONT).fontSize(9).fillColor(MUTED);
    doc.text('—', x + 10, y, { width: width - 10 });
    doc.fillColor('#000000');
    return doc.y + 2;
  }
  let cursor = y;
  for (const item of items) cursor = bullet(doc, item, x, cursor, width, opts);
  return cursor;
}

// Render one side of a two-column region, and report where it finished — both
// the y and the page, since a long column can run onto the next one.
function column(doc, draw, x, y, width, startPage) {
  doc.switchToPage(startPage);
  const endY = draw(x, y, width);
  return { y: endY, page: doc.bufferedPageRange().count - 1 === startPage ? startPage : currentPage(doc) };
}

function currentPage(doc) {
  // pdfkit tracks the page being written to internally; its index within the
  // buffered range is what switchToPage expects back.
  return doc.bufferedPageRange().start + doc.bufferedPageRange().count - 1;
}

// ─── The newsletter's sections ────────────────────────────────────────────────

function prayerBlock(doc, title, items, x, y, width) {
  // An empty heading in a printed newsletter reads as a mistake rather than as
  // good news, so a block with nothing in it is left out entirely.
  if (!items.length) return y;
  let cursor = heading(doc, title, x, y, width);
  return bullets(doc, items, x, cursor, width);
}

function draw(doc, b) {
  // ── Masthead ──
  let y = band(doc, [
    { text: b.masthead,    size: 17, bold: true },
    { text: b.sundayLabel, size: 11, bold: true },
  ], MARGIN);

  y += 10;

  // ── Quote ──
  if (b.quote) {
    const text = b.quoteRef ? `“${b.quote}” – ${b.quoteRef}` : `“${b.quote}”`;
    doc.font(FONT_I).fontSize(9).fillColor('#000000');
    doc.text(text, MARGIN, y, { width: WIDTH, align: 'center' });
    y = doc.y + 12;
  }

  // ── Reminders beside the prayer list ──
  const gutter   = 16;
  const leftW    = 170;
  const rightW   = WIDTH - leftW - gutter;
  const rightX   = MARGIN + leftW + gutter;
  const startPg  = currentPage(doc);

  const left = column(doc, (x, yy, w) => {
    let c = heading(doc, 'Reminders:', x, yy, w);
    return bullets(doc, b.reminders, x, c, w);
  }, MARGIN, y, leftW, startPg);

  const right = column(doc, (x, yy, w) => {
    doc.font(FONT_B).fontSize(13).fillColor(NAVY);
    doc.text('Prayer Requests', x, yy, { width: w });
    doc.fillColor('#000000');
    let c = doc.y + 4;
    c = prayerBlock(doc, 'Updates',                b.prayer.updates,     x, c, w);
    c = prayerBlock(doc, 'Ongoing',                b.prayer.ongoing,     x, c, w);
    c = prayerBlock(doc, 'Shut-Ins',               b.prayer.shutIns,     x, c, w);
    c = prayerBlock(doc, 'Pregnancies',            b.prayer.pregnancies, x, c, w);
    c = prayerBlock(doc, 'Evangelists We Support', b.prayer.evangelists, x, c, w);
    return c;
  }, rightX, y, rightW, startPg);

  // ── Page two ──
  doc.addPage();
  y = band(doc, [{ text: b.serviceTimes, size: 10, bold: true }], MARGIN);
  y += 12;

  const dataLines = [
    b.lastWeek.sunday    != null ? `Sunday attendance: ${b.lastWeek.sunday}`       : null,
    b.lastWeek.wednesday != null ? `Wednesday attendance: ${b.lastWeek.wednesday}` : null,
    b.lastWeek.offering          ? `Offering: ${b.lastWeek.offering}`              : null,
    b.lastWeek.building          ? `Building progress: ${b.lastWeek.building}`     : null,
  ].filter(Boolean);

  const leftW2  = 200;
  const rightW2 = WIDTH - leftW2 - gutter;
  const rightX2 = MARGIN + leftW2 + gutter;
  const pg2     = currentPage(doc);

  const left2 = column(doc, (x, yy, w) => {
    let c = heading(doc, 'Last Week’s Data:', x, yy, w);
    c = bullets(doc, dataLines, x, c, w);
    c = heading(doc, 'Anniversaries:', x, c, w);
    c = bullets(doc, b.anniversaries, x, c, w);
    c = heading(doc, 'Birthdays:', x, c, w);
    c = bullets(doc, b.birthdays, x, c, w);
    c = heading(doc, 'Groups:', x, c, w);
    if (!b.groups.length) return bullets(doc, [], x, c, w);
    for (const g of b.groups) {
      c = bullet(doc, g.leader ? `${g.name} – Leader: ${g.leader}` : g.name, x, c, w);
      if (g.note) c = bullet(doc, g.note, x, c, w, { level: 1, italic: true });
    }
    return c;
  }, MARGIN, y, leftW2, pg2);

  const person = p => (p.duties.length ? `${p.name} — ${p.duties.join(', ')}` : p.name);

  const right2 = column(doc, (x, yy, w) => {
    let c = heading(doc, 'Elders', x, yy, w);
    c = bullets(doc, b.elders.map(person), x, c, w);
    c = heading(doc, 'Deacons / Responsibilities', x, c, w);
    return bullets(doc, b.deacons.map(person), x, c, w);
  }, rightX2, y, rightW2, pg2);

  // Continue below whichever column ran longer, on whichever page it ended on.
  doc.switchToPage(Math.max(left2.page, right2.page));
  y = (left2.page === right2.page ? Math.max(left2.y, right2.y)
      : left2.page > right2.page  ? left2.y : right2.y) + 14;

  // ── Key email contacts ──
  y = heading(doc, 'Key Email Contacts:', MARGIN, y, WIDTH);
  const labelW = 170;
  for (const c of b.emailContacts) {
    doc.font(FONT).fontSize(9).fillColor('#000000');
    const h = Math.max(
      doc.heightOfString(c.label, { width: labelW - 8 }),
      doc.heightOfString(c.email, { width: WIDTH - labelW - 8 })
    ) + 6;
    doc.rect(MARGIN, y, WIDTH, h).lineWidth(0.5).stroke(RULE);
    doc.moveTo(MARGIN + labelW, y).lineTo(MARGIN + labelW, y + h).stroke(RULE);
    doc.text(c.label, MARGIN + 4, y + 3, { width: labelW - 8 });
    doc.text(c.email, MARGIN + labelW + 4, y + 3, { width: WIDTH - labelW - 8 });
    y += h;
  }

  // ── Footer ──
  y += 16;
  doc.font(FONT).fontSize(8).fillColor('#000000');
  for (const line of b.footer.address) {
    doc.text(line, MARGIN, y, { width: WIDTH, align: 'center' });
    y = doc.y;
  }
  doc.text(`${b.footer.phone}  ·  ${b.footer.website}`, MARGIN, y, { width: WIDTH, align: 'center' });
  y = doc.y;
  doc.fillColor(MUTED);
  doc.text(b.footer.social.map(([k, v]) => `${k}: ${v}`).join('  ·  '), MARGIN, y, { width: WIDTH, align: 'center' });
}

// A PDF of the composed newsletter, as a Buffer.
function render(bulletin) {
  return new Promise((resolve, reject) => {
    // bufferPages is what lets a column rewind to the page it started on.
    const doc = new PDFDocument({ size: 'LETTER', margin: MARGIN, bufferPages: true, autoFirstPage: true });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      draw(doc, bulletin);
    } catch (err) {
      return reject(err);
    }

    doc.flushPages();
    doc.end();
  });
}

function filename(bulletin) {
  return `capshaw-newsletter-${bulletin.sunday}.pdf`;
}

module.exports = { render, filename };
