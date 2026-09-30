// ─── How It Works, as a PDF ───────────────────────────────────────────────────
//
// The same sections the page shows (server/lib/howItWorks.js), laid out for
// print: a cover, a table of contents whose every line is a link to its
// section, then the sections, each with its flowcharts drawn the way the page
// draws them (the same layout, server/lib/flowLayout.js). The PDF also carries
// bookmarks, so a reader's sidebar lists the sections too.
//
// The contents page has to show page numbers it cannot know until the
// sections are laid out, so the document buffers its pages: the contents page
// is left blank, the sections are drawn, and then it goes back and fills the
// contents in.

const PDFDocument = require('pdfkit');
const { layoutFlow } = require('./flowLayout');

const PAGE = { width: 612, height: 792 };
const MARGIN = 60;
const W = PAGE.width - MARGIN * 2;
const BOTTOM = PAGE.height - MARGIN - 14;

const NAVY = '#1e2a4a';
const GOLD = '#c9a227';
const INK = '#2d3748';
const MUTED = '#64748b';
const RULE = '#e2e8f0';
const TINT = '#faf6ea';

const FONT = 'Helvetica';
const BOLD = 'Helvetica-Bold';

const STEP = { fill: '#eef2f7', stroke: '#9aa8bd', text: '#4a5568' };
const OUTCOME = {
  good:    { fill: '#ecfdf5', stroke: '#34d399', text: '#065f46' },
  bad:     { fill: '#fef2f2', stroke: '#fca5a5', text: '#991b1b' },
  neutral: { fill: '#f8fafc', stroke: '#cbd5e1', text: '#475569' },
};

// Same wrapping as the page's charts: two lines of about 22 characters.
function wrap(text, max = 22) {
  const words = String(text || '').split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    if ((line + ' ' + word).trim().length > max && line) { lines.push(line); line = word; }
    else line = (line + ' ' + word).trim();
  }
  if (line) lines.push(line);
  return lines.slice(0, 2);
}

// The PDF's built-in fonts have no arrow, so a menu path reads "A › B".
const printable = text => String(text || '').replace(/→/g, '›');

// "**bold** and plain" → [{ text, bold }]
const runs = text => printable(text).split(/(\*\*[^*]+\*\*)/).filter(Boolean)
  .map(part => (part.startsWith('**') ? { text: part.slice(2, -2), bold: true } : { text: part, bold: false }));
const plain = text => runs(text).map(r => r.text).join('');

const destination = id => `section-${id}`;

function renderHowItWorks({ sections, admin = false, generatedAt = new Date() }) {
  const doc = new PDFDocument({
    size: 'LETTER', margin: MARGIN, bufferPages: true, pageMode: 'UseOutlines',
    info: { Title: 'How It Works — Capshaw Church of Christ Member Portal', Author: 'Capshaw Church of Christ' },
  });

  const room = () => BOTTOM - doc.y;
  const ensure = h => { if (room() < h) doc.addPage(); };

  // Words laid out by hand, so bold and plain can sit side by side on a line
  // (pdfkit's own run-on text drifts when the font changes mid-line).
  function layoutRich(text, width, size) {
    const lines = [[]];
    let used = 0;
    doc.fontSize(size);
    for (const run of runs(text)) {
      doc.font(run.bold ? BOLD : FONT);
      for (const token of run.text.split(/(\s+)/)) {
        if (!token) continue;
        const space = /^\s+$/.test(token);
        const w = doc.widthOfString(space ? ' ' : token);
        if (!space && used + w > width && used > 0) { lines.push([]); used = 0; }
        if (space && used === 0) continue;
        lines[lines.length - 1].push({ text: space ? ' ' : token, bold: run.bold, x: used });
        used += w;
      }
    }
    return lines;
  }

  const lineHeight = size => size * 1.38;

  // A paragraph with **bold** runs, flowing onto the next page as needed.
  function paragraph(text, { x = MARGIN, width = W, size = 10.5, color = INK, gap = 7 } = {}) {
    let y = doc.y;
    for (const line of layoutRich(text, width, size)) {
      if (y + lineHeight(size) > BOTTOM) { doc.addPage(); y = MARGIN; }
      for (const word of line) {
        doc.font(word.bold ? BOLD : FONT).fontSize(size).fillColor(word.bold ? NAVY : color)
          .text(word.text, x + word.x, y, { lineBreak: false });
      }
      y += lineHeight(size);
    }
    doc.x = x;
    doc.y = y + gap * 0.6;
  }

  function heightOf(text, width, size = 10.5) {
    return layoutRich(text, width, size).length * lineHeight(size);
  }

  function list(items, numbered) {
    items.forEach((item, i) => {
      const mark = numbered ? `${i + 1}.` : '•';
      ensure(Math.min(heightOf(item, W - 18) + 4, 60));
      const y = doc.y;
      doc.font(numbered ? BOLD : FONT).fontSize(10.5).fillColor(numbered ? GOLD : NAVY).text(mark, MARGIN, y, { width: 16 });
      doc.y = y;
      paragraph(item, { x: MARGIN + 18, width: W - 18, gap: 3 });
    });
    doc.moveDown(0.3);
  }

  function note(text) {
    const h = heightOf(text, W - 28) + 16;
    ensure(h + 6);
    const y = doc.y;
    doc.save().rect(MARGIN, y, W, h).fill(TINT).restore();
    doc.save().rect(MARGIN, y, 3, h).fill(GOLD).restore();
    doc.y = y + 8;
    paragraph(text, { x: MARGIN + 16, width: W - 28, gap: 0 });
    doc.y = y + h + 8;
  }

  function table({ head, rows }) {
    // Widths by how much each column says, within limits.
    const lengths = head.map((h, c) => Math.max(h.length, ...rows.map(r => Math.min(String(r[c] || '').length, 90))));
    const total = lengths.reduce((a, b) => a + b, 0);
    // No column narrower than its longest word, or pdfkit splits the word.
    const longestWord = c => Math.max(...[head[c], ...rows.map(r => r[c])].flatMap(cell => plain(cell).split(/\s+/)).map(word => {
      doc.fontSize(9).font(BOLD);
      return doc.widthOfString(word);
    })) + 12;
    const widths = lengths.map((l, c) => Math.max(70, longestWord(c), (l / total) * W));
    const scale = W / widths.reduce((a, b) => a + b, 0);
    for (let i = 0; i < widths.length; i++) widths[i] *= scale;
    const pad = 5;
    const size = 9;

    const rowHeight = (cells, header = false) => Math.max(...cells.map((cell, c) => {
      doc.fontSize(size).font(header || c === 0 ? BOLD : FONT);
      return doc.heightOfString(plain(cell), { width: widths[c] - pad * 2, lineGap: 1 });
    })) + pad * 2;

    const drawRow = (cells, { header = false, shade = false } = {}) => {
      const h = rowHeight(cells, header);
      if (room() < h) { doc.addPage(); if (!header) drawRow(head, { header: true }); }
      const y = doc.y;
      if (header) doc.save().rect(MARGIN, y, W, h).fill(NAVY).restore();
      else if (shade) doc.save().rect(MARGIN, y, W, h).fill('#f8fafc').restore();
      let x = MARGIN;
      cells.forEach((cell, c) => {
        doc.font(header ? BOLD : (c === 0 ? BOLD : FONT)).fontSize(size).fillColor(header ? '#ffffff' : (c === 0 ? NAVY : INK))
          .text(plain(cell), x + pad, y + pad, { width: widths[c] - pad * 2, lineGap: 1 });
        x += widths[c];
      });
      doc.save().moveTo(MARGIN, y + h).lineTo(MARGIN + W, y + h).lineWidth(0.5).strokeColor(RULE).stroke().restore();
      doc.y = y + h;
    };

    ensure(rowHeight(head, true) + rowHeight(rows[0] || head) + 4);
    drawRow(head, { header: true });
    rows.forEach((r, i) => drawRow(r, { shade: i % 2 === 1 }));
    doc.x = MARGIN;
    doc.moveDown(0.8);
  }

  function chartTitle(graph) {
    if (!graph.title) return;
    doc.font(BOLD).fontSize(9).fillColor(MUTED).text(printable(graph.title).toUpperCase(), MARGIN, doc.y, { width: W, characterSpacing: 0.6 });
    doc.moveDown(0.3);
  }

  // A chart that is one step after another, with no branches or loops, is
  // drawn left to right across the page: the same boxes, a fraction of the room.
  function chain(graph) {
    const next = new Map(graph.edges.map(e => [e.from, e.to]));
    if (graph.edges.length !== graph.nodes.length - 1 || next.size !== graph.edges.length) return null;
    const order = [];
    for (let id = graph.start; id && order.length <= graph.nodes.length; id = next.get(id)) order.push(id);
    if (order.length !== graph.nodes.length) return null;
    const byId = new Map(graph.nodes.map(n => [n.id, n]));
    return order.map(id => byId.get(id));
  }

  function row(graph, nodes) {
    const gap = 18;
    const bw = (W - gap * (nodes.length - 1)) / nodes.length;
    const bh = 46;
    ensure(bh + 26);
    chartTitle(graph);
    const y = doc.y;
    nodes.forEach((node, i) => {
      const x = MARGIN + i * (bw + gap);
      const style = node.kind === 'outcome' ? OUTCOME[node.tone || 'neutral'] : STEP;
      doc.save().roundedRect(x, y, bw, bh, node.kind === 'outcome' ? bh / 2 : 7).lineWidth(1).fillAndStroke(style.fill, style.stroke).restore();
      doc.font(BOLD).fontSize(8.5).fillColor(style.text);
      const th = doc.heightOfString(printable(node.label), { width: bw - 12, align: 'center' });
      doc.text(printable(node.label), x + 6, y + (bh - th) / 2, { width: bw - 12, align: 'center' });
      if (i < nodes.length - 1) {
        const ax = x + bw + 3, ay = y + bh / 2;
        doc.save().moveTo(ax, ay).lineTo(ax + gap - 8, ay).lineWidth(1.3).strokeColor('#94a3b8').stroke()
          .moveTo(ax + gap - 6, ay).lineTo(ax + gap - 11, ay - 3.5).lineTo(ax + gap - 11, ay + 3.5).closePath().fill('#94a3b8').restore();
      }
    });
    doc.x = MARGIN;
    doc.y = y + bh + 16;
  }

  // A flowchart: the page's layout, scaled to fit the column.
  function chart(graph) {
    const straight = chain(graph);
    if (straight) return row(graph, straight);
    const laid = layoutFlow(graph);
    if (!laid.nodes.length) return;
    const scale = Math.max(0.6, Math.min(0.85, W / laid.width, 260 / laid.height));
    const w = laid.width * scale;
    const h = laid.height * scale;
    ensure(h + 26);
    chartTitle(graph);
    const x0 = MARGIN + (W - w) / 2;
    const y0 = doc.y;

    doc.save();
    doc.translate(x0, y0).scale(scale);

    for (const edge of laid.edges) {
      doc.save().path(edge.path).lineWidth(1.5).strokeColor(edge.back ? '#cbd5e1' : '#94a3b8');
      if (edge.back) doc.dash(4, { space: 3 });
      doc.stroke().undash().restore();
      // An arrowhead at the end, pointing the way the path arrives.
      const nums = edge.path.match(/-?\d+(\.\d+)?/g).map(Number);
      const [x2, y2] = nums.slice(-2);
      const [x1, y1] = nums.slice(-4, -2);
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const size = 7;
      doc.save().fillColor('#94a3b8')
        .moveTo(x2, y2)
        .lineTo(x2 - size * Math.cos(angle - 0.45), y2 - size * Math.sin(angle - 0.45))
        .lineTo(x2 - size * Math.cos(angle + 0.45), y2 - size * Math.sin(angle + 0.45))
        .closePath().fill().restore();
    }

    for (const node of laid.nodes) {
      const style = node.kind === 'outcome' ? OUTCOME[node.tone || 'neutral'] : STEP;
      doc.save().roundedRect(node.x, node.y, node.w, node.h, node.kind === 'outcome' ? node.h / 2 : 8)
        .lineWidth(1.25).fillAndStroke(style.fill, style.stroke).restore();
      const lines = wrap(node.label);
      doc.font(BOLD).fontSize(11).fillColor(style.text);
      lines.forEach((line, i) => {
        const ty = node.y + node.h / 2 + (lines.length > 1 ? (i === 0 ? -13 : 1) : -6);
        doc.text(line, node.x + 4, ty, { width: node.w - 8, align: 'center', lineBreak: false });
      });
    }
    doc.restore();

    doc.x = MARGIN;
    doc.y = y0 + h + 14;
  }

  function block(b) {
    doc.x = MARGIN;
    if (b.p !== undefined) { ensure(30); paragraph(b.p); }
    else if (b.list) list(b.list, false);
    else if (b.steps) list(b.steps, true);
    else if (b.note) note(b.note);
    else if (b.table) table(b.table);
    else if (b.chart) chart(b.chart);
    else if (b.workflow) { if (b.intro) { ensure(30); paragraph(b.intro); } chart(b.chart); }
  }

  // ── The cover ──
  doc.rect(0, 0, PAGE.width, 250).fill(NAVY);
  doc.font(BOLD).fontSize(11).fillColor(GOLD).text('CAPSHAW CHURCH OF CHRIST · MEMBER PORTAL', MARGIN, 110, { width: W, characterSpacing: 1.2 });
  doc.font(BOLD).fontSize(38).fillColor('#ffffff').text('How It Works', MARGIN, 136, { width: W });
  doc.font(FONT).fontSize(12).fillColor(INK).text(
    'What the portal does, where to find it, and who can change what.', MARGIN, 290, { width: W },
  );
  doc.moveDown(0.6);
  doc.fontSize(10.5).fillColor(MUTED).text(
    admin ? 'This copy includes the sections for admins.' : 'This copy is for members.', { width: W },
  );
  doc.text(`Made ${generatedAt.toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'long', day: 'numeric', year: 'numeric' })}.`, { width: W });

  // ── The contents, filled in at the end ──
  const everyone = sections.filter(s => s.audience === 'everyone');
  const admins = sections.filter(s => s.audience === 'admins');
  const tocLines = sections.length + (admins.length ? 2 : 0);
  const tocPages = Math.max(1, Math.ceil(tocLines / 26));
  const tocStart = doc.bufferedPageRange().count;
  for (let i = 0; i < tocPages; i++) doc.addPage();

  // ── The sections ──
  const pageOf = {};
  const partHeading = (title, sub) => {
    doc.addPage();
    doc.font(BOLD).fontSize(10).fillColor(GOLD).text(sub.toUpperCase(), MARGIN, MARGIN, { characterSpacing: 1 });
    doc.font(BOLD).fontSize(24).fillColor(NAVY).text(title);
    doc.moveDown(0.6);
  };

  const drawSection = (s, first) => {
    if (!first) ensure(160);
    if (!first && room() < BOTTOM - MARGIN) doc.moveDown(0.8);
    pageOf[s.id] = doc.bufferedPageRange().start + doc.bufferedPageRange().count - 1;
    // pdfkit takes the top of the view in page coordinates from the top.
    doc.addNamedDestination(destination(s.id), 'XYZ', null, Math.max(0, doc.y - 8), null);
    doc.outline.addItem(s.title);
    doc.x = MARGIN;
    doc.font(BOLD).fontSize(16).fillColor(NAVY).text(s.title, MARGIN, doc.y, { width: W });
    const ruleY = doc.y + 3;
    doc.save().moveTo(MARGIN, ruleY).lineTo(MARGIN + 60, ruleY).lineWidth(2).strokeColor(GOLD).stroke().restore();
    doc.y = ruleY + 10;
    if (s.audience === 'admins') {
      doc.font(BOLD).fontSize(8).fillColor('#9a3412').text('ADMINS ONLY', MARGIN, doc.y, { characterSpacing: 0.8 });
      doc.moveDown(0.4);
    }
    s.blocks.forEach(block);
  };

  partHeading('For everyone', 'Part one');
  everyone.forEach((s, i) => drawSection(s, i === 0));
  if (admins.length) {
    partHeading('For admins', 'Part two');
    admins.forEach((s, i) => drawSection(s, i === 0));
  }

  // ── Back to the contents ──
  doc.switchToPage(tocStart);
  doc.font(BOLD).fontSize(24).fillColor(NAVY).text('Contents', MARGIN, MARGIN);
  doc.moveDown(0.8);
  let tocPage = tocStart;
  const tocEntry = (s) => {
    if (doc.y > BOTTOM - 24 && tocPage < tocStart + tocPages - 1) {
      doc.switchToPage(++tocPage);
      doc.y = MARGIN;
    }
    const y = doc.y;
    const page = String(pageOf[s.id] + 1);
    doc.font(FONT).fontSize(11.5).fillColor(NAVY);
    const titleW = doc.widthOfString(s.title);
    const pageW = doc.widthOfString(page);
    doc.text(printable(s.title), MARGIN + 12, y, { width: W - 60, goTo: destination(s.id), lineBreak: false });
    // Dot leaders between the title and its page number.
    const dotsFrom = MARGIN + 12 + titleW + 6;
    const dotsTo = MARGIN + W - pageW - 6;
    if (dotsTo > dotsFrom) {
      doc.fillColor('#cbd5e1');
      for (let x = dotsFrom; x < dotsTo; x += 5) doc.circle(x, y + 8, 0.7).fill();
    }
    doc.fillColor(MUTED).text(page, MARGIN + W - pageW, y, { goTo: destination(s.id), lineBreak: false });
    // The whole line is the link, not just its words.
    doc.goTo(MARGIN, y - 2, W, 18, destination(s.id));
    doc.y = y + 21;
  };
  const tocPart = title => {
    doc.moveDown(0.3);
    doc.font(BOLD).fontSize(9.5).fillColor(GOLD).text(title.toUpperCase(), MARGIN, doc.y, { characterSpacing: 1 });
    doc.moveDown(0.4);
  };
  tocPart('For everyone');
  everyone.forEach(tocEntry);
  if (admins.length) { tocPart('For admins'); admins.forEach(tocEntry); }

  // ── Page numbers, everywhere but the cover ──
  const { start, count } = doc.bufferedPageRange();
  for (let i = start + 1; i < start + count; i++) {
    doc.switchToPage(i);
    // Writing inside the bottom margin would otherwise start a new page.
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font(FONT).fontSize(8.5).fillColor(MUTED)
      .text(`How It Works · page ${i + 1} of ${count}`, MARGIN, PAGE.height - MARGIN + 10, { width: W, align: 'center', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

module.exports = { renderHowItWorks, destination };
