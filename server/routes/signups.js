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

// GET /api/signups/calendar — every sign-up date, for the church calendar.
// Everyone signed in can see every list, so everyone sees these.
router.get('/calendar', (req, res) => {
  res.json({ success: true, dates: lists.calendarDates() });
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

// ─── Telling the people a change concerns ─────────────────────────────────────
// Somebody else putting your name down or taking it off, a date you are on
// moving, or the list going: you hear about it. And taking your own name off
// tells whoever made the list, who was counting on you.

const db = require('../db');
const notices = require('../mail/notices');

const entryWhat = (entry, item) => (item ? `“${item.label}”` : `“${entry.note}”`);
const signupNotice = (list, actor) => ({
  kind: 'signup-changed', page: 'signups', params: { list: list.id }, actor,
  why: `your name is on the sign-up “${list.title}”`,
});
const ENTRIES_AHEAD = `
  SELECT e.*, d.date AS on_date, d.time AS on_time, i.label AS item_label
    FROM signup_entries e JOIN signup_dates d ON d.id = e.date_id LEFT JOIN signup_items i ON i.id = e.item_id
   WHERE d.date >= ?`;
// Every entry on a list for a date still to come — or one entry, if it is.
const entriesAhead = listId => db.prepare(`${ENTRIES_AHEAD} AND e.list_id = ?`).all(today(), listId);
const entryAhead = entryId => db.prepare(`${ENTRIES_AHEAD} AND e.id = ?`).get(today(), entryId);

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
  // Who is on each date to come, and when it was, so anybody whose date moves
  // can be told.
  const was = new Map(db.prepare('SELECT id, date, time FROM signup_dates WHERE list_id = ?').all(Number(req.params.id)).map(d => [d.id, d]));
  const onDates = entriesAhead(Number(req.params.id));
  const result = lists.update(req.user, req.params.id, req.body);
  if (result.error) return fail(res, result);
  const list = lists.detail(result.id, req.user, today());
  actionLog.record(req.user, {
    area: AREA, action: 'update', entity: 'sign-up list', entityId: list.id,
    summary: `Changed the sign-up “${list.title}”`, before: result.before, after: req.body,
  });
  const now = new Map(db.prepare('SELECT id, date, time FROM signup_dates WHERE list_id = ?').all(list.id).map(d => [d.id, d]));
  for (const entry of onDates) {
    const before = was.get(entry.date_id);
    const after = now.get(entry.date_id);
    if (!before || !after || (before.date === after.date && before.time === after.time)) continue;
    const when = d => `${d.date}${d.time ? ` at ${d.time}` : ''}`;
    notices.signups([{ directoryId: entry.directory_id, userId: entry.user_id, name: entry.name }], {
      ...signupNotice(list, req.user),
      subject: `Date changed on “${list.title}”: now ${when(after)}`,
      lines: [`${req.user.name} has moved a date you signed up for on “${list.title}”. You are down for ${entry.item_label ? `“${entry.item_label}”` : `“${entry.note}”`}, which was ${when(before)} and is now ${when(after)}.`],
    }, `${list.id}:entry:${entry.id}:moved`);
  }
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
  const going = lists.listRow(req.params.id);
  const onDates = going ? entriesAhead(going.id) : [];
  const result = lists.remove(req.user, req.params.id);
  if (result.error) return fail(res, result);
  actionLog.record(req.user, {
    area: AREA, action: 'delete', entity: 'sign-up list', entityId: result.list.id,
    summary: `Deleted the sign-up “${result.list.title}”${result.entries ? ` and its ${result.entries} name${result.entries === 1 ? '' : 's'}` : ''}`,
    before: result.list,
  });
  // Everybody still down for a date to come: what they signed up for is gone.
  notices.signups(onDates.map(e => ({ directoryId: e.directory_id, userId: e.user_id, name: e.name })), {
    ...signupNotice(result.list, req.user), page: 'signups', params: {},
    subject: `The sign-up “${result.list.title}” has been taken down`,
    lines: [`${req.user.name} has deleted the sign-up “${result.list.title}”, so you are no longer down for anything on it.`],
  }, `${result.list.id}:deleted`);
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
  // Put down by somebody else: they hear they are on it.
  if (req.body?.name) {
    notices.signups([{ directoryId: entry.directory_id, name: entry.name }], {
      ...signupNotice(list, req.user),
      subject: `You are down for ${entryWhat(entry, item)} on “${list.title}”`,
      lines: [`${req.user.name} has put you down for ${entryWhat(entry, item)} on “${list.title}”, ${date.date}${date.time ? ` at ${date.time}` : ''}.`,
        'If you cannot do it, please let them know, or take your name off on the sign-up.'],
    }, `${list.id}:entry:${entry.id}:added`);
  }
  res.json({ success: true, list: lists.detail(list.id, req.user, today()) });
});

// DELETE /api/signups/entries/:entryId — take a name off.
router.delete('/entries/:entryId(\\d+)', requireApproved, (req, res) => {
  const ahead = entryAhead(Number(req.params.entryId));
  const result = lists.removeEntry(req.user, req.params.entryId);
  if (result.error) return fail(res, result);
  actionLog.record(req.user, {
    area: AREA, action: 'delete', entity: 'sign-up', entityId: result.entry.id,
    summary: `Took ${result.entry.name} off “${result.list.title}”`, before: result.entry,
  });
  const { entry, list } = result;
  if (ahead) {
    const what = ahead.item_label ? `“${ahead.item_label}”` : `“${entry.note}”`;
    const when = `${ahead.on_date}${ahead.on_time ? ` at ${ahead.on_time}` : ''}`;
    const own = entry.user_id === req.user.id || (!!req.user.directory_id && entry.directory_id === req.user.directory_id);
    if (own) {
      // Whoever made the list was counting on them.
      if (list.created_by) {
        notices.signups([{ userId: list.created_by }], {
          ...signupNotice(list, req.user), why: `you made the sign-up “${list.title}”`,
          subject: `${entry.name} took their name off “${list.title}”`,
          lines: [`${entry.name} is no longer down for ${what} on “${list.title}”, ${when}.`],
        }, `${list.id}:entry:${entry.id}:withdrawn`);
      }
    } else {
      notices.signups([{ directoryId: entry.directory_id, userId: entry.user_id, name: entry.name }], {
        ...signupNotice(list, req.user),
        subject: `You are no longer down for ${what} on “${list.title}”`,
        lines: [`${req.user.name} has taken your name off ${what} on “${list.title}”, ${when}.`],
      }, `${list.id}:entry:${entry.id}:removed`);
    }
  }
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
