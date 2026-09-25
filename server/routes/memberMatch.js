const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { requireApproved } = require('../middleware/auth');
const photoStore = require('../lib/photoStore');

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

router.use(requireApproved);

// ─── GET /api/member-match/rounds ──────────────────────────────────────────
// Every photo on file, with who is in it. A photo held by one person is a
// single round; held by several, it is a family photo the client asks about
// one member at a time.

router.get('/rounds', (req, res) => {
  const rows = db.prepare(`
    SELECT photo, id, name FROM directory
    WHERE trim(photo) <> '' AND trim(name) <> ''
    ORDER BY photo, name
  `).all();

  const byPhoto = new Map();
  for (const row of rows) {
    if (!byPhoto.has(row.photo)) byPhoto.set(row.photo, []);
    byPhoto.get(row.photo).push({ id: row.id, name: row.name });
  }

  const rounds = [...byPhoto.entries()].map(([photo, members]) => ({ photo, members }));
  res.json({ success: true, rounds });
});

// ─── GET /api/member-match/photo/:filename ─────────────────────────────────
// Any photo on file, for any approved member — unlike a profile photo, a
// matching game showing only your own household would not be much of a game.

router.get('/photo/:filename', (req, res) => {
  const file = photoStore.photoPath(req.params.filename);
  if (!file || !photoStore.exists(req.params.filename)) {
    return res.status(404).json({ success: false, error: 'No such photo' });
  }

  res.set('Cache-Control', 'private, max-age=86400');
  res.sendFile(file);
});

module.exports = router;
