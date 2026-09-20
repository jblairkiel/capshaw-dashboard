const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { requireAuth, requireApproved, holdsArea } = require('../middleware/auth');
const actionLog = require('../lib/actionLog');
const photoStore = require('../lib/photoStore');
const worship = require('../lib/worship');
const {
  sameHousehold,
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

// A person plus everything the profile screens render about them.
function personPayload(person) {
  const { edited_fields, photo, ...fields } = person;
  return {
    ...fields,
    edited_fields: safeParse(edited_fields),
    has_photo: !!photo,
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
    // Everyone is opted into the monthly worship summary until they say
    // otherwise, so this reflects the column's default of on.
    notifications: { monthlyReport: req.user.wants_monthly_report !== 0 },
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

// ─── PATCH /api/profile/notifications ─────────────────────────────────────────
// Anyone signed in can turn their own emails off; nobody can change anyone
// else's.

router.patch('/notifications', requireAuth, (req, res) => {
  const wanted = req.body?.monthlyReport;
  if (typeof wanted !== 'boolean') {
    return res.status(400).json({ success: false, error: 'monthlyReport must be true or false' });
  }

  db.prepare('UPDATE users SET wants_monthly_report = ? WHERE id = ?').run(wanted ? 1 : 0, req.user.id);
  res.json({ success: true, notifications: { monthlyReport: wanted } });
});

// ─── GET /api/profile/person/:id/photo ────────────────────────────────────────

router.get('/person/:id/photo', requireApproved, (req, res) => {
  const person = getPerson(req.params.id);
  if (!person) return res.status(404).json({ success: false, error: 'Person not found' });
  if (!canEdit(req.user, person)) {
    return res.status(403).json({ success: false, error: 'You can only view photos in your own household' });
  }

  const file = photoStore.photoPath(person.photo);
  if (!person.photo || !file || !photoStore.exists(person.photo)) {
    return res.status(404).json({ success: false, error: 'No photo on file' });
  }

  // Content-addressed filenames never change contents, so this is safe to keep.
  res.set('Cache-Control', 'private, max-age=86400');
  res.sendFile(file);
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
