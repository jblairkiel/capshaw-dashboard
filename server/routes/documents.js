const express = require('express');
const router = express.Router();
const multer = require('multer');
const mammoth = require('mammoth');
const JSZip = require('jszip');
const path = require('path');
const fs = require('fs');
const { requireArea } = require('../middleware/auth');
const actionLog = require('../lib/actionLog');

// The order of service for this Sunday is a document, so uploading, replacing
// and removing it belongs to whoever looks after the worship order. Reading
// is open to everybody signed in, as it always was.
const requireWorshipOrder = requireArea('worship-order');

// ─── Convert docx → HTML, preserving paragraph indentation ───────────────────
// Mammoth strips w:ind (indentation) from paragraphs. We re-read the OOXML to
// get each paragraph's indent value and inject it as padding-left.

async function docxToHtml(filePath) {
  const [mammothResult, buf] = await Promise.all([
    mammoth.convertToHtml({ path: filePath }),
    fs.promises.readFile(filePath),
  ]);

  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('word/document.xml').async('string');

  // One twips value per paragraph (0 = no indent)
  const indents = [...xml.matchAll(/<w:p[\s>][\s\S]*?<\/w:p>/g)].map(m => {
    const firstLine = parseInt((m[0].match(/w:firstLine="(\d+)"/) || [])[1] || 0);
    const left      = parseInt((m[0].match(/w:left="(\d+)"/)      || [])[1] || 0);
    return Math.max(firstLine, left);
  });

  // Walk mammoth's HTML paragraph-by-paragraph and inject padding-left
  let i = 0;
  const html = mammothResult.value.replace(
    /<(p|h[1-6])(\s[^>]*)?>[\s\S]*?<\/\1>/gi,
    match => {
      const twips = indents[i++] || 0;
      if (twips === 0) return match;
      // 1440 twips = 1 inch; target ~2em per inch at standard font size
      const em = ((twips / 1440) * 2).toFixed(2);
      return match.replace(/^<(p|h[1-6])(\s[^>]*)?>/,
        (_, tag, attrs) => `<${tag}${attrs || ''} style="padding-left:${em}em">`
      );
    }
  );

  return { html, warnings: mammothResult.messages };
}

// The order of service. server/uploads by default; a container points this
// at a volume so an upload survives the next deploy.
//
// Exactly one Word document lives here at a time — the most recent upload.
// Nothing here is ever addressed by a client-supplied filename, so there is
// no path to sanitize: the server always reads whatever is actually on disk.
const uploadsDir = require('../lib/paths').uploads;

function currentFilename() {
  const files = fs.readdirSync(uploadsDir).filter(f => /\.(docx|doc)$/i.test(f));
  if (!files.length) return null;
  // Newest by modified time, in case more than one somehow survives — an
  // upload that failed to clear its predecessor, say.
  return files
    .map(f => ({ f, mtime: fs.statSync(path.join(uploadsDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0].f;
}

function displayNameFor(filename) {
  return filename.replace(/^\d+-/, '');
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    // Keep original name, prefix with timestamp so it never collides with
    // whatever it is about to replace.
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${safeName}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
    ];
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.(docx|doc)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Only .docx and .doc files are allowed'));
    }
  },
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
});

// POST /api/documents/upload — replace the order of service
router.post('/upload', requireWorshipOrder, upload.single('document'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No file uploaded' });
  }

  try {
    const { html, warnings } = await docxToHtml(req.file.path);

    // A successful upload is now the order of service — whatever was there
    // before it does not survive alongside it.
    for (const f of fs.readdirSync(uploadsDir)) {
      if (f === req.file.filename) continue;
      try { fs.unlinkSync(path.join(uploadsDir, f)); } catch { /* already gone */ }
    }

    actionLog.record(req.user, {
      area:    'worship-order',
      action:  'create',
      entity:  'order of service',
      entityId: req.file.filename,
      summary: `Uploaded the order of service "${req.file.originalname}"`,
      details: { storedAs: req.file.filename, size: req.file.size },
    });
    res.json({
      success:  true,
      filename: req.file.originalname,
      storedAs: req.file.filename,
      html,
      warnings,
    });
  } catch (err) {
    console.error('Document conversion error:', err.message);
    // Multer already wrote this one to disk before the route ever ran; a
    // file that cannot be read back as a Word document is not a real order
    // of service, and left in place it would be "the newest file here" —
    // exactly what a fresh page load trusts as the current one.
    try { fs.unlinkSync(req.file.path); } catch { /* already gone */ }
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/documents/current — whatever is on file right now, or none
router.get('/current', async (req, res) => {
  const filename = currentFilename();
  if (!filename) return res.json({ success: true, current: null });

  try {
    const { html, warnings } = await docxToHtml(path.join(uploadsDir, filename));
    res.json({
      success: true,
      current: { filename, displayName: displayNameFor(filename), html, warnings },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/documents/current — take down the order of service
router.delete('/current', requireWorshipOrder, (req, res) => {
  const filename = currentFilename();
  if (!filename) return res.status(404).json({ success: false, error: 'Nothing is uploaded' });

  try {
    fs.unlinkSync(path.join(uploadsDir, filename));
    actionLog.record(req.user, {
      area:    'worship-order',
      action:  'delete',
      entity:  'order of service',
      entityId: filename,
      summary: `Deleted the order of service "${displayNameFor(filename)}"`,
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
