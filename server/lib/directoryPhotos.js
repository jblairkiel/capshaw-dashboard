// Where directory photos actually come from.
//
// The vCard export carries no PHOTO property — not the global one, not the
// per-family ones — so photos have to be taken from the directory pages
// instead. They are published one per family, at
// /media/uploads/photos/families/{id}.jpg, and those URLs 302 to a signed
// cdn.congregatecloud.com link that expires, so a photo must be downloaded and
// stored rather than linked to.
//
// Members are read from the per-family vCard rather than the global export,
// which is what ties a person to their family's photo. It is also the more
// complete list: the global export leaves people out.

const { fetchPage, fetchBinary } = require('./capshawClient');
const { parseDirectory, parseDirectoryFamilies } = require('./parsers');
const { savePhoto: defaultSavePhoto, exists: photoExists } = require('./photoStore');

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

/**
 * Scrape the directory family by family, downloading each family's photo into
 * the photo store and handing back a flat list of people, each carrying the
 * filename of their family portrait.
 *
 * Photos are saved here rather than passed along as bytes: the scrape result is
 * cached to members.json, and a congregation of portraits does not belong in a
 * JSON file.
 */
async function scrapeDirectory({ concurrency = 5, savePhoto = defaultSavePhoto, known = new Map() } = {}) {
  const listing = await fetchPage('/members/directory');
  if (listing.url?.includes('login')) throw new Error('Session expired or login failed — check credentials in .env');
  if (listing.status !== 200) throw new Error(`/members/directory returned ${listing.status}`);

  const families = parseDirectoryFamilies(listing.body);
  if (families.length === 0) throw new Error('no families found on /members/directory');

  const warnings = [];
  const summary  = { families: families.length, people: 0, photos: 0, photosReused: 0, noPhoto: 0, photoErrors: 0 };

  const perFamily = await mapLimit(families, concurrency, async family => {
    let people = [];
    try {
      const res = await fetchPage(`/members/directory/vcard/${family.familyId}`);
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      people = parseDirectory(res.body);
    } catch (e) {
      warnings.push(`family ${family.familyId} (${family.familyName}): ${e.message}`);
      return [];
    }
    if (people.length === 0) {
      warnings.push(`family ${family.familyId} (${family.familyName}): no members in vCard`);
      return [];
    }

    // The site stamps a photo's URL with a version that changes when it is
    // replaced, so an unchanged photo needs no download at all.
    let photoFile = null;
    if (!family.hasPhoto) {
      summary.noPhoto++;
    } else if (savePhoto) {
      // Reuse the stored photo only if the site's version is unchanged AND the
      // file is really still there. Trusting the record alone is how a missing
      // file becomes permanent: every later scrape calls it unchanged and never
      // downloads it again.
      const cached = known.get(family.familyId);
      if (cached?.file && cached.version === family.version && photoExists(cached.file)) {
        photoFile = cached.file;
        summary.photosReused++;
      } else {
        try {
          const res = await fetchBinary(family.fullUrl);
          if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
          photoFile = savePhoto({ buffer: res.body });
          if (!photoFile) throw new Error('response was not an image we can store');
          summary.photos++;
        } catch (e) {
          summary.photoErrors++;
          warnings.push(`family ${family.familyId} photo: ${e.message}`);
        }
      }
    }

    return people.map(person => ({
      ...person,
      familyId:   family.familyId,
      familyName: family.familyName,
      photo:      photoFile ? { file: photoFile, version: family.version } : null,
    }));
  });

  const people = perFamily.flat();
  summary.people = people.length;
  return { people, families, warnings, summary };
}

module.exports = { scrapeDirectory, mapLimit };
