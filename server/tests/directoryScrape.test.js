// scrapeDirectory walks the directory family by family: read the listing, pull
// each family's vCard for its members, and download the family portrait unless
// the copy already stored is still current. The HTTP layer and the photo store
// are both mocked, so what is under test is the walk itself — which families
// are visited, which photos are downloaded, and what ends up in the warnings.
jest.mock('../lib/capshawClient', () => ({ fetchPage: jest.fn(), fetchBinary: jest.fn() }));
jest.mock('../lib/photoStore', () => ({ savePhoto: jest.fn(), exists: jest.fn(() => true) }));

const { fetchPage, fetchBinary }     = require('../lib/capshawClient');
const photoStore                     = require('../lib/photoStore');
const { scrapeDirectory, mapLimit }  = require('../lib/directoryPhotos');

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const familyCard = ({ id, name, photo = true, version = 'v1' }) => `
  <a class="c-card" href="/members/directory/family/${id}">
    <img src="/media/uploads/photos/families/thumbs/${photo ? `${id}.jpg?h=${version}` : 'no-image.png'}">
    <h2 class="c-title">${name}</h2>
  </a>`;

const listing = (...cards) => ({ status: 200, url: '/members/directory', body: cards.join('\n') });

const vcard = (...names) => ({
  status: 200,
  body: names.map(n => `BEGIN:VCARD\nVERSION:3.0\nFN:${n}\nEMAIL:${n.split(' ')[0].toLowerCase()}@example.com\nEND:VCARD`).join('\n'),
});

// Routes fetchPage by path so a test can describe the whole site at once.
function servePages(map) {
  fetchPage.mockImplementation(async path => {
    const hit = Object.entries(map).find(([p]) => path === p);
    if (!hit) throw new Error(`unexpected page fetch: ${path}`);
    const out = typeof hit[1] === 'function' ? hit[1]() : hit[1];
    if (out instanceof Error) throw out;
    return out;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  photoStore.exists.mockReturnValue(true);
  photoStore.savePhoto.mockImplementation(() => 'saved.jpg');
  fetchBinary.mockResolvedValue({ status: 200, body: Buffer.from('jpeg-bytes') });
});

// ─── mapLimit ─────────────────────────────────────────────────────────────────

describe('mapLimit', () => {
  test('keeps results in input order however they finish', async () => {
    const out = await mapLimit([30, 10, 20], 3, async ms => {
      await new Promise(r => setTimeout(r, ms / 10));
      return ms;
    });
    expect(out).toEqual([30, 10, 20]);
  });

  test('never runs more than the limit at once', async () => {
    let inFlight = 0, peak = 0;
    await mapLimit([1, 2, 3, 4, 5, 6], 2, async () => {
      peak = Math.max(peak, ++inFlight);
      await new Promise(r => setTimeout(r, 1));
      inFlight--;
    });
    expect(peak).toBe(2);
  });

  test('an empty list starts no workers at all', async () => {
    const worker = jest.fn();
    expect(await mapLimit([], 5, worker)).toEqual([]);
    expect(worker).not.toHaveBeenCalled();
  });

  test('a limit larger than the list is harmless', async () => {
    expect(await mapLimit([1, 2], 10, async n => n * 2)).toEqual([2, 4]);
  });

  test('passes each item its index', async () => {
    expect(await mapLimit(['a', 'b'], 1, async (item, i) => `${i}:${item}`)).toEqual(['0:a', '1:b']);
  });
});

// ─── scrapeDirectory: the listing page ────────────────────────────────────────

describe('scrapeDirectory — reaching the directory', () => {
  test('throws when the session has lapsed and the site redirects to login', async () => {
    servePages({ '/members/directory': { status: 200, url: 'https://capshawchurch.org/members/login', body: '' } });
    await expect(scrapeDirectory()).rejects.toThrow(/Session expired or login failed/);
  });

  test('throws on a non-200 listing, naming the status', async () => {
    servePages({ '/members/directory': { status: 503, url: '/members/directory', body: '' } });
    await expect(scrapeDirectory()).rejects.toThrow('/members/directory returned 503');
  });

  test('throws rather than reporting an empty congregation when no families parse', async () => {
    servePages({ '/members/directory': listing('<div>the page changed shape</div>') });
    await expect(scrapeDirectory()).rejects.toThrow('no families found');
  });
});

// ─── scrapeDirectory: people ──────────────────────────────────────────────────

describe('scrapeDirectory — people', () => {
  test('returns everyone, tagged with their family and portrait', async () => {
    servePages({
      '/members/directory':              listing(familyCard({ id: '1', name: 'The Harris Family' })),
      '/members/directory/vcard/1':      vcard('Ray Harris', 'Jo Harris'),
    });

    const { people, families, summary, warnings } = await scrapeDirectory();

    expect(warnings).toEqual([]);
    expect(families).toHaveLength(1);
    expect(people).toHaveLength(2);
    expect(people[0]).toMatchObject({
      name: 'Ray Harris', familyId: '1', familyName: 'The Harris Family',
      photo: { file: 'saved.jpg', version: 'v1' },
    });
    expect(summary).toMatchObject({ families: 1, people: 2, photos: 1, photosReused: 0, noPhoto: 0, photoErrors: 0 });
  });

  test('a family whose vCard fails is warned about, and the rest still come back', async () => {
    servePages({
      '/members/directory':         listing(familyCard({ id: '1', name: 'Harris' }), familyCard({ id: '2', name: 'Nelson' })),
      '/members/directory/vcard/1': new Error('socket hang up'),
      '/members/directory/vcard/2': vcard('Tom Nelson'),
    });

    const { people, warnings, summary } = await scrapeDirectory({ concurrency: 1 });
    expect(people.map(p => p.name)).toEqual(['Tom Nelson']);
    expect(warnings).toEqual(['family 1 (Harris): socket hang up']);
    expect(summary.people).toBe(1);
  });

  test('a vCard that answers with an error status is warned about by status', async () => {
    servePages({
      '/members/directory':         listing(familyCard({ id: '1', name: 'Harris' })),
      '/members/directory/vcard/1': { status: 404, body: '' },
    });

    const { people, warnings } = await scrapeDirectory();
    expect(people).toEqual([]);
    expect(warnings).toEqual(['family 1 (Harris): HTTP 404']);
  });

  test('an empty vCard is warned about rather than passing silently', async () => {
    servePages({
      '/members/directory':         listing(familyCard({ id: '1', name: 'Harris' })),
      '/members/directory/vcard/1': { status: 200, body: '' },
    });

    const { people, warnings } = await scrapeDirectory();
    expect(people).toEqual([]);
    expect(warnings).toEqual(['family 1 (Harris): no members in vCard']);
    // A family with nobody in it is not worth downloading a portrait for
    expect(fetchBinary).not.toHaveBeenCalled();
  });
});

// ─── scrapeDirectory: photos ──────────────────────────────────────────────────

describe('scrapeDirectory — photos', () => {
  const oneFamily = (card = familyCard({ id: '1', name: 'Harris' })) => servePages({
    '/members/directory':         listing(card),
    '/members/directory/vcard/1': vcard('Ray Harris'),
  });

  test('downloads the full-size image, not the thumbnail', async () => {
    oneFamily();
    await scrapeDirectory();
    expect(fetchBinary).toHaveBeenCalledWith('/media/uploads/photos/families/1.jpg?h=v1');
  });

  test('a family with no photo is counted, and nothing is downloaded', async () => {
    oneFamily(familyCard({ id: '1', name: 'Harris', photo: false }));

    const { people, summary } = await scrapeDirectory();
    expect(summary).toMatchObject({ noPhoto: 1, photos: 0 });
    expect(people[0].photo).toBeNull();
    expect(fetchBinary).not.toHaveBeenCalled();
  });

  test('reuses a stored photo when the version is unchanged and the file is still there', async () => {
    oneFamily();
    const known = new Map([['1', { file: 'already-here.jpg', version: 'v1' }]]);

    const { people, summary } = await scrapeDirectory({ known });
    expect(summary).toMatchObject({ photosReused: 1, photos: 0 });
    expect(people[0].photo).toEqual({ file: 'already-here.jpg', version: 'v1' });
    expect(fetchBinary).not.toHaveBeenCalled();
  });

  test('re-downloads when the site says the photo has been replaced', async () => {
    oneFamily(familyCard({ id: '1', name: 'Harris', version: 'v2' }));
    const known = new Map([['1', { file: 'stale.jpg', version: 'v1' }]]);

    const { people, summary } = await scrapeDirectory({ known });
    expect(summary).toMatchObject({ photos: 1, photosReused: 0 });
    expect(people[0].photo).toEqual({ file: 'saved.jpg', version: 'v2' });
  });

  test('re-downloads when the recorded file has gone missing from the store', async () => {
    oneFamily();
    photoStore.exists.mockReturnValue(false);
    const known = new Map([['1', { file: 'vanished.jpg', version: 'v1' }]]);

    const { summary } = await scrapeDirectory({ known });
    // Trusting the record alone would make a missing file permanent
    expect(summary).toMatchObject({ photos: 1, photosReused: 0 });
    expect(fetchBinary).toHaveBeenCalled();
  });

  test('a failed download is a warning, and the people still come back', async () => {
    oneFamily();
    fetchBinary.mockRejectedValue(new Error('cdn link expired'));

    const { people, warnings, summary } = await scrapeDirectory();
    expect(people).toHaveLength(1);
    expect(people[0].photo).toBeNull();
    expect(warnings).toEqual(['family 1 photo: cdn link expired']);
    expect(summary).toMatchObject({ photoErrors: 1, photos: 0 });
  });

  test('a non-200 image response is warned about by status', async () => {
    oneFamily();
    fetchBinary.mockResolvedValue({ status: 403, body: Buffer.alloc(0) });

    const { warnings, summary } = await scrapeDirectory();
    expect(warnings).toEqual(['family 1 photo: HTTP 403']);
    expect(summary.photoErrors).toBe(1);
  });

  test('a download the photo store will not keep is warned about', async () => {
    oneFamily();
    photoStore.savePhoto.mockReturnValue(null);

    const { warnings, summary } = await scrapeDirectory();
    expect(warnings).toEqual(['family 1 photo: response was not an image we can store']);
    expect(summary.photoErrors).toBe(1);
  });

  test('passing savePhoto: null gathers people without touching any images', async () => {
    oneFamily();
    const { people, summary } = await scrapeDirectory({ savePhoto: null });
    expect(people[0].photo).toBeNull();
    expect(summary).toMatchObject({ photos: 0, noPhoto: 0, photoErrors: 0 });
    expect(fetchBinary).not.toHaveBeenCalled();
  });

  test('a caller may supply its own savePhoto', async () => {
    oneFamily();
    const savePhoto = jest.fn(() => 'custom.jpg');

    const { people } = await scrapeDirectory({ savePhoto });
    expect(savePhoto).toHaveBeenCalledWith({ buffer: expect.any(Buffer) });
    expect(people[0].photo.file).toBe('custom.jpg');
  });
});

// ─── scrapeDirectory: several families ────────────────────────────────────────

describe('scrapeDirectory — a whole congregation', () => {
  test('visits every family and totals them up', async () => {
    const ids = ['1', '2', '3', '4'];
    servePages({
      '/members/directory': listing(...ids.map(id => familyCard({ id, name: `Family ${id}` }))),
      ...Object.fromEntries(ids.map(id => [`/members/directory/vcard/${id}`, vcard(`Person ${id}A`, `Person ${id}B`)])),
    });

    const { people, summary } = await scrapeDirectory({ concurrency: 2 });
    expect(summary).toMatchObject({ families: 4, people: 8, photos: 4 });
    // Order follows the listing, not whichever request finished first
    expect(people.map(p => p.familyId)).toEqual(['1', '1', '2', '2', '3', '3', '4', '4']);
  });
});
