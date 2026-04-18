const express = require('express');
const router = express.Router();
const multer = require('multer');
const mammoth = require('mammoth');
const JSZip = require('jszip');
const path = require('path');
const fs = require('fs');

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

const uploadsDir = path.join(__dirname, '../uploads');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    // Keep original name, prefix with timestamp to avoid collisions
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

// POST /api/documents/upload — upload a Word doc and return HTML
router.post('/upload', upload.single('document'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No file uploaded' });
  }

  try {
    const { html, warnings } = await docxToHtml(req.file.path);
    res.json({
      success: true,
      filename: req.file.originalname,
      storedAs: req.file.filename,
      html,
      warnings,
    });
  } catch (err) {
    console.error('Document conversion error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/documents — list uploaded documents
router.get('/', (req, res) => {
  try {
    const files = fs.readdirSync(uploadsDir)
      .filter((f) => f.match(/\.(docx|doc)$/i))
      .map((f) => {
        const stats = fs.statSync(path.join(uploadsDir, f));
        // Strip the timestamp prefix for display
        const displayName = f.replace(/^\d+-/, '');
        return {
          filename: f,
          displayName,
          size: stats.size,
          uploadedAt: stats.mtime,
        };
      })
      .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

    res.json({ success: true, files });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/documents/:filename — convert and return HTML for a stored doc
router.get('/:filename', async (req, res) => {
  const filePath = path.join(uploadsDir, req.params.filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, error: 'File not found' });
  }

  try {
    const { html, warnings } = await docxToHtml(filePath);
    res.json({
      success: true,
      filename: req.params.filename,
      html,
      warnings,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/documents/:filename
router.delete('/:filename', (req, res) => {
  const filePath = path.join(uploadsDir, req.params.filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, error: 'File not found' });
  }

  try {
    fs.unlinkSync(filePath);
    res.json({ success: true, message: 'File deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
