// Photos are kept as files beside the database rather than inside it: a
// congregation's worth of base64 portraits would bloat every directory query,
// and files can be served with normal caching headers.

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const PHOTO_DIR = path.join(__dirname, '../data/photos');

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

// Writes a photo for one person and returns its filename, or null if the photo
// is unusable. Named by content hash so an unchanged photo is a no-op and two
// people sharing a family portrait share one file.
function savePhoto({ base64, mime }, maxBytes = 5 * 1024 * 1024) {
  const ext = extensionFor(mime);
  if (!base64 || !ext) return null;

  let buffer;
  try {
    buffer = Buffer.from(base64, 'base64');
  } catch {
    return null;
  }
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

module.exports = { PHOTO_DIR, EXTENSIONS, extensionFor, isSafeFilename, photoPath, exists, savePhoto, pruneUnreferenced };
