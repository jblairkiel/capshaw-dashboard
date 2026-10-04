// The last few months of worship jobs, and who actually did them, so Worship
// Participation has a history to analyse: most Sundays checked, a few left
// unchecked, the odd man standing in for another and the odd job missed. Some
// men are leaned on far more than others, which is what the page is for
// noticing.
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
  page:  'Worship Participation',
  order: 55,
  describe: 'The last three months of worship jobs, with most services checked: who served, who stood in, and what was missed.',
  tables: ['job_assignments', 'worship_participation'],

  generate({ insert, random, scale, db, helpers }) {
    const men = db.prepare("SELECT name FROM directory WHERE gender = 'male' ORDER BY id DESC LIMIT 30").all().map(r => r.name);
    if (men.length < 3) return;
    // A few are asked again and again; the rest now and then.
    const regulars = men.slice(0, Math.max(2, Math.floor(men.length / 4)));
    const pickMan = () => (random.chance(0.6) ? random.pick(regulars) : random.pick(men));
    const today = helpers.asIsoDate(new Date());
    const taken = db.prepare('SELECT 1 FROM job_assignments WHERE month = ? AND date = ? AND service = ? AND job = ? LIMIT 1');

    for (let offset = -Math.min(3, 1 + scale); offset <= 0; offset++) {
      const label = monthLabel(offset);
      const month = parseMonth(label);
      for (const occasion of servicesIn(month)) {
        const iso = occasion.date.toISOString().slice(0, 10);
        if (iso > today) continue;
        const checked = random.chance(0.75);
        const used = new Set();
        for (const job of occasion.roles) {
          if (taken.get(label, occasion.dateLabel, occasion.service, job)) continue;
          let name = pickMan();
          for (let i = 0; i < 5 && used.has(name); i++) name = pickMan();
          used.add(name);
          const filled = !random.chance(1 / 12);
          insert('job_assignments', { month: label, date: occasion.dateLabel, service: occasion.service, job, name: filled ? name : '' },
            `${job} — ${occasion.dateLabel} ${occasion.service} (past)`);
          if (!checked || !filled) continue;

          const roll = random.next();
          const outcome = roll < 0.85 ? 'served' : roll < 0.95 ? 'substitute' : 'missed';
          const stoodIn = outcome === 'substitute' ? men.find(m => !used.has(m)) || random.pick(men) : '';
          insert('worship_participation', {
            date: iso, service: occasion.service, job, position: 0,
            scheduled_name: name, outcome, served_name: stoodIn, user_name: 'Sample data',
          }, `${job} ${iso} — ${outcome}`);
        }
      }
    }
  },
};
