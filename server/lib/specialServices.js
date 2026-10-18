// Special services on the Serving Schedule: a gospel meeting, a monthly
// singing — anything that does not come round every week — on one day or
// each night of a run of days, with the jobs it needs. It is put down by the
// service's own name, which is how Upcoming Service finds it, fills its parts,
// and reminds its song leader.
//
// Setup → Add a special service (POST /api/serving/special) and the Build a
// month wizard (lib/rosterBuild.js) both lay one out through here.

const db = require('../db');
const { SERVICES, MONTHS } = require('../workflows/scheduling');
const { WORSHIP_ROLES } = require('./people');
const serviceJobs = require('./serviceJobs');
const plans = require('./worshipPlans');

const isIsoDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`));
const MAX_NIGHTS = 14;

// A Bible class is not a service anybody is rostered for, so it is never
// offered — whatever its tracking says.
const BIBLE_CLASS = /\bbible\b|\bclass(es)?\b|\bstudy\b/i;

// What can be added as a special service: the church's own list of services,
// kept by an admin, less the ones the regular rosters already cover.
function specialChoices() {
  const regular = new Set(SERVICES.map(s => s.toLowerCase()));
  return plans.activeServices()
    .filter(s => !regular.has(s.name.toLowerCase()) && !plans.servingServiceFor(s.name)
      && !(s.tracking === 'weekly' && s.weekday !== null) && !BIBLE_CLASS.test(s.name))
    .map(s => s.name);
}

const labelOf = d => ({ month: `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`, date: `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}` });

// Checks a special service and works out its nights and jobs, without
// writing anything: { type, from, through, nights, jobs, when } or { error }.
function check({ service, from, through, jobs } = {}) {
  const type = plans.serviceType(service);
  if (!type || !type.active || !specialChoices().includes(type.name)) {
    return { error: 'Choose which service it is, or add a new kind of service first.' };
  }
  from = String(from || '');
  through = String(through || '') || from;
  if (!isIsoDate(from) || !isIsoDate(through)) return { error: 'Choose the day it is held' };
  if (through < from) return { error: 'The last night is before the first' };

  const nights = [];
  for (let d = new Date(`${from}T12:00:00Z`); d.toISOString().slice(0, 10) <= through; d.setUTCDate(d.getUTCDate() + 1)) {
    nights.push(labelOf(d));
    if (nights.length > MAX_NIGHTS) return { error: `That is more than ${MAX_NIGHTS} nights — add a longer meeting in parts` };
  }

  const asked = Array.isArray(jobs) ? jobs : serviceJobs.jobsFor(type.name);
  // In the order of the worship jobs; a job asked for twice is two slots.
  const clean = WORSHIP_ROLES.flatMap(j => Array(Math.min(asked.filter(a => a === j).length, serviceJobs.MAX_OF_ONE_JOB)).fill(j));
  if (!clean.length) return { error: 'Choose at least one job it needs' };

  const when = nights.length === 1 ? nights[0].date : `${nights[0].date} – ${nights.at(-1).date}`;
  return { type, from, through, nights, jobs: clean, when };
}

// Puts a checked special service's empty slots down, adding only what each
// night does not have already. Returns how many slots it made.
function layOut({ type, nights, jobs }) {
  const already = db.prepare('SELECT job, COUNT(*) AS n FROM job_assignments WHERE month = ? AND date = ? AND lower(service) = lower(?) GROUP BY job');
  const insert = db.prepare('INSERT INTO job_assignments (month, date, service, job, name) VALUES (?, ?, ?, ?, ?)');
  return db.transaction(() => {
    let n = 0;
    for (const { month, date } of nights) {
      const have = new Map(already.all(month, date, type.name).map(r => [r.job, r.n]));
      for (const job of serviceJobs.missing(jobs, have)) {
        insert.run(month, date, type.name, job, '');
        n++;
      }
    }
    return n;
  })();
}

module.exports = { BIBLE_CLASS, MAX_NIGHTS, isIsoDate, specialChoices, check, layOut };
