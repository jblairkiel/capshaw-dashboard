// ─── The serving schedule ─────────────────────────────────────────────────────
//
// Two different people use this page, and they can do different things:
//
//   · Whoever looks after the Serving Schedule builds next month's worship
//     jobs, fills or clears any slot, and decides which jobs each member may
//     put their own name against.
//   · Every other member sees the roster, and — if they are down as a man in
//     the directory and have been allowed that job — can sign themselves up
//     for an empty slot, or take their own name back off one.
//
// Everything written here lands in the action history.
const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { requireAuth, requireApproved, requireArea, holdsArea } = require('../middleware/auth');
const { WORSHIP_ROLES } = require('../lib/people');
const { SERVICE_ROLES, SERVICES, parseMonth, servicesIn } = require('../workflows/scheduling');
const actionLog = require('../lib/actionLog');

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

function eligibilityFor(directoryId) {
  if (!directoryId) return [];
  return db.prepare('SELECT job FROM job_eligibility WHERE directory_id = ? ORDER BY job').all(directoryId).map(r => r.job);
}

function personFor(user) {
  if (!user?.directory_id) return null;
  return db.prepare('SELECT id, name, gender FROM directory WHERE id = ?').get(user.directory_id) || null;
}

// The two things that have to be true before somebody can put their own name
// down: the congregation rosters men for these jobs, and the schedule keeper
// has said this is one of theirs.
function signupProblem(person, job) {
  if (!person) return 'Your account is not linked to the member directory yet — ask an admin to link it.';
  if ((person.gender || '').toLowerCase() !== 'male') {
    return 'Worship jobs are filled by the men of the congregation. If that is you, set it on My Info.';
  }
  if (!eligibilityFor(person.id).includes(job)) {
    return `You have not been signed off for ${job} yet. Ask whoever looks after the serving schedule.`;
  }
  return null;
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

  res.json({
    success:     true,
    months,
    month:       wanted,
    assignments: wanted ? assignmentsIn(wanted) : [],
    jobs:        WORSHIP_ROLES,
    services:    SERVICES,
    serviceJobs: SERVICE_ROLES,
    canManage:   holdsArea(req.user, AREA),
    me: {
      directoryId: person?.id ?? null,
      name:        person?.name ?? '',
      gender:      person?.gender ?? '',
      jobs:        person ? eligibilityFor(person.id) : [],
      canSignUp:   !!person && (person.gender || '').toLowerCase() === 'male',
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
  res.json({ success: true, assignment: row });
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
  res.json({ success: true, assignment: after });
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

// ─── Signing yourself up ──────────────────────────────────────────────────────

router.post('/assignments/:id/signup', requireApproved, (req, res) => {
  const slot = db.prepare('SELECT * FROM job_assignments WHERE id = ?').get(req.params.id);
  if (!slot) return res.status(404).json({ success: false, error: 'No such slot' });
  if (slot.name.trim()) {
    return res.status(409).json({ success: false, error: `${slot.name} already has that one.` });
  }

  const person  = personFor(req.user);
  const problem = signupProblem(person, slot.job);
  if (problem) return res.status(403).json({ success: false, error: problem });

  db.prepare('UPDATE job_assignments SET name = ? WHERE id = ?').run(person.name, slot.id);
  const after = db.prepare('SELECT * FROM job_assignments WHERE id = ?').get(slot.id);

  actionLog.record(req.user, {
    area:     AREA,
    action:   'update',
    entity:   'serving assignment',
    entityId: slot.id,
    summary:  `${person.name} signed up for ${slot.job} on ${slot.date || slot.month}`,
    before:   slot,
    after,
  });
  res.json({ success: true, assignment: after });
});

// Taking your name back off. The schedule keeper may clear anybody's; everyone
// else may only clear their own, so nobody can quietly drop someone else.
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

// ─── Who may sign up for what ─────────────────────────────────────────────────
// The dedicated page behind the Serving Schedule area: every member, whether
// they are down as a man, and which jobs they may put their own name against.

router.get('/members', requireApproved, manageOnly, (req, res) => {
  const people = db.prepare(`
    SELECT d.id, d.name, d.gender, d.email,
           (SELECT COUNT(*) FROM job_assignments j WHERE lower(trim(j.name)) = lower(trim(d.name))) AS assignments
      FROM directory d ORDER BY d.name ASC
  `).all();

  const eligibility = db.prepare('SELECT directory_id, job FROM job_eligibility').all();
  const preferences = db.prepare('SELECT directory_id, role, level FROM worship_preferences').all();

  const byPerson = new Map(people.map(p => [p.id, { ...p, jobs: [], preferences: {} }]));
  for (const row of eligibility) byPerson.get(row.directory_id)?.jobs.push(row.job);
  for (const row of preferences) {
    const entry = byPerson.get(row.directory_id);
    if (entry) entry.preferences[row.role] = row.level;
  }

  res.json({ success: true, members: [...byPerson.values()], jobs: WORSHIP_ROLES });
});

const saveEligibility = db.transaction((directoryId, jobs) => {
  db.prepare('DELETE FROM job_eligibility WHERE directory_id = ?').run(directoryId);
  const ins = db.prepare("INSERT OR IGNORE INTO job_eligibility (directory_id, job, updated_at) VALUES (?, ?, datetime('now'))");
  for (const job of jobs) ins.run(directoryId, job);
});

router.put('/members/:id/jobs', requireApproved, manageOnly, (req, res) => {
  const person = db.prepare('SELECT id, name FROM directory WHERE id = ?').get(req.params.id);
  if (!person) return res.status(404).json({ success: false, error: 'No such member' });

  const wanted = req.body?.jobs;
  if (!Array.isArray(wanted)) return res.status(400).json({ success: false, error: 'jobs must be an array' });

  const unknown = wanted.filter(j => !WORSHIP_ROLES.includes(j));
  if (unknown.length) return res.status(400).json({ success: false, error: `Unknown job: ${unknown.join(', ')}` });

  const before = eligibilityFor(person.id);
  saveEligibility(person.id, wanted);
  const after = eligibilityFor(person.id);

  const added   = after.filter(j => !before.includes(j));
  const removed = before.filter(j => !after.includes(j));
  if (added.length || removed.length) {
    actionLog.record(req.user, {
      area:     AREA,
      action:   'update',
      entity:   'member jobs',
      entityId: person.id,
      summary:  [
        added.length   ? `${person.name} may now sign up for ${added.join(', ')}`   : '',
        removed.length ? `${person.name} may no longer sign up for ${removed.join(', ')}` : '',
      ].filter(Boolean).join('; '),
      details:  { added, removed, jobs: after },
    });
  }

  res.json({ success: true, member: { id: person.id, name: person.name, jobs: after } });
});

module.exports = router;
