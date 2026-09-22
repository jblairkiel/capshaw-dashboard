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
const { SERVICE_ROLES, SERVICES, parseMonth, servicesIn } = require('../workflows/scheduling');
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
  return assignmentsIn(month).map(slot => {
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
    serviceJobs: SERVICE_ROLES,
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

// ─── POST /api/serving/months ─────────────────────────────────────────────────
// Lay out next month: every service in it, with the jobs that service needs and
// nobody's name against them yet. Existing slots for that month are left alone,
// so running it twice never doubles the roster up.

router.post('/months', requireApproved, manageOnly, (req, res) => {
  const label  = String(req.body?.month || '').trim();
  const parsed = parseMonth(label);
  if (!parsed) return res.status(400).json({ success: false, error: `"${label}" is not a month I understand — try "June 2026"` });

  const wanted = Array.isArray(req.body?.services) && req.body.services.length
    ? req.body.services.filter(s => SERVICES.includes(s))
    : SERVICES;
  if (!wanted.length) return res.status(400).json({ success: false, error: 'Choose at least one service' });

  const occasions = servicesIn(parsed, wanted);
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

  actionLog.record(req.user, {
    area:     AREA,
    action:   'create',
    entity:   'serving schedule',
    entityId: parsed.label,
    summary:  `Laid out ${parsed.label} — ${created} empty slot${created === 1 ? '' : 's'} across ${wanted.join(', ')}`,
    details:  { month: parsed.label, services: wanted, created },
  });

  res.json({ success: true, month: parsed.label, created, assignments: assignmentsIn(parsed.label) });
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
  res.json({ success: true });
});

// ─── Taking your own name off ──────────────────────────────────────────────────
// The one thing left that is a member's own to change: stepping down from a
// slot they are down for, however it got their name — generated, put there by
// the schedule keeper, or (from before this changed) signed up for
// themselves. The schedule keeper may clear anybody's; everyone else may only
// clear their own, so nobody can quietly drop someone else.
router.delete('/assignments/:id/signup', requireApproved, (req, res) => {
  const slot = db.prepare('SELECT * FROM job_assignments WHERE id = ?').get(req.params.id);
  if (!slot) return res.status(404).json({ success: false, error: 'No such slot' });

  const person  = personFor(req.user);
  const isMine  = person && slot.name.trim().toLowerCase() === person.name.trim().toLowerCase();
  if (!isMine && !holdsArea(req.user, AREA)) {
    return res.status(403).json({ success: false, error: 'You can only take your own name off the roster.' });
  }

  db.prepare("UPDATE job_assignments SET name = '' WHERE id = ?").run(slot.id);
  actionLog.record(req.user, {
    area:     AREA,
    action:   'update',
    entity:   'serving assignment',
    entityId: slot.id,
    summary:  isMine
      ? `${person.name} stepped down from ${slot.job} on ${slot.date || slot.month}`
      : `Cleared ${slot.name || 'an empty slot'} from ${slot.job} on ${slot.date || slot.month}`,
    before:   slot,
    after:    { ...slot, name: '' },
  });
  res.json({ success: true });
});

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
