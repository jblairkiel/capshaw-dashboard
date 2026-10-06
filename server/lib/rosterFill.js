// Who could take a slot on the Serving Schedule, and filling a month's open
// slots from that.
//
// A man is a candidate for a job when he has said he is glad to or willing to
// do it (My Household & Preferences, or recorded for him on the Service
// Roster). Among candidates, the ones who can actually do it on the day come
// first: not away, and not already serving at that same service. Then fewest
// turns so far this month — so the load is spread — glad before willing, and
// for anything still level, chance: building a month twice gives two
// different, equally fair months.
//
// Filling only ever touches an empty slot; a name already on the schedule,
// put there by hand, is never moved.

const db = require('../db');
const blackouts = require('./blackouts');

const nameKey = s => String(s || '').trim().toLowerCase();
const LEVEL_RANK = { preferred: 0, willing: 1, '': 2, unavailable: 3 };

// Everything the ranking needs for one month, read once.
function contextFor(month) {
  const people = db.prepare("SELECT id, name, gender FROM directory WHERE trim(name) <> '' AND coalesce(gender, '') <> 'female'").all();
  const prefs = new Map();
  for (const r of db.prepare('SELECT directory_id, role, level FROM worship_preferences').all()) {
    if (!prefs.has(r.directory_id)) prefs.set(r.directory_id, {});
    prefs.get(r.directory_id)[r.role] = r.level;
  }
  const slots = db.prepare('SELECT id, month, date, service, job, name FROM job_assignments WHERE month = ? ORDER BY id').all(month);
  const turns = new Map();
  const serving = new Map();   // "date|service" → names down for it
  for (const s of slots) {
    if (!s.name.trim()) continue;
    turns.set(nameKey(s.name), (turns.get(nameKey(s.name)) || 0) + 1);
    const at = `${s.date}|${nameKey(s.service)}`;
    if (!serving.has(at)) serving.set(at, new Set());
    serving.get(at).add(nameKey(s.name));
  }
  return { month, people, prefs, slots, turns, serving };
}

// Every man, ranked for one slot, each saying why he is or is not a fit.
function rank(slot, ctx, random = Math.random) {
  const day = blackouts.dateOf(slot.month, slot.date);
  const at = `${slot.date}|${nameKey(slot.service)}`;
  return ctx.people
    .map(p => {
      const level = ctx.prefs.get(p.id)?.[slot.job] || '';
      const away = day ? blackouts.personAwayOn(p.id, day) : null;
      const busy = (ctx.serving.get(at) || new Set()).has(nameKey(p.name)) && nameKey(p.name) !== nameKey(slot.name);
      return {
        id: p.id, name: p.name, level,
        away: away ? { startsOn: away.startsOn, endsOn: away.endsOn, reason: away.reason || '' } : null,
        busy,
        turns: ctx.turns.get(nameKey(p.name)) || 0,
        current: nameKey(p.name) === nameKey(slot.name),
        free: !away && !busy && level !== 'unavailable',
        tie: random(),
      };
    })
    .sort((a, b) =>
      (b.free - a.free)
      || (LEVEL_RANK[a.level] - LEVEL_RANK[b.level])
      || (a.turns - b.turns)
      || (a.tie - b.tie)
      || a.name.localeCompare(b.name))
    .map(({ tie, ...rest }) => rest);
}

// Somebody fit to be put in without asking: free on the day, and has said he
// will do this job.
const willDo = c => c.free && (c.level === 'preferred' || c.level === 'willing');

// Fills the month's empty slots, in date order. Returns what it filled.
function fillOpen(month, { random = Math.random } = {}) {
  const ctx = contextFor(month);
  const order = s => blackouts.dateOf(s.month, s.date) || '9999';
  const open = ctx.slots.filter(s => !s.name.trim() && s.date).sort((a, b) => order(a).localeCompare(order(b)) || a.id - b.id);
  const set = db.prepare('UPDATE job_assignments SET name = ? WHERE id = ?');
  const filled = [];
  db.transaction(() => {
    for (const slot of open) {
      const pick = rank(slot, ctx, random).find(willDo);
      if (!pick) continue;
      set.run(pick.name, slot.id);
      filled.push({ ...slot, name: pick.name });
      ctx.turns.set(nameKey(pick.name), (ctx.turns.get(nameKey(pick.name)) || 0) + 1);
      const at = `${slot.date}|${nameKey(slot.service)}`;
      if (!ctx.serving.has(at)) ctx.serving.set(at, new Set());
      ctx.serving.get(at).add(nameKey(pick.name));
    }
  })();
  return { filled, open: open.length - filled.length };
}

// Ranked candidates for one slot, for the keeper's picker.
function candidatesFor(slotId) {
  const slot = db.prepare('SELECT * FROM job_assignments WHERE id = ?').get(Number(slotId));
  if (!slot) return null;
  return { slot, candidates: rank(slot, contextFor(slot.month)) };
}

module.exports = { fillOpen, candidatesFor, rank, contextFor };
