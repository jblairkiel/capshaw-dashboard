// A few sign-up lists: a fellowship meal on one date with set dishes and free
// sign-ups, and a week-long meal train with one cook a night — some of each
// taken by people from the directory.
module.exports = {
  id:    'signups',
  label: 'Sign-Ups',
  area:  'signups',
  page:  'Sign-Ups',
  order: 65,
  describe: 'A fellowship meal (one date, several dishes and free sign-ups) and a meal train (one cook each night for a week), partly signed up for by people in the directory.',
  tables: ['signup_lists', 'signup_dates', 'signup_items', 'signup_entries'],

  generate({ insert, random, helpers, db }) {
    const people = db.prepare("SELECT id, name FROM directory WHERE trim(name) <> '' ORDER BY id DESC LIMIT 40").all();
    const ahead = days => helpers.asIsoDate(random.date(-days));

    // One date, several things needed.
    const meal = insert('signup_lists', {
      title: 'Fellowship meal', description: 'After morning worship in the fellowship hall. Bring enough to share.',
      kind: 'one-date', allow_free: 1, free_label: 'Something else to share', created_by_name: 'Sample data',
    }, 'Fellowship meal');
    const mealDate = insert('signup_dates', { list_id: meal, date: ahead(18), time: '12:00', note: '', position: 0 }, 'Fellowship meal date');
    const dishes = [['Main dish', 6], ['Side dish', 6], ['Dessert', 4], ['Drinks', 2], ['Set-up help', 3]]
      .map(([label, needed], i) => ({ id: insert('signup_items', { list_id: meal, label, needed, position: i }, label), needed }));

    // Several dates, one thing each.
    const train = insert('signup_lists', {
      title: 'Meal train', description: 'A hot meal each evening for a family welcoming a new baby. Drop off by 6 PM.',
      kind: 'multi-date', allow_free: 0, free_label: '', created_by_name: 'Sample data',
    }, 'Meal train');
    const cook = insert('signup_items', { list_id: train, label: 'Bring dinner', needed: 1, position: 0 }, 'Bring dinner');
    const nights = Array.from({ length: 7 }, (_, i) => insert('signup_dates', { list_id: train, date: ahead(5 + i), time: '18:00', note: '', position: i }, `Night ${i + 1}`));

    if (!people.length) return;
    for (const dish of dishes) {
      random.some(people, Math.min(people.length, random.int(0, dish.needed))).forEach(p =>
        insert('signup_entries', { list_id: meal, date_id: mealDate, item_id: dish.id, name: p.name, directory_id: p.id }, `${p.name} — fellowship meal`));
    }
    insert('signup_entries', { list_id: meal, date_id: mealDate, item_id: null, name: random.pick(people).name, note: 'Paper plates and napkins' }, 'Free sign-up');
    nights.forEach(night => {
      if (!random.chance(0.6)) return;
      const p = random.pick(people);
      insert('signup_entries', { list_id: train, date_id: night, item_id: cook, name: p.name, directory_id: p.id }, `${p.name} — meal train`);
    });
  },
};
