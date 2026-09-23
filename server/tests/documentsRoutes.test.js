// /api/documents accepts a Word bulletin, converts it to HTML for the site,
// and holds exactly one at a time — the most recent upload replaces whatever
// was there before. The conversion is the interesting part: mammoth throws
// paragraph indentation away, so the route re-reads the OOXML and puts it
// back as padding.
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

beforeAll(() => fs.mkdirSync(uploadsDir, { recursive: true }));

// Every test starts from an empty uploads directory: whatever a previous
// test left behind (a stray fixture, a failed upload's partial write) would
// otherwise leak into "there is only one document" assertions.
beforeEach(() => {
  for (const f of fs.readdirSync(uploadsDir)) fs.unlinkSync(path.join(uploadsDir, f));
});

afterAll(() => {
  for (const f of fs.readdirSync(uploadsDir)) fs.unlinkSync(path.join(uploadsDir, f));
});

function writeFixture(filename, buffer) {
  fs.writeFileSync(path.join(uploadsDir, filename), buffer);
  return filename;
}

// ─── POST /upload ─────────────────────────────────────────────────────────────

describe('POST /api/documents/upload', () => {
  test('401 signed out, 403 for a member — uploading is worship-order only', async () => {
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

    expect(res.status).toBe(200);
    expect(res.body.filename).toBe('bulletin.docx');
    // Stored under a timestamp prefix so a same-named re-upload cannot collide
    // with itself on disk for the moment before the old one is removed.
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
    expect(res.body.html).toContain('padding-left:2.00em');
  });

  test('sanitises an awkward filename rather than trusting it', async () => {
    const docx = await buildDocx([{ text: 'Hi' }]);
    const res = await request(buildApp(ADMIN))
      .post('/api/documents/upload')
      .attach('document', docx, 'a b/../c&d.docx');

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
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });

  test('a new upload replaces whatever was there before', async () => {
    const first  = await buildDocx([{ text: 'First bulletin' }]);
    const second = await buildDocx([{ text: 'Second bulletin' }]);

    const res1 = await request(buildApp(ADMIN))
      .post('/api/documents/upload').attach('document', first, 'first.docx');
    expect(fs.existsSync(path.join(uploadsDir, res1.body.storedAs))).toBe(true);

    const res2 = await request(buildApp(ADMIN))
      .post('/api/documents/upload').attach('document', second, 'second.docx');

    // The first upload is gone; only the second is left on disk.
    expect(fs.existsSync(path.join(uploadsDir, res1.body.storedAs))).toBe(false);
    expect(fs.existsSync(path.join(uploadsDir, res2.body.storedAs))).toBe(true);
    expect(fs.readdirSync(uploadsDir)).toEqual([res2.body.storedAs]);
  });

  test('an upload that fails to convert leaves the previous one in place', async () => {
    const good = await buildDocx([{ text: 'Still here' }]);
    await request(buildApp(ADMIN)).post('/api/documents/upload').attach('document', good, 'good.docx');

    const res = await request(buildApp(ADMIN))
      .post('/api/documents/upload')
      .attach('document', Buffer.from('not a zip at all'), 'broken.docx');
    expect(res.status).toBe(500);

    const current = await request(buildApp(MEMBER)).get('/api/documents/current');
    expect(current.body.current.html).toContain('Still here');
  });
});

// ─── GET /current ─────────────────────────────────────────────────────────────

describe('GET /api/documents/current', () => {
  test('null when nothing has been uploaded', async () => {
    const res = await request(buildApp(MEMBER)).get('/api/documents/current');
    expect(res.status).toBe(200);
    expect(res.body.current).toBeNull();
  });

  test('anybody signed in can read it, converted to HTML', async () => {
    const docx = await buildDocx([{ text: 'Announcements' }, { text: 'Indented', left: 1440 }]);
    writeFixture(`${Date.now()}-fetch-me.docx`, docx);

    const res = await request(buildApp(MEMBER)).get('/api/documents/current');
    expect(res.status).toBe(200);
    expect(res.body.current.displayName).toBe('fetch-me.docx');
    expect(res.body.current.html).toContain('<p>Announcements</p>');
    expect(res.body.current.html).toContain('padding-left:2.00em');
  });

  test('500 when the stored file cannot be read as a Word document', async () => {
    writeFixture(`${Date.now()}-corrupt.docx`, Buffer.from('not a zip at all'));
    const res = await request(buildApp(MEMBER)).get('/api/documents/current');
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});

// ─── DELETE /current ──────────────────────────────────────────────────────────

describe('DELETE /api/documents/current', () => {
  test('401 signed out, 403 for a member — removing is worship-order only', async () => {
    const docx = await buildDocx([{ text: 'Hi' }]);
    writeFixture(`${Date.now()}-guarded.docx`, docx);

    for (const [user, status] of [[null, 401], [MEMBER, 403]]) {
      const res = await request(buildApp(user)).delete('/api/documents/current');
      expect(res.status).toBe(status);
    }
    expect(fs.readdirSync(uploadsDir)).toHaveLength(1);
  });

  test('removes the file from disk', async () => {
    const docx = await buildDocx([{ text: 'Hi' }]);
    writeFixture(`${Date.now()}-doomed.docx`, docx);

    const res = await request(buildApp(ADMIN)).delete('/api/documents/current');
    expect(res.status).toBe(200);
    expect(fs.readdirSync(uploadsDir)).toHaveLength(0);

    const current = await request(buildApp(MEMBER)).get('/api/documents/current');
    expect(current.body.current).toBeNull();
  });

  test('404 when there is nothing to remove', async () => {
    const res = await request(buildApp(ADMIN)).delete('/api/documents/current');
    expect(res.status).toBe(404);
  });
});
