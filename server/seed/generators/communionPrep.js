// The communion preparation sign-up list: this year's, with about half of the
// months still to come taken by people from the directory.
module.exports = {
  id:    'communion-prep',
  label: 'Communion Preparation',
  area:  'communion-prep',
  page:  'Communion Preparation',
  order: 46,
  describe: 'This year\'s communion preparation list, with some of the months ahead signed up for by people in the directory.',
  tables: ['communion_prep_years', 'communion_prep_signups'],

  generate({ insert, random, db }) {
    const year = new Date().getFullYear();
    // A list already started (a real one, say) is used rather than doubled.
    if (!db.prepare('SELECT 1 FROM communion_prep_years WHERE year = ?').get(year)) {
      insert('communion_prep_years', { year, created_by_name: 'Sample data' }, `${year} list`);
    }
    const people = db.prepare("SELECT id, name FROM directory WHERE trim(name) <> '' ORDER BY id DESC LIMIT 40").all();
    if (!people.length) return;
    const taken = new Set(db.prepare('SELECT month FROM communion_prep_signups WHERE year = ?').all(year).map(r => r.month));
    for (let month = 1; month <= 12; month++) {
      if (taken.has(month) || !random.chance(0.55)) continue;
      const who = random.pick(people);
      insert('communion_prep_signups', { year, month, name: who.name, directory_id: who.id }, `${who.name}, ${month}/${year}`);
    }
  },
};
