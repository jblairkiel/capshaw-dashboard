// ─── Rotations ────────────────────────────────────────────────────────────────
// Anything the church takes in turns (lib/rotations.js). Everybody signed in
// can read every rotation. Whoever holds the rotations area starts, retires and
// deletes them and says who coordinates each; a coordinator runs only their
// own — who is in it, the order, and the turns. Whoever is next up is told when
// the rotation moves on (mail/rotations.js).
const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { requireAuth, requireApproved, requireArea } = require('../middleware/auth');
const actionLog = require('../lib/actionLog');
const rotations = require('../lib/rotations');
const { tellNextUp, tellTurnGiven } = require('../mail/rotations');
const notices = require('../mail/notices');

const rotationNotice = (req, extra) => ({
  kind: 'rotation-changed', page: 'rotations', params: { rotation: req.rotation.id },
  subjectType: 'rotation', subjectId: req.rotation.id, actor: req.user,
  why: `your name is on the "${req.rotation.name}" rotation`, ...extra,
});
// Read through the module, so a test can say what day it is.
const recordKeeping = require('../lib/recordKeeping');
const churchToday = () => recordKeeping.churchToday();

const AREA = rotations.AREA;
const manageOnly = requireArea(AREA);

router.use(requireAuth);

// A coordinator of this rotation, or whoever holds the area.
function runOnly(req, res, next) {
  const rotation = rotations.rotationRow(req.params.id);
  if (!rotation) return res.status(404).json({ success: false, error: 'No such rotation' });
  if (!rotations.coordinates(req.user, rotation.id)) {
    return res.status(403).json({ success: false, error: 'Only this rotation\'s coordinators can change it' });
  }
  req.rotation = rotation;
  next();
}

const fail = (res, result) => res.status(result.status || 400).json({ success: false, error: result.error });
const full = (req, id) => rotations.detail(id, { user: req.user, today: churchToday() });

function log(req, entry) {
  actionLog.record(req.user, { area: AREA, entity: 'rotation', entityId: req.rotation?.id ?? entry.entityId, ...entry });
}

// Whoever is now next up is told, and the answer says so, so the page can too
// (and, for a turn just given, whether its person was told about it).
function respond(req, res, { status = 200, tell = false, given = null } = {}) {
  const told = tell ? tellNextUp(req.rotation.id, { actor: req.user }) : null;
  res.status(status).json({ success: true, rotation: full(req, req.rotation.id), told, given });
}

// GET /api/rotations[?retired=1] — every rotation, and whether this person may start one.
router.get('/', (req, res) => {
  const canManage = rotations.managesRotations(req.user);
  res.json({
    success: true,
    canManage,
    rotations: rotations.list({ user: req.user, today: churchToday(), includeRetired: canManage && req.query.retired === '1' }),
  });
});

// GET /api/rotations/people — the member directory, for choosing who is in a
// rotation or coordinates one.
router.get('/people', requireApproved, (req, res) => {
  const people = db.prepare("SELECT id, name FROM directory WHERE trim(name) <> '' ORDER BY name COLLATE NOCASE").all();
  res.json({ success: true, people });
});

// GET /api/rotations/:id
router.get('/:id', (req, res) => {
  const rotation = full(req, req.params.id);
  if (!rotation) return res.status(404).json({ success: false, error: 'No such rotation' });
  res.json({ success: true, rotation });
});

// POST /api/rotations { name, description, coordinatorIds } — start one.
router.post('/', requireApproved, manageOnly, (req, res) => {
  const result = rotations.create(req.body || {}, req.user);
  if (result.error) return fail(res, result);
  req.rotation = result.rotation;
  log(req, { action: 'create', summary: `Started the "${result.rotation.name}" rotation`, after: result.rotation });
  respond(req, res, { status: 201 });
});

// PATCH /api/rotations/:id { name?, description?, active? }
router.patch('/:id', requireApproved, runOnly, (req, res) => {
  const result = rotations.update(req.rotation.id, req.body || {}, { canManage: rotations.managesRotations(req.user) });
  if (result.error) return fail(res, result);
  const { before, rotation } = result;
  const summary = before.active !== rotation.active
    ? `${rotation.active ? 'Brought back' : 'Retired'} the "${rotation.name}" rotation`
    : `Changed the "${rotation.name}" rotation`;
  log(req, { action: 'update', summary, before, after: rotation });
  respond(req, res);
});

// DELETE /api/rotations/:id — gone, with its turns.
router.delete('/:id', requireApproved, manageOnly, (req, res) => {
  const result = rotations.remove(req.params.id);
  if (result.error) return fail(res, result);
  actionLog.record(req.user, {
    area: AREA, action: 'delete', entity: 'rotation', entityId: result.before.id,
    summary: `Deleted the "${result.before.name}" rotation`, before: result.before,
  });
  res.json({ success: true });
});

// PUT /api/rotations/:id/coordinators { directoryIds }
router.put('/:id/coordinators', requireApproved, manageOnly, runOnly, (req, res) => {
  const result = rotations.setCoordinators(req.rotation.id, req.body?.directoryIds);
  if (result.error) return fail(res, result);
  const names = result.after.map(c => c.name);
  log(req, {
    action: 'update',
    summary: `${names.length ? `${names.join(', ')} now coordinate` : 'Nobody coordinates'} the "${req.rotation.name}" rotation`,
    before: result.before, after: result.after,
  });
  respond(req, res);
});

// POST /api/rotations/:id/members { directoryIds } — added at the back.
router.post('/:id/members', requireApproved, runOnly, (req, res) => {
  const result = rotations.addMembers(req.rotation.id, req.body?.directoryIds);
  if (result.error) return fail(res, result);
  if (result.added.length) {
    log(req, { action: 'update', summary: `Added ${result.added.map(a => a.name).join(', ')} to the "${req.rotation.name}" rotation` });
  }
  respond(req, res);
});

// DELETE /api/rotations/:id/members/:directoryId
router.delete('/:id/members/:directoryId', requireApproved, runOnly, (req, res) => {
  const result = rotations.removeMember(req.rotation.id, req.params.directoryId);
  if (result.error) return fail(res, result);
  log(req, { action: 'update', summary: `Took ${result.removed.name} off the "${req.rotation.name}" rotation` });
  notices.rotations([{ directoryId: result.removed.directoryId }], rotationNotice(req, {
    subject: `You are no longer on the "${req.rotation.name}" rotation`,
    lines: [`${req.user.name} has taken you off the "${req.rotation.name}" rotation, so your turn will not come round any more.`,
      'If that is a mistake, please let them know.'],
  }), `${req.rotation.id}:member:${result.removed.directoryId}:removed`);
  respond(req, res);
});

// PUT /api/rotations/:id/order { order: [directoryId, …] } — tells nobody.
router.put('/:id/order', requireApproved, runOnly, (req, res) => {
  const result = rotations.reorder(req.rotation.id, req.body?.order);
  if (result.error) return fail(res, result);
  log(req, { action: 'update', summary: `Changed the order of the "${req.rotation.name}" rotation` });
  respond(req, res);
});

// PATCH /api/rotations/:id/members/:directoryId { sittingOut }
router.patch('/:id/members/:directoryId', requireApproved, runOnly, (req, res) => {
  const result = rotations.setSittingOut(req.rotation.id, req.params.directoryId, !!req.body?.sittingOut);
  if (result.error) return fail(res, result);
  const { member } = result;
  log(req, {
    action: 'update',
    summary: `${member.name} ${member.sittingOut ? 'is sitting out' : 'is back in'} the "${req.rotation.name}" rotation`,
  });
  respond(req, res);
});

// POST /api/rotations/:id/members/:directoryId/back — passes, without a turn.
router.post('/:id/members/:directoryId/back', requireApproved, runOnly, (req, res) => {
  const result = rotations.sendToBack(req.rotation.id, req.params.directoryId);
  if (result.error) return fail(res, result);
  log(req, { action: 'update', summary: `Sent ${result.member.name} to the back of the "${req.rotation.name}" rotation` });
  respond(req, res, { tell: true });
});

// POST /api/rotations/:id/turns { directoryId?, date?, note? } — next up, unless
// somebody else is named.
router.post('/:id/turns', requireApproved, runOnly, (req, res) => {
  const result = rotations.giveTurn(req.rotation.id, req.body || {}, req.user);
  if (result.error) return fail(res, result);
  const { turn } = result;
  log(req, {
    action: 'create', entity: 'rotation turn', entityId: turn.id,
    summary: `Gave ${turn.name} a turn on the "${req.rotation.name}" rotation${turn.date ? ` on ${turn.date}` : ''}`,
    after: turn,
  });
  respond(req, res, { status: 201, tell: true, given: tellTurnGiven(turn, { actor: req.user }) });
});

// DELETE /api/rotations/:id/turns/:turnId[?requeue=1] — requeue puts them back at the front.
router.delete('/:id/turns/:turnId', requireApproved, runOnly, (req, res) => {
  const requeue = req.query.requeue === '1';
  const result = rotations.removeTurn(req.rotation.id, req.params.turnId, { requeue });
  if (result.error) return fail(res, result);
  const { before } = result;
  log(req, {
    action: 'delete', entity: 'rotation turn', entityId: before.id,
    summary: requeue
      ? `Cancelled ${before.name}'s turn on the "${req.rotation.name}" rotation and put them back at the front`
      : `Took ${before.name}'s turn${before.date ? ` on ${before.date}` : ''} out of the "${req.rotation.name}" history`,
    before,
  });
  // A turn still to come, called off: whoever had it was getting ready for it.
  if (before.date && before.date >= churchToday()) {
    notices.rotations([{ directoryId: before.directory_id, name: before.name }], rotationNotice(req, {
      subject: `Your turn on "${req.rotation.name}" on ${before.date} is off`,
      lines: [`${req.user.name} has cancelled your turn on the "${req.rotation.name}" rotation on ${before.date}.${requeue ? ' You are back at the front of the line, so your turn will come round again next.' : ''}`],
    }), `${req.rotation.id}:turn:${before.id}:cancelled`);
  }
  respond(req, res);
});

// POST /api/rotations/:id/remind — tell whoever is next up, now.
router.post('/:id/remind', requireApproved, runOnly, (req, res) => {
  const told = tellNextUp(req.rotation.id, { actor: req.user, force: true });
  if (!told) return res.status(400).json({ success: false, error: 'There is nobody next up to tell' });
  log(req, { action: 'update', summary: `Let ${told.name} know they are next up on the "${req.rotation.name}" rotation` });
  res.json({ success: true, rotation: full(req, req.rotation.id), told });
});

module.exports = router;
