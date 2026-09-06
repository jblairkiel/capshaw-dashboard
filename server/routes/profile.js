const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { requireAuth, requireApproved } = require('../middleware/auth');
const photoStore = require('../lib/photoStore');
const {
  sameHousehold,
  WORSHIP_ROLES, PREFERENCE_LEVELS, isWorshipRole, isPreferenceLevel,
  EDITABLE_FIELDS,
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

function preferencesOf(directoryId) {
  const rows = db.prepare('SELECT role, level FROM worship_preferences WHERE directory_id = ?').all(directoryId);
  const map  = {};
  for (const r of rows) map[r.role] = r.level;
  return map;
}

function notesOf(directoryId) {
  return db.prepare('SELECT notes FROM worship_profile WHERE directory_id = ?').get(directoryId)?.notes ?? '';
}

// A person plus everything the profile screens render about them.
function personPayload(person) {
  const { edited_fields, photo, ...fields } = person;
  return {
    ...fields,
    edited_fields: safeParse(edited_fields),
    has_photo: !!photo,
    worship: { preferences: preferencesOf(person.id), notes: notesOf(person.id) },
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

// Admins may edit anybody. Everyone else may edit only the people in their own
// household, which requires their account to be linked to a directory entry.
function canEdit(user, person) {
  if (!user || !person) return false;
  if (user.role === 'admin') return true;
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
    // Admins edit from the directory screen; members edit their own household.
    canEditAll:   req.user.role === 'admin',
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

  // Remember which fields were set by hand so the next scrape leaves them be.
  const edited = new Set(safeParse(person.edited_fields));
  fields.forEach(f => edited.add(f));

  db.prepare(
    `UPDATE directory SET ${fields.map(f => `${f} = ?`).join(', ')}, edited_fields = ? WHERE id = ?`
  ).run(...values, JSON.stringify([...edited]), person.id);

  res.json({ success: true, person: personPayload(getPerson(person.id)) });
});

// ─── PUT /api/profile/person/:id/worship — role preferences ───────────────────

const saveWorship = db.transaction((directoryId, preferences, notes) => {
  db.prepare('DELETE FROM worship_preferences WHERE directory_id = ?').run(directoryId);
  const ins = db.prepare(
    "INSERT INTO worship_preferences (directory_id, role, level, updated_at) VALUES (?, ?, ?, datetime('now'))"
  );
  for (const [role, level] of Object.entries(preferences)) ins.run(directoryId, role, level);

  if (notes === undefined) return;
  db.prepare(
    "INSERT INTO worship_profile (directory_id, notes, updated_at) VALUES (?, ?, datetime('now'))\n" +
    "ON CONFLICT(directory_id) DO UPDATE SET notes = excluded.notes, updated_at = excluded.updated_at"
  ).run(directoryId, notes);
});

router.put('/person/:id/worship', requireApproved, (req, res) => {
  const person = getPerson(req.params.id);
  if (!person) return res.status(404).json({ success: false, error: 'Person not found' });
  if (!canEdit(req.user, person)) {
    return res.status(403).json({ success: false, error: 'You can only edit your own household' });
  }

  const incoming = req.body?.preferences;
  if (incoming === undefined || incoming === null || typeof incoming !== 'object' || Array.isArray(incoming)) {
    return res.status(400).json({ success: false, error: 'preferences must be an object of role → level' });
  }

  // Validate everything before writing anything: a bad role should not leave
  // half a set of preferences behind.
  const preferences = {};
  for (const [role, level] of Object.entries(incoming)) {
    if (level === null || level === '') continue;           // cleared — no preference
    if (!isWorshipRole(role)) {
      return res.status(400).json({ success: false, error: `Unknown worship role: ${role}` });
    }
    if (!isPreferenceLevel(level)) {
      return res.status(400).json({ success: false, error: `Level must be one of: ${PREFERENCE_LEVELS.join(', ')}` });
    }
    preferences[role] = level;
  }

  const notes = req.body.notes === undefined ? undefined : String(req.body.notes).trim();
  saveWorship(person.id, preferences, notes);

  res.json({ success: true, person: personPayload(getPerson(person.id)) });
});

module.exports = router;
