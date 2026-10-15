// ─── The directory as phone contacts ──────────────────────────────────────────
//
// "Add the directory to my phone" (My Household & Preferences) downloads the
// whole member directory as one vCard file. Opening it on an iPhone or an
// Android phone offers to add every contact at once.
//
// vCard 3.0, because it is what both phones' contact apps import most reliably:
// CRLF line endings, lines folded at 75 octets, and , ; \ and newlines escaped.
// Every card carries the church's name as its organisation and category, so the
// contacts can be found (or cleared out) together, and a UID made from the
// directory id, so importing a newer file can be matched against an older one.
//
// The directory's photos are family photos, shared by everybody at an
// address. A card carries its photo when it is a JPEG, PNG or GIF (what both
// phones show) and small enough not to make the file unwieldy to import.

const fs = require('fs');
const db = require('../db');
const photoStore = require('./photoStore');

const ORG = 'Capshaw Church of Christ';
// A family thumbnail is far below this; a full-size camera photo is not worth
// making every member's download many megabytes for.
const MAX_PHOTO_BYTES = 512 * 1024;
const PHOTO_TYPES = { jpg: 'JPEG', png: 'PNG', gif: 'GIF' };

const SUFFIXES = new Set(['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv']);

// vCard text values escape \ , ; and newlines.
const esc = v => String(v ?? '').trim()
  .replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');

// Lines longer than 75 octets continue on the next line after a space, split
// on a character boundary so a multi-byte letter is never cut in two.
function fold(line) {
  if (Buffer.byteLength(line) <= 75) return line;
  const out = [];
  let current = '';
  for (const ch of line) {
    const limit = out.length ? 74 : 75;           // a continuation's leading space counts
    if (Buffer.byteLength(current + ch) > limit) { out.push(current); current = ''; }
    current += ch;
  }
  if (current) out.push(current);
  return out.join('\r\n ');
}

// "Ann Bell" → Bell / Ann; "Bell, Ann" → Bell / Ann; "Tom Hale Jr." keeps the
// suffix out of the family name. A single word is a given name.
function splitName(full) {
  const name = String(full || '').replace(/\s+/g, ' ').trim();
  if (name.includes(',')) {
    const [family, ...rest] = name.split(',');
    return { family: family.trim(), given: rest.join(',').trim(), suffix: '' };
  }
  const words = name.split(' ');
  let suffix = '';
  if (words.length > 2 && SUFFIXES.has(words.at(-1).toLowerCase())) suffix = words.pop();
  if (words.length === 1) return { family: '', given: words[0], suffix };
  return { family: words.pop(), given: words.join(' '), suffix };
}

// The photo for a card, read from the photo store, or null.
function photoFor(filename, cache) {
  if (!filename || !photoStore.isSafeFilename(filename)) return null;
  if (cache.has(filename)) return cache.get(filename);
  let photo = null;
  try {
    const path = photoStore.photoPath(filename);
    if (path && fs.existsSync(path) && fs.statSync(path).size <= MAX_PHOTO_BYTES) {
      const bytes = fs.readFileSync(path);
      const type = PHOTO_TYPES[photoStore.sniffExtension(bytes)];
      if (type) photo = { type, base64: bytes.toString('base64') };
    }
  } catch { /* an unreadable photo just means a card without one */ }
  cache.set(filename, photo);
  return photo;
}

function card(person, { photos = true, cache = new Map() } = {}) {
  const { family, given, suffix } = splitName(person.name);
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `UID:capshaw-directory-${person.id}`,
    `N:${esc(family)};${esc(given)};;;${esc(suffix)}`,
    `FN:${esc(person.name)}`,
    `ORG:${esc(ORG)}`,
    `CATEGORIES:${esc(ORG)}`,
  ];
  if (person.cell)  lines.push(`TEL;TYPE=CELL,VOICE:${esc(person.cell)}`);
  if (person.phone && person.phone !== person.cell) lines.push(`TEL;TYPE=HOME,VOICE:${esc(person.phone)}`);
  if (person.email) lines.push(`EMAIL;TYPE=INTERNET,HOME:${esc(person.email)}`);
  if (person.address || person.city || person.state || person.zip) {
    lines.push(`ADR;TYPE=HOME:;;${esc(person.address)};${esc(person.city)};${esc(person.state)};${esc(person.zip)};`);
  }
  const photo = photos ? photoFor(person.photo, cache) : null;
  if (photo) lines.push(`PHOTO;ENCODING=b;TYPE=${photo.type}:${photo.base64}`);
  lines.push('END:VCARD');
  return lines.map(fold).join('\r\n');
}

// Everybody in the directory with a name, alphabetically. Returns the file's
// text and how many contacts (and photos) are in it.
function directoryVcf({ photos = true } = {}) {
  const people = db.prepare(`
    SELECT id, name, address, city, state, zip, phone, cell, email, photo
      FROM directory WHERE trim(name) <> '' ORDER BY name COLLATE NOCASE
  `).all();
  const cache = new Map();
  const cards = people.map(p => card(p, { photos, cache }));
  const withPhotos = cards.filter(c => c.includes('\r\nPHOTO;')).length;
  return { vcf: cards.length ? `${cards.join('\r\n')}\r\n` : '', count: people.length, withPhotos };
}

module.exports = { ORG, MAX_PHOTO_BYTES, splitName, card, directoryVcf };
