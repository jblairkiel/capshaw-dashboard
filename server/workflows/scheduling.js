// ─── Building a month of worship assignments ──────────────────────────────────
// Pure and deterministic: given the same month, roles and preferences it always
// produces the same schedule, so the coordinator can regenerate deliberately
// (by asking for a different attempt) rather than by chance.
//
// The rules, in order of importance:
//   1. Never schedule somebody who said they are unavailable for that role.
//   2. Never schedule the same person twice in one service.
//   3. Spread the load — whoever has had the fewest turns goes next.
//   4. Among people on equal turns, the one who said they are glad to do it
//      gets it ahead of one who is merely willing.
//   5. Break any remaining tie by name, so the result is stable.
//
// Load beats keenness deliberately. Sorting by keenness first would hand the
// one eager song leader every Sunday in the month while a willing volunteer
// sat idle — which is not what a coordinator would do by hand.

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Which roles each service needs. Sunday morning is the full set; the other
// services are lighter, which matches how these rosters are usually built.
const SERVICE_ROLES = {
  'Sunday Worship':  ['Song Leader', 'Opening Prayer', 'Scripture Reading', 'Communion', 'Closing Prayer', 'Usher'],
  'Sunday Evening':  ['Song Leader', 'Opening Prayer', 'Closing Prayer'],
  'Wednesday':       ['Song Leader', 'Opening Prayer'],
};

const SERVICES = Object.keys(SERVICE_ROLES);

function parseMonth(label) {
  const match = String(label || '').trim().match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (!match) return null;
  const monthIndex = MONTHS.findIndex(m => m.toLowerCase() === match[1].toLowerCase());
  if (monthIndex < 0) return null;
  return { monthIndex, year: Number(match[2]), label: `${MONTHS[monthIndex]} ${match[2]}` };
}

// Every occurrence of a weekday in a month. 0 = Sunday, 3 = Wednesday.
function datesFor({ monthIndex, year }, weekday) {
  const dates = [];
  const date = new Date(Date.UTC(year, monthIndex, 1));
  while (date.getUTCMonth() === monthIndex) {
    if (date.getUTCDay() === weekday) dates.push(new Date(date));
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return dates;
}

function formatDate(date) {
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

// Every service in the month, in the order they happen.
function servicesIn(month, wanted = SERVICES) {
  const occasions = [];

  for (const service of wanted) {
    const weekday = service === 'Wednesday' ? 3 : 0;
    for (const date of datesFor(month, weekday)) {
      occasions.push({ date, dateLabel: formatDate(date), service, roles: SERVICE_ROLES[service] || [] });
    }
  }

  return occasions.sort((a, b) => a.date - b.date || SERVICES.indexOf(a.service) - SERVICES.indexOf(b.service));
}

// Turns the stored preference rows into "who could do this role, and how
// keenly", keyed by role.
function candidatesByRole(people, preferences) {
  const byRole = new Map();
  const nameOf = new Map(people.map(p => [p.id, p.name]));

  for (const pref of preferences) {
    if (pref.level === 'unavailable') continue;          // rule 1
    if (!nameOf.has(pref.directory_id)) continue;        // no longer in the directory

    if (!byRole.has(pref.role)) byRole.set(pref.role, []);
    byRole.get(pref.role).push({
      id: pref.directory_id,
      name: nameOf.get(pref.directory_id),
      keen: pref.level === 'preferred',                  // rule 3
    });
  }

  return byRole;
}

/**
 * Builds a month of assignments.
 *
 * `attempt` shifts who gets first refusal, so asking again produces a genuinely
 * different-but-still-fair schedule rather than the same one.
 *
 * Returns the rows, plus any role nobody could be found for — reported rather
 * than quietly left blank, since an unfilled slot is the thing a coordinator
 * most needs to know about.
 */
function generateSchedule({ month, people = [], preferences = [], services = SERVICES, attempt = 0 }) {
  const parsed = parseMonth(month);
  if (!parsed) return { error: `"${month}" is not a month I understand — try "June 2026"` };

  const byRole = candidatesByRole(people, preferences);
  const occasions = servicesIn(parsed, services);

  const turnsTaken = new Map();     // directory id → how many turns so far
  const rows = [];
  const unfilled = [];

  for (const occasion of occasions) {
    const usedToday = new Set();    // rule 2

    for (const role of occasion.roles) {
      const candidates = (byRole.get(role) || []).filter(c => !usedToday.has(c.id));

      if (!candidates.length) {
        unfilled.push({ date: occasion.dateLabel, service: occasion.service, role });
        rows.push({ date: occasion.dateLabel, service: occasion.service, job: role, name: '' });
        continue;
      }

      const chosen = pickFrom(candidates, turnsTaken, attempt);
      usedToday.add(chosen.id);
      turnsTaken.set(chosen.id, (turnsTaken.get(chosen.id) || 0) + 1);

      rows.push({ date: occasion.dateLabel, service: occasion.service, job: role, name: chosen.name });
    }
  }

  return {
    month: parsed.label,
    rows,
    unfilled,
    // How the work came out, so fairness can be seen rather than assumed.
    load: [...turnsTaken.entries()]
      .map(([id, turns]) => ({ name: people.find(p => p.id === id)?.name || '', turns }))
      .sort((a, b) => b.turns - a.turns || a.name.localeCompare(b.name)),
  };
}

// Fewest turns first, keenness breaking the tie, then name. `attempt` rotates
// within the tied front-runners so regenerating gives somebody else the first
// turn without abandoning fairness.
function pickFrom(candidates, turnsTaken, attempt) {
  const turnsOf = c => turnsTaken.get(c.id) || 0;

  const sorted = [...candidates].sort((a, b) => {
    const turns = turnsOf(a) - turnsOf(b);
    if (turns !== 0) return turns;                                        // rule 3
    if (a.keen !== b.keen) return a.keen ? -1 : 1;                        // rule 4
    return a.name.localeCompare(b.name);                                  // rule 5
  });

  const best = sorted[0];
  const tied = sorted.filter(c => turnsOf(c) === turnsOf(best) && c.keen === best.keen);

  return tied[attempt % tied.length];
}

// The schedule as a table the workflow screen can render.
function asPreview(draft) {
  return {
    columns: ['Date', 'Service', 'Job', 'Name'],
    rows: (draft?.rows || []).map(r => [r.date, r.service, r.job, r.name || '— nobody available —']),
  };
}

// One person's own assignments, for the note that goes to them.
function assignmentsFor(draft, name) {
  const wanted = String(name || '').trim().toLowerCase();
  return (draft?.rows || []).filter(r => (r.name || '').trim().toLowerCase() === wanted);
}

module.exports = {
  MONTHS, SERVICES, SERVICE_ROLES,
  parseMonth, datesFor, servicesIn, generateSchedule, asPreview, assignmentsFor,
};
