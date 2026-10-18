// Writes a small Excel workbook (.xlsx): text and number cells, a few cell
// styles, column widths and a frozen header row. Enough for a template
// somebody downloads, fills in and uploads again — not a general spreadsheet
// library. The reading half is ./xlsxReader.js; both use jszip, which the
// project already has, rather than adding a dependency.
//
//   writeWorkbook({ sheets: [{ name, columns: [width, …], freeze: true,
//                              rows: [[cell, …], …] }] })  → Promise<Buffer>
//
// A cell is a plain value (string or number), null for an empty cell, or
// { v, style } where style is one of the names in STYLES below.

const JSZip = require('jszip');
const { columnName } = require('./xlsxReader');

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Fonts, fills and the cell formats built from them. Index 0 of each is the
// default Excel expects; fill 1 is the gray125 Excel reserves.
const FONTS = [
  '<font><sz val="11"/><name val="Calibri"/></font>',
  '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>',   // 1 header
  '<font><b/><sz val="14"/><color rgb="FF1A2744"/><name val="Calibri"/></font>',   // 2 title
  '<font><i/><sz val="10"/><color rgb="FF6B7280"/><name val="Calibri"/></font>',   // 3 note
  '<font><b/><sz val="11"/><name val="Calibri"/></font>',                          // 4 bold
];
const FILLS = [
  '<fill><patternFill patternType="none"/></fill>',
  '<fill><patternFill patternType="gray125"/></fill>',
  '<fill><patternFill patternType="solid"><fgColor rgb="FF1A2744"/><bgColor indexed="64"/></patternFill></fill>',  // 2 navy
  '<fill><patternFill patternType="solid"><fgColor rgb="FFF8F5EE"/><bgColor indexed="64"/></patternFill></fill>',  // 3 cream
];
const STYLES = {
  plain:  { font: 0, fill: 0, wrap: true },
  header: { font: 1, fill: 2 },
  title:  { font: 2, fill: 0 },
  note:   { font: 3, fill: 0, wrap: true },
  bold:   { font: 4, fill: 0, wrap: true },
  shaded: { font: 0, fill: 3, wrap: true },
  shadedBold: { font: 4, fill: 3, wrap: true },
};
const STYLE_INDEX = Object.fromEntries(Object.keys(STYLES).map((name, i) => [name, i + 1]));
const XFS = [
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>',
  ...Object.values(STYLES).map(s =>
    `<xf numFmtId="0" fontId="${s.font}" fillId="${s.fill}" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1">` +
    `<alignment vertical="top"${s.wrap ? ' wrapText="1"' : ''}/></xf>`),
];

function styles() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<fonts count="${FONTS.length}">${FONTS.join('')}</fonts>` +
    `<fills count="${FILLS.length}">${FILLS.join('')}</fills>` +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    `<cellXfs count="${XFS.length}">${XFS.join('')}</cellXfs>` +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';
}

function sheetXml(sheet, stringIndex) {
  const rows = sheet.rows.map((row, r) => {
    const cells = row.map((cell, c) => {
      if (cell === null || cell === undefined) return '';
      const { v, style } = typeof cell === 'object' ? cell : { v: cell };
      const ref = `${columnName(c)}${r + 1}`;
      const s = style ? ` s="${STYLE_INDEX[style] || 0}"` : '';
      if (v === undefined || v === null || v === '') return `<c r="${ref}"${s}/>`;
      if (typeof v === 'number') return `<c r="${ref}"${s}><v>${v}</v></c>`;
      return `<c r="${ref}"${s} t="s"><v>${stringIndex(String(v))}</v></c>`;
    }).join('');
    return `<row r="${r + 1}">${cells}</row>`;
  }).join('');

  const view = sheet.freeze
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
  const cols = sheet.columns?.length
    ? `<cols>${sheet.columns.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    : '';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `${view}${cols}<sheetData>${rows}</sheetData></worksheet>`;
}

async function writeWorkbook({ sheets }) {
  const strings = [];
  const index = new Map();
  const stringIndex = s => {
    if (!index.has(s)) { index.set(s, strings.length); strings.push(s); }
    return index.get(s);
  };

  const zip = new JSZip();
  sheets.forEach((sheet, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sheet, stringIndex)));

  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
    '</Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>');
  zip.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
    sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
    '</sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
    `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `<Relationship Id="rId${sheets.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>` +
    '</Relationships>');
  zip.file('xl/styles.xml', styles());
  zip.file('xl/sharedStrings.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">` +
    strings.map(s => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('') + '</sst>');

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = { writeWorkbook };
