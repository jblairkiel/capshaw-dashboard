// Next month's worship jobs, filled from the directory, with a slot or two
// left empty — an unfilled slot is the thing the page exists to show.
//
// The month is laid out the way the Serving Schedule page lays one out, from
// the same services and the same roles, so a sample month is the shape of a
// real one rather than a lookalike. Who may sign up for what follows what each
// man said on the Service Roster: nobody is signed off for a job they asked
// not to do, and a few of them have blocked out days they will be away.
const { WORSHIP_ROLES } = require('../../lib/people');
const { MARK } = require('../people');
const { parseMonth, servicesIn } = require('../../workflows/scheduling');

const AWAY_REASONS = [
  'Away with family',
  'Work travel',
  'Surgery and recovery',
  'Visiting the grandchildren',
  'Out of town for a wedding',
];

function monthLabel(offset) {
  const when = new Date();
  when.setDate(1);
  when.setMonth(when.getMonth() + offset);
  return `${when.toLocaleString('en-US', { month: 'long' })} ${when.getFullYear()}`;
}

module.exports = {
  id:    'serving',
  label: 'Serving Schedule',
  area:  'serving-schedule',
  page:  'Serving Schedule',
  order: 50,
  describe: 'A month of worship jobs, filled from the directory, with some slots left open — who may sign up for what, and a few men away.',
  tables: ['job_assignments', 'job_eligibility', 'job_blackouts'],

  generate({ insert, random, scale, db }) {
    const men = db.prepare("SELECT id, name FROM directory WHERE gender = 'male' ORDER BY id DESC LIMIT 30").all();
    const names = men.map(r => r.name);

    // Next month always; the month after as well once there is enough of
    // everything else to be worth paging through.
    const labels = [monthLabel(1), ...(scale >= 3 ? [monthLabel(2)] : [])];

    for (const label of labels) {
      const month = parseMonth(label);
      for (const occasion of servicesIn(month)) {
        for (const job of occasion.roles) {
          // One slot in six is left open on purpose.
          const filled = names.length && !random.chance(1 / 6);
          insert('job_assignments', {
            month:   label,
            date:    occasion.dateLabel,
            service: occasion.service,
            job,
            name:    filled ? random.pick(names) : '',
          }, `${job} — ${occasion.dateLabel} ${occasion.service}`);
        }
      }
    }

    // What each man has already said, so being signed off agrees with it.
    const refused = new Map();
    for (const row of db.prepare("SELECT directory_id, role FROM worship_preferences WHERE level = 'unavailable'").all()) {
      if (!refused.has(row.directory_id)) refused.set(row.directory_id, new Set());
      refused.get(row.directory_id).add(row.role);
    }

    for (const member of men.slice(0, 6 * scale)) {
      const open = WORSHIP_ROLES.filter(role => !refused.get(member.id)?.has(role));
      for (const job of random.some(open, random.int(1, 4))) {
        insert('job_eligibility', { directory_id: member.id, job }, `${member.name} may do ${job}`);
      }
    }

    // A few men away next month, which is what the schedule keeper is looking
    // for when a Sunday will not fill: a holiday, a hospital stay, a week at
    // the beach. Kept inside the month that has just been laid out, so the
    // effect shows on the page rather than in a month nobody is looking at.
    const next = parseMonth(labels[0]);
    const pad  = n => String(n).padStart(2, '0');
    const day  = d => `${next.year}-${pad(next.monthIndex + 1)}-${pad(d)}`;

    for (const member of random.some(men, Math.min(men.length, random.int(1, 2 * scale)))) {
      const from = random.int(1, 20);
      insert('job_blackouts', {
        directory_id: member.id,
        starts_on:    day(from),
        ends_on:      day(from + random.int(0, 8)),
        reason:       `${random.pick(AWAY_REASONS)} (${MARK})`,
      }, `${member.name} away ${day(from)}`);
    }
  },
};
