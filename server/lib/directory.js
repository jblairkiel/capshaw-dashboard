const fs   = require('fs');
const path = require('path');
const { fetchPage, fetchBinary } = require('./capshawClient');
const { parseDirectory, parseDirectoryFamilies } = require('./parsers');

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

async function listFamilies() {
  const page = await fetchPage('/members/directory');
  if (page.url.includes('login')) throw new Error('Session expired or login failed — check credentials in .env');
  if (page.status !== 200) throw new Error(`/members/directory returned ${page.status}`);
  return parseDirectoryFamilies(page.body);
}

/**
 * Download every family photo from the member directory into server/data/photos.
 * Photos whose `?h=` version already matches the manifest are skipped unless
 * `force` is set. Returns per-family results plus a summary.
 */
async function syncDirectoryPhotos({ size = 'full', force = false, concurrency = 4, limit = 0 } = {}) {
  fs.mkdirSync(PHOTO_DIR, { recursive: true });

  const manifest = readManifest();
  const all      = await listFamilies();
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


/**
 * Scrape the directory as the church site structures it: one record per family,
 * with members attached. Replaces address-based grouping — the global vCard
 * export silently omits members that the per-family exports include.
 *
 * Costs one request for the family list plus one per family, so it is meant for
 * the scheduled scrape rather than per-page-load.
 */
async function scrapeDirectory({ photos = true, concurrency = 5 } = {}) {
  const listed   = await listFamilies();
  const warnings = [];

  // Photo files are downloaded first so each family can carry its filename.
  let photoSummary = null;
  if (photos) {
    try {
      ({ summary: photoSummary } = await syncDirectoryPhotos({ concurrency }));
    } catch (e) {
      warnings.push(`directory photos: ${e.message}`);
    }
  }
  const manifest = readManifest();

  const families = [];
  const members  = [];

  await mapLimit(listed, concurrency, async fam => {
    let famMembers = [];
    try {
      const res = await fetchPage(`/members/directory/vcard/${fam.familyId}`);
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      famMembers = parseDirectory(res.body);
    } catch (e) {
      warnings.push(`family ${fam.familyId} (${fam.familyName}): ${e.message}`);
      return;
    }

    if (famMembers.length === 0) {
      warnings.push(`family ${fam.familyId} (${fam.familyName}): no members in vCard`);
      return;
    }

    // Members of a family share a mailing address; take it from the first.
    const [first] = famMembers;
    const entry   = manifest.families[fam.familyId];

    families.push({
      id:           Number(fam.familyId),
      name:         fam.familyName,
      address:      first.address || '',
      city:         first.city    || '',
      state:        first.state   || '',
      zip:          first.zip     || '',
      photoFile:    fam.hasPhoto && entry ? entry.file : '',
      photoVersion: fam.hasPhoto && entry ? entry.version : '',
    });

    for (const m of famMembers) members.push({ ...m, familyId: Number(fam.familyId) });
  });

  families.sort((a, b) => a.name.localeCompare(b.name));
  members.sort((a, b) => a.name.localeCompare(b.name));

  return {
    families,
    members,
    warnings,
    summary: {
      families:     families.length,
      members:      members.length,
      listed:       listed.length,
      withPhoto:    families.filter(f => f.photoFile).length,
      photos:       photoSummary,
    },
  };
}

module.exports = { PHOTO_DIR, MANIFEST, sniffExt, readManifest, listFamilies, syncDirectoryPhotos, scrapeDirectory };
