// A few weeks of roll calls for the people in the directory, so the Member
// Attendance roll and its analytics have something in them. Each sample
// service's roll is a fresh one: a roll somebody really took is left alone.
//
// The statuses are the tracker's list and are only made here when there is no
// list at all (a database emptied by hand); otherwise the real ones are used.
module.exports = {
  id:    'member-attendance',
  label: 'Member Attendance',
  area:  'member-attendance',
  page:  'Member Attendance',
  order: 35,
  describe: 'Roll calls for the directory at each service across the past few weeks.',
  tables: ['attendance_statuses', 'member_attendance'],

  generate({ insert, random, scale, helpers, db }) {
    const people = db.prepare("SELECT id FROM directory WHERE trim(name) <> '' ORDER BY id DESC LIMIT 80").all();
    if (!people.length) return;

    let statuses = db.prepare('SELECT id, label, counts_present FROM attendance_statuses WHERE active = 1 ORDER BY sort_order').all();
    if (!statuses.length) {
      statuses = [['Present (sample)', 'blue', 1], ['Sick (sample)', 'orange', 0], ['Absent (sample)', 'yellow', 0]]
        .map(([label, tone, present], i) => ({
          id: insert('attendance_statuses', { label, tone, counts_present: present, sort_order: 100 + i }, label),
          label, counts_present: present,
        }));
    }

    const listed = db.prepare('SELECT name, weekday FROM service_types WHERE active = 1 AND weekday IS NOT NULL ORDER BY sort_order').all();
    const services = listed.length ? listed : [{ name: 'Sunday AM Worship', weekday: 0 }, { name: 'Wednesday Bible Study', weekday: 3 }];

    const present = statuses.find(s => s.counts_present) || statuses[0];
    const others = statuses.filter(s => s.id !== present.id);
    const taken = db.prepare('SELECT 1 FROM member_attendance WHERE date = ? AND service = ? LIMIT 1');
    // Each person comes about as often as they usually do, so the analytics
    // show some regulars and some who have slipped away.
    const habit = new Map(people.map(p => [p.id, 0.45 + random.next() * 0.5]));

    for (let w = 0; w < 4 * scale; w++) {
      for (const service of services) {
        const d = random.date(w * 7);
        d.setDate(d.getDate() - ((d.getDay() - service.weekday + 7) % 7));
        const date = helpers.asIsoDate(d);
        if (taken.get(date, service.name)) continue;
        for (const p of people) {
          const status = random.chance(habit.get(p.id)) || !others.length ? present : random.pick(others);
          insert('member_attendance', {
            person_id: p.id, date, service: service.name, status_id: status.id, user_name: 'Sample data',
          }, `${service.name} ${date} — ${status.label}`);
        }
      }
    }
  },
};
