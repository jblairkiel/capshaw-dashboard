// ─── The newsletter as a Word document ────────────────────────────────────────
//
// Built as OOXML by hand and zipped, the same way server/tests/helpers builds
// its fixtures and routes/documents.js reads one back. That keeps the feature
// on the two dependencies the project already had (jszip) rather than adding a
// document library for one screen.
//
// The draft this reproduces lays its content out in 22 floating text boxes at
// fixed sizes — the prayer column is pinned to 3.13 by 8.65 inches. That is
// fine for a document a person types once, and wrong for one a program fills:
// Word does not reflow between floating boxes, so a week with a longer prayer
// list would silently clip off the page. The side-by-side regions are therefore
// borderless tables, which look the same and grow instead of clipping.
const JSZip  = require('jszip');
const config = require('./bulletinConfig');

// Twips. US Letter with the draft's one-inch margins leaves this much room.
const CONTENT_WIDTH = 9360;

const NAVY  = '1F3864';
const RULE  = 'C9C9C9';

// ─── XML plumbing ─────────────────────────────────────────────────────────────

// Word will refuse to open a document containing a raw & or <, and the content
// is congregation names and email addresses, so this is not optional.
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
function run(text, { bold, italic, size = 11, color, font } = {}) {
  const props = [
    font   ? `<w:rFonts w:ascii="${font}" w:hAnsi="${font}"/>` : '',
    bold   ? '<w:b/>'   : '',
    italic ? '<w:i/>'   : '',
    color  ? `<w:color w:val="${color}"/>` : '',
    `<w:sz w:val="${size * 2}"/><w:szCs w:val="${size * 2}"/>`,
  ].join('');
  return `<w:r><w:rPr>${props}</w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

function para(runs, { align, shade, spaceBefore = 0, spaceAfter = 60, bullet, indent, border } = {}) {
  const props = [
    bullet !== undefined ? `<w:numPr><w:ilvl w:val="${bullet}"/><w:numId w:val="1"/></w:numPr>` : '',
    indent ? `<w:ind w:left="${indent}"/>` : '',
    align ? `<w:jc w:val="${align}"/>` : '',
    shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>` : '',
    border ? `<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="2" w:color="${border}"/></w:pBdr>` : '',
    `<w:spacing w:before="${spaceBefore}" w:after="${spaceAfter}"/>`,
  ].join('');
  return `<w:p><w:pPr>${props}</w:pPr>${Array.isArray(runs) ? runs.join('') : runs}</w:p>`;
}

const EMPTY = '<w:p/>';

function pageBreak() {
  return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
}

// A borderless two-column grid. This is what replaces the draft's floating
// boxes: the same side-by-side look, but a cell grows downward instead of
// hiding what does not fit.
function twoColumn(leftXml, rightXml, leftWidth) {
  const rightWidth = CONTENT_WIDTH - leftWidth;
  const cell = (xml, w) =>
    `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>` +
    `<w:tcMar><w:left w:w="0" w:type="dxa"/><w:right w:w="170" w:type="dxa"/></w:tcMar>` +
    `</w:tcPr>${xml || EMPTY}</w:tc>`;
  return (
    '<w:tbl><w:tblPr><w:tblW w:w="' + CONTENT_WIDTH + '" w:type="dxa"/>' +
    '<w:tblBorders>' +
    ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
      .map(s => `<w:${s} w:val="none" w:sz="0" w:space="0" w:color="auto"/>`).join('') +
    '</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr>' +
    `<w:tblGrid><w:gridCol w:w="${leftWidth}"/><w:gridCol w:w="${rightWidth}"/></w:tblGrid>` +
    `<w:tr>${cell(leftXml, leftWidth)}${cell(rightXml, rightWidth)}</w:tr></w:tbl>`
  );
}

// The email contacts grid, which is a real table in the draft too.
function contactsTable(contacts) {
  const rows = contacts.map(c =>
    '<w:tr>' +
    `<w:tc><w:tcPr><w:tcW w:w="3600" w:type="dxa"/></w:tcPr>${para(run(c.label, { size: 10 }), { spaceAfter: 20 })}</w:tc>` +
    `<w:tc><w:tcPr><w:tcW w:w="5760" w:type="dxa"/></w:tcPr>${para(run(c.email, { size: 10 }), { spaceAfter: 20 })}</w:tc>` +
    '</w:tr>'
  ).join('');

  return (
    '<w:tbl><w:tblPr><w:tblW w:w="' + CONTENT_WIDTH + '" w:type="dxa"/>' +
    '<w:tblBorders>' +
    ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
      .map(s => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="${RULE}"/>`).join('') +
    '</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="3600"/><w:gridCol w:w="5760"/></w:tblGrid>' +
    rows + '</w:tbl>'
  );
}

// ─── The newsletter's own pieces ──────────────────────────────────────────────

// A section heading, as the draft sets them: bold italic, navy, ruled under.
function heading(text) {
  return para(run(text, { bold: true, italic: true, size: 12, color: NAVY }),
    { spaceBefore: 160, spaceAfter: 60, border: RULE });
}

function bullets(items, level = 0) {
  if (!items.length) return para(run('—', { size: 10, color: '888888' }), { indent: 360, spaceAfter: 40 });
  return items.map(i => para(run(i, { size: 10 }), { bullet: level, spaceAfter: 20 })).join('');
}

// A prayer block only appears when it has something in it: an empty "Shut-Ins"
// heading in a printed newsletter reads as a mistake rather than as good news.
function prayerBlock(title, items) {
  if (!items.length) return '';
  return heading(title) + bullets(items);
}

function body(b) {
  const parts = [];

  // ── Masthead ──
  parts.push(para(run(b.masthead, { bold: true, italic: true, size: 20, color: 'FFFFFF' }),
    { align: 'center', shade: NAVY, spaceBefore: 0, spaceAfter: 0 }));
  parts.push(para(run(b.sundayLabel, { bold: true, size: 12, color: 'FFFFFF' }),
    { align: 'center', shade: NAVY, spaceBefore: 0, spaceAfter: 120 }));

  // ── Quote ──
  if (b.quote) {
    const text = b.quoteRef ? `“${b.quote}” – ${b.quoteRef}` : `“${b.quote}”`;
    parts.push(para(run(text, { italic: true, size: 10 }), { align: 'center', spaceAfter: 160 }));
  }

  // ── Reminders beside the prayer list ──
  const left = heading('Reminders:') + bullets(b.reminders);

  const right = [
    para(run('Prayer Requests', { bold: true, size: 14, color: NAVY }), { spaceAfter: 60 }),
    prayerBlock('Updates',               b.prayer.updates),
    prayerBlock('Ongoing',               b.prayer.ongoing),
    prayerBlock('Shut-Ins',              b.prayer.shutIns),
    prayerBlock('Pregnancies',           b.prayer.pregnancies),
    prayerBlock('Evangelists We Support', b.prayer.evangelists),
  ].join('');

  parts.push(twoColumn(left, right, 3400));
  parts.push(pageBreak());

  // ── Service times ──
  parts.push(para(run(b.serviceTimes, { bold: true, italic: true, size: 11, color: 'FFFFFF' }),
    { align: 'center', shade: NAVY, spaceAfter: 160 }));

  // ── Last week, dates and groups, beside the leadership ──
  const dataLines = [
    b.lastWeek.sunday    != null ? `Sunday attendance: ${b.lastWeek.sunday}`       : null,
    b.lastWeek.wednesday != null ? `Wednesday attendance: ${b.lastWeek.wednesday}` : null,
    b.lastWeek.offering          ? `Offering: ${b.lastWeek.offering}`              : null,
    b.lastWeek.building          ? `Building progress: ${b.lastWeek.building}`     : null,
  ].filter(Boolean);

  const groupLines = b.groups.flatMap(g => {
    const label = g.leader ? `${g.name} – Leader: ${g.leader}` : g.name;
    const out = [para(run(label, { size: 10 }), { bullet: 0, spaceAfter: 20 })];
    if (g.note) out.push(para(run(g.note, { size: 10, italic: true }), { bullet: 1, spaceAfter: 20 }));
    return out;
  });

  const leftTwo = [
    heading('Last Week’s Data:'), bullets(dataLines),
    heading('Anniversaries:'),    bullets(b.anniversaries),
    heading('Birthdays:'),        bullets(b.birthdays),
    heading('Groups:'),           groupLines.length ? groupLines.join('') : bullets([]),
  ].join('');

  const person = p => para(
    run(p.duties.length ? `${p.name} — ${p.duties.join(', ')}` : p.name, { size: 10 }),
    { bullet: 0, spaceAfter: 20 }
  );

  const rightTwo = [
    heading('Elders'),
    b.elders.length  ? b.elders.map(person).join('')  : bullets([]),
    heading('Deacons / Responsibilities'),
    b.deacons.length ? b.deacons.map(person).join('') : bullets([]),
  ].join('');

  parts.push(twoColumn(leftTwo, rightTwo, 4000));

  // ── Contacts ──
  parts.push(heading('Key Email Contacts:'));
  parts.push(contactsTable(b.emailContacts));
  parts.push(EMPTY);

  // ── Footer ──
  for (const line of b.footer.address) {
    parts.push(para(run(line, { size: 9 }), { align: 'center', spaceAfter: 0 }));
  }
  parts.push(para(run(`${b.footer.phone}  ·  ${b.footer.website}`, { size: 9 }), { align: 'center', spaceAfter: 0 }));
  parts.push(para(run(b.footer.social.map(([k, v]) => `${k}: ${v}`).join('  ·  '), { size: 9, color: '595959' }),
    { align: 'center', spaceAfter: 0 }));

  return parts.join('');
}

// ─── The package ──────────────────────────────────────────────────────────────

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr>
      <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>
      <w:sz w:val="22"/><w:szCs w:val="22"/>
    </w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="252" w:lineRule="auto"/></w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/><w:qFormat/>
  </w:style>
</w:styles>`;

// Two levels of bullet, which is all the draft uses (a group's meeting note
// sits under the group).
const NUMBERING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0">
    <w:multiLevelType w:val="hybridMultilevel"/>
    <w:lvl w:ilvl="0">
      <w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/>
      <w:pPr><w:ind w:left="360" w:hanging="220"/></w:pPr>
      <w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr>
    </w:lvl>
    <w:lvl w:ilvl="1">
      <w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="o"/><w:lvlJc w:val="left"/>
      <w:pPr><w:ind w:left="720" w:hanging="220"/></w:pPr>
      <w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:hint="default"/></w:rPr>
    </w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`;

const SECTION =
  '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
  '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>' +
  '<w:cols w:space="720"/></w:sectPr>';

// A .docx of the composed newsletter, as a Buffer.
async function render(bulletin) {
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body(bulletin)}${SECTION}</w:body></w:document>`;

  const zip = new JSZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.folder('_rels').file('.rels', ROOT_RELS);
  const word = zip.folder('word');
  word.file('document.xml', document);
  word.file('styles.xml', STYLES);
  word.file('numbering.xml', NUMBERING);
  word.folder('_rels').file('document.xml.rels', DOC_RELS);

  return zip.generateAsync({ type: 'nodebuffer' });
}

// 'capshaw-newsletter-2026-05-03.docx'
function filename(bulletin) {
  return `capshaw-newsletter-${bulletin.sunday}.docx`;
}

module.exports = { render, filename, esc, body };
