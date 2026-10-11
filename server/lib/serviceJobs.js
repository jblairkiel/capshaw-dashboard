// The jobs each service needs on the Serving Schedule — set by whoever holds
// the serving-schedule area, on the Serving Schedule page.
//
// A regular roster ("Sunday Worship", "Sunday Evening", "Wednesday") starts
// from the defaults in server/workflows/scheduling.js; a special service (a
// gospel meeting) from SPECIAL_DEFAULT. Building a month, the Monthly Worship
// Schedule's draft, and adding a special service all read from here, so a
// change is made once.

const db = require('../db');
const { SERVICES, SERVICE_ROLES } = require('../workflows/scheduling');
const { WORSHIP_ROLES } = require('./people');

const SPECIAL_DEFAULT = ['Song Leader', 'Opening Prayer', 'Closing Prayer'];
const MAX_OF_ONE_JOB = 8;

function stored() {
  const out = {};
  for (const r of db.prepare('SELECT service, jobs, updated_by, updated_at FROM service_jobs').all()) {
    let jobs = [];
    try { jobs = JSON.parse(r.jobs); } catch { /* a damaged row reads as unset */ }
    if (Array.isArray(jobs)) out[r.service] = { jobs: jobs.filter(j => WORSHIP_ROLES.includes(j)), by: r.updated_by, at: r.updated_at };
  }
  return out;
}

const defaultFor = service => SERVICE_ROLES[service] || SPECIAL_DEFAULT;

// The jobs for one service.
function jobsFor(service) {
  return stored()[service]?.jobs || [...defaultFor(service)];
}

// { service: [jobs] } for the regular rosters and any special services named,
// the shape server/workflows/scheduling.js builds a month from.
function rolesByService(specials = []) {
  const own = stored();
  return Object.fromEntries([...SERVICES, ...specials].map(s => [s, own[s]?.jobs || [...defaultFor(s)]]));
}

// What the page shows: each service, its jobs, and whether they are the
// defaults or somebody's own.
function list(specials = []) {
  const own = stored();
  return [...SERVICES, ...specials].map(service => ({
    service,
    special: !SERVICES.includes(service),
    jobs: own[service]?.jobs || [...defaultFor(service)],
    defaults: [...defaultFor(service)],
    custom: !!own[service],
    updatedBy: own[service]?.by || '',
  }));
}

// `jobs` null puts a service back on its defaults.
function setJobs(service, jobs, user) {
  const name = String(service || '').trim();
  if (!name) return { error: 'Which service?' };
  const before = jobsFor(name);
  if (jobs === null) {
    db.prepare('DELETE FROM service_jobs WHERE service = ?').run(name);
    return { service: name, before, jobs: jobsFor(name) };
  }
  if (!Array.isArray(jobs)) return { error: 'Say which jobs the service needs' };
  const unknown = jobs.find(j => !WORSHIP_ROLES.includes(j));
  if (unknown !== undefined) return { error: `"${unknown}" is not one of the worship jobs` };
  // A job may be listed more than once — two communion assists are two
  // slots — but not without limit.
  const counts = {};
  for (const j of jobs) counts[j] = (counts[j] || 0) + 1;
  const tooMany = Object.entries(counts).find(([, n]) => n > MAX_OF_ONE_JOB);
  if (tooMany) return { error: `No more than ${MAX_OF_ONE_JOB} of ${tooMany[0]} at one service` };
  // Kept in the order of the worship jobs, repeats together.
  const clean = WORSHIP_ROLES.flatMap(j => Array(counts[j] || 0).fill(j));
  if (!clean.length) return { error: 'A service needs at least one job' };
  db.prepare(`
    INSERT INTO service_jobs (service, jobs, updated_by, updated_at) VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT (service) DO UPDATE SET jobs = excluded.jobs, updated_by = excluded.updated_by, updated_at = excluded.updated_at
  `).run(name, JSON.stringify(clean), user?.name || '');
  return { service: name, before, jobs: clean };
}

// How many slots of each job are already down for one service on one day,
// and how many more the jobs list asks for: building again only adds the
// difference.
function missing(jobs, have) {
  const left = new Map(have);
  const out = [];
  for (const job of jobs) {
    const n = left.get(job) || 0;
    if (n > 0) left.set(job, n - 1);
    else out.push(job);
  }
  return out;
}

module.exports = { SPECIAL_DEFAULT, MAX_OF_ONE_JOB, missing, jobsFor, rolesByService, list, setJobs };
