// Builds a small but genuine .xlsx in memory, the way Excel lays one out:
// shared strings, a styles part whose cell formats point at fills, a theme,
// and one worksheet part per sheet.
//
//   buildXlsx({ sheets: [{ name, rows: [[cell, …], …], hidden }] })
//
// A cell is a plain value (string or number), null for an empty cell, or
// { v, fill } where fill is { rgb: 'FF00B050' } | { theme: 9, tint: 0.4 } |
// { indexed: 10 }.
const JSZip = require('jszip');
const { columnName } = require('../../lib/xlsxReader');

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const THEME = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme"><a:themeElements>
<a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
<a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>
<a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3>
<a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6>
<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>
</a:themeElements></a:theme>`;

async function buildXlsx({ sheets }) {
  const strings = [];
  const stringIndex = s => {
    let i = strings.indexOf(s);
    if (i === -1) { strings.push(s); i = strings.length - 1; }
    return i;
  };
  // fills 0 and 1 are reserved by Excel (none, gray125); xf 0 is the default.
  const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  const styleFor = new Map();
  const styleOf = fill => {
    if (!fill) return 0;
    const key = JSON.stringify(fill);
    if (!styleFor.has(key)) {
      const colour = Object.entries(fill).map(([k, v]) => `${k}="${v}"`).join(' ');
      fills.push(`<fill><patternFill patternType="solid"><fgColor ${colour}/><bgColor indexed="64"/></patternFill></fill>`);
      xfs.push(`<xf numFmtId="0" fontId="0" fillId="${fills.length - 1}" borderId="0" xfId="0" applyFill="1"/>`);
      styleFor.set(key, xfs.length - 1);
    }
    return styleFor.get(key);
  };

  const zip = new JSZip();
  sheets.forEach((sheet, i) => {
    const rows = sheet.rows.map((row, r) => {
      const cells = row.map((cell, c) => {
        if (cell === null || cell === undefined) return '';
        const { v, fill } = typeof cell === 'object' ? cell : { v: cell };
        const ref = `${columnName(c)}${r + 1}`;
        const s = styleOf(fill);
        const sAttr = s ? ` s="${s}"` : '';
        if (v === undefined || v === null || v === '') return `<c r="${ref}"${sAttr}/>`;
        if (typeof v === 'number') return `<c r="${ref}"${sAttr}><v>${v}</v></c>`;
        return `<c r="${ref}"${sAttr} t="s"><v>${stringIndex(String(v))}</v></c>`;
      }).join('');
      return `<row r="${r + 1}">${cells}</row>`;
    }).join('');
    zip.file(`xl/worksheets/sheet${i + 1}.xml`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`);
  });

  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${
  sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}"${s.hidden ? ' state="hidden"' : ''} r:id="rId${i + 1}"/>`).join('')
}</sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${
  sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
}</Relationships>`);
  zip.file('xl/sharedStrings.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}">${
    strings.map(s => `<si><t>${esc(s)}</t></si>`).join('')}</sst>`);
  zip.file('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fills count="${fills.length}">${fills.join('')}</fills><cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs></styleSheet>`);
  zip.file('xl/theme/theme1.xml', THEME);
  return zip.generateAsync({ type: 'nodebuffer' });
}

module.exports = { buildXlsx };
