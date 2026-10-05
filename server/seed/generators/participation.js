// The last few months of worship jobs, so Worship Participation has a history
// to analyse. Some men are leaned on far more than others, and the odd slot
// was never filled, which is what the page is for noticing.
const { parseMonth, servicesIn } = require('../../workflows/scheduling');

function monthLabel(offset) {
  const when = new Date();
  when.setDate(1);
  when.setMonth(when.getMonth() + offset);
  return `${when.toLocaleString('en-US', { month: 'long' })} ${when.getFullYear()}`;
}

module.exports = {
  id:    'participation',
  label: 'Worship Participation',
  area:  'serving-schedule',
  page:  'Service Roster → Analysis',
  order: 55,
  describe: 'The last three months of worship jobs, with a few men doing most of them and the odd slot left unfilled.',
  tables: ['job_assignments'],

  generate({ insert, random, scale, db, helpers }) {
    const names = db.prepare("SELECT name FROM directory WHERE gender = 'male' ORDER BY id DESC LIMIT 30").all().map(r => r.name);
    if (names.length < 3) return;
    // A few are asked again and again; the rest now and then.
    const regulars = names.slice(0, Math.max(2, Math.floor(names.length / 4)));
    const pickMan = () => (random.chance(0.6) ? random.pick(regulars) : random.pick(names));
    const today = helpers.asIsoDate(new Date());
    const taken = db.prepare('SELECT 1 FROM job_assignments WHERE month = ? AND date = ? AND service = ? AND job = ? LIMIT 1');

    for (let offset = -Math.min(3, 1 + scale); offset <= 0; offset++) {
      const label = monthLabel(offset);
      for (const occasion of servicesIn(parseMonth(label))) {
        if (occasion.date.toISOString().slice(0, 10) > today) continue;
        const used = new Set();
        for (const job of occasion.roles) {
          if (taken.get(label, occasion.dateLabel, occasion.service, job)) continue;
          let name = pickMan();
          for (let i = 0; i < 5 && used.has(name); i++) name = pickMan();
          used.add(name);
          insert('job_assignments', {
            month: label, date: occasion.dateLabel, service: occasion.service, job,
            name: random.chance(1 / 12) ? '' : name,
          }, `${job} — ${occasion.dateLabel} ${occasion.service} (past)`);
        }
      }
    }
  },
};
