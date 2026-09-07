const fs   = require('fs');
const path = require('path');
const photoStore = require('../lib/photoStore');
const { parseDirectoryFamilies } = require('../lib/parsers');
const { syncDirectory } = require('../lib/directorySync');
const { createMemoryDb } = require('./helpers/memoryDb');

// Real magic bytes, since the store reads the type from the bytes.
const JPEG_BYTES = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');
const PNG_BYTES  = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(16, 7)]);

function card(id, src, title) {
  return `<a class="c-card" href="/members/directory/family/${id}">` +
         `<div class="c-thumb"><img src="${src}" alt="" loading="lazy"></div>` +
         `<div class="c-cbody"><h2 class="c-title">${title}</h2></div></a>`;
}

// ─── Where photos actually come from ──────────────────────────────────────────

describe('parseDirectoryFamilies', () => {
  const html =
    card('328', '/media/uploads/photos/families/thumbs/328.jpg?h=1757592046', 'Allen, Josh &amp; Tylan (Lincoln, and Saylor)') +
    card('999', '/media/frontend/members/no-image.jpg', 'Reaves, Will');

  test('reads the family id, name and both photo sizes', () => {
    const [fam] = parseDirectoryFamilies(html);
    expect(fam).toMatchObject({
      familyId:   '328',
      familyName: 'Allen, Josh & Tylan (Lincoln, and Saylor)',
      thumbUrl:   '/media/uploads/photos/families/thumbs/328.jpg?h=1757592046',
      fullUrl:    '/media/uploads/photos/families/328.jpg?h=1757592046',
      version:    '1757592046',
      hasPhoto:   true,
    });
  });

  test('flags the shared placeholder so it is never downloaded', () => {
    expect(parseDirectoryFamilies(html)[1]).toMatchObject({ familyId: '999', hasPhoto: false });
  });

  test('ignores a card with no image, and html with no cards', () => {
    expect(parseDirectoryFamilies('<a class="c-card" href="/members/directory/family/5"><h2 class="c-title">X</h2></a>')).toEqual([]);
    expect(parseDirectoryFamilies('<html><body>nothing</body></html>')).toEqual([]);
  });
});

// ─── Storing downloaded bytes ─────────────────────────────────────────────────

describe('photoStore.savePhoto from raw bytes', () => {
  const written = [];
  afterEach(() => {
    while (written.length) fs.rmSync(path.join(photoStore.PHOTO_DIR, written.pop()), { force: true });
  });

  test('stores a downloaded buffer and names it by content hash', () => {
    const a = photoStore.savePhoto({ buffer: JPEG_BYTES });
    const b = photoStore.savePhoto({ buffer: JPEG_BYTES });
    written.push(a);
    expect(a).toMatch(/^[0-9a-f]{40}\.jpg$/);
    // Same bytes, same file — a family portrait is stored once for everyone in it.
    expect(b).toBe(a);
  });

  // The site serves PNG thumbnails under .jpg names with an image/jpeg header,
  // so the declared type cannot be trusted.
  test('reads the real type from the bytes, not the declared mime', () => {
    const file = photoStore.savePhoto({ buffer: PNG_BYTES });
    written.push(file);
    expect(file).toMatch(/\.png$/);
  });

  test('corrects a lying mime on a base64 photo too', () => {
    const file = photoStore.savePhoto({ base64: PNG_BYTES.toString('base64'), mime: 'image/jpeg' });
    written.push(file);
    expect(file).toMatch(/\.png$/);
  });

  test('refuses bytes that are not an image we serve', () => {
    expect(photoStore.savePhoto({ buffer: Buffer.from('<svg onload=alert(1)>') })).toBeNull();
    expect(photoStore.savePhoto({ buffer: Buffer.alloc(4) })).toBeNull();
  });

  test('refuses a photo bigger than the cap', () => {
    expect(photoStore.savePhoto({ buffer: JPEG_BYTES }, 4)).toBeNull();
  });
});

// ─── Handing an already-stored photo to the sync ──────────────────────────────

describe('syncDirectory with a pre-stored photo', () => {
  test('takes the filename the scrape already saved', () => {
    const db = createMemoryDb();
    syncDirectory(db, [{ name: 'Josh Allen', photo: { file: 'abc123.jpg', version: '1' } }], { savePhoto: null });
    expect(db.prepare('SELECT photo FROM directory WHERE name = ?').get('Josh Allen').photo).toBe('abc123.jpg');
  });

  test('everyone in a family points at the one portrait', () => {
    const db = createMemoryDb();
    const photo = { file: 'shared.jpg', version: '1' };
    syncDirectory(db, [
      { name: 'Josh Allen',  photo },
      { name: 'Tylan Allen', photo },
    ], { savePhoto: null });

    const rows = db.prepare('SELECT photo FROM directory ORDER BY name').all();
    expect(rows.map(r => r.photo)).toEqual(['shared.jpg', 'shared.jpg']);
  });

  test('a person with no photo is left blank rather than broken', () => {
    const db = createMemoryDb();
    syncDirectory(db, [{ name: 'Will Reaves', photo: null }], { savePhoto: null });
    expect(db.prepare('SELECT photo FROM directory WHERE name = ?').get('Will Reaves').photo).toBe('');
  });

  test('ids survive a re-scrape, so accounts and preferences stay attached', () => {
    const db = createMemoryDb();
    const people = [{ name: 'Josh Allen', photo: { file: 'a.jpg' } }];
    syncDirectory(db, people, { savePhoto: null });
    const first = db.prepare('SELECT id FROM directory WHERE name = ?').get('Josh Allen').id;

    syncDirectory(db, people, { savePhoto: null });
    expect(db.prepare('SELECT id FROM directory WHERE name = ?').get('Josh Allen').id).toBe(first);
  });
});

// ─── The empty-scrape guard ───────────────────────────────────────────────────
// syncDirectory removes people the site no longer lists, and a failed scrape
// looks exactly like an empty one. Passing it nothing must never be how the
// congregation gets deleted.

describe('an empty people list', () => {
  test('would delete unlinked people, which is why the scraper refuses to pass one', () => {
    const db = createMemoryDb();
    syncDirectory(db, [{ name: 'Josh Allen' }, { name: 'Tylan Allen' }], { savePhoto: null });
    expect(db.prepare('SELECT COUNT(*) n FROM directory').get().n).toBe(2);

    // Demonstrates the hazard the guard in _saveScraped exists to prevent.
    syncDirectory(db, [], { savePhoto: null });
    expect(db.prepare('SELECT COUNT(*) n FROM directory').get().n).toBe(0);
  });

  test('leaves alone anyone an account or a preference is attached to', () => {
    const db = createMemoryDb();
    syncDirectory(db, [{ name: 'Josh Allen' }, { name: 'Tylan Allen' }], { savePhoto: null });
    const josh = db.prepare('SELECT id FROM directory WHERE name = ?').get('Josh Allen').id;
    db.prepare("INSERT INTO users (provider, provider_id, name, role, directory_id) VALUES ('google','g1','Josh Allen','approved',?)").run(josh);

    syncDirectory(db, [], { savePhoto: null });

    const left = db.prepare('SELECT name FROM directory').all().map(r => r.name);
    expect(left).toEqual(['Josh Allen']);
  });
});

// ─── The photo store must survive a sync that knows about no photos ───────────

describe('pruning', () => {
  test('an empty reference set never empties the store', () => {
    const file = photoStore.savePhoto({ buffer: JPEG_BYTES });
    try {
      // A fixture database, a fresh install and a failed scrape all look like
      // this. None of them should cost us the photo library.
      syncDirectory(createMemoryDb(), [{ name: 'Josh Allen' }]);
      expect(photoStore.exists(file)).toBe(true);
    } finally {
      fs.rmSync(path.join(photoStore.PHOTO_DIR, file), { force: true });
    }
  });

  test('still drops a file once nothing references it', () => {
    const keep = photoStore.savePhoto({ buffer: JPEG_BYTES });
    const drop = photoStore.savePhoto({ buffer: PNG_BYTES });
    try {
      const db = createMemoryDb();
      syncDirectory(db, [{ name: 'Josh Allen', photo: { file: keep } }]);
      expect(photoStore.exists(keep)).toBe(true);
      expect(photoStore.exists(drop)).toBe(false);
    } finally {
      fs.rmSync(path.join(photoStore.PHOTO_DIR, keep), { force: true });
      fs.rmSync(path.join(photoStore.PHOTO_DIR, drop), { force: true });
    }
  });
});
