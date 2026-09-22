// Screenshots attached to bug reports, kept as files beside the database —
// the same reasoning as server/lib/photoStore.js, and mostly the same code.
//
// Deliberately its own module rather than a shared one: photoStore's directory
// is pruned against the directory (server/lib/directorySync.js deletes any
// photo no living person references), and a screenshot dropped into that same
// directory would be unreferenced by every one of those checks and would not
// survive the next sync.

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const SCREENSHOT_DIR = require('./paths').screenshots;

// Only ever screenshots — a phone's photo library, not arbitrary uploads.
const MAGIC = [
  { ext: 'jpg',  test: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png',  test: b => b.slice(0, 8).toString('hex') === '89504e470d0a1a0a' },
  { ext: 'gif',  test: b => b.slice(0, 3).toString('ascii') === 'GIF' },
  { ext: 'webp', test: b => b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP' },
];

const CONTENT_TYPE = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };

function sniffExtension(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  return MAGIC.find(m => m.test(buffer))?.ext ?? null;
}

function isSafeFilename(name) {
  return typeof name === 'string' && /^[A-Za-z0-9_-]+\.(jpg|png|gif|webp)$/.test(name);
}

function screenshotPath(filename) {
  if (!isSafeFilename(filename)) return null;
  return path.join(SCREENSHOT_DIR, filename);
}

function contentTypeFor(filename) {
  const ext = String(filename || '').split('.').pop();
  return CONTENT_TYPE[ext] || 'application/octet-stream';
}

function exists(filename) {
  const p = screenshotPath(filename);
  return !!p && fs.existsSync(p);
}

// Writes one screenshot and returns its filename, or null if the upload is not
// a readable image. Named by content hash, so re-submitting the exact same
// image (easy to do by mistake, attaching from a clipboard) is a no-op.
function save(buffer, maxBytes = 5 * 1024 * 1024) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > maxBytes) return null;

  const ext = sniffExtension(buffer);
  if (!ext) return null;

  const filename = `${crypto.createHash('sha1').update(buffer).digest('hex')}.${ext}`;
  const target   = path.join(SCREENSHOT_DIR, filename);

  if (!fs.existsSync(target)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    fs.writeFileSync(target, buffer);
  }
  return filename;
}

function remove(filename) {
  const p = screenshotPath(filename);
  if (p && fs.existsSync(p)) fs.unlinkSync(p);
}

module.exports = { SCREENSHOT_DIR, screenshotPath, contentTypeFor, exists, save, remove };
