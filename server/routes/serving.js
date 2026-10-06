// ─── The serving schedule ─────────────────────────────────────────────────────
//
// A slot gets a name in it two ways, and two ways only: the Monthly Worship
// Schedule workflow publishing a generated draft, or whoever holds
// `serving-schedule` filling or changing one by hand. There is no self
// sign-up — a member cannot put their own name against an empty slot.
//
//   · Whoever looks after the Serving Schedule builds next month's worship
//     jobs, fills or clears any slot, and records what each man will
//     volunteer for.
//   · Every other member sees the roster, and may take their own name back
//     off a slot they are down for — the one thing left that is theirs to
//     change — but cannot put it there in the first place.
//   · Anybody linked to the directory can block out the days they will be
//     away, and the schedule keeper can do it for them. The month builder
//     skips those days for that person.
//
// Everything written here lands in the action history.
const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { requireAuth, requireApproved, requireArea, holdsArea } = require('../middleware/auth');
const { WORSHIP_ROLES, PREFERENCE_LEVELS } = require('../lib/people');
const worship = require('../lib/worship');
const { SERVICES, MONTHS, parseMonth, servicesIn } = require('../workflows/scheduling');
const serviceJobs = require('../lib/serviceJobs');
const engine = require('../workflows/engine');
const notifications = require('../lib/notifications');
const rosterFill = require('../lib/rosterFill');
const notify = require('../mail/notify');
const mailer = require('../mail/mailer');
const plans = require('../lib/worshipPlans');
const actionLog = require('../lib/actionLog');
const blackouts = require('../lib/blackouts');

const AREA = 'serving-schedule';
const manageOnly = requireArea(AREA);

router.use(requireAuth);

// ─── Lookups ──────────────────────────────────────────────────────────────────

function monthsOnRecord() {
  return db.prepare("SELECT month, COUNT(*) AS slots FROM job_assignments WHERE month <> '' GROUP BY month")
    .all()
    .map(r => ({ ...r, parsed: parseMonth(r.month) }))
    .sort((a, b) => {
      if (!a.parsed || !b.parsed) return a.month.localeCompare(b.month);
      return b.parsed.year - a.parsed.year || b.parsed.monthIndex - a.parsed.monthIndex;
    })
    .map(({ month, slots }) => ({ month, slots }));
}

function assignmentsIn(month) {
  return db.prepare('SELECT id, month, date, service, job, name FROM job_assignments WHERE month = ? ORDER BY id ASC').all(month);
}

function personFor(user) {
  if (!user?.directory_id) return null;
  return db.prepare('SELECT id, name, gender FROM directory WHERE id = ?').get(user.directory_id) || null;
}

// ─── Time away ────────────────────────────────────────────────────────────────

// Which day a slot falls on, as a date a blocked-out range can be compared
// against. A slot with no date of its own belongs to no particular day.
function dayOf(slot) {
  return blackouts.dateOf(slot.month, slot.date);
}

// The roster, with each filled slot told whether whoever is down for it has
// blocked that day out. Worked out here rather than on the page, because the
// page has names and the ranges have directory entries.
function assignmentsWithConflicts(month) {
  const asked = openReplacements();
  return assignmentsIn(month).map(raw => {
    // A replacement somebody has asked for and that is not settled yet.
    const slot = asked.has(raw.id) ? { ...raw, replacement: asked.get(raw.id) } : raw;
    const away = slot.name.trim() ? blackouts.nameAwayOn(slot.name, dayOf(slot)) : null;
    if (!away) return slot;

    return {
      ...slot,
      away: {
        startsOn: away.startsOn,
        endsOn:   away.endsOn,
        reason:   away.reason,
        said:     blackouts.describe(away),
      },
    };
  });
}

// Writing somebody into a slot they are away for is the schedule keeper's
// call — they may know something the range does not — so it is said rather
// than refused. Nothing is said when the day is clear.
function awayWarning(slot) {
  if (!slot?.name?.trim()) return null;
  const away = blackouts.nameAwayOn(slot.name, dayOf(slot));
  return away
    ? `${slot.name} has blocked out ${blackouts.describe(away)}${away.reason ? ` (${away.reason})` : ''} — they are down for this one anyway.`
    : null;
}

// Whose time away somebody may keep: their own, and — for the schedule keeper —
// anybody's. Returns the directory entry, or the answer to refuse with.
function personWhoseTimeOff(req, wantedId) {
  const keeper = holdsArea(req.user, AREA);
  // No id named means their own, which is how the Serving Schedule page sends it.
  const own = wantedId === undefined || wantedId === null || wantedId === '';
  const id  = own ? req.user?.directory_id : Number(wantedId);

  if (!own && !Number.isInteger(id)) return { error: 'No such member', status: 404 };
  if (!id) return { error: 'Your account is not linked to the member directory yet — ask an admin to link it.', status: 403 };
  if (!keeper && id !== req.user?.directory_id) {
    return { error: 'You can only block out your own days. Ask whoever looks after the serving schedule.', status: 403 };
  }

  const person = db.prepare('SELECT id, name FROM directory WHERE id = ?').get(id);
  if (!person) return { error: 'No such member', status: 404 };
  return { person };
}

// ─── GET /api/serving ─────────────────────────────────────────────────────────
// Everything one page render needs: the months on record, the chosen month's
// slots, and what this particular person may do with them.

router.get('/', (req, res) => {
  const months  = monthsOnRecord();
  const wanted  = req.query.month && months.some(m => m.month === req.query.month)
    ? req.query.month
    : months[0]?.month || '';
  const person  = personFor(req.user);

  const canManage = holdsArea(req.user, AREA);

  res.json({
    success:     true,
    months,
    month:       wanted,
    assignments: wanted ? assignmentsWithConflicts(wanted) : [],
    jobs:        WORSHIP_ROLES,
    services:    SERVICES,
    // The jobs each service needs — the schedule keeper's to change.
    serviceJobs: serviceJobs.list(specialChoices()),
    // What can be added as a special service — a gospel meeting, a singing:
    // the church's own list of services, kept by an admin, less the ones the
    // regular rosters already cover.
    specialServices: specialChoices(),
    canManage,
    // Everyone's time away is the schedule keeper's to see — it is why a slot
    // is empty. Everybody else sees only their own.
    blackouts:   canManage ? blackouts.all() : [],
    me: {
      directoryId: person?.id ?? null,
      name:        person?.name ?? '',
      gender:      person?.gender ?? '',
      blackouts:   person ? blackouts.forPerson(person.id) : [],
    },
  });
});

// ─── POST /api/serving/months  { month, services, fill = true } ───────────────
// Build a month: every service in it, with the jobs that service needs, and —
// unless `fill` is false — a name in each open slot from what the men have said
// they will do (server/lib/rosterFill.js). Existing slots are left alone and a
// name already on the schedule is never moved, so building a month again only
// lays out what is missing and fills what is still open. The schedule keeper
// then changes any name by hand. Nobody is emailed until they choose to.

router.post('/months', requireApproved, manageOnly, (req, res) => {
  const label  = String(req.body?.month || '').trim();
  const parsed = parseMonth(label);
  if (!parsed) return res.status(400).json({ success: false, error: `"${label}" is not a month I understand — try "June 2026"` });

  const wanted = Array.isArray(req.body?.services) && req.body.services.length
    ? req.body.services.filter(s => SERVICES.includes(s))
    : SERVICES;
  if (!wanted.length) return res.status(400).json({ success: false, error: 'Choose at least one service' });

  const occasions = servicesIn(parsed, wanted, serviceJobs.rolesByService());
  if (!occasions.length) return res.status(400).json({ success: false, error: `No services fall in ${parsed.label}` });

  const existing = new Set(
    assignmentsIn(parsed.label).map(a => `${a.date}|${a.service}|${a.job}`)
  );

  const insert = db.prepare('INSERT INTO job_assignments (month, date, service, job, name) VALUES (?, ?, ?, ?, ?)');
  const created = db.transaction(() => {
    let n = 0;
    for (const occasion of occasions) {
      for (const job of occasion.roles) {
        const key = `${occasion.dateLabel}|${occasion.service}|${job}`;
        if (existing.has(key)) continue;
        insert.run(parsed.label, occasion.dateLabel, occasion.service, job, '');
        n++;
      }
    }
    return n;
  })();

  const { filled, open } = req.body?.fill === false
    ? { filled: [], open: assignmentsIn(parsed.label).filter(a => !a.name.trim()).length }
    : rosterFill.fillOpen(parsed.label);

  actionLog.record(req.user, {
    area:     AREA,
    action:   'create',
    entity:   'serving schedule',
    entityId: parsed.label,
    summary:  `Built ${parsed.label} — ${created} new slot${created === 1 ? '' : 's'}, ${filled.length} filled from preferences, ${open} still open`,
    details:  { month: parsed.label, services: wanted, created, filled: filled.map(f => ({ id: f.id, job: f.job, date: f.date, name: f.name })), open },
  });

  res.json({ success: true, month: parsed.label, created, filled: filled.length, open, assignments: assignmentsWithConflicts(parsed.label) });
});

// ─── GET /api/serving/assignments/:id/candidates ──────────────────────────────
// Who could take a slot, best fit first, each saying why he is or is not one:
// what he has said about the job, whether he is away that day or already
// serving at that service, and how many turns he has this month.

router.get('/assignments/:id/candidates', requireApproved, manageOnly, (req, res) => {
  const found = rosterFill.candidatesFor(req.params.id);
  if (!found) return res.status(404).json({ success: false, error: 'No such slot' });
  res.json({ success: true, slot: found.slot, candidates: found.candidates });
});

// ─── POST /api/serving/months/notify  { month } ───────────────────────────────
// Once the month is as the schedule keeper wants it: each man down for a job
// is emailed his own, and everyone who has not opted out gets the whole month.

router.post('/months/notify', requireApproved, manageOnly, (req, res) => {
  const month = String(req.body?.month || '').trim();
  const rows = assignmentsIn(month).filter(a => a.name.trim());
  if (!rows.length) return res.status(400).json({ success: false, error: `Nobody is down for anything in ${month || 'that month'} yet` });
  const draft = { month, rows: rows.map(({ date, service, job, name }) => ({ date, service, job, name })) };
  const { queued, unreachable } = notify.schedulePublished({ draft, instanceId: 'roster' });
  notify.monthlyReport({ draft, instanceId: 'roster' });
  mailer.drainOutbox().catch(err => console.error('[mail] drain failed:', err.message));
  actionLog.record(req.user, {
    area: AREA, action: 'update', entity: 'serving schedule', entityId: month,
    summary: `Emailed ${month}'s jobs to ${queued.length} ${queued.length === 1 ? 'man' : 'men'}${unreachable.length ? ` (no address for ${unreachable.join(', ')})` : ''}`,
    details: { month, emailed: queued.length, unreachable },
  });
  res.json({ success: true, emailed: queued.length, unreachable });
});

// ─── POST /api/serving/special ────────────────────────────────────────────────
// A service that does not come round every week — a gospel meeting, a monthly
// singing — on one day or each night of a run of days, with the jobs it needs
// and nobody against them yet. It is put down by the service's own name, which
// is how Upcoming Service finds it, fills its parts, and reminds its song
// leader.

const isIsoDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`));
const MAX_NIGHTS = 14;

function specialChoices() {
  const regular = new Set(SERVICES.map(s => s.toLowerCase()));
  return plans.activeServices()
    .filter(s => !regular.has(s.name.toLowerCase()) && !plans.servingServiceFor(s.name) && !(s.tracking === 'weekly' && s.weekday !== null))
    .map(s => s.name);
}

router.post('/special', requireApproved, manageOnly, (req, res) => {
  const type = plans.serviceType(req.body?.service);
  if (!type || !type.active || !specialChoices().includes(type.name)) {
    return res.status(400).json({ success: false, error: 'Choose which service it is. An admin adds services to the list under Church Records → Service Types.' });
  }
  const from = String(req.body?.from || '');
  const through = String(req.body?.through || '') || from;
  if (!isIsoDate(from) || !isIsoDate(through)) return res.status(400).json({ success: false, error: 'Choose the day it is held' });
  if (through < from) return res.status(400).json({ success: false, error: 'The last night is before the first' });

  const nights = [];
  for (let d = new Date(`${from}T12:00:00Z`); d.toISOString().slice(0, 10) <= through; d.setUTCDate(d.getUTCDate() + 1)) {
    nights.push(new Date(d));
    if (nights.length > MAX_NIGHTS) return res.status(400).json({ success: false, error: `That is more than ${MAX_NIGHTS} nights — add a longer meeting in parts` });
  }

  const asked = Array.isArray(req.body?.jobs) ? req.body.jobs : serviceJobs.jobsFor(type.name);
  const jobs = WORSHIP_ROLES.filter(j => asked.includes(j));
  if (!jobs.length) return res.status(400).json({ success: false, error: 'Choose at least one job it needs' });

  const label = d => ({ month: `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`, date: `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}` });
  const exists = db.prepare('SELECT 1 FROM job_assignments WHERE month = ? AND date = ? AND lower(service) = lower(?) AND job = ?');
  const insert = db.prepare('INSERT INTO job_assignments (month, date, service, job, name) VALUES (?, ?, ?, ?, ?)');
  const created = db.transaction(() => {
    let n = 0;
    for (const night of nights) {
      const { month, date } = label(night);
      for (const job of jobs) {
        if (exists.get(month, date, type.name, job)) continue;
        insert.run(month, date, type.name, job, '');
        n++;
      }
    }
    return n;
  })();

  const first = label(nights[0]);
  const when = nights.length === 1 ? first.date : `${first.date} – ${label(nights.at(-1)).date}`;
  actionLog.record(req.user, {
    area:     AREA,
    action:   'create',
    entity:   'serving schedule',
    entityId: `${type.name}:${from}`,
    summary:  `Added ${type.name}, ${when}${nights.length > 1 ? ` (${nights.length} nights)` : ''} — ${created} empty slot${created === 1 ? '' : 's'}`,
    details:  { service: type.name, from, through, jobs, created },
  });

  res.json({ success: true, created, month: first.month, assignments: assignmentsWithConflicts(first.month) });
});

// ─── PUT /api/serving/service-jobs  { service, jobs } ───────────────────────────
// The jobs a service needs, in order — what building a month lays out for it,
// what the Monthly Worship Schedule fills, and what a special service starts
// with. `jobs: null` puts it back on the defaults. Months already built keep
// their slots; this is for the ones built after.

router.put('/service-jobs', requireApproved, manageOnly, (req, res) => {
  const service = String(req.body?.service || '');
  if (!SERVICES.includes(service) && !specialChoices().includes(service)) {
    return res.status(400).json({ success: false, error: 'Choose one of the services on the schedule' });
  }
  const result = serviceJobs.setJobs(service, req.body?.jobs ?? null, req.user);
  if (result.error) return res.status(400).json({ success: false, error: result.error });
  actionLog.record(req.user, {
    area:     AREA,
    action:   'update',
    entity:   'service jobs',
    entityId: service,
    summary:  req.body?.jobs == null
      ? `Put ${service} back on its usual jobs`
      : `Set the jobs for ${service}: ${result.jobs.join(', ')}`,
    details:  result,
  });
  res.json({ success: true, serviceJobs: serviceJobs.list(specialChoices()) });
});

// ─── Slots ────────────────────────────────────────────────────────────────────

router.post('/assignments', requireApproved, manageOnly, (req, res) => {
  const month   = String(req.body?.month || '').trim();
  const date    = String(req.body?.date || '').trim();
  const service = String(req.body?.service || '').trim();
  const job     = String(req.body?.job || '').trim();
  const name    = String(req.body?.name || '').trim();

  if (!month || !job) return res.status(400).json({ success: false, error: 'A month and a job are required' });

  const { lastInsertRowid: id } = db
    .prepare('INSERT INTO job_assignments (month, date, service, job, name) VALUES (?, ?, ?, ?, ?)')
    .run(month, date, service, job, name);

  const row = db.prepare('SELECT * FROM job_assignments WHERE id = ?').get(id);
  actionLog.record(req.user, {
    area:     AREA,
    action:   'create',
    entity:   'serving assignment',
    entityId: id,
    summary:  `Added ${job} on ${date || month}${name ? ` for ${name}` : ' (nobody yet)'}`,
    after:    row,
  });
  res.json({ success: true, assignment: row, warning: awayWarning(row) });
});

router.patch('/assignments/:id', requireApproved, manageOnly, (req, res) => {
  const before = db.prepare('SELECT * FROM job_assignments WHERE id = ?').get(req.params.id);
  if (!before) return res.status(404).json({ success: false, error: 'No such slot' });

  const fields = ['month', 'date', 'service', 'job', 'name'].filter(f => req.body?.[f] !== undefined);
  if (!fields.length) return res.status(400).json({ success: false, error: 'Nothing to change' });

  db.prepare(`UPDATE job_assignments SET ${fields.map(f => `${f} = ?`).join(', ')} WHERE id = ?`)
    .run(...fields.map(f => String(req.body[f] ?? '').trim()), req.params.id);

  const after = db.prepare('SELECT * FROM job_assignments WHERE id = ?').get(req.params.id);
  actionLog.record(req.user, {
    area:     AREA,
    action:   'update',
    entity:   'serving assignment',
    entityId: req.params.id,
    summary:  `Changed ${after.job} on ${after.date || after.month} to ${after.name || 'nobody'}`,
    before,
    after,
  });
  if (after.name !== before.name) settleReplacement(after.id, after.name, req.user);
  res.json({ success: true, assignment: after, warning: awayWarning(after) });
});

router.delete('/assignments/:id', requireApproved, manageOnly, (req, res) => {
  const before = db.prepare('SELECT * FROM job_assignments WHERE id = ?').get(req.params.id);
  if (!before) return res.status(404).json({ success: false, error: 'No such slot' });

  db.prepare('DELETE FROM job_assignments WHERE id = ?').run(req.params.id);
  actionLog.record(req.user, {
    area:     AREA,
    action:   'delete',
    entity:   'serving assignment',
    entityId: req.params.id,
    summary:  `Removed ${before.job} on ${before.date || before.month}${before.name ? ` (was ${before.name})` : ''}`,
    before,
  });
  settleReplacement(before.id, '', req.user);
  res.json({ success: true });
});

// ─── Asking to be replaced ────────────────────────────────────────────────────
// Somebody who cannot do a job they are down for asks; they do not take their
// own name off, so a gap is never left that nobody knows about. Whoever keeps
// the schedule is emailed, told on their bell, and finds it in My Inbox
// (server/workflows/definitions/servingReplacement.js).

const REPLACEMENT = 'serving-replacement';

// slot id → { id, askedBy, askedAt } for every request still open.
function openReplacements() {
  const rows = db.prepare(`
    SELECT i.id, i.data, i.created_at, u.name AS asked_by
      FROM workflow_instances i LEFT JOIN users u ON u.id = i.created_by
     WHERE i.definition_id = ? AND i.status = 'active'
  `).all(REPLACEMENT);
  const out = new Map();
  for (const r of rows) {
    const data = engine.parseData(r.data);
    const slotId = Number(data.slotId);
    if (slotId) out.set(slotId, { id: r.id, askedBy: r.asked_by || '', askedAt: r.created_at, reason: data.reason || '' });
  }
  return out;
}

function keepers() {
  const holders = db.prepare(`
    SELECT u.id FROM users u JOIN user_areas a ON a.user_id = u.id
     WHERE a.area = ? AND u.role = 'approved'
  `).all(AREA);
  return holders.length ? holders : db.prepare("SELECT id FROM users WHERE role = 'admin'").all();
}

router.post('/assignments/:id/replacement', requireApproved, (req, res) => {
  const started = engine.start({
    definitionId: REPLACEMENT,
    data: { slotId: String(req.params.id), reason: String(req.body?.reason || '') },
    user: req.user,
  });
  if (started.error) return res.status(started.status || 400).json({ success: false, error: started.error });

  const slot = db.prepare('SELECT * FROM job_assignments WHERE id = ?').get(req.params.id);
  const when = [slot.date || slot.month, slot.service].filter(Boolean).join(', ');
  notifications.notify({
    users: keepers(), actor: req.user, kind: 'serving-replacement-asked',
    title: `${slot.name} needs replacing: ${slot.job}, ${when}`,
    body: req.body?.reason ? String(req.body.reason).slice(0, 300) : '',
    subjectType: 'serving-slot', subjectId: slot.id,
  });
  actionLog.record(req.user, {
    area: AREA, action: 'create', entity: 'serving replacement', entityId: slot.id,
    summary: `${req.user.name} asked for ${slot.name} to be replaced on ${slot.job}, ${when}`,
    details: { slot, reason: req.body?.reason || '', workflow: started.id },
  });
  res.json({ success: true, workflowId: started.id, assignments: assignmentsWithConflicts(slot.month) });
});

// When the keeper settles a slot by hand — a new name, or the slot cleared or
// removed — an open request on it is closed to match, so it never sits in
// somebody's inbox after the fact.
function settleReplacement(slotId, newName, user) {
  const open = openReplacements().get(Number(slotId));
  if (!open) return;
  const task = db.prepare("SELECT id FROM workflow_tasks WHERE instance_id = ? AND status = 'pending'").get(open.id);
  if (!task) return;
  const result = newName
    ? engine.act({ taskId: task.id, actionId: 'replaced', note: newName, user })
    : engine.act({ taskId: task.id, actionId: 'leave-open', user });
  if (result?.error) console.error('[serving] could not close the replacement request:', result.error);
}

// ─── Time away ────────────────────────────────────────────────────────────────
// A member blocks out their own days; the schedule keeper may block out
// anybody's, because plenty of people say "we are away that fortnight" in the
// foyer rather than typing it in. Every range lands in the action history under
// whoever wrote it down, so one taken second-hand is never mistaken for one the
// member entered themselves.

router.get('/blackouts', requireApproved, (req, res) => {
  const keeper = holdsArea(req.user, AREA);
  res.json({
    success:   true,
    canManage: keeper,
    blackouts: keeper ? blackouts.all() : blackouts.forPerson(req.user?.directory_id),
  });
});

router.post('/blackouts', requireApproved, (req, res) => {
  const { person, error, status } = personWhoseTimeOff(req, req.body?.directoryId);
  if (error) return res.status(status).json({ success: false, error });

  const { range, error: badRange } = blackouts.readRange(req.body);
  if (badRange) return res.status(400).json({ success: false, error: badRange });

  const saved = blackouts.add(person.id, range);
  const mine  = person.id === req.user?.directory_id;

  actionLog.record(req.user, {
    area:     AREA,
    action:   'create',
    entity:   'time away',
    entityId: saved.id,
    summary:  mine
      ? `Blocked out ${blackouts.describe(saved)} for the serving jobs`
      : `Blocked out ${blackouts.describe(saved)} for ${person.name}`,
    after:    saved,
  });

  res.json({ success: true, blackout: saved });
});

router.delete('/blackouts/:id', requireApproved, (req, res) => {
  const existing = blackouts.get(req.params.id);
  if (!existing) return res.status(404).json({ success: false, error: 'No such time away' });

  const { error, status } = personWhoseTimeOff(req, existing.directoryId);
  if (error) return res.status(status).json({ success: false, error });

  blackouts.remove(existing.id);
  const mine = existing.directoryId === req.user?.directory_id;

  actionLog.record(req.user, {
    area:     AREA,
    action:   'delete',
    entity:   'time away',
    entityId: existing.id,
    summary:  mine
      ? `Cleared their time away for ${blackouts.describe(existing)}`
      : `Cleared ${existing.name}'s time away for ${blackouts.describe(existing)}`,
    before:   existing,
  });

  res.json({ success: true });
});

// ─── The service roster: what each man will volunteer for ─────────────────────
// What the Service Roster page is built from: every member, whether they are
// down as a man, and what they have said they will volunteer for.

function rosterMembers() {
  const people = db.prepare(`
    SELECT d.id, d.name, d.gender, d.email,
           (SELECT COUNT(*) FROM job_assignments j WHERE lower(trim(j.name)) = lower(trim(d.name))) AS assignments
      FROM directory d ORDER BY d.name ASC
  `).all();

  const preferences = worship.allPreferences();
  const notes       = worship.allNotes();
  const away        = blackouts.byPerson();

  return people.map(p => ({
    ...p,
    preferences: preferences.get(p.id) ?? {},
    notes:       notes.get(p.id) ?? '',
    blackouts:   away.get(p.id) ?? [],
  }));
}

router.get('/members', requireApproved, manageOnly, (req, res) => {
  res.json({
    success: true,
    members: rosterMembers(),
    jobs:    WORSHIP_ROLES,
    levels:  PREFERENCE_LEVELS,
  });
});

// A man tells the portal himself on My Household & Preferences — but plenty of
// them say it in the foyer instead, so whoever builds the roster can write it
// down for them here. Same table, same vocabulary, and the action history says
// who recorded it, so a preference set on somebody's behalf is never mistaken
// for one they typed.

router.put('/members/:id/preferences', requireApproved, manageOnly, (req, res) => {
  const person = db.prepare('SELECT id, name FROM directory WHERE id = ?').get(req.params.id);
  if (!person) return res.status(404).json({ success: false, error: 'No such member' });

  const { preferences, error } = worship.readPreferences(req.body?.preferences);
  if (error) return res.status(400).json({ success: false, error });

  const before      = worship.preferencesOf(person.id);
  const notesBefore = worship.notesOf(person.id);
  const notes       = req.body?.notes === undefined ? undefined : String(req.body.notes).trim();

  worship.save(person.id, preferences, notes);

  const after      = worship.preferencesOf(person.id);
  const changes    = worship.describeChange(before, after);
  const noteMoved  = notes !== undefined && notes !== notesBefore;

  actionLog.record(req.user, {
    area:     AREA,
    action:   'update',
    entity:   'worship preferences',
    entityId: person.id,
    summary:  changes.length
      ? `Recorded what ${person.name} will serve — ${changes.join('; ')}${noteMoved ? ', and their scheduling note' : ''}`
      : `Reviewed what ${person.name} will serve${noteMoved ? ', and their scheduling note' : ' — nothing changed'}`,
    details:  { preferences: after, changes },
  });

  res.json({
    success: true,
    member: {
      id:          person.id,
      name:        person.name,
      preferences: after,
      notes:       worship.notesOf(person.id),
    },
  });
});

module.exports = router;
