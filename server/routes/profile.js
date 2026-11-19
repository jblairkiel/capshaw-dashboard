const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const db      = require('../db');
const { requireAuth, requireApproved, holdsArea } = require('../middleware/auth');
const actionLog = require('../lib/actionLog');
const photoStore = require('../lib/photoStore');
const directoryVcard = require('../lib/directoryVcard');
const worship = require('../lib/worship');
const {
  sameHousehold, photoOf,
  WORSHIP_ROLES, PREFERENCE_LEVELS,
  EDITABLE_FIELDS, GENDERS, isGender,
} = require('../lib/people');

// ─── Lookups ──────────────────────────────────────────────────────────────────

function getPerson(id) {
  return db.prepare('SELECT * FROM directory WHERE id = ?').get(id);
}

// Everyone at the same address, the person themselves included.
function householdOf(person) {
  if (!person) return [];
  return db.prepare('SELECT * FROM directory ORDER BY name ASC')
    .all()
    .filter(other => sameHousehold(person, other));
}

// A short, stable token for a stored photo, so a page can ask for the new
// picture the moment one is replaced instead of the one its browser cached.
const photoVersion = file => (file ? file.slice(0, 12) : '');

// A person plus everything the profile screens render about them. The photo
// filenames stay on the server; the page learns only whether there is one of
// each kind, and which the face shown is.
function personPayload(person) {
  const { edited_fields, photo, own_photo, ...fields } = person;
  const face = photoOf(person);
  return {
    ...fields,
    edited_fields: safeParse(edited_fields),
    has_photo:        !!face,
    has_own_photo:    !!own_photo,
    has_family_photo: !!photo,
    photo_version:    photoVersion(face),
    own_photo_version:    photoVersion(own_photo),
    family_photo_version: photoVersion(photo),
    worship: { preferences: worship.preferencesOf(person.id), notes: worship.notesOf(person.id) },
  };
}

function safeParse(json) {
  try {
    const parsed = JSON.parse(json || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ─── Authorization ────────────────────────────────────────────────────────────

// Admins, and whoever looks after the member directory, may edit anybody.
// Everyone else may edit only the people in their own household, which requires
// their account to be linked to a directory entry.
function canEdit(user, person) {
  if (!user || !person) return false;
  if (holdsArea(user, 'directory')) return true;
  if (!user.directory_id) return false;
  const self = getPerson(user.directory_id);
  return sameHousehold(self, person);
}

// ─── GET /api/profile/me ──────────────────────────────────────────────────────

router.get('/me', requireAuth, (req, res) => {
  const person = req.user.directory_id ? getPerson(req.user.directory_id) : null;

  res.json({
    success:      true,
    linked:       !!person,
    person:       person ? personPayload(person) : null,
    household:    person ? householdOf(person).map(personPayload) : [],
    roles:        WORSHIP_ROLES,
    levels:       PREFERENCE_LEVELS,
    fields:       EDITABLE_FIELDS,
    notifications: notificationsOf(req.user),
    genders:      GENDERS.filter(Boolean),
    // The directory area edits from the directory screen; members edit their
    // own household.
    canEditAll:   holdsArea(req.user, 'directory'),
    canEdit:      req.user.role === 'admin' || (!!person && req.user.role !== 'pending'),
  });
});

// ─── GET /api/profile/person/:id ──────────────────────────────────────────────

router.get('/person/:id', requireApproved, (req, res) => {
  const person = getPerson(req.params.id);
  if (!person) return res.status(404).json({ success: false, error: 'Person not found' });
  if (!canEdit(req.user, person)) {
    return res.status(403).json({ success: false, error: 'You can only view profiles in your own household' });
  }
  res.json({ success: true, person: personPayload(person), household: householdOf(person).map(personPayload) });
});

// Everyone is opted into both until they say otherwise, so these reflect the
// columns' default of on.
function notificationsOf(user) {
  return {
    monthlyReport: user?.wants_monthly_report !== 0,
    weeklyEmail: user?.wants_weekly_email !== 0,
  };
}

// ─── PATCH /api/profile/notifications ─────────────────────────────────────────
// Anyone signed in can turn their own emails off; nobody can change anyone
// else's.

router.patch('/notifications', requireAuth, (req, res) => {
  const columns = { monthlyReport: 'wants_monthly_report', weeklyEmail: 'wants_weekly_email' };
  const given = Object.keys(columns).filter(k => req.body?.[k] !== undefined);
  if (!given.length || given.some(k => typeof req.body[k] !== 'boolean')) {
    return res.status(400).json({ success: false, error: 'monthlyReport or weeklyEmail must be true or false' });
  }

  for (const key of given) {
    db.prepare(`UPDATE users SET ${columns[key]} = ? WHERE id = ?`).run(req.body[key] ? 1 : 0, req.user.id);
  }
  const user = db.prepare('SELECT wants_monthly_report, wants_weekly_email FROM users WHERE id = ?').get(req.user.id);
  res.json({ success: true, notifications: notificationsOf(user) });
});

// ─── GET /api/profile/directory.vcf ──────────────────────────────────────────
// The whole member directory as phone contacts, for any approved member
// (lib/directoryVcard.js). Opening the file on a phone offers to add them all.
// Each download is written to the action history: it is the congregation's
// contact details leaving the site, so it is worth knowing who took a copy.

router.get('/directory.vcf', requireApproved, (req, res) => {
  const { vcf, count, withPhotos } = directoryVcard.directoryVcf({ photos: req.query.photos !== '0' });
  actionLog.record(req.user, {
    area: 'directory', action: 'other', entity: 'member directory',
    summary: `${req.user.name} added the member directory to their phone (${count} contact${count === 1 ? '' : 's'})`,
    details: { contacts: count, photos: withPhotos },
  });
  res.set('Content-Type', 'text/vcard; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="Capshaw Church Directory.vcf"');
  res.set('Cache-Control', 'private, no-store');
  res.send(vcf);
});

// ─── GET /api/profile/person/:id/photo ────────────────────────────────────────
// The face shown for a person: their own photo, or their family's when they
// have none. ?kind=own or ?kind=family asks for one in particular, which is
// what the photo editor shows.

// A fixed choice rather than a lookup table: nothing in the query string is
// ever used to pick a function, so ?kind=constructor and friends just get a 400.
// Returns undefined for a kind it does not know.
function photoOfKind(person, kind) {
  switch (kind) {
    case 'face':   return photoOf(person);
    case 'own':    return person.own_photo;
    case 'family': return person.photo;
    default:       return undefined;
  }
}

router.get('/person/:id/photo', requireApproved, (req, res) => {
  const person = getPerson(req.params.id);
  if (!person) return res.status(404).json({ success: false, error: 'Person not found' });
  if (!canEdit(req.user, person)) {
    return res.status(403).json({ success: false, error: 'You can only view photos in your own household' });
  }

  const kind = typeof req.query.kind === 'string' ? req.query.kind : 'face';
  const filename = photoOfKind(person, kind);
  if (filename === undefined) return res.status(400).json({ success: false, error: 'kind must be own or family' });
  const file = photoStore.photoPath(filename);
  if (!filename || !file || !photoStore.exists(filename)) {
    return res.status(404).json({ success: false, error: 'No photo on file' });
  }

  // Content-addressed filenames never change contents, so this is safe to keep.
  // The page adds ?v= with the photo's version, so a replaced photo is a new URL.
  res.set('Cache-Control', 'private, max-age=86400');
  res.sendFile(file);
});

// ─── Uploading photos ─────────────────────────────────────────────────────────
// A person's own photo belongs to them; the family photo belongs to everybody
// at the address and changes for all of them at once. Either may be put up or
// taken down by anyone who may edit that person (canEdit): the directory's
// keeper for anybody, a member for their own household.
//
// An uploaded or removed photo is marked edited, like a typed-in field, so the
// next sync from capshawchurch.org does not put the site's portrait back over
// it (lib/directorySync.js) — and so the row is not pruned as a scrape artefact.

const IMAGE_MIMES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']);
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => cb(null, IMAGE_MIMES.has(file.mimetype)),
  limits: { fileSize: MAX_PHOTO_BYTES },
});

// multer's own errors (a file over the limit) as a plain 400 rather than a 500.
function receivePhoto(req, res, next) {
  upload.single('photo')(req, res, err => {
    if (err) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      return res.status(400).json({ success: false, error: tooBig ? 'That photo is larger than 5 MB' : 'That photo could not be uploaded' });
    }
    next();
  });
}

function markEdited(person, field) {
  const edited = new Set(safeParse(person.edited_fields));
  edited.add(field);
  return JSON.stringify([...edited]);
}

function editablePerson(req, res) {
  const person = getPerson(req.params.id);
  if (!person) { res.status(404).json({ success: false, error: 'Person not found' }); return null; }
  if (!canEdit(req.user, person)) {
    res.status(403).json({ success: false, error: 'You can only change photos in your own household' });
    return null;
  }
  return person;
}

function storeUpload(req, res) {
  if (!req.file) {
    res.status(400).json({ success: false, error: 'Choose a JPEG, PNG, GIF or WebP photo to upload' });
    return null;
  }
  const filename = photoStore.savePhoto({ buffer: req.file.buffer }, MAX_PHOTO_BYTES);
  if (!filename) res.status(400).json({ success: false, error: 'That file could not be read as a photo' });
  return filename;
}

function photoArea(user) {
  return holdsArea(user, 'directory') ? 'directory' : 'my-household';
}

// Writes one person's own photo ('' removes it).
function setOwnPhoto(req, res, person, filename) {
  db.prepare('UPDATE directory SET own_photo = ?, edited_fields = ? WHERE id = ?')
    .run(filename, markEdited(person, 'own_photo'), person.id);
  actionLog.record(req.user, {
    area:     photoArea(req.user),
    action:   'update',
    entity:   'directory photo',
    entityId: person.id,
    summary:  filename ? `Put up a photo of ${person.name}` : `Took down ${person.name}'s own photo`,
  });
  res.json({ success: true, person: personPayload(getPerson(person.id)) });
}

// Writes the family photo for everybody at the person's address ('' removes it).
function setFamilyPhoto(req, res, person, filename) {
  const household = householdOf(person);
  const update = db.prepare('UPDATE directory SET photo = ?, edited_fields = ? WHERE id = ?');
  db.transaction(() => {
    for (const member of household) update.run(filename, markEdited(member, 'photo'), member.id);
  })();
  actionLog.record(req.user, {
    area:     photoArea(req.user),
    action:   'update',
    entity:   'directory photo',
    entityId: person.id,
    summary:  `${filename ? 'Put up' : 'Took down'} the family photo for ${household.map(m => m.name).join(', ')}`,
    details:  { household: household.map(m => m.id) },
  });
  res.json({
    success:   true,
    person:    personPayload(getPerson(person.id)),
    household: householdOf(person).map(personPayload),
  });
}

// ─── PUT/DELETE /api/profile/person/:id/photo — one person's own photo ───────

router.put('/person/:id/photo', requireApproved, receivePhoto, (req, res) => {
  const person = editablePerson(req, res);
  if (!person) return;
  const filename = storeUpload(req, res);
  if (filename) setOwnPhoto(req, res, person, filename);
});

router.delete('/person/:id/photo', requireApproved, (req, res) => {
  const person = editablePerson(req, res);
  if (person) setOwnPhoto(req, res, person, '');
});

// ─── PUT/DELETE /api/profile/person/:id/family-photo — the household's ───────

router.put('/person/:id/family-photo', requireApproved, receivePhoto, (req, res) => {
  const person = editablePerson(req, res);
  if (!person) return;
  const filename = storeUpload(req, res);
  if (filename) setFamilyPhoto(req, res, person, filename);
});

router.delete('/person/:id/family-photo', requireApproved, (req, res) => {
  const person = editablePerson(req, res);
  if (person) setFamilyPhoto(req, res, person, '');
});

// ─── PATCH /api/profile/person/:id — contact details ──────────────────────────

router.patch('/person/:id', requireApproved, (req, res) => {
  const person = getPerson(req.params.id);
  if (!person) return res.status(404).json({ success: false, error: 'Person not found' });
  if (!canEdit(req.user, person)) {
    return res.status(403).json({ success: false, error: 'You can only edit your own household' });
  }

  const fields = EDITABLE_FIELDS.filter(f => req.body[f] !== undefined);
  if (!fields.length) return res.status(400).json({ success: false, error: 'No editable fields supplied' });

  const values = fields.map(f => String(req.body[f] ?? '').trim());
  if (fields.includes('name') && !values[fields.indexOf('name')]) {
    return res.status(400).json({ success: false, error: 'Name cannot be empty' });
  }
  if (fields.includes('gender')) {
    const index = fields.indexOf('gender');
    values[index] = values[index].toLowerCase();
    if (!isGender(values[index])) {
      return res.status(400).json({ success: false, error: `Gender must be one of: ${GENDERS.filter(Boolean).join(', ')}` });
    }
  }

  // Remember which fields were set by hand so the next scrape leaves them be.
  const edited = new Set(safeParse(person.edited_fields));
  fields.forEach(f => edited.add(f));

  db.prepare(
    `UPDATE directory SET ${fields.map(f => `${f} = ?`).join(', ')}, edited_fields = ? WHERE id = ?`
  ).run(...values, JSON.stringify([...edited]), person.id);

  const updated = getPerson(person.id);
  actionLog.record(req.user, {
    area:     holdsArea(req.user, 'directory') ? 'directory' : 'my-household',
    action:   'update',
    entity:   'directory entry',
    entityId: person.id,
    summary:  `Updated ${updated.name}'s details (${fields.join(', ')})`,
    before:   person,
    after:    updated,
  });
  res.json({ success: true, person: personPayload(updated) });
});

// ─── PUT /api/profile/person/:id/worship — role preferences ───────────────────

router.put('/person/:id/worship', requireApproved, (req, res) => {
  const person = getPerson(req.params.id);
  if (!person) return res.status(404).json({ success: false, error: 'Person not found' });
  if (!canEdit(req.user, person)) {
    return res.status(403).json({ success: false, error: 'You can only edit your own household' });
  }

  const { preferences, error } = worship.readPreferences(req.body?.preferences);
  if (error) return res.status(400).json({ success: false, error });

  const notes = req.body.notes === undefined ? undefined : String(req.body.notes).trim();
  worship.save(person.id, preferences, notes);

  actionLog.record(req.user, {
    area:     holdsArea(req.user, 'directory') ? 'directory' : 'my-household',
    action:   'update',
    entity:   'worship preferences',
    entityId: person.id,
    summary:  `Updated ${person.name}'s worship preferences`,
    details:  { preferences },
  });
  res.json({ success: true, person: personPayload(getPerson(person.id)) });
});

module.exports = router;
