// ─── The newsletter as a Word document ────────────────────────────────────────
//
// Built as OOXML by hand and zipped, the same way server/tests/helpers builds
// its fixtures and routes/documents.js reads one back. That keeps the feature
// on a dependency the project already had (jszip) rather than adding a document
// library for one screen.
//
// This walks the same composed object as server/lib/bulletinPdf.js and lays the
// same sections out in the same order, so the two files say the same thing.
//
// The printed newsletter positions its content in floating text boxes at fixed
// sizes. Word does not reflow between those, so a week with a longer prayer
// list would silently clip off the page; every panel here is a table cell
// instead, which looks the same and grows. The one thing still floated is the
// banner artwork, because a masthead is a fixed-size decoration rather than
// content — it is anchored behind the text so the title can sit on top of it.
const JSZip  = require('jszip');
const fs     = require('fs');
const config = require('./bulletinConfig');

// OOXML measures in twentieths of a point, and drawings in EMU.
const tw  = pt => Math.round(pt * 20);
const emu = pt => Math.round(pt * 12700);

const PAGE_W  = 612, PAGE_H = 792;
const MARGIN  = 9;                       // the printed newsletter's own margin
const CONTENT = PAGE_W - MARGIN * 2;     // 594pt

// Page one's grid: the navy spine, a gap, the narrow column, a gap, the wide
// one. The gaps are columns of their own so the cards do not touch.
const GRID = {
  spine: 16,
  gap1:  3,
  left:  204,
  gap2:  11,
  right: 360,
};

const C     = config.colors;
const NAVY  = C.navy;
const CARD  = C.card;
const RULE  = C.rule;
const PEACH = C.peach;
const LINK  = C.link;
const WHITE = C.white;

// ─── XML plumbing ─────────────────────────────────────────────────────────────

// Word refuses to open a document containing a raw & or <, and the content is
// congregation names and email addresses, so this is not optional.
function esc(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// One run. Size is in points here and doubled on the way out, because OOXML
// measures half-points and doing that conversion at every call site is how a
// document ends up with one heading at the wrong size.
function run(text, { bold, italic, size = 10, color, underline } = {}) {
  const props = [
    bold      ? '<w:b/>' : '',
    italic    ? '<w:i/>' : '',
    color     ? `<w:color w:val="${color}"/>` : '',
    underline ? '<w:u w:val="single"/>' : '',
    `<w:sz w:val="${Math.round(size * 2)}"/><w:szCs w:val="${Math.round(size * 2)}"/>`,
  ].join('');
  return `<w:r><w:rPr>${props}</w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

function para(runs, {
  align, shade, before = 0, after = 40, bullet, indent, hanging, rightIndent, keepNext, border,
  ruleAbove,
} = {}) {
  const props = [
    bullet !== undefined ? `<w:numPr><w:ilvl w:val="${bullet}"/><w:numId w:val="1"/></w:numPr>` : '',
    indent || rightIndent
      ? `<w:ind${indent ? ` w:left="${indent}"` : ''}${rightIndent ? ` w:right="${rightIndent}"` : ''}` +
        `${hanging ? ` w:hanging="${hanging}"` : ''}/>`
      : '',
    align  ? `<w:jc w:val="${align}"/>` : '',
    shade  ? `<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>` : '',
    border ? `<w:pBdr>${['top', 'left', 'bottom', 'right']
      .map(s => `<w:${s} w:val="single" w:sz="6" w:space="6" w:color="${border}"/>`).join('')}</w:pBdr>`
      : ruleAbove ? `<w:pBdr><w:top w:val="single" w:sz="4" w:space="4" w:color="${ruleAbove}"/></w:pBdr>` : '',
    keepNext ? '<w:keepNext/>' : '',
    `<w:spacing w:before="${before}" w:after="${after}"/>`,
  ].join('');
  return `<w:p><w:pPr>${props}</w:pPr>${Array.isArray(runs) ? runs.join('') : runs}</w:p>`;
}

const EMPTY = '<w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>';

// ─── Cards without nesting ────────────────────────────────────────────────────
//
// A panel used to be a one-cell table inside the layout table. Word and its
// converters size a nested table from its own width rather than the cell's, so
// the grid blew out and the columns landed anywhere.
//
// Consecutive paragraphs carrying identical borders are drawn as one box
// instead, which is the same picture with no nesting at all. Sections are
// therefore built as paragraph descriptors and only turned into XML once the
// card's fill and border are known — a blank, unbordered paragraph between two
// cards is what stops them merging into one.
const P = (runs, opts = {}) => ({ runs, opts });

const renderParas = (items, style = {}) =>
  items.map(({ runs, opts }) => para(runs, { ...opts, ...style })).join('');

// A card's contents. The box around it belongs to the table cell holding this,
// not to the paragraphs: Word will draw a border on a run of identical
// paragraphs, but a paragraph border inside a table cell is clipped at the cell
// edge by some readers, which left cards with a rule above and below and no
// sides. A cell border is drawn by everything.
const card = items => renderParas([...items, P('', { after: 0 })]);

const pageBreak = () =>
  '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>' +
  '<w:rPr><w:sz w:val="2"/></w:rPr></w:pPr>' +
  '<w:r><w:rPr><w:sz w:val="2"/></w:rPr><w:br w:type="page"/></w:r></w:p>';

// ─── Tables ───────────────────────────────────────────────────────────────────

function borders(kind, color = NAVY, sz = 8) {
  const sides = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'];
  return `<w:tblBorders>${sides
    .map(s => `<w:${s} w:val="${kind}" w:sz="${kind === 'none' ? 0 : sz}" w:space="0" w:color="${kind === 'none' ? 'auto' : color}"/>`)
    .join('')}</w:tblBorders>`;
}

// A cell's own borders, which is how a card gets a box: the layout table draws
// none, and the cards that want one ask for it here.
function cellBorder(color = NAVY, sz = 8) {
  return `<w:tcBorders>${['top', 'left', 'bottom', 'right']
    .map(side => `<w:${side} w:val="single" w:sz="${sz}" w:space="0" w:color="${color}"/>`).join('')}</w:tcBorders>`;
}

// Note there is deliberately no vertical merge here. Spanning a cell down
// several rows is the obvious way to put one tall panel beside a stack of
// short ones, and Word renders it differently enough from everything else to
// drop the merged cell's sides and bottom and to push the following page's
// content a page late. Every table in this file is a single row.
function cell(xml, widthPt, { shade, span, valign, margin = 60, bordered } = {}) {
  const props = [
    `<w:tcW w:w="${tw(widthPt)}" w:type="dxa"/>`,
    span ? `<w:gridSpan w:val="${span}"/>` : '',
    bordered ? cellBorder() : '',
    shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>` : '',
    valign ? `<w:vAlign w:val="${valign}"/>` : '',
    `<w:tcMar><w:top w:w="${margin}" w:type="dxa"/><w:left w:w="${margin}" w:type="dxa"/>` +
      `<w:bottom w:w="${margin}" w:type="dxa"/><w:right w:w="${margin}" w:type="dxa"/></w:tcMar>`,
  ].join('');
  // Word requires every cell to end with a paragraph.
  return `<w:tc><w:tcPr>${props}</w:tcPr>${xml || EMPTY}</w:tc>`;
}

function table(rows, widths, { kind = 'none', color = NAVY, sz = 8, indent = 0 } = {}) {
  const total = widths.reduce((a, b) => a + b, 0);
  return (
    '<w:tbl><w:tblPr>' +
    `<w:tblW w:w="${tw(total)}" w:type="dxa"/>` +
    (indent ? `<w:tblInd w:w="${tw(indent)}" w:type="dxa"/>` : '') +
    borders(kind, color, sz) +
    '<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>' +
    '</w:tblPr>' +
    `<w:tblGrid>${widths.map(w => `<w:gridCol w:w="${tw(w)}"/>`).join('')}</w:tblGrid>` +
    rows.join('') +
    '</w:tbl>'
  );
}

const row = (cells, { header = false, height = 0 } = {}) =>
  `<w:tr><w:trPr>${header ? '<w:tblHeader/>' : ''}${height ? `<w:trHeight w:val="${tw(height)}" w:hRule="atLeast"/>` : ''}</w:trPr>${cells.join('')}</w:tr>`;

// ─── The newsletter's own pieces ──────────────────────────────────────────────

// These three return paragraph descriptors rather than XML, because a card
// decides its own fill and border and applies them to every paragraph it holds.
const heading = (text, { size = 12, plain = false, after = 40, rule = false } = {}) =>
  [P(run(text, { bold: true, italic: !plain, size, color: NAVY }),
     { before: rule ? 120 : 40, after, keepNext: true, ruleAbove: rule ? RULE : undefined })];

function bullets(items, { size } = {}) {
  if (!items.length) return [P(run('—', { size, color: '888888' }), { indent: 220, after: 20 })];
  return items.map(item => {
    const sub  = typeof item === 'object' && item.level;
    const text = typeof item === 'object' ? item.text : item;
    return P(run(text, { size, italic: !!sub }), { bullet: sub ? 1 : 0, after: 20 });
  });
}

// A running paragraph whose names are bold and whose remainders are not.
const segments = (segs, { size } = {}) =>
  [P(segs.map(s => run(s.text, { size, bold: s.bold })), { after: 40 })];

function lastWeekLines(b) {
  const lines = [
    b.lastWeek.sunday    != null ? `Sunday attendance: ${b.lastWeek.sunday}`       : null,
    b.lastWeek.wednesday != null ? `Wednesday attendance: ${b.lastWeek.wednesday}` : null,
    b.lastWeek.offering          ? `Offering: ${b.lastWeek.offering}`              : null,
    b.lastWeek.building          ? `Building progress: ${b.lastWeek.building}`     : null,
  ].filter(Boolean);
  return lines.length ? lines : ['—'];
}

// The banner: the artwork anchored behind the text, then the title over it.
// Fixed size, so floating it carries none of the risk that floating the content
// would. rId3 is the image relationship declared in DOC_RELS below.
function mastheadXml(b, hasImage, t) {
  const drawing = hasImage ? `<w:r><w:drawing>
<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="1" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1">
<wp:simplePos x="0" y="0"/>
<wp:positionH relativeFrom="page"><wp:posOffset>${emu(MARGIN)}</wp:posOffset></wp:positionH>
<wp:positionV relativeFrom="page"><wp:posOffset>${emu(6)}</wp:posOffset></wp:positionV>
<wp:extent cx="${emu(CONTENT)}" cy="${emu(101)}"/>
<wp:effectExtent l="0" t="0" r="0" b="0"/>
<wp:wrapNone/>
<wp:docPr id="1" name="Masthead"/>
<wp:cNvGraphicFramePr/>
<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
<pic:nvPicPr><pic:cNvPr id="1" name="Masthead"/><pic:cNvPicPr/></pic:nvPicPr>
<pic:blipFill><a:blip r:embed="rId3"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu(CONTENT)}" cy="${emu(101)}"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
</pic:pic></a:graphicData></a:graphic>
</wp:anchor></w:drawing></w:r>` : '';

  return [
    // The anchor rides on the title paragraph so the picture cannot be orphaned
    // onto a page of its own.
    `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="${tw(14)}" w:after="0"/></w:pPr>` +
      drawing + run(b.masthead, { bold: true, size: t.banner, color: NAVY }) + '</w:p>',
    para(run(b.sundayLabel, { bold: true, size: t.date, color: NAVY }),
      { align: 'center', before: tw(22), after: tw(14) }),
  ].join('');
}

// ─── Page one ─────────────────────────────────────────────────────────────────

function pageOne(b, hasImage, t, large) {
  const parts = [mastheadXml(b, hasImage, t)];

  if (b.quote) {
    const text = b.quoteRef ? `“${b.quote}” – ${b.quoteRef}` : `“${b.quote}”`;
    parts.push(para(run(text, { bold: true, italic: true, size: t.quote, color: NAVY }),
      { align: 'center', after: 100 }));
  }

  // ── Left column ──
  const groupItems = [];
  for (const g of b.groups) {
    groupItems.push(g.leader ? `${g.name} \u2013 Leader: ${g.leader}` : g.name);
    if (g.note) groupItems.push({ text: g.note, level: 1 });
  }

  // One grey card holding all three sections, rather than three boxes.
  //
  // Three separate boxes beside one tall prayer panel needs either a table
  // nested in a cell or a vertical merge, and both are unsafe: a nested table
  // makes Word re-fit the outer grid and throws the columns across the page,
  // and a vertical merge renders differently enough in Word to lose a cell's
  // side and bottom borders and to push the rest of the newsletter a page
  // late. A single row of plain cells is the one arrangement every reader
  // agrees on, so the sections are divided by their headings instead.
  const leftColumn = card([
    ...heading('Reminders:', { size: t.cardHead, plain: true }),
    ...bullets(b.reminders, { size: t.small }),
    ...heading('Last Week\u2019s Data:', { size: t.cardHead, plain: true, rule: true }),
    ...bullets(lastWeekLines(b), { size: t.small }),
    ...heading('Anniversaries:', { size: t.cardHead, plain: true, rule: true }),
    ...bullets(b.anniversaries, { size: t.small }),
    ...heading('Birthdays:', { size: t.cardHead, plain: true, rule: true }),
    ...bullets(b.birthdays, { size: t.small }),
    ...heading('Groups:', { size: t.cardHead, plain: true, rule: true }),
    ...bullets(groupItems, { size: t.small }),
  ]);

  // ── Right column: the prayer panel ──
  const prayer = [];
  const add = (title, items) => {
    // An empty heading in a printed newsletter reads as a mistake rather than
    // as good news, so a block with nothing in it is left out entirely.
    if (!items.length) return;
    prayer.push(...heading(title, { size: t.section }), ...bullets(items, { size: t.body }));
  };
  add('Updates',     b.prayer.updates);
  add('Ongoing',     b.prayer.ongoing);
  add('Shut-Ins',    b.prayer.shutIns);
  add('Pregnancies', b.prayer.pregnancies);
  if (b.prayer.evangelists.length) {
    prayer.push(...heading('Evangelists We Support', { size: t.section }),
                ...segments(b.prayer.evangelists, { size: t.body }));
  }
  if (!prayer.length) prayer.push(P(run('\u2014', { color: '888888' })));

  const rightColumn =
    para(run('Prayer Requests', { bold: true, size: t.panelTitle, color: WHITE }),
      { shade: NAVY, before: 0, after: 80 }) +
    card(prayer);

  // ── The body ──
  //
  // Two columns normally. The large-print edition runs down the page instead:
  // at 16pt the narrow column would hold about a dozen characters a line, so
  // the columns are stacked and the newsletter is longer for it.
  if (large) {
    parts.push(table(
      [row([cell(leftColumn, CONTENT, { shade: CARD, bordered: true, margin: 120 })])],
      [CONTENT],
    ));
    parts.push(EMPTY);
    parts.push(table([row([cell(rightColumn, CONTENT, { bordered: true, margin: 120 })])], [CONTENT]));
  } else {
    parts.push(table(
      [row([
        cell(EMPTY,       GRID.spine, { shade: NAVY, margin: 0 }),
        cell(EMPTY,       GRID.gap1,  { margin: 0 }),
        cell(leftColumn,  GRID.left,  { shade: CARD, bordered: true, margin: 90 }),
        cell(EMPTY,       GRID.gap2,  { margin: 0 }),
        cell(rightColumn, GRID.right, { bordered: true, margin: 90 }),
      ])],
      [GRID.spine, GRID.gap1, GRID.left, GRID.gap2, GRID.right],
    ));
  }

  parts.push(para(run(b.serviceTimes, { bold: true, italic: true, size: t.times, color: NAVY }),
    { align: 'center', shade: PEACH, border: NAVY, before: 120, after: 0 }));

  return parts.join('');
}

// ─── Page two ─────────────────────────────────────────────────────────────────

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];

function longLabel(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : '';
}

function rosterTable(b, t, large) {
  const labelW = large ? 240 : 200;
  const colW   = (CONTENT - labelW) / 2;
  const widths = [labelW, colW, colW];

  const rows = [
    row([cell(
      para(run('Duty Roster', { bold: true, italic: true, size: t.rosterTitle, color: NAVY }), { align: 'center', after: 0 }),
      CONTENT, { shade: RULE, span: 3 },
    )]),
  ];

  const section = (label, part) => {
    rows.push(row([
      cell(para(run(label, { bold: true, size: t.roster, color: NAVY }), { after: 0 }), labelW, { shade: CARD }),
      ...part.dates.map(d => cell(
        para(run(longLabel(d), { bold: true, size: t.roster, color: NAVY }), { align: 'center', after: 0 }),
        colW, { shade: CARD },
      )),
    ], { header: true }));

    for (const job of part.jobs) {
      rows.push(row([
        cell(para(run(job.job, { size: t.roster }), { after: 0 }), labelW),
        ...job.names.map(n => cell(
          para(run(n || '', { size: t.roster }), { align: 'center', after: 0 }), colW,
        )),
      ], { height: 13 }));
    }
  };

  section('Sunday',    b.dutyRoster.sunday);
  section('Wednesday', b.dutyRoster.wednesday);

  return table(rows, widths, { kind: 'single', color: '000000', sz: 4 });
}

function pageTwo(b, t, large) {
  const parts = [rosterTable(b, t, large), EMPTY];

  const leftW  = 331;
  const gap    = 8;
  const rightW = CONTENT - leftW - gap;

  // ── Leadership ──
  const leadership = [...heading('Elders', { size: t.section })];
  leadership.push(...(b.leadership.elders.length
    ? segments(b.leadership.elders, { size: t.lead })
    : [P(run('\u2014', { color: '888888' }))]));

  if (b.leadership.evangelist?.name) {
    leadership.push(...heading('Evangelist', { size: t.section }), ...segments([
      { text: b.leadership.evangelist.name, bold: true },
      { text: ` ${b.leadership.evangelist.phone}` },
    ], { size: t.lead }));
  }

  leadership.push(...heading('Deacons', { size: t.section }));
  leadership.push(...(b.leadership.deacons.length
    ? segments(b.leadership.deacons, { size: t.lead })
    : [P(run('\u2014', { color: '888888' }))]));

  // ── Contacts ──
  const contacts = [...heading('Key Email Contacts', { size: t.section })];
  for (const c of b.contacts.groups) {
    contacts.push(
      P(run(`${c.label}:`, { bold: true, size: t.lead }), { after: 20 }),
      P(run(c.email, { size: t.lead, color: LINK, underline: true }), { after: 60 }),
    );
  }
  if (b.contacts.admins.length) {
    contacts.push(P(run('Website Admins', { bold: true, size: t.lead }), { after: 40 }));
    for (const a of b.contacts.admins) {
      contacts.push(P([
        run(`${a.name} - `, { size: t.lead }),
        run(a.email, { size: t.lead, color: LINK, underline: true }),
      ], { after: 20 }));
    }
  }

  // ── Find us ──
  //
  // The grey heading is a shaded paragraph inside the navy cell rather than a
  // cell of its own: two stacked cells beside the leadership panel would need a
  // vertical merge, and that is what lost this card its sides and bottom in
  // Word and pushed the rest of the newsletter a page late.
  const findUs = [
    P(run('FIND US:', { bold: true, size: t.cardHead, color: NAVY }),
      { align: 'center', shade: CARD, after: 80 }),
    ...b.footer.address.map(l => P(run(l, { size: t.lead, color: WHITE }), { align: 'center', after: 40 })),
    P(run(b.footer.phone,   { size: t.lead, color: WHITE }), { align: 'center', after: 40 }),
    P(run(b.footer.website, { size: t.lead, color: WHITE }), { align: 'center', after: 60 }),
    ...b.footer.social.map(([k, v]) =>
      P(run(`${k}: ${v}`, { size: t.small, color: WHITE }), { after: 20 })),
  ];

  // Leadership spans the width on its own row, then the contacts and the
  // address sit beside each other. Every cell is plain — one row, no merges.
  parts.push(table(
    [row([cell(card(leadership), CONTENT, { bordered: true, margin: 90 })])],
    [CONTENT],
  ));
  parts.push(EMPTY);

  if (large) {
    parts.push(table([row([cell(card(contacts), CONTENT, { bordered: true, margin: 120 })])], [CONTENT]));
    parts.push(EMPTY);
    parts.push(table([row([cell(card(findUs), CONTENT, { shade: NAVY, bordered: true, margin: 120 })])], [CONTENT]));
  } else {
    const halfGap = 10;
    const halfL   = 300;
    const halfR   = CONTENT - halfL - halfGap;

    parts.push(table(
      [row([
        cell(card(contacts), halfL, { bordered: true, margin: 90 }),
        cell(EMPTY, halfGap, { margin: 0 }),
        cell(card(findUs), halfR, { shade: NAVY, bordered: true, margin: 90 }),
      ])],
      [halfL, halfGap, halfR],
    ));
  }

  return parts.join('');
}

// ─── The package ──────────────────────────────────────────────────────────────

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="jpeg" ContentType="image/jpeg"/>
  <Default Extension="jpg" ContentType="image/jpeg"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const docRels = hasImage => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
  ${hasImage ? '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/masthead.jpg"/>' : ''}
</Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr>
      <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>
      <w:sz w:val="20"/><w:szCs w:val="20"/>
    </w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
</w:styles>`;

// Two levels of bullet, which is all the newsletter uses (a group's meeting
// note sits under the group).
const NUMBERING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0">
    <w:multiLevelType w:val="hybridMultilevel"/>
    <w:lvl w:ilvl="0">
      <w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="&#8226;"/><w:lvlJc w:val="left"/>
      <w:pPr><w:ind w:left="260" w:hanging="200"/></w:pPr>
      <w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:hint="default"/></w:rPr>
    </w:lvl>
    <w:lvl w:ilvl="1">
      <w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="&#9702;"/><w:lvlJc w:val="left"/>
      <w:pPr><w:ind w:left="260" w:hanging="200"/></w:pPr>
      <w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:hint="default"/></w:rPr>
    </w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`;

const SECTION =
  `<w:sectPr><w:pgSz w:w="${tw(PAGE_W)}" w:h="${tw(PAGE_H)}"/>` +
  `<w:pgMar w:top="${tw(MARGIN)}" w:right="${tw(MARGIN)}" w:bottom="${tw(MARGIN)}" w:left="${tw(MARGIN)}" ` +
  `w:header="0" w:footer="0" w:gutter="0"/><w:cols w:space="720"/></w:sectPr>`;

const NS = [
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"',
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"',
].join(' ');

// 'normal' or 'large'. An unknown name falls back rather than throwing: an
// export is not worth failing over a query string.
function typeFor(edition) {
  return config.type[edition] || config.type.normal;
}

function body(b, hasImage, edition = 'normal') {
  const t     = typeFor(edition);
  const large = edition === 'large';
  return pageOne(b, hasImage, t, large) + pageBreak() + pageTwo(b, t, large);
}

// A .docx of the composed newsletter, as a Buffer.
async function render(bulletin, { edition = 'normal' } = {}) {
  let image = null;
  try {
    if (fs.existsSync(config.mastheadImage)) image = await fs.promises.readFile(config.mastheadImage);
  } catch {
    // A missing or unreadable banner is a plainer newsletter, not a failed one.
    image = null;
  }
  const hasImage = !!image;

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${NS}><w:body>${body(bulletin, hasImage, edition)}${SECTION}</w:body></w:document>`;

  const zip = new JSZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.folder('_rels').file('.rels', ROOT_RELS);

  const word = zip.folder('word');
  word.file('document.xml', document);
  word.file('styles.xml', STYLES);
  word.file('numbering.xml', NUMBERING);
  word.folder('_rels').file('document.xml.rels', docRels(hasImage));
  if (hasImage) word.folder('media').file('masthead.jpg', image);

  return zip.generateAsync({ type: 'nodebuffer' });
}

function filename(bulletin, { edition = 'normal' } = {}) {
  const suffix = edition === 'large' ? '-large-print' : '';
  return `capshaw-newsletter-${bulletin.sunday}${suffix}.docx`;
}

module.exports = { render, filename, esc, body };
