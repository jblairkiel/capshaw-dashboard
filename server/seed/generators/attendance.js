// Attendance, one count per service across the past few months, so the page
// has something to draw and the service types have something under them.
module.exports = {
  id:    'attendance',
  label: 'Attendance',
  area:  'attendance',
  page:  'Attendance',
  order: 30,
  describe: 'A count for every service across the past few months.',
  tables: ['attendance'],

  generate({ insert, random, scale, helpers, db }) {
    const services = db.prepare("SELECT name FROM service_types WHERE active = 1 ORDER BY sort_order").all()
      .map(r => r.name);
    const list = services.length ? services : ['Sunday AM Worship', 'Sunday PM Worship', 'Wednesday Bible Study'];

    const weeks = 8 * scale;
    for (let w = 0; w < weeks; w++) {
      for (const service of list) {
        // A morning service is fuller than a midweek one, and the number
        // wanders rather than sitting still.
        const base = /wed|bible|study/i.test(service) ? 60 : /pm|evening/i.test(service) ? 70 : 130;
        insert('attendance', {
          date:    helpers.asIsoDate(random.date(w * 7 + random.int(0, 2))),
          service,
          count:   Math.max(1, base + random.int(-15, 20)),
        }, `${service} — ${w} week(s) ago`);
      }
    }
  },
};
