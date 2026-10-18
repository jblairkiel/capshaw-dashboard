// ─── Bible Jeopardy ───────────────────────────────────────────────────────────
// Games built in the Excel template and uploaded (lib/jeopardy.js). A game,
// like the Bible Quiz, so any approved member may make and play one; whoever
// made a game, or holds Bible Quiz Keeper, may change or delete it.
const express = require('express');
const multer  = require('multer');
const router  = express.Router();
const { requireApproved } = require('../middleware/auth');
const actionLog = require('../lib/actionLog');
const jeopardy  = require('../lib/jeopardy');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: jeopardy.MAX_FILE_BYTES, files: 1 },
});

// Multer's own errors (a file too large) as the page's usual JSON.
function receive(req, res, next) {
  upload.single('file')(req, res, err => {
    if (!err) return next();
    const error = err.code === 'LIMIT_FILE_SIZE'
      ? 'That file is too large. A game template is well under 2 MB.'
      : 'The file could not be read. Please try again.';
    res.status(400).json({ success: false, error });
  });
}

router.use(requireApproved);

const fail = (res, result) => res.status(result.status || 400).json({ success: false, error: result.error, errors: result.errors });

// The board in an uploaded file, or the reasons it could not be read.
async function boardFromUpload(req) {
  if (!req.file) return { errors: ['Choose the filled-in template to upload'] };
  const { board, errors } = await jeopardy.readBoard(req.file.buffer);
  return errors ? { errors } : { board };
}

// GET /api/jeopardy/template — the Excel template to fill in.
router.get('/template', async (req, res) => {
  const buffer = await jeopardy.template();
  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': 'attachment; filename="Bible Jeopardy template.xlsx"',
  });
  res.send(buffer);
});

// GET /api/jeopardy?q= — the saved games, newest first, or those matching a search.
router.get('/', (req, res) => {
  res.json({ success: true, games: jeopardy.list(req.user, req.query.q) });
});

// GET /api/jeopardy/:id — one game with its board, for playing.
router.get('/:id(\\d+)', (req, res) => {
  const game = jeopardy.get(req.params.id, req.user);
  if (!game) return res.status(404).json({ success: false, error: 'No such game' });
  res.json({ success: true, game });
});

// POST /api/jeopardy (multipart: file, title) — a new game from a filled-in template.
router.post('/', receive, async (req, res) => {
  const read = await boardFromUpload(req);
  if (read.errors) return res.status(400).json({ success: false, error: 'The template needs a few things put right', errors: read.errors });

  const result = jeopardy.create(req.user, { title: req.body?.title, board: read.board });
  if (result.error) return fail(res, result);
  actionLog.record(req.user, {
    area: jeopardy.AREA, action: 'create', entity: 'jeopardy game', entityId: result.game.id,
    summary: `Made the Bible Jeopardy game "${result.game.title}"`,
    details: { categories: result.game.categoryNames, clues: result.game.clueCount },
  });
  res.status(201).json({ success: true, game: result.game });
});

// PUT /api/jeopardy/:id (multipart: title?, file?) — rename a game, or replace
// its board with a corrected template. The link stays the same.
router.put('/:id(\\d+)', receive, async (req, res) => {
  let board;
  if (req.file) {
    const read = await boardFromUpload(req);
    if (read.errors) return res.status(400).json({ success: false, error: 'The template needs a few things put right', errors: read.errors });
    board = read.board;
  }
  const result = jeopardy.update(req.user, req.params.id, { title: req.body?.title, board });
  if (result.error) return fail(res, result);

  const changed = [board && 'uploaded a new board', result.before.title !== result.game.title && `renamed it from "${result.before.title}"`].filter(Boolean);
  actionLog.record(req.user, {
    area: jeopardy.AREA, action: 'update', entity: 'jeopardy game', entityId: result.game.id,
    summary: `Changed the Bible Jeopardy game "${result.game.title}"${changed.length ? `: ${changed.join(', ')}` : ''}`,
    details: { before: { title: result.before.title, categories: result.before.categoryNames }, after: { title: result.game.title, categories: result.game.categoryNames } },
  });
  res.json({ success: true, game: result.game });
});

// DELETE /api/jeopardy/:id
router.delete('/:id(\\d+)', (req, res) => {
  const result = jeopardy.remove(req.user, req.params.id);
  if (result.error) return fail(res, result);
  actionLog.record(req.user, {
    area: jeopardy.AREA, action: 'delete', entity: 'jeopardy game', entityId: result.before.id,
    summary: `Deleted the Bible Jeopardy game "${result.before.title}"`,
    before: { title: result.before.title, categories: result.before.categoryNames },
  });
  res.json({ success: true });
});

module.exports = router;
