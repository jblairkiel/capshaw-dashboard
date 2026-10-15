// "Add the directory to my phone": the member directory as one vCard file.
// What a phone imports is read back here through the same parser the site uses
// for the church's own vCard export, so the two can never disagree about what
// a field means.
const os = require('os');
const fs = require('fs');
const path = require('path');

// Photos written here are this file's alone.
process.env.CAPSHAW_PHOTO_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vcard-photos-'));
jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const request = require('supertest');
const express = require('express');
const db = require('../db');
const photoStore = require('../lib/photoStore');
const { parseDirectory } = require('../lib/parsers');
const { directoryVcf, splitName, card, MAX_PHOTO_BYTES } = require('../lib/directoryVcard');
const router = require('../routes/profile');

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const WEBP = Buffer.concat([Buffer.from('RIFF0000WEBPVP8 ', 'ascii'), Buffer.alloc(16)]);

function addPerson(fields) {
  const row = { address: '', city: '', state: '', zip: '', phone: '', cell: '', email: '', photo: '', ...fields };
  return Number(db.prepare(`
    INSERT INTO directory (name, address, city, state, zip, phone, cell, email, photo)
    VALUES (@name, @address, @city, @state, @zip, @phone, @cell, @email, @photo)
  `).run(row).lastInsertRowid);
}

function addUser(name, role = 'approved') {
  const id = db.prepare('INSERT INTO users (provider, provider_id, email, name, role) VALUES (?,?,?,?,?)')
    .run('google', `${name}-id`, `${name}@example.com`, name, role).lastInsertRowid;
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function buildApp(user) {
  const app = express();
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/profile', router);
  return app;
}

beforeEach(() => {
  for (const t of ['action_log', 'users', 'directory']) db.prepare(`DELETE FROM ${t}`).run();
});

afterAll(() => fs.rmSync(process.env.CAPSHAW_PHOTO_DIR, { recursive: true, force: true }));

describe('the file', () => {
  test('a phone reads back exactly what the directory holds', () => {
    addPerson({ name: 'Ann Bell', address: '12 Oak St', city: 'Harvest', state: 'AL', zip: '35749', phone: '256-555-0100', cell: '256-555-0101', email: 'ann@example.com' });
    addPerson({ name: 'Joe Carter', cell: '256-555-0199' });

    const { vcf, count } = directoryVcf();
    expect(count).toBe(2);
    expect(parseDirectory(vcf).map(({ photo, ...rest }) => rest)).toEqual([
      { name: 'Ann Bell', address: '12 Oak St', city: 'Harvest', state: 'AL', zip: '35749', phone: '256-555-0100', cell: '256-555-0101', email: 'ann@example.com', notes: '' },
      { name: 'Joe Carter', address: '', city: '', state: '', zip: '', phone: '', cell: '256-555-0199', email: '', notes: '' },
    ]);
  });

  test('every card says who it belongs with, and is a well-formed vCard 3.0', () => {
    const id = addPerson({ name: 'Ann Bell' });
    const { vcf } = directoryVcf();
    expect(vcf).toMatch(/^BEGIN:VCARD\r\nVERSION:3\.0\r\n/);
    expect(vcf).toContain(`UID:capshaw-directory-${id}\r\n`);
    expect(vcf).toContain('N:Bell;Ann;;;\r\n');
    expect(vcf).toContain('ORG:Capshaw Church of Christ\r\nCATEGORIES:Capshaw Church of Christ\r\n');
    expect(vcf.endsWith('END:VCARD\r\n')).toBe(true);
    // Nothing but CRLF line endings.
    expect(vcf.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  test('names are split the way a phone sorts them', () => {
    expect(splitName('Ann Bell')).toEqual({ family: 'Bell', given: 'Ann', suffix: '' });
    expect(splitName('Mary Ann Bell')).toEqual({ family: 'Bell', given: 'Mary Ann', suffix: '' });
    expect(splitName('Bell, Ann')).toEqual({ family: 'Bell', given: 'Ann', suffix: '' });
    expect(splitName('Tom Hale Jr.')).toEqual({ family: 'Hale', given: 'Tom', suffix: 'Jr.' });
    expect(splitName('Cher')).toEqual({ family: '', given: 'Cher', suffix: '' });
  });

  test('commas, semicolons and backslashes are escaped, and long lines folded', () => {
    const text = card({ id: 1, name: 'Bell, Ann', address: '12 Oak St; Apt 3\\B', city: 'Harvest, North' });
    expect(text).toContain('FN:Bell\\, Ann');
    expect(text).toContain('ADR;TYPE=HOME:;;12 Oak St\\; Apt 3\\\\B;Harvest\\, North;;;');
    const long = card({ id: 2, name: 'A'.repeat(200) });
    for (const line of long.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    expect(parseDirectory(long)[0].name).toBe('A'.repeat(200));
  });

  test('a home number the same as the cell is not listed twice', () => {
    addPerson({ name: 'Ann Bell', phone: '256-555-0101', cell: '256-555-0101' });
    expect(directoryVcf().vcf.match(/^TEL/gm)).toHaveLength(1);
  });

  test('the family photo comes along when a phone can show it, and not when it cannot or is too big', () => {
    const png = photoStore.savePhoto({ buffer: PNG });
    const webp = photoStore.savePhoto({ buffer: WEBP });
    const big = photoStore.savePhoto({ buffer: Buffer.concat([PNG, Buffer.alloc(MAX_PHOTO_BYTES)]) });
    addPerson({ name: 'Ann Bell', photo: png });
    addPerson({ name: 'Ben Bell', photo: png });       // the same family photo, read once
    addPerson({ name: 'Cal Webb', photo: webp });
    addPerson({ name: 'Dot Webb', photo: big });
    addPerson({ name: 'Eve Ward', photo: '../../etc/passwd' });

    const { vcf, withPhotos } = directoryVcf();
    expect(withPhotos).toBe(2);
    const people = parseDirectory(vcf);
    expect(people.find(p => p.name === 'Ann Bell').photo).toEqual({ base64: PNG.toString('base64'), mime: 'image/png', url: null });
    expect(people.find(p => p.name === 'Cal Webb').photo).toBeNull();
    expect(people.find(p => p.name === 'Dot Webb').photo).toBeNull();
    expect(people.find(p => p.name === 'Eve Ward').photo).toBeNull();

    expect(directoryVcf({ photos: false }).withPhotos).toBe(0);
  });

  test('entries with no name are left out, and the rest are in alphabetical order', () => {
    addPerson({ name: 'zed Young' });
    addPerson({ name: '   ' });
    addPerson({ name: 'Ann Bell' });
    expect(parseDirectory(directoryVcf().vcf).map(p => p.name)).toEqual(['Ann Bell', 'zed Young']);
  });
});

describe('GET /api/profile/directory.vcf', () => {
  test('an approved member downloads it as a contacts file, and it is written down', async () => {
    addPerson({ name: 'Ann Bell', cell: '256-555-0101' });
    const res = await request(buildApp(addUser('Mel'))).get('/api/profile/directory.vcf');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/vcard/);
    expect(res.headers['content-disposition']).toBe('attachment; filename="Capshaw Church Directory.vcf"');
    expect(res.headers['cache-control']).toMatch(/no-store/);
    expect(res.text).toContain('FN:Ann Bell');
    expect(db.prepare("SELECT area, summary FROM action_log").get()).toEqual({
      area: 'directory', summary: 'Mel added the member directory to their phone (1 contact)',
    });
  });

  test('an account still waiting for approval cannot, and neither can nobody', async () => {
    addPerson({ name: 'Ann Bell' });
    expect((await request(buildApp(addUser('Pat', 'pending'))).get('/api/profile/directory.vcf')).status).toBe(403);
    expect((await request(buildApp(null)).get('/api/profile/directory.vcf')).status).toBe(401);
    expect(db.prepare('SELECT COUNT(*) AS n FROM action_log').get().n).toBe(0);
  });
});
