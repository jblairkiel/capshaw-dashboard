// ─── Communion preparation sign-up ────────────────────────────────────────────
// A list a year, one sign-up a month (lib/communionPrep.js). Everybody signed
// in can read it and put their own name down; whoever holds communion-prep
// starts each year's list and can write anybody in or clear any month.
const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { requireAuth, requireApproved, requireArea, holdsArea } = require('../middleware/auth');
const actionLog = require('../lib/actionLog');
const prep = require('../lib/communionPrep');
// Read through the module, so a test can say what day it is.
const recordKeeping = require('../lib/recordKeeping');
const churchToday = () => recordKeeping.churchToday();

const AREA = 'communion-prep';
const manageOnly = requireArea(AREA);

router.use(requireAuth);

const label = (year, month) => `${prep.MONTHS[month - 1]} ${year}`;

// GET /api/communion-prep?year= — one year's list, and what this person may do.
router.get('/', (req, res) => {
  const today = churchToday();
  const thisYear = Number(today.slice(0, 4));
  const years = prep.years();
  const wanted = Number(req.query.year) || (years.includes(thisYear) ? thisYear : years.filter(y => y > thisYear)[0] || years.at(-1) || thisYear);
  const canManage = holdsArea(req.user, AREA);
  // The years the keeper could start next.
  const startable = canManage
    ? Array.from({ length: prep.YEARS_AHEAD + 1 }, (_, i) => thisYear + i).filter(y => !years.includes(y))
    : [];
  const people = canManage
    ? db.prepare("SELECT name FROM directory WHERE trim(name) <> '' ORDER BY name").all().map(r => r.name)
    : [];
  res.json({
    success: true,
    today, year: wanted, years, startable, canManage, people,
    months: prep.listFor(wanted, { user: req.user, today }),
  });
});

// POST /api/communion-prep/years { year } — start a year's list.
router.post('/years', requireApproved, manageOnly, (req, res) => {
  const result = prep.createYear(req.body?.year, req.user, churchToday());
  if (result.error) return res.status(400).json({ success: false, error: result.error });
  actionLog.record(req.user, {
    area: AREA, action: 'create', entity: 'communion preparation list', entityId: result.year,
    summary: `Started the ${result.year} communion preparation list`,
  });
  res.status(201).json({ success: true, year: result.year, months: prep.listFor(result.year, { user: req.user, today: churchToday() }) });
});

// POST /api/communion-prep/:year/:month/signup — put your own name down.
router.post('/:year/:month/signup', requireApproved, (req, res) => {
  const today = churchToday();
  const result = prep.signUp(req.user, req.params, today);
  if (result.error) return res.status(result.status || 400).json({ success: false, error: result.error });
  const { signup } = result;
  actionLog.record(req.user, {
    area: AREA, action: 'create', entity: 'communion preparation', entityId: signup.id,
    summary: `${signup.name} signed up to prepare communion in ${label(signup.year, signup.month)}`,
  });
  res.json({ success: true, months: prep.listFor(signup.year, { user: req.user, today }) });
});

// DELETE /api/communion-prep/:year/:month/signup — take your own name back off.
router.delete('/:year/:month/signup', requireApproved, (req, res) => {
  const today = churchToday();
  const result = prep.withdraw(req.user, req.params, today);
  if (result.error) return res.status(result.status || 400).json({ success: false, error: result.error });
  const { before } = result;
  actionLog.record(req.user, {
    area: AREA, action: 'delete', entity: 'communion preparation', entityId: before.id,
    summary: `${before.name} took their name off communion preparation in ${label(before.year, before.month)}`,
    before,
  });
  res.json({ success: true, months: prep.listFor(before.year, { user: req.user, today }) });
});

// PUT /api/communion-prep/:year/:month { name } — the keeper sets or clears a month.
router.put('/:year/:month', requireApproved, manageOnly, (req, res) => {
  const today = churchToday();
  const result = prep.setMonth(req.user, { ...req.params, name: req.body?.name }, today);
  if (result.error) return res.status(result.status || 400).json({ success: false, error: result.error });
  const { before, signup } = result;
  const year = Number(req.params.year);
  const month = Number(req.params.month);
  if ((before?.name || '') !== (signup?.name || '')) {
    actionLog.record(req.user, {
      area: AREA, action: signup ? (before ? 'update' : 'create') : 'delete', entity: 'communion preparation', entityId: signup?.id ?? before?.id,
      summary: signup
        ? `Put ${signup.name} down to prepare communion in ${label(year, month)}${before ? ` in place of ${before.name}` : ''}`
        : `Cleared communion preparation in ${label(year, month)} (was ${before.name})`,
      before, after: signup,
    });
  }
  res.json({ success: true, months: prep.listFor(year, { user: req.user, today }) });
});

module.exports = router;
