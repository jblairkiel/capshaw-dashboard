const fs   = require('fs');
const path = require('path');
const photoStore = require('../lib/photoStore');
const { parseDirectory, parseVCardPhoto } = require('../lib/parsers');
const { syncDirectory } = require('../lib/directorySync');
const { createMemoryDb } = require('./helpers/memoryDb');

const JPEG = Buffer.from('fake-jpeg-bytes').toString('base64');

function vcard(lines) {
  return ['BEGIN:VCARD', 'VERSION:3.0', ...lines, 'END:VCARD'].join('\r\n');
}

// ─── vCard photo forms ────────────────────────────────────────────────────────

describe('parseVCardPhoto', () => {
  test('reads a vCard 3.0 inline base64 photo', () => {
    const [m] = parseDirectory(vcard(['FN:Ray Harris', `PHOTO;ENCODING=b;TYPE=JPEG:${JPEG}`]));
    expect(m.photo).toEqual({ base64: JPEG, mime: 'image/jpeg', url: null });
  });

  test('reads ENCODING=BASE64 spelled out, and a PNG type', () => {
    const [m] = parseDirectory(vcard(['FN:Ray Harris', `PHOTO;ENCODING=BASE64;TYPE=PNG:${JPEG}`]));
    expect(m.photo).toEqual({ base64: JPEG, mime: 'image/png', url: null });
  });

  test('reads a vCard 4.0 data URI', () => {
    const [m] = parseDirectory(vcard(['FN:Ray Harris', `PHOTO:data:image/png;base64,${JPEG}`]));
    expect(m.photo).toEqual({ base64: JPEG, mime: 'image/png', url: null });
  });

  test('reads a photo given as a URL', () => {
    const [m] = parseDirectory(vcard(['FN:Ray Harris', 'PHOTO;VALUE=URI:https://example.com/ray.jpg']));
    expect(m.photo).toEqual({ base64: null, mime: 'image/jpeg', url: 'https://example.com/ray.jpg' });
  });

  test('unfolds a photo split across continuation lines', () => {
    const half = JPEG.slice(0, 6);
    const rest = JPEG.slice(6);
    const vcf  = ['BEGIN:VCARD', 'VERSION:3.0', 'FN:Ray Harris',
      `PHOTO;ENCODING=b;TYPE=JPEG:${half}`, ` ${rest}`, 'END:VCARD'].join('\r\n');
    expect(parseDirectory(vcf)[0].photo.base64).toBe(JPEG);
  });

  test('is null when there is no photo', () => {
    expect(parseDirectory(vcard(['FN:Ray Harris']))[0].photo).toBeNull();
    expect(parseVCardPhoto({})).toBeNull();
    expect(parseVCardPhoto({ 'PHOTO;ENCODING=b': [''] })).toBeNull();
  });

  test('does not treat an unencoded, non-URL value as a photo', () => {
    expect(parseVCardPhoto({ PHOTO: ['some nonsense'] })).toBeNull();
  });
});

// ─── Photo store ──────────────────────────────────────────────────────────────

describe('photoStore', () => {
  const written = [];
  afterAll(() => {
    for (const name of written) {
      try { fs.unlinkSync(path.join(photoStore.PHOTO_DIR, name)); } catch { /* already gone */ }
    }
  });

  test('rejects filenames that could escape the photo directory', () => {
    for (const bad of ['../secrets.jpg', 'a/b.jpg', '/etc/passwd', '..%2Fx.jpg', '']) {
      expect(photoStore.isSafeFilename(bad)).toBe(false);
      expect(photoStore.photoPath(bad)).toBeNull();
    }
  });

  test('rejects image types we will not serve back', () => {
    expect(photoStore.extensionFor('image/svg+xml')).toBeNull();
    expect(photoStore.extensionFor('text/html')).toBeNull();
    expect(photoStore.savePhoto({ base64: JPEG, mime: 'image/svg+xml' })).toBeNull();
  });

  test('refuses an empty or oversized photo', () => {
    expect(photoStore.savePhoto({ base64: '', mime: 'image/jpeg' })).toBeNull();
    expect(photoStore.savePhoto({ base64: JPEG, mime: 'image/jpeg' }, 4)).toBeNull();
  });

  test('writes the file and names it by content, so duplicates share one file', () => {
    const a = photoStore.savePhoto({ base64: JPEG, mime: 'image/jpeg' });
    const b = photoStore.savePhoto({ base64: JPEG, mime: 'image/jpeg' });
    written.push(a);
    expect(a).toMatch(/^[0-9a-f]{40}\.jpg$/);
    expect(b).toBe(a);
    expect(photoStore.exists(a)).toBe(true);
    expect(fs.readFileSync(photoStore.photoPath(a)).toString()).toBe('fake-jpeg-bytes');
  });
});

// ─── Sync ─────────────────────────────────────────────────────────────────────

describe('syncDirectory — photos', () => {
  let db;
  const savePhoto = jest.fn(() => 'abc123.jpg');

  beforeEach(() => { db = createMemoryDb(); savePhoto.mockClear(); });

  function person(name, photo) {
    return { name, address: '12 Oak St', zip: '35749', city: '', state: '', phone: '', cell: '', email: '', notes: '', photo };
  }

  test('stores the photo filename against the person', () => {
    const summary = syncDirectory(db, [person('Ray Harris', { base64: JPEG, mime: 'image/jpeg' })], { savePhoto });
    expect(savePhoto).toHaveBeenCalledTimes(1);
    expect(summary.photos).toBe(1);
    expect(db.prepare('SELECT photo FROM directory').get().photo).toBe('abc123.jpg');
  });

  test('counts URL-only photos separately and stores nothing', () => {
    const summary = syncDirectory(db, [person('Ray Harris', { base64: null, url: 'https://x/y.jpg' })], { savePhoto });
    expect(savePhoto).not.toHaveBeenCalled();
    expect(summary.photoUrlsSkipped).toBe(1);
    expect(db.prepare('SELECT photo FROM directory').get().photo).toBe('');
  });

  test('leaves the photo empty when a person has none', () => {
    syncDirectory(db, [person('Ray Harris', null)], { savePhoto });
    expect(db.prepare('SELECT photo FROM directory').get().photo).toBe('');
  });

  test('updates the stored photo when the site sends a new one', () => {
    syncDirectory(db, [person('Ray Harris', { base64: JPEG, mime: 'image/jpeg' })], { savePhoto });
    savePhoto.mockReturnValueOnce('new456.jpg');
    syncDirectory(db, [person('Ray Harris', { base64: JPEG, mime: 'image/jpeg' })], { savePhoto });
    expect(db.prepare('SELECT photo FROM directory').get().photo).toBe('new456.jpg');
  });

  test('can be run with photos switched off entirely', () => {
    const summary = syncDirectory(db, [person('Ray Harris', { base64: JPEG, mime: 'image/jpeg' })], { savePhoto: null });
    expect(summary.photos).toBe(0);
    expect(db.prepare('SELECT photo FROM directory').get().photo).toBe('');
  });
});
