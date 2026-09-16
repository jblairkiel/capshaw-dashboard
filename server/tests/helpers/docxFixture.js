// Builds the smallest thing mammoth will accept as a Word document, so the
// document routes can be tested against real .docx bytes rather than a stub.
//
// Each paragraph may carry an indent in twips (1440 = one inch), which is the
// detail server/routes/documents.js re-reads from the OOXML — mammoth drops it.
const JSZip = require('jszip');

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

// paragraphs: [{ text, left, firstLine }]
function buildDocx(paragraphs) {
  const body = paragraphs.map(p => {
    const ind = [
      p.left      != null ? `w:left="${p.left}"`           : '',
      p.firstLine != null ? `w:firstLine="${p.firstLine}"` : '',
    ].filter(Boolean).join(' ');
    const pPr = ind ? `<w:pPr><w:ind ${ind}/></w:pPr>` : '';
    return `<w:p>${pPr}<w:r><w:t>${p.text}</w:t></w:r></w:p>`;
  }).join('');

  const zip = new JSZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.folder('_rels').file('.rels', ROOT_RELS);
  zip.folder('word').file('document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);

  return zip.generateAsync({ type: 'nodebuffer' });
}

module.exports = { buildDocx };
