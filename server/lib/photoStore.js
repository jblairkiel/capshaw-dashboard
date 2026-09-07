// Photos are kept as files beside the database rather than inside it: a
// congregation's worth of base64 portraits would bloat every directory query,
// and files can be served with normal caching headers.

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

// Redirectable so a test run can never reach the real photo library: syncing a
// fixture database prunes against whatever this points at.
const PHOTO_DIR = process.env.CAPSHAW_PHOTO_DIR || path.join(__dirname, '../data/photos');

const EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/jpg':  'jpg',
  'image/png':  'png',
  'image/gif':  'gif',
  'image/webp': 'webp',
};

// Refuse anything that is not an image we are prepared to serve back.
function extensionFor(mime) {
  return EXTENSIONS[(mime || '').toLowerCase()] ?? null;
}

// A stored photo is addressed by a plain filename. Reject anything that could
// escape the photo directory before it reaches the filesystem.
function isSafeFilename(name) {
  return typeof name === 'string' && /^[A-Za-z0-9_-]+\.(jpg|png|gif|webp)$/.test(name);
}

function photoPath(filename) {
  if (!isSafeFilename(filename)) return null;
  return path.join(PHOTO_DIR, filename);
}

function exists(filename) {
  const p = photoPath(filename);
  return !!p && fs.existsSync(p);
}

// The site labels every photo .jpg and serves it as image/jpeg regardless of
// what it really is — family thumbnails are routinely PNG — so the bytes are
// the only trustworthy source of the type.
const MAGIC = [
  { ext: 'jpg',  test: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png',  test: b => b.slice(0, 8).toString('hex') === '89504e470d0a1a0a' },
  { ext: 'gif',  test: b => b.slice(0, 3).toString('ascii') === 'GIF' },
  { ext: 'webp', test: b => b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP' },
];

function sniffExtension(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  return MAGIC.find(m => m.test(buffer))?.ext ?? null;
}

// Writes a photo for one person and returns its filename, or null if the photo
// is unusable. Named by content hash so an unchanged photo is a no-op and two
// people sharing a family portrait share one file.
//
// Accepts a photo either as base64 with a declared mime (the vCard form), or
// as raw bytes, in which case the type is read from the bytes themselves.
function savePhoto({ base64, mime, buffer: rawBuffer }, maxBytes = 5 * 1024 * 1024) {
  let buffer = rawBuffer;
  let ext;

  if (buffer) {
    ext = sniffExtension(buffer);
  } else {
    ext = extensionFor(mime);
    if (!base64 || !ext) return null;
    try {
      buffer = Buffer.from(base64, 'base64');
    } catch {
      return null;
    }
    // A declared mime can lie; prefer what the bytes say when they are clear.
    ext = sniffExtension(buffer) ?? ext;
  }

  if (!ext) return null;
  if (!buffer.length || buffer.length > maxBytes) return null;

  const filename = `${crypto.createHash('sha1').update(buffer).digest('hex')}.${ext}`;
  const target   = path.join(PHOTO_DIR, filename);

  if (!fs.existsSync(target)) {
    fs.mkdirSync(PHOTO_DIR, { recursive: true });
    fs.writeFileSync(target, buffer);
  }
  return filename;
}

// Deletes stored photos nothing references any more.
function pruneUnreferenced(referenced) {
  let removed = 0;
  if (!fs.existsSync(PHOTO_DIR)) return removed;
  const keep = new Set(referenced.filter(Boolean));
  for (const name of fs.readdirSync(PHOTO_DIR)) {
    if (keep.has(name)) continue;
    try { fs.unlinkSync(path.join(PHOTO_DIR, name)); removed++; } catch { /* ignore */ }
  }
  return removed;
}

module.exports = { PHOTO_DIR, EXTENSIONS, extensionFor, sniffExtension, isSafeFilename, photoPath, exists, savePhoto, pruneUnreferenced };
