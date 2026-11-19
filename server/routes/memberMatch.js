const express = require('express');
const router  = express.Router();
const path    = require('path');
const db      = require('../db');
const { requireApproved } = require('../middleware/auth');
const photoStore = require('../lib/photoStore');
const { photoOf, householdKey } = require('../lib/people');

// ─── Member Match ───────────────────────────────────────────────────────────
//
// A game, not a record: nothing here is written, only read, so there is no
// area for it — anyone approved may play, the same as the Bible class tools.
//
// A "round" is one photo and the people in it. Two people share a photo file
// exactly when they were the same family portrait (server/lib/photoStore.js
// names a photo by content hash, so two rows pointing at the same file are
// pointing at the same picture) — that is what tells a family photo from a
// single one, not anything about address or household.
//
// Each person is asked about once, with their own photo when they have one
// and their family's otherwise (lib/people.js photoOf). So once a family has
// put up individual photos, their family portrait drops out of the game for
// those people. Every member carries `family`, which the client uses to keep
// relatives out of each other's wrong answers: a person with their own photo
// is still part of their family.

router.use(requireApproved);

// ─── GET /api/member-match/rounds ──────────────────────────────────────────
// Every photo on file, with who is in it. A photo held by one person is a
// single round; held by several, it is a family photo the client asks about
// one member at a time.

router.get('/rounds', (req, res) => {
  const rows = db.prepare(`
    SELECT id, name, address, zip, photo, own_photo FROM directory
    WHERE (trim(photo) <> '' OR trim(own_photo) <> '') AND trim(name) <> ''
    ORDER BY name
  `).all();

  const byPhoto = new Map();
  for (const row of rows) {
    const photo = photoOf(row);
    if (!byPhoto.has(photo)) byPhoto.set(photo, { photo, kind: row.own_photo?.trim() ? 'individual' : 'family', members: [] });
    byPhoto.get(photo).members.push({
      id:     row.id,
      name:   row.name,
      // The family portrait names the family when there is one; otherwise the
      // address does, the same grouping the directory shows.
      family: row.photo?.trim() || householdKey(row),
    });
  }

  const rounds = [...byPhoto.values()].sort((a, b) => a.photo.localeCompare(b.photo));
  res.json({ success: true, rounds });
});

// ─── GET /api/member-match/photo/:filename ─────────────────────────────────
// Any photo on file, for any approved member — unlike a profile photo, a
// matching game showing only your own household would not be much of a game.

router.get('/photo/:filename', (req, res) => {
  // path.basename() strips any directory component before photoStore's own
  // whitelist check ever sees the value, so nothing derived from the request
  // reaches sendFile still carrying a path to follow.
  const filename = path.basename(req.params.filename);
  const file = photoStore.photoPath(filename);
  if (!file || !photoStore.exists(filename)) {
    return res.status(404).json({ success: false, error: 'No such photo' });
  }

  res.set('Cache-Control', 'private, max-age=86400');
  res.sendFile(file);
});

module.exports = router;
