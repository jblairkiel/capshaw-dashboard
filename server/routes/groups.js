const express = require('express');
const router  = express.Router();
const db      = require('../db');

const groups        = require('../lib/churchGroups');
const events        = require('../lib/groupEvents');
const comments      = require('../lib/eventComments');
const notifications = require('../lib/notifications');
const actionLog     = require('../lib/actionLog');
const notify        = require('../mail/notify');
const { requireAuth, requireApproved } = require('../middleware/auth');

// ─── Church groups ────────────────────────────────────────────────────────────
//
// Three different people use this router, and every route below is written
// around which of them is asking:
//
//   · whoever looks after every group (the 'church-groups' area) — makes the
//     groups, generates a set of them at once, appoints the leaders
//   · a group's leader or co-leader — keeps their own group's roll, and posts,
//     changes and cancels their own group's meetings
//   · everybody else on a roll — reads their group's meetings, answers the
//     invitation, takes something off the sign-up list, and replies
//
// Reading the list of groups is open to anyone signed in: which groups the
// congregation has is not a secret. What is inside one is not.

router.use(requireAuth);

// ─── Loading the group a request is about ─────────────────────────────────────

function loadGroup(req, res, next) {
  const group = groups.getGroup(req.params.groupId);
  if (!group) return res.status(404).json({ success: false, error: 'No such group' });

  req.group = group;
  req.perms = {
    manages: groups.managesGroups(req.user),
    leads:   groups.leadsGroup(req.user, group.id),
    belongs: groups.belongsToGroup(req.user, group.id),
    myRole:  groups.roleInGroup(req.user, group.id),
  };
  next();
}

function requireManages(req, res, next) {
  if (!req.perms?.manages && !groups.managesGroups(req.user)) {
    return res.status(403).json({
      success: false,
      error:   'You do not look after the church groups. Ask an admin if you should.',
      area:    'church-groups',
    });
  }
  next();
}

function requireLeads(req, res, next) {
  if (!req.perms.leads) {
    return res.status(403).json({
      success: false,
      error:   `Only ${req.group.name}'s leaders can do that.`,
    });
  }
  next();
}

function requireBelongs(req, res, next) {
  if (!req.perms.belongs) {
    return res.status(403).json({ success: false, error: `You are not in ${req.group.name}.` });
  }
  next();
}

// ─── GET /api/groups ──────────────────────────────────────────────────────────
// The whole set, what this account's part in each is, and what is coming up in
// the groups they are actually in.

router.get('/', (req, res) => {
  const mine = groups.groupsForUser(req.user);
  const upcoming = events.upcomingForGroups(mine.map(g => g.id));
  const counts = comments.commentCounts('group-event', upcoming.map(e => e.id));

  res.json({
    success: true,
    groups: groups.listGroups(),
    mine,
    upcoming: upcoming.map(event => ({
      ...event,
      rsvp:     events.rsvpOf(event.id, req.user.id),
      summary:  events.rsvpSummary(event.id),
      comments: counts[event.id] ?? 0,
    })),
    roles: groups.GROUP_ROLES,
    canManage: groups.managesGroups(req.user),
    // An account nobody has matched to a directory entry cannot be put on a
    // roll, and saying so is more use than an empty page.
    linkedToDirectory: !!req.user.directory_id,
  });
});

// ─── POST /api/groups ─────────────────────────────────────────────────────────

router.post('/', requireApproved, requireManages, (req, res) => {
  const result = groups.createGroup({
    name:        req.body?.name,
    key:         req.body?.key,
    description: req.body?.description ?? '',
    meets:       req.body?.meets ?? '',
    location:    req.body?.location ?? '',
    email:       req.body?.email ?? '',
  });
  if (result.error) return res.status(400).json({ success: false, error: result.error });

  actionLog.record(req.user, {
    area:     'church-groups',
    action:   'create',
    entity:   'church group',
    entityId: result.group.id,
    summary:  `Created the ${result.group.name} church group`,
    after:    result.group,
  });
  res.json({ success: true, group: result.group });
});

// ─── POST /api/groups/generate ────────────────────────────────────────────────
// The whole set at once. Running it again tops the set up rather than starting
// over: keys that already exist are reported as skipped, and nobody already on
// a roll is moved.

router.post('/generate', requireApproved, requireManages, (req, res) => {
  const result = groups.generateGroups({
    count:         req.body?.count,
    prefix:        req.body?.prefix,
    startAt:       req.body?.startAt,
    meets:         req.body?.meets,
    emailDomain:   req.body?.emailDomain,
    assignMembers: !!req.body?.assignMembers,
    createdBy:     req.user.id,
  });
  if (result.error) return res.status(400).json({ success: false, error: result.error });

  actionLog.record(req.user, {
    area:     'church-groups',
    action:   'create',
    entity:   'church group',
    summary:  `Generated ${result.created.length} church group(s)` +
              (result.assigned?.placed ? `, placing ${result.assigned.placed} people` : '') +
              (result.skipped.length ? `, skipping ${result.skipped.length} that already existed` : ''),
    details:  {
      created: result.created.map(g => g.key),
      skipped: result.skipped,
      assigned: result.assigned,
    },
  });

  // Everybody who was placed hears where they landed, so a generated set does
  // not leave two hundred people to find out by accident.
  for (const group of result.created) {
    const roll = groups.membersOf(group.id);
    notifications.notify({
      users: roll.map(m => m.userId),
      kind:  'group-membership',
      title: `You are in ${group.name}`,
      body:  group.meets ? `${group.name} meets ${group.meets}.` : `Say hello to your church group.`,
      subjectType: 'church-group',
      subjectId: group.id,
      actor: req.user,
    });
  }

  res.json({ success: true, ...result, groups: groups.listGroups() });
});

// ─── GET /api/groups/:groupId ─────────────────────────────────────────────────

router.get('/:groupId', loadGroup, (req, res) => {
  // The roll and the meetings belong to the group. Somebody who is not in it
  // sees the group exists, who leads it and when it meets, and no more.
  if (!req.perms.belongs) {
    return res.json({
      success: true,
      group:   req.group,
      perms:   { ...req.perms, canSeeRoll: false },
      members: [],
      events:  [],
    });
  }

  const list = events.eventsForGroup(req.group.id, { includeDrafts: req.perms.leads });
  const counts = comments.commentCounts('group-event', list.map(e => e.id));

  res.json({
    success: true,
    group:   req.group,
    perms:   { ...req.perms, canSeeRoll: true },
    members: groups.membersOf(req.group.id),
    events: list.map(event => ({
      ...event,
      rsvp:     events.rsvpOf(event.id, req.user.id),
      summary:  events.rsvpSummary(event.id),
      comments: counts[event.id] ?? 0,
    })),
    roles: groups.GROUP_ROLES,
    // Everybody in the directory who is not on this roll yet, for the leader's
    // "add somebody" box.
    candidates: req.perms.leads
      ? db.prepare(`
          SELECT d.id, d.name, d.email FROM directory d
           WHERE NOT EXISTS (SELECT 1 FROM church_group_members m WHERE m.group_id = ? AND m.directory_id = d.id)
           ORDER BY d.name ASC LIMIT 800
        `).all(req.group.id)
      : [],
  });
});

// ─── PUT /api/groups/:groupId ─────────────────────────────────────────────────
// A leader keeps their own group's details — when and where it meets, what it
// is for. Retiring a group, renaming it and its mailing list, are the group
// manager's.

router.put('/:groupId', requireApproved, loadGroup, (req, res) => {
  if (!req.perms.leads) {
    return res.status(403).json({ success: false, error: `Only ${req.group.name}'s leaders can edit it.` });
  }

  const fields = {
    description: req.body?.description,
    meets:       req.body?.meets,
    location:    req.body?.location,
  };
  // Only the group manager may rename a group, change its address or retire
  // it: those three follow the group into the mailing list and the directory
  // of groups, which are everybody's.
  if (req.perms.manages) {
    fields.name      = req.body?.name;
    fields.email     = req.body?.email;
    fields.active    = req.body?.active;
    fields.sortOrder = req.body?.sortOrder;
  }

  const result = groups.updateGroup(req.group.id, fields);
  if (result.error) return res.status(400).json({ success: false, error: result.error });

  actionLog.record(req.user, {
    area:     'church-groups',
    action:   'update',
    entity:   'church group',
    entityId: req.group.id,
    summary:  `Edited the ${result.group.name} church group`,
    before:   result.before,
    after:    result.group,
  });
  res.json({ success: true, group: result.group });
});

// ─── DELETE /api/groups/:groupId ──────────────────────────────────────────────

router.delete('/:groupId', requireApproved, loadGroup, requireManages, (req, res) => {
  const result = groups.deleteGroup(req.group.id);
  if (result.error) return res.status(400).json({ success: false, error: result.error });

  actionLog.record(req.user, {
    area:     'church-groups',
    action:   'delete',
    entity:   'church group',
    entityId: req.group.id,
    summary:  `Deleted the ${req.group.name} church group and its meetings`,
    before:   result.group,
  });
  res.json({ success: true });
});

// ─── The roll ─────────────────────────────────────────────────────────────────

router.post('/:groupId/members', requireApproved, loadGroup, requireLeads, (req, res) => {
  const role = req.body?.role || 'member';
  // Appointing a leader is the group manager's doing. A leader can bring
  // people in and name a host, and cannot hand their own group to somebody.
  if (['leader', 'co-leader'].includes(role) && !req.perms.manages) {
    return res.status(403).json({
      success: false,
      error:   'Only whoever looks after the church groups can appoint a leader.',
    });
  }

  const result = groups.addMember(req.group.id, {
    directoryId: Number(req.body?.directoryId),
    role,
    addedBy:     req.user.id,
  });
  if (result.error) return res.status(400).json({ success: false, error: result.error });

  actionLog.record(req.user, {
    area:     'church-groups',
    action:   'create',
    entity:   'church group member',
    entityId: req.group.id,
    summary:  `Added ${result.person.name} to ${req.group.name} as ${groups.groupRoleLabel(role)}`,
    details:  { group: req.group.key, directoryId: result.person.id, role },
  });

  const account = notifications.accountsForDirectory([result.person.id])[0];
  notifications.notify({
    users: account ? [account.id] : [],
    kind:  'group-membership',
    title: `You are in ${req.group.name}`,
    body:  req.group.meets ? `${req.group.name} meets ${req.group.meets}.` : '',
    subjectType: 'church-group',
    subjectId:   req.group.id,
    actor: req.user,
  });

  res.json({ success: true, members: groups.membersOf(req.group.id) });
});

router.patch('/:groupId/members/:memberId', requireApproved, loadGroup, requireLeads, (req, res) => {
  const role = req.body?.role;
  if (['leader', 'co-leader'].includes(role) && !req.perms.manages) {
    return res.status(403).json({
      success: false,
      error:   'Only whoever looks after the church groups can appoint a leader.',
    });
  }

  const result = groups.setMemberRole(req.group.id, Number(req.params.memberId), role);
  if (result.error) return res.status(400).json({ success: false, error: result.error });

  actionLog.record(req.user, {
    area:     'church-groups',
    action:   'update',
    entity:   'church group member',
    entityId: req.group.id,
    summary:  `${result.member.name} is now ${groups.groupRoleLabel(role)} of ${req.group.name}`,
    details:  { group: req.group.key, was: result.was, now: role },
  });

  const account = notifications.accountsForDirectory([result.member.directory_id])[0];
  if (groups.GROUP_ROLES.find(r => r.id === role)?.leads) {
    notifications.notify({
      users: account ? [account.id] : [],
      kind:  'group-membership',
      title: `You are now ${groups.groupRoleLabel(role)} of ${req.group.name}`,
      body:  'You can post the group\'s meetings and keep its roll.',
      subjectType: 'church-group',
      subjectId:   req.group.id,
      actor: req.user,
    });
  }

  res.json({ success: true, members: groups.membersOf(req.group.id) });
});

router.delete('/:groupId/members/:memberId', requireApproved, loadGroup, requireLeads, (req, res) => {
  const result = groups.removeMember(req.group.id, Number(req.params.memberId));
  if (result.error) return res.status(404).json({ success: false, error: result.error });

  actionLog.record(req.user, {
    area:     'church-groups',
    action:   'delete',
    entity:   'church group member',
    entityId: req.group.id,
    summary:  `Removed ${result.member.name} from ${req.group.name}`,
    details:  { group: req.group.key, directoryId: result.member.directory_id },
  });
  res.json({ success: true, members: groups.membersOf(req.group.id) });
});

// Re-mirror the roll onto the distribution list. Membership already syncs on
// every change; this is for a list somebody edited from Email Groups by hand.
router.post('/:groupId/sync-mail', requireApproved, loadGroup, requireManages, (req, res) => {
  const result = groups.syncMailGroup(req.group.id);
  actionLog.record(req.user, {
    area:     'church-groups',
    action:   'other',
    entity:   'church group',
    entityId: req.group.id,
    summary:  `Put ${req.group.name}'s mailing list back in step with its roll (${result.synced} on it)`,
    details:  result,
  });
  res.json({ success: true, ...result });
});

// ─── Meetings ─────────────────────────────────────────────────────────────────

function eventFields(body = {}) {
  return {
    title:         String(body.title || '').trim(),
    description:   String(body.description || '').trim(),
    event_date:    String(body.date || '').trim(),
    event_time:    String(body.time || '').trim(),
    end_time:      String(body.endTime || '').trim(),
    location:      String(body.location || '').trim(),
    host_name:     String(body.hostName || '').trim(),
    rsvp_enabled:  body.rsvpEnabled === false ? 0 : 1,
    rsvp_deadline: String(body.rsvpDeadline || '').trim(),
    capacity:      Math.max(0, Math.min(Number(body.capacity) || 0, 999)),
    signup_enabled: body.signupEnabled ? 1 : 0,
    signup_title:  String(body.signupTitle || '').trim() || 'What to bring',
  };
}

router.post('/:groupId/events', requireApproved, loadGroup, requireLeads, (req, res) => {
  const fields = eventFields(req.body);
  if (!fields.title) return res.status(400).json({ success: false, error: 'A title is required' });

  // A meeting is a draft until its leader publishes it, so writing one in two
  // sittings never tells the group twice.
  const { lastInsertRowid: id } = db.prepare(`
    INSERT INTO group_events
      (group_id, title, description, event_date, event_time, end_time, location, host_name,
       rsvp_enabled, rsvp_deadline, capacity, signup_enabled, signup_title, status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)
  `).run(
    req.group.id, fields.title, fields.description, fields.event_date, fields.event_time,
    fields.end_time, fields.location, fields.host_name, fields.rsvp_enabled, fields.rsvp_deadline,
    fields.capacity, fields.signup_enabled, fields.signup_title, req.user.id,
  );

  if (Array.isArray(req.body?.signupItems)) events.saveSignupItems(id, req.body.signupItems);

  actionLog.record(req.user, {
    area:     'church-groups',
    action:   'create',
    entity:   'group meeting',
    entityId: id,
    summary:  `Drafted "${fields.title}" for ${req.group.name}`,
    after:    events.getEvent(id),
  });
  res.json({ success: true, event: eventPayload(id, req.user) });
});

// One meeting, with everything a page shows about it in one answer.
function eventPayload(eventId, user, { canManage = false } = {}) {
  const event = events.getEvent(eventId);
  if (!event) return null;
  return {
    ...event,
    rsvp:     events.rsvpOf(eventId, user.id),
    rsvps:    events.rsvpsFor(eventId),
    summary:  events.rsvpSummary(eventId),
    signups:  events.signupsFor(eventId, user),
    comments: comments.listComments('group-event', eventId, user),
    canManage,
  };
}

function loadEvent(req, res, next) {
  const event = events.getEvent(Number(req.params.eventId));
  if (!event || event.groupId !== req.group.id) {
    return res.status(404).json({ success: false, error: 'No such meeting' });
  }
  // A draft belongs to the leaders until it is published.
  if (event.status === 'draft' && !req.perms.leads) {
    return res.status(404).json({ success: false, error: 'No such meeting' });
  }
  req.event = event;
  next();
}

router.get('/:groupId/events/:eventId', loadGroup, requireBelongs, loadEvent, (req, res) => {
  res.json({ success: true, event: eventPayload(req.event.id, req.user, { canManage: req.perms.leads }) });
});

router.put('/:groupId/events/:eventId', requireApproved, loadGroup, requireLeads, loadEvent, (req, res) => {
  const fields = eventFields({ ...req.event, ...req.body });
  if (!fields.title) return res.status(400).json({ success: false, error: 'A title is required' });

  db.prepare(`
    UPDATE group_events
       SET title = ?, description = ?, event_date = ?, event_time = ?, end_time = ?, location = ?,
           host_name = ?, rsvp_enabled = ?, rsvp_deadline = ?, capacity = ?, signup_enabled = ?, signup_title = ?
     WHERE id = ?
  `).run(
    fields.title, fields.description, fields.event_date, fields.event_time, fields.end_time,
    fields.location, fields.host_name, fields.rsvp_enabled, fields.rsvp_deadline, fields.capacity,
    fields.signup_enabled, fields.signup_title, req.event.id,
  );

  if (Array.isArray(req.body?.signupItems)) events.saveSignupItems(req.event.id, req.body.signupItems);

  const after = events.getEvent(req.event.id);
  actionLog.record(req.user, {
    area:     'church-groups',
    action:   'update',
    entity:   'group meeting',
    entityId: req.event.id,
    summary:  `Edited "${after.title}" for ${req.group.name}`,
    before:   req.event,
    after,
  });

  // Only a change to a meeting people have already been told about is worth
  // telling anybody about, and only the people who said they were coming.
  if (after.status === 'published') {
    const attending = events.rsvpsFor(after.id).filter(r => r.response !== 'no');
    notifications.notify({
      users: attending.map(r => r.userId),
      kind:  'group-event-updated',
      title: `"${after.title}" has changed`,
      body:  [after.date, after.time, after.location].filter(Boolean).join(' · '),
      subjectType: 'group-event',
      subjectId:   after.id,
      actor: req.user,
    });

    const withAddresses = db.prepare(`
      SELECT u.name, u.email FROM group_event_rsvps r
        JOIN users u ON u.id = r.user_id
       WHERE r.event_id = ? AND r.response <> 'no' AND u.email IS NOT NULL
    `).all(after.id);
    notify.groupEventChanged({ group: req.group, event: after, attendees: withAddresses });
  }

  res.json({ success: true, event: eventPayload(req.event.id, req.user, { canManage: true }) });
});

// ─── Publishing ───────────────────────────────────────────────────────────────
// The moment the group hears about it: the portal's own notification to
// everybody on the roll who has an account, and the group's email to the list.

router.post('/:groupId/events/:eventId/publish', requireApproved, loadGroup, requireLeads, loadEvent, (req, res) => {
  if (req.event.status === 'published') {
    return res.status(400).json({ success: false, error: 'That meeting has already been posted' });
  }

  db.prepare("UPDATE group_events SET status = 'published', published_at = datetime('now') WHERE id = ?")
    .run(req.event.id);
  const event = events.getEvent(req.event.id);

  const roll = groups.membersOf(req.group.id);
  const told = notifications.notify({
    users: roll.map(m => m.userId),
    kind:  'group-event-published',
    title: `${req.group.name}: ${event.title}`,
    body:  [event.date, event.time, event.location].filter(Boolean).join(' · '),
    subjectType: 'group-event',
    subjectId:   event.id,
    actor: req.user,
  });

  const queued = notify.groupEventPublished({ group: req.group, event });

  actionLog.record(req.user, {
    area:     'church-groups',
    action:   'update',
    entity:   'group meeting',
    entityId: event.id,
    summary:  `Posted "${event.title}" to ${req.group.name} (${told} notified, ${queued.length} emailed)`,
    details:  { notified: told, emailed: queued.length },
  });

  res.json({ success: true, event: eventPayload(event.id, req.user, { canManage: true }), notified: told, emailed: queued.length });
});

router.post('/:groupId/events/:eventId/cancel', requireApproved, loadGroup, requireLeads, loadEvent, (req, res) => {
  db.prepare("UPDATE group_events SET status = 'cancelled' WHERE id = ?").run(req.event.id);
  const event = events.getEvent(req.event.id);

  // A meeting that was never posted was never heard of, so cancelling it tells
  // nobody.
  let told = 0;
  let queued = [];
  if (req.event.status === 'published') {
    const roll = groups.membersOf(req.group.id);
    told = notifications.notify({
      users: roll.map(m => m.userId),
      kind:  'group-event-cancelled',
      title: `Cancelled: ${event.title}`,
      body:  `${req.group.name}'s meeting${event.date ? ` on ${event.date}` : ''} is off.`,
      subjectType: 'group-event',
      subjectId:   event.id,
      actor: req.user,
    });
    queued = notify.groupEventCancelled({ group: req.group, event });
  }

  actionLog.record(req.user, {
    area:     'church-groups',
    action:   'update',
    entity:   'group meeting',
    entityId: event.id,
    summary:  `Cancelled "${event.title}" for ${req.group.name}`,
    details:  { notified: told, emailed: queued.length },
  });

  res.json({ success: true, event: eventPayload(event.id, req.user, { canManage: true }), notified: told });
});

router.delete('/:groupId/events/:eventId', requireApproved, loadGroup, requireLeads, loadEvent, (req, res) => {
  db.prepare('DELETE FROM group_events WHERE id = ?').run(req.event.id);
  actionLog.record(req.user, {
    area:     'church-groups',
    action:   'delete',
    entity:   'group meeting',
    entityId: req.event.id,
    summary:  `Deleted "${req.event.title}" from ${req.group.name}`,
    before:   req.event,
  });
  res.json({ success: true });
});

// ─── Answering the invitation ─────────────────────────────────────────────────

router.post('/:groupId/events/:eventId/rsvp', requireApproved, loadGroup, requireBelongs, loadEvent, (req, res) => {
  if (!req.event.rsvpEnabled) {
    return res.status(400).json({ success: false, error: 'This meeting is not asking for answers' });
  }
  if (req.event.status !== 'published') {
    return res.status(400).json({ success: false, error: 'That meeting is not open for answers' });
  }

  const previous = events.rsvpOf(req.event.id, req.user.id);
  const result = events.setRsvp(req.event.id, req.user, {
    response: req.body?.response,
    guests:   req.body?.guests,
    note:     req.body?.note,
  });
  if (result.error) return res.status(400).json({ success: false, error: result.error });

  // The leaders hear about a new answer, so a host planning chairs and food
  // does not have to keep opening the page. A correction to an answer they
  // have already seen is not worth a second notification.
  if (!previous) {
    const leaders = groups.membersOf(req.group.id).filter(m => m.role === 'leader' || m.role === 'co-leader');
    const guests  = Math.max(0, Number(req.body?.guests) || 0);
    notifications.notify({
      users: leaders.map(m => m.userId),
      kind:  'group-event-rsvp',
      title: `${req.user.name} said ${req.body?.response} to "${req.event.title}"`,
      body:  guests ? `Bringing ${guests} other${guests === 1 ? '' : 's'}.` : '',
      subjectType: 'group-event',
      subjectId:   req.event.id,
      actor: req.user,
    });
  }

  res.json({
    success: true,
    rsvp:    events.rsvpOf(req.event.id, req.user.id),
    summary: events.rsvpSummary(req.event.id),
    rsvps:   events.rsvpsFor(req.event.id),
  });
});

// ─── The sign-up list ─────────────────────────────────────────────────────────

router.put('/:groupId/events/:eventId/signup-items', requireApproved, loadGroup, requireLeads, loadEvent, (req, res) => {
  const items = events.saveSignupItems(req.event.id, Array.isArray(req.body?.items) ? req.body.items : [], req.user);
  db.prepare('UPDATE group_events SET signup_enabled = ? WHERE id = ?').run(items.length ? 1 : 0, req.event.id);

  actionLog.record(req.user, {
    area:     'church-groups',
    action:   'update',
    entity:   'group meeting',
    entityId: req.event.id,
    summary:  `Set the ${req.event.signupTitle.toLowerCase()} list for "${req.event.title}" (${items.length} item(s))`,
    details:  { items: items.map(i => i.label) },
  });
  res.json({ success: true, signups: items });
});

router.post('/:groupId/events/:eventId/signups', requireApproved, loadGroup, requireBelongs, loadEvent, (req, res) => {
  const result = events.claimSignup(Number(req.body?.itemId), req.user, {
    detail:   req.body?.detail,
    quantity: req.body?.quantity,
  });
  if (result.error) return res.status(400).json({ success: false, error: result.error });

  const leaders = groups.membersOf(req.group.id).filter(m => m.role === 'leader' || m.role === 'co-leader');
  notifications.notify({
    users: leaders.map(m => m.userId),
    kind:  'group-event-signup',
    title: `${req.user.name} is bringing ${result.item.label}`,
    body:  `For "${req.event.title}".`,
    subjectType: 'group-event',
    subjectId:   req.event.id,
    actor: req.user,
  });

  res.json({ success: true, signups: events.signupsFor(req.event.id, req.user) });
});

router.delete('/:groupId/events/:eventId/signups/:claimId', requireApproved, loadGroup, requireBelongs, loadEvent, (req, res) => {
  const result = events.releaseSignup(Number(req.params.claimId), req.user, { canManage: req.perms.leads });
  if (result.error) return res.status(403).json({ success: false, error: result.error });
  res.json({ success: true, signups: events.signupsFor(req.event.id, req.user) });
});

module.exports = router;
