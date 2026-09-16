// /api/documents accepts a Word bulletin, converts it to HTML for the site, and
// lists or removes what has been uploaded. The conversion is the interesting
// part: mammoth throws paragraph indentation away, so the route re-reads the
// OOXML and puts it back as padding.
const fs      = require('fs');
const path    = require('path');
const request = require('supertest');
const express = require('express');

const router          = require('../routes/documents');
const { buildDocx }   = require('./helpers/docxFixture');

const uploadsDir = path.join(__dirname, '../uploads');

function buildApp(user = null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/documents', router);
  // multer rejections (wrong file type, oversize) surface as errors
  app.use((err, _req, res, _next) => res.status(400).json({ success: false, error: err.message }));
  return app;
}

const ADMIN  = { id: 1, role: 'admin' };
const MEMBER = { id: 2, role: 'approved' };

// Only ever remove files this run created, so a real uploads directory on a
// developer's machine survives the suite.
const created = new Set();

function track(filename) {
  if (filename) created.add(filename);
  return filename;
}

function writeFixture(filename, buffer) {
  fs.writeFileSync(path.join(uploadsDir, filename), buffer);
  return track(filename);
}

beforeAll(() => fs.mkdirSync(uploadsDir, { recursive: true }));

afterAll(() => {
  for (const f of created) {
    try { fs.unlinkSync(path.join(uploadsDir, f)); } catch { /* already gone */ }
  }
});

// ─── POST /upload ─────────────────────────────────────────────────────────────

describe('POST /api/documents/upload', () => {
  test('401 signed out, 403 for a member — uploads are admin-only', async () => {
    const docx = await buildDocx([{ text: 'Hello' }]);
    for (const [user, status] of [[null, 401], [MEMBER, 403]]) {
      const res = await request(buildApp(user))
        .post('/api/documents/upload')
        .attach('document', docx, 'bulletin.docx');
      expect(res.status).toBe(status);
    }
  });

  test('400 when the request carries no file', async () => {
    const res = await request(buildApp(ADMIN)).post('/api/documents/upload');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('No file uploaded');
  });

  test('converts a document to HTML and reports both names', async () => {
    const docx = await buildDocx([{ text: 'Order of Worship' }, { text: 'Welcome' }]);
    const res = await request(buildApp(ADMIN))
      .post('/api/documents/upload')
      .attach('document', docx, 'bulletin.docx');
    track(res.body.storedAs);

    expect(res.status).toBe(200);
    expect(res.body.filename).toBe('bulletin.docx');
    // Stored under a timestamp prefix so two uploads of one name cannot collide
    expect(res.body.storedAs).toMatch(/^\d+-bulletin\.docx$/);
    expect(res.body.html).toContain('<p>Order of Worship</p>');
    expect(res.body.warnings).toEqual([]);
    expect(fs.existsSync(path.join(uploadsDir, res.body.storedAs))).toBe(true);
  });

  test('restores paragraph indentation that mammoth drops', async () => {
    const docx = await buildDocx([
      { text: 'Flush left' },
      { text: 'One inch in',  left: 1440 },
      { text: 'Half an inch', left: 720 },
    ]);
    const res = await request(buildApp(ADMIN))
      .post('/api/documents/upload')
      .attach('document', docx, 'indents.docx');
    track(res.body.storedAs);

    expect(res.body.html).toContain('<p>Flush left</p>');
    // 1440 twips = 1 inch, rendered as ~2em
    expect(res.body.html).toContain('<p style="padding-left:2.00em">One inch in</p>');
    expect(res.body.html).toContain('<p style="padding-left:1.00em">Half an inch</p>');
  });

  test('uses the larger of a first-line and a left indent', async () => {
    const docx = await buildDocx([{ text: 'Hanging', left: 720, firstLine: 1440 }]);
    const res = await request(buildApp(ADMIN))
      .post('/api/documents/upload')
      .attach('document', docx, 'hanging.docx');
    track(res.body.storedAs);
    expect(res.body.html).toContain('padding-left:2.00em');
  });

  test('sanitises an awkward filename rather than trusting it', async () => {
    const docx = await buildDocx([{ text: 'Hi' }]);
    const res = await request(buildApp(ADMIN))
      .post('/api/documents/upload')
      .attach('document', docx, 'a b/../c&d.docx');
    track(res.body.storedAs);

    expect(res.status).toBe(200);
    expect(res.body.storedAs).toMatch(/^\d+-[a-zA-Z0-9._-]+$/);
    expect(res.body.storedAs).not.toContain('/');
  });

  test('rejects a file that is not a Word document', async () => {
    const res = await request(buildApp(ADMIN))
      .post('/api/documents/upload')
      .attach('document', Buffer.from('id,name\n1,Ray'), {
        filename: 'members.csv', contentType: 'text/csv',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Only \.docx and \.doc/);
  });

  test('500 when the upload is named .docx but is not a Word document', async () => {
    const res = await request(buildApp(ADMIN))
      .post('/api/documents/upload')
      .attach('document', Buffer.from('this is not a zip'), 'broken.docx');
    track((res.body.storedAs) || null);
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    // Clean up whatever multer wrote before the conversion failed
    for (const f of fs.readdirSync(uploadsDir).filter(f => f.endsWith('-broken.docx'))) track(f);
  });
});

// ─── GET / ────────────────────────────────────────────────────────────────────

describe('GET /api/documents', () => {
  test('lists the stored documents with a display name and size', async () => {
    const docx = await buildDocx([{ text: 'Hi' }]);
    const stored = writeFixture(`${Date.now()}-listed-bulletin.docx`, docx);

    const res = await request(buildApp(MEMBER)).get('/api/documents');
    expect(res.status).toBe(200);

    const entry = res.body.files.find(f => f.filename === stored);
    expect(entry).toBeDefined();
    // The timestamp prefix is stripped for display
    expect(entry.displayName).toBe('listed-bulletin.docx');
    expect(entry.size).toBe(docx.length);
    expect(entry.uploadedAt).toBeTruthy();
  });

  test('ignores files that are not Word documents', async () => {
    writeFixture('notes.txt', Buffer.from('just a note'));
    const res = await request(buildApp(MEMBER)).get('/api/documents');
    expect(res.body.files.some(f => f.filename === 'notes.txt')).toBe(false);
  });

  test('returns the newest upload first', async () => {
    const docx = await buildDocx([{ text: 'Hi' }]);
    const older = writeFixture('1000000000000-older.docx', docx);
    const newer = writeFixture('2000000000000-newer.docx', docx);
    // mtime, not the name, decides the order
    fs.utimesSync(path.join(uploadsDir, older), new Date(2020, 0, 1), new Date(2020, 0, 1));
    fs.utimesSync(path.join(uploadsDir, newer), new Date(2025, 0, 1), new Date(2025, 0, 1));

    const names = (await request(buildApp(MEMBER)).get('/api/documents')).body.files
      .map(f => f.filename).filter(n => n === older || n === newer);
    expect(names).toEqual([newer, older]);
  });
});

// ─── GET /:filename ───────────────────────────────────────────────────────────

describe('GET /api/documents/:filename', () => {
  test('converts a stored document on demand', async () => {
    const docx = await buildDocx([{ text: 'Announcements' }, { text: 'Indented', left: 1440 }]);
    const stored = writeFixture(`${Date.now()}-fetch-me.docx`, docx);

    const res = await request(buildApp(MEMBER)).get(`/api/documents/${stored}`);
    expect(res.status).toBe(200);
    expect(res.body.filename).toBe(stored);
    expect(res.body.html).toContain('<p>Announcements</p>');
    expect(res.body.html).toContain('padding-left:2.00em');
  });

  test('404 for a document that is not stored', async () => {
    const res = await request(buildApp(MEMBER)).get('/api/documents/nothing-here.docx');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('File not found');
  });

  test('500 when a stored file cannot be read as a Word document', async () => {
    const stored = writeFixture(`${Date.now()}-corrupt.docx`, Buffer.from('not a zip at all'));
    const res = await request(buildApp(MEMBER)).get(`/api/documents/${stored}`);
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});

// ─── DELETE /:filename ────────────────────────────────────────────────────────

describe('DELETE /api/documents/:filename', () => {
  test('401 signed out, 403 for a member — deleting is admin-only', async () => {
    const docx = await buildDocx([{ text: 'Hi' }]);
    const stored = writeFixture(`${Date.now()}-guarded.docx`, docx);

    for (const [user, status] of [[null, 401], [MEMBER, 403]]) {
      const res = await request(buildApp(user)).delete(`/api/documents/${stored}`);
      expect(res.status).toBe(status);
    }
    expect(fs.existsSync(path.join(uploadsDir, stored))).toBe(true);
  });

  test('an admin removes the file from disk', async () => {
    const docx = await buildDocx([{ text: 'Hi' }]);
    const stored = writeFixture(`${Date.now()}-doomed.docx`, docx);

    const res = await request(buildApp(ADMIN)).delete(`/api/documents/${stored}`);
    expect(res.status).toBe(200);
    expect(fs.existsSync(path.join(uploadsDir, stored))).toBe(false);
  });

  test('404 for a document that is not stored', async () => {
    const res = await request(buildApp(ADMIN)).delete('/api/documents/nothing-here.docx');
    expect(res.status).toBe(404);
  });
});
