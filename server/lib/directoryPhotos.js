const fs   = require('fs');
const path = require('path');
const { fetchPage, fetchBinary } = require('./capshawClient');
const { parseDirectoryPhotos } = require('./parsers');

const PHOTO_DIR = path.join(__dirname, '../data/photos');
const MANIFEST  = path.join(PHOTO_DIR, 'manifest.json');

// The site serves every family photo as .jpg regardless of the real encoding
// (thumbnails are frequently PNG), so sniff the bytes instead of trusting the
// extension or Content-Type.
function sniffExt(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.slice(0, 8).toString('hex') === '89504e470d0a1a0a')  return 'png';
  if (buf.slice(0, 3).toString('ascii') === 'GIF')             return 'gif';
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' &&
      buf.slice(8, 12).toString('ascii') === 'WEBP')           return 'webp';
  return null;
}

function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  } catch {
    return { lastUpdated: null, families: {} };
  }
}

function writeManifest(manifest) {
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
}

// Run `worker` over `items` with at most `limit` in flight.
async function mapLimit(items, limit, worker) {
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }));
  return results;
}

async function listFamilyPhotos() {
  const page = await fetchPage('/members/directory');
  if (page.url.includes('login')) throw new Error('Session expired or login failed — check credentials in .env');
  if (page.status !== 200) throw new Error(`/members/directory returned ${page.status}`);
  return parseDirectoryPhotos(page.body);
}

/**
 * Download every family photo from the member directory into server/data/photos.
 * Photos whose `?h=` version already matches the manifest are skipped unless
 * `force` is set. Returns per-family results plus a summary.
 */
async function syncDirectoryPhotos({ size = 'full', force = false, concurrency = 4, limit = 0 } = {}) {
  fs.mkdirSync(PHOTO_DIR, { recursive: true });

  const manifest = readManifest();
  const all      = await listFamilyPhotos();
  const withPhoto = all.filter(f => f.hasPhoto);
  const targets   = limit > 0 ? withPhoto.slice(0, limit) : withPhoto;

  const results = await mapLimit(targets, concurrency, async fam => {
    const prev = manifest.families[fam.familyId];
    const base = `family-${fam.familyId}`;

    if (!force && prev && prev.version === fam.version && prev.size === size &&
        fs.existsSync(path.join(PHOTO_DIR, prev.file))) {
      return { ...fam, status: 'skipped', file: prev.file, bytes: prev.bytes };
    }

    const url = size === 'thumb' ? fam.thumbUrl : fam.fullUrl;
    try {
      const res = await fetchBinary(url);
      if (res.status !== 200) return { ...fam, status: 'error', error: `HTTP ${res.status}` };

      const ext = sniffExt(res.body);
      if (!ext) return { ...fam, status: 'error', error: 'response was not an image' };

      // Drop any prior file for this family whose extension changed.
      if (prev && prev.file && prev.file !== `${base}.${ext}`) {
        fs.rmSync(path.join(PHOTO_DIR, prev.file), { force: true });
      }

      const file = `${base}.${ext}`;
      fs.writeFileSync(path.join(PHOTO_DIR, file), res.body);

      manifest.families[fam.familyId] = {
        familyName: fam.familyName,
        file,
        size,
        version:    fam.version,
        bytes:      res.body.length,
        sourceUrl:  url,
        fetchedAt:  new Date().toISOString(),
      };
      return { ...fam, status: 'downloaded', file, bytes: res.body.length };
    } catch (e) {
      return { ...fam, status: 'error', error: e.message };
    }
  });

  manifest.lastUpdated = new Date().toISOString();
  writeManifest(manifest);

  const count = s => results.filter(r => r.status === s).length;
  return {
    results,
    summary: {
      families:    all.length,
      withPhoto:   withPhoto.length,
      noPhoto:     all.length - withPhoto.length,
      attempted:   targets.length,
      downloaded:  count('downloaded'),
      skipped:     count('skipped'),
      errors:      count('error'),
      lastUpdated: manifest.lastUpdated,
    },
  };
}

module.exports = { PHOTO_DIR, MANIFEST, sniffExt, readManifest, listFamilyPhotos, syncDirectoryPhotos };
