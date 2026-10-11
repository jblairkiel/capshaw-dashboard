// ─── Sign-up lists ────────────────────────────────────────────────────────────
// Any member can make one; whoever made it keeps it; whoever holds `signups`
// keeps them all and sees the analytics (lib/signupLists.js). Every list has
// its own permanent link: /?page=signups&list=<id>.
const express = require('express');
const router  = express.Router();
const { requireAuth, requireApproved, requireArea, holdsArea } = require('../middleware/auth');
const actionLog = require('../lib/actionLog');
const lists = require('../lib/signupLists');
const groups = require('../mail/groups');
const { compose, sendSignupEmail } = require('../mail/signups');
// Read through the module, so a test can say what day it is.
const recordKeeping = require('../lib/recordKeeping');
const today = () => recordKeeping.churchToday();

const AREA = lists.AREA;
router.use(requireAuth);

const fail = (res, result) => res.status(result.status || 400).json({ success: false, error: result.error });
const canEmailGroups = user => lists.isManager(user) || holdsArea(user, 'mail-groups');

// GET /api/signups — every list, newest first.
router.get('/', (req, res) => {
  res.json({ success: true, lists: lists.summaries(req.user, today()), canManage: lists.isManager(req.user) });
});

// GET /api/signups/analytics — for the sign-up manager.
router.get('/analytics', requireArea(AREA), (req, res) => {
  res.json({ success: true, ...lists.analytics(today()) });
});

// GET /api/signups/:id — one list, and what this person may do with it.
router.get('/:id(\\d+)', (req, res) => {
  const list = lists.detail(req.params.id, req.user, today());
  if (!list) return res.status(404).json({ success: false, error: 'That sign-up is not here any more' });
  const emailGroups = list.canEdit && canEmailGroups(req.user)
    ? groups.listGroups().map(g => ({ key: g.key, name: g.name }))
    : [];
  res.json({ success: true, list, emailGroups, canManage: lists.isManager(req.user) });
});

// POST /api/signups — a new list.
router.post('/', requireApproved, (req, res) => {
  const result = lists.create(req.user, req.body);
  if (result.error) return fail(res, result);
  const list = lists.detail(result.id, req.user, today());
  actionLog.record(req.user, {
    area: AREA, action: 'create', entity: 'sign-up list', entityId: list.id,
    summary: `Made the sign-up “${list.title}”`, after: req.body,
  });
  res.status(201).json({ success: true, list });
});

// PUT /api/signups/:id — change it.
router.put('/:id(\\d+)', requireApproved, (req, res) => {
  const result = lists.update(req.user, req.params.id, req.body);
  if (result.error) return fail(res, result);
  const list = lists.detail(result.id, req.user, today());
  actionLog.record(req.user, {
    area: AREA, action: 'update', entity: 'sign-up list', entityId: list.id,
    summary: `Changed the sign-up “${list.title}”`, before: result.before, after: req.body,
  });
  res.json({ success: true, list });
});

// POST /api/signups/:id/close { closed } — stop (or start again) taking names.
router.post('/:id(\\d+)/close', requireApproved, (req, res) => {
  const closed = req.body?.closed !== false;
  const result = lists.setClosed(req.user, req.params.id, closed);
  if (result.error) return fail(res, result);
  actionLog.record(req.user, {
    area: AREA, action: 'update', entity: 'sign-up list', entityId: result.list.id,
    summary: `${closed ? 'Closed' : 'Reopened'} the sign-up “${result.list.title}”`,
  });
  res.json({ success: true, list: lists.detail(result.list.id, req.user, today()) });
});

// DELETE /api/signups/:id
router.delete('/:id(\\d+)', requireApproved, (req, res) => {
  const result = lists.remove(req.user, req.params.id);
  if (result.error) return fail(res, result);
  actionLog.record(req.user, {
    area: AREA, action: 'delete', entity: 'sign-up list', entityId: result.list.id,
    summary: `Deleted the sign-up “${result.list.title}”${result.entries ? ` and its ${result.entries} name${result.entries === 1 ? '' : 's'}` : ''}`,
    before: result.list,
  });
  res.json({ success: true });
});

// POST /api/signups/:id/entries { dateId, itemId, note, name? } — sign up.
router.post('/:id(\\d+)/entries', requireApproved, (req, res) => {
  const result = lists.signUp(req.user, req.params.id, req.body, today());
  if (result.error) return fail(res, result);
  const { entry, list, date, item } = result;
  actionLog.record(req.user, {
    area: AREA, action: 'create', entity: 'sign-up', entityId: entry.id,
    summary: `${entry.name} signed up for ${item ? `“${item.label}”` : `“${entry.note}”`} on “${list.title}”, ${date.date}`,
  });
  res.json({ success: true, list: lists.detail(list.id, req.user, today()) });
});

// DELETE /api/signups/entries/:entryId — take a name off.
router.delete('/entries/:entryId(\\d+)', requireApproved, (req, res) => {
  const result = lists.removeEntry(req.user, req.params.entryId);
  if (result.error) return fail(res, result);
  actionLog.record(req.user, {
    area: AREA, action: 'delete', entity: 'sign-up', entityId: result.entry.id,
    summary: `Took ${result.entry.name} off “${result.list.title}”`, before: result.entry,
  });
  res.json({ success: true, list: lists.detail(result.list.id, req.user, today()) });
});

// ─── Emailing about a list ────────────────────────────────────────────────────
// { to: 'signed-up' | <distribution group key>, subject, message }

function readEmail(req) {
  const row = lists.listRow(req.params.id);
  if (!row) return { error: 'No such sign-up', status: 404 };
  if (!lists.canEdit(req.user, row)) return { error: 'Only whoever made this sign-up, or the sign-up manager, can email about it', status: 403 };
  const list = lists.detail(row.id, req.user, today());
  const to = String(req.body?.to || 'signed-up');
  let recipients; let missing; let audience;
  if (to === 'signed-up') {
    ({ recipients, missing } = lists.peopleOn(row.id));
    audience = 'everyone signed up';
  } else {
    if (!canEmailGroups(req.user)) return { error: 'Only the sign-up manager can email a whole group', status: 403 };
    const found = groups.recipientsFor(to);
    if (!found.group) return { error: 'No such email group' };
    ({ recipients, missing } = found);
    audience = found.group.name;
  }
  const message = String(req.body?.message || '').slice(0, 5000);
  const email = compose.signupEmail({ list, subject: req.body?.subject, message, from: req.user?.name || '' });
  return { list, to, audience, recipients, missing, email, message };
}

router.post('/:id(\\d+)/email/preview', requireApproved, (req, res) => {
  const read = readEmail(req);
  if (read.error) return fail(res, read);
  res.json({ success: true, ...read.email, audience: read.audience, count: read.recipients.length, missing: read.missing });
});

router.post('/:id(\\d+)/email', requireApproved, (req, res) => {
  const read = readEmail(req);
  if (read.error) return fail(res, read);
  if (!read.message.trim()) return res.status(400).json({ success: false, error: 'Add a few words of your own before sending' });
  if (!read.recipients.length) return res.status(400).json({ success: false, error: 'Nobody there has an email address to send to' });
  const queued = sendSignupEmail({ list: read.list, recipients: read.recipients, email: read.email });
  actionLog.record(req.user, {
    area: AREA, action: 'create', entity: 'sign-up email', entityId: read.list.id,
    summary: `Emailed ${read.audience} about “${read.list.title}” (${queued.length} ${queued.length === 1 ? 'person' : 'people'})`,
    details: { subject: read.email.subject, to: read.to },
  });
  res.json({ success: true, sent: queued.length, missing: read.missing });
});

module.exports = router;
