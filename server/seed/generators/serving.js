// Next month's worship jobs, filled from the directory, with a slot or two
// left empty — an unfilled slot is the thing the page exists to show.
const JOBS = [
  'Song Leader', 'Opening Prayer', 'Closing Prayer', 'Lord\'s Table',
  'Scripture Reading', 'Announcements', 'Usher', 'Greeter', 'Sound Booth',
];

module.exports = {
  id:    'serving',
  label: 'Serving Schedule',
  area:  'serving-schedule',
  page:  'Serving Schedule',
  order: 50,
  describe: 'A month of worship jobs, filled from the directory, with some slots left open.',
  tables: ['job_assignments', 'job_eligibility'],

  generate({ insert, random, scale, db }) {
    const men = db.prepare("SELECT id, name FROM directory WHERE gender = 'male' ORDER BY id DESC LIMIT 30").all();
    const names = men.map(r => r.name);

    const now   = new Date();
    const month = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const label = `${month.toLocaleString('en-US', { month: 'long' })} ${month.getFullYear()}`;

    // Every Sunday next month, morning and evening.
    const sundays = [];
    for (let d = new Date(month); d.getMonth() === month.getMonth(); d.setDate(d.getDate() + 1)) {
      if (d.getDay() === 0) sundays.push(new Date(d));
    }

    for (const sunday of sundays.slice(0, 5)) {
      const date = `${sunday.toLocaleString('en-US', { month: 'long' })} ${sunday.getDate()}`;
      for (const service of ['AM', 'PM']) {
        for (const job of random.some(JOBS, 4 + scale)) {
          // One slot in six is left open on purpose.
          const filled = names.length && !random.chance(1 / 6);
          insert('job_assignments', {
            month: label, date, service, job,
            name:  filled ? random.pick(names) : '',
          }, `${job} — ${date} ${service}`);
        }
      }
    }

    // Who may sign up for what, so the member-jobs page has something in it.
    for (const member of men.slice(0, 6 * scale)) {
      for (const job of random.some(JOBS, random.int(1, 4))) {
        insert('job_eligibility', { directory_id: member.id, job }, `${member.name} may do ${job}`);
      }
    }
  },
};
