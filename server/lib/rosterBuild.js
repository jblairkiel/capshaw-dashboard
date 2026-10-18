// Building a month of the Serving Schedule, as the "Build a month" wizard
// does it.
//
// The wizard walks the schedule keeper through three steps:
//
//   1. Dates — which services, which of their dates (a Sunday evening given
//      over to a combined service is left out), whether to fill in names,
//      whether to fill the special services already planned that month, and
//      any new special service to add (a gospel meeting's nights).
//   2. Jobs — each service's jobs for this month only (four communion assists
//      instead of six on a fifth Sunday), starting from the usual ones, with
//      the choice to make them the usual ones from now on; and the jobs each
//      new special service needs.
//   3. Preview — the whole month as it would be, laid out and filled, before
//      anything is saved. "Shuffle again" draws a fresh fill; saving keeps
//      exactly the draw that was shown, because the preview's random seed is
//      sent back and the fill is made from it again.
//
// A preview does the real work inside a transaction and rolls it back, so
// what is shown is what saving will do, not a second copy of the rules.
// What the keeper chose (services, fill, specials) is remembered for next
// month; skipped dates and a month's own jobs are not, being about one month.

const db = require('../db');
const { SERVICES, parseMonth, servicesIn } = require('../workflows/scheduling');
const serviceJobs = require('./serviceJobs');
const rosterFill = require('./rosterFill');
const blackouts = require('./blackouts');
const specialServices = require('./specialServices');

const DEFAULTS = { services: SERVICES, fill: true, fillSpecials: true };

// ─── Remembered choices ───────────────────────────────────────────────────────

function settings() {
  const out = { ...DEFAULTS };
  for (const r of db.prepare('SELECT key, value FROM serving_settings').all()) {
    try { if (r.key in DEFAULTS) out[r.key] = JSON.parse(r.value); } catch { /* a damaged row reads as unset */ }
  }
  out.services = Array.isArray(out.services) ? out.services.filter(s => SERVICES.includes(s)) : [...SERVICES];
  if (!out.services.length) out.services = [...SERVICES];
  out.fill = out.fill !== false;
  out.fillSpecials = out.fillSpecials !== false;
  return out;
}

function remember(choices, user) {
  const put = db.prepare(`
    INSERT INTO serving_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at
  `);
  for (const key of Object.keys(DEFAULTS)) {
    if (choices[key] !== undefined) put.run(key, JSON.stringify(choices[key]), user?.name || '');
  }
}

// ─── Step one: what the month holds ───────────────────────────────────────────

const slotsIn = month => db.prepare('SELECT id, month, date, service, job, name FROM job_assignments WHERE month = ? ORDER BY id').all(month);

// Every regular service's dates in the month (with how much of each is
// already built), the special services already planned in it, and the
// choices to start from.
function plan(label) {
  const parsed = parseMonth(label);
  if (!parsed) return { error: `"${label}" is not a month I understand — try "June 2026"` };
  const slots = slotsIn(parsed.label);
  const tally = new Map();
  for (const s of slots) {
    const key = `${s.date}|${s.service}`;
    const t = tally.get(key) || { slots: 0, filled: 0 };
    t.slots++; if (s.name.trim()) t.filled++;
    tally.set(key, t);
  }
  const roles = serviceJobs.rolesByService();
  const services = SERVICES.map(service => ({
    service,
    jobs: roles[service],
    dates: servicesIn(parsed, [service], roles).map(o => ({
      date: o.dateLabel,
      iso: blackouts.dateOf(parsed.label, o.dateLabel),
      ...(tally.get(`${o.dateLabel}|${service}`) || { slots: 0, filled: 0 }),
    })),
  }));

  const specials = new Map();
  for (const s of slots) {
    if (SERVICES.includes(s.service) || !s.date) continue;
    if (!specials.has(s.service)) specials.set(s.service, { service: s.service, dates: new Set(), slots: 0, open: 0 });
    const sp = specials.get(s.service);
    sp.dates.add(s.date); sp.slots++; if (!s.name.trim()) sp.open++;
  }
  const isoOf = d => blackouts.dateOf(parsed.label, d) || '';
  return {
    month: parsed.label,
    services,
    specials: [...specials.values()].map(sp => ({ ...sp, dates: [...sp.dates].sort((a, b) => isoOf(a).localeCompare(isoOf(b))) })),
    // What can be added as a special service, each with the jobs it usually needs.
    specialKinds: specialServices.specialChoices().map(service => ({ service, jobs: serviceJobs.jobsFor(service) })),
    maxNights: specialServices.MAX_NIGHTS,
    settings: settings(),
  };
}

// ─── Steps two and three: building, or showing what building would do ────────

// A small seeded generator (mulberry32), so a preview's draw can be made again.
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ROLLBACK = Symbol('preview');

// Lays out and fills a month. `body` is what the wizard (or the old one-step
// Build a month) sends:
//
//   month         "June 2026"
//   services      which regular services; all of them when left out. An
//                 empty list is none, when the build only adds specials.
//   skip          ["June 7|Sunday Evening", …]: dates to leave alone
//   jobs          { service: [jobs] } for this month only
//   saveJobs      [service, …]: also make this month's jobs the usual ones
//   fill          false lays out empty slots only
//   fillSpecials  true or false: fill the month's special services as well.
//                 Left out, every open slot in the month is filled, as the
//                 one-step build always did.
//   addSpecials   [{ service, from, through, jobs }, …]: new special
//                 services, each night inside the month, laid out (and
//                 filled, if names are being filled) with the rest
//   preview       true shows what would happen and saves nothing
//   seed          the preview's draw, to save exactly that
//
// `view(month)` reads the month's slots the way the page shows them; it is
// read inside the transaction, so a preview sees its own unsaved work.
function build(body = {}, { user, view = slotsIn } = {}) {
  const label  = String(body.month || '').trim();
  const parsed = parseMonth(label);
  if (!parsed) return { error: `"${label}" is not a month I understand — try "June 2026"` };

  // Special services to add, each checked, and all inside this month: the
  // preview shows one month, so a meeting running over the turn of the month
  // goes in through Setup → Add a special service instead.
  const added = [];
  for (const asked of Array.isArray(body.addSpecials) ? body.addSpecials : []) {
    const special = specialServices.check(asked);
    if (special.error) return { error: `${asked?.service || 'Special service'}: ${special.error}` };
    if (special.nights.some(n => n.month !== parsed.label)) {
      return { error: `${special.type.name}: every night has to be in ${parsed.label} — add a meeting that runs into another month with Setup → Add a special service` };
    }
    added.push(special);
  }

  const wanted = Array.isArray(body.services) && (body.services.length || added.length)
    ? SERVICES.filter(s => body.services.includes(s))
    : SERVICES;
  if (!wanted.length && !added.length) return { error: 'Choose at least one service' };

  const roles = serviceJobs.rolesByService();
  const monthJobs = {};
  if (body.jobs && typeof body.jobs === 'object') {
    for (const [service, list] of Object.entries(body.jobs)) {
      if (!wanted.includes(service)) continue;
      const { jobs, error } = serviceJobs.cleanJobs(list);
      if (error) return { error: `${service}: ${error}` };
      monthJobs[service] = roles[service] = jobs;
    }
  }

  const skip = new Set((Array.isArray(body.skip) ? body.skip : []).map(String));
  const all = servicesIn(parsed, wanted, roles);
  if (!all.length && !added.length) return { error: `No services fall in ${parsed.label}` };
  const occasions = all.filter(o => !skip.has(`${o.dateLabel}|${o.service}`));
  if (!occasions.length && !added.length) return { error: 'Every date is left out, so there is nothing to build' };
  const addedNights = new Set(added.flatMap(sp => sp.nights.map(n => `${n.date}|${sp.type.name}`)));

  const specials = new Set(slotsIn(parsed.label).filter(s => !SERVICES.includes(s.service)).map(s => s.service));
  const inScope = body.fillSpecials === undefined
    ? () => true
    : s => (wanted.includes(s.service) && !skip.has(`${s.date}|${s.service}`))
        || (body.fillSpecials === true && specials.has(s.service))
        || addedNights.has(`${s.date}|${s.service}`);

  const seed = Number.isInteger(body.seed) ? body.seed : Math.floor(Math.random() * 2 ** 31);
  const preview = body.preview === true;
  const saveJobs = (Array.isArray(body.saveJobs) ? body.saveJobs : []).filter(s => monthJobs[s]);

  let result;
  const run = db.transaction(() => {
    // How many of each job each service already has, so building again adds
    // only what is missing — a sixth communion assist, say.
    const before = slotsIn(parsed.label);
    const have = new Map();
    for (const a of before) {
      const key = `${a.date}|${a.service}`;
      if (!have.has(key)) have.set(key, new Map());
      have.get(key).set(a.job, (have.get(key).get(a.job) || 0) + 1);
    }
    const insert = db.prepare('INSERT INTO job_assignments (month, date, service, job, name) VALUES (?, ?, ?, ?, ?)');
    let created = 0;
    for (const special of added) created += specialServices.layOut(special);
    for (const occasion of occasions) {
      for (const job of serviceJobs.missing(occasion.roles, have.get(`${occasion.dateLabel}|${occasion.service}`))) {
        insert.run(parsed.label, occasion.dateLabel, occasion.service, job, '');
        created++;
      }
    }

    const { filled, open } = body.fill === false
      ? { filled: [], open: slotsIn(parsed.label).filter(a => !a.name.trim() && inScope(a)).length }
      : rosterFill.fillOpen(parsed.label, { random: seeded(seed), only: inScope });

    if (!preview) {
      for (const service of saveJobs) serviceJobs.setJobs(service, monthJobs[service], user);
      // The specials choice is only a choice in a month that has some.
      remember({ ...(wanted.length ? { services: wanted } : {}), fill: body.fill !== false, ...(typeof body.fillSpecials === 'boolean' && specials.size ? { fillSpecials: body.fillSpecials } : {}) }, user);
    }

    const old = new Set(before.map(a => a.id));
    const filledIds = new Set(filled.map(f => f.id));
    result = {
      month: parsed.label, services: wanted, preview, seed, created, filled, open, saveJobs,
      added: added.map(sp => ({ service: sp.type.name, from: sp.from, through: sp.through, when: sp.when, nights: sp.nights.length, jobs: sp.jobs })),
      assignments: view(parsed.label).map(a => ({ ...a, isNew: !old.has(a.id), justFilled: filledIds.has(a.id) })),
    };
    if (preview) throw ROLLBACK;
  });
  try { run(); } catch (err) { if (err !== ROLLBACK) throw err; }
  return result;
}

module.exports = { plan, build, settings, remember, seeded, DEFAULTS };
