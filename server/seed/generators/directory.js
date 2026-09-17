// The member directory: households of people, with the anniversaries that hang
// off them. Runs first, because everything that names a member — the serving
// schedule, who invited a guest, who leads the singing — picks from what this
// leaves behind.
const { household, person, MARK } = require('../people');

module.exports = {
  id:    'directory',
  label: 'Member Directory',
  area:  'directory',
  page:  'Church Directory',
  order: 10,
  describe: 'Households with addresses, phone numbers and email, plus their anniversaries.',
  tables: ['directory', 'anniversaries'],

  generate({ insert, random, scale, helpers }) {
    const households = 4 * scale;
    const months = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];

    for (let h = 0; h < households; h++) {
      const home  = household(random);
      const size  = random.int(1, 4);
      const names = [];

      for (let m = 0; m < size; m++) {
        const who = person(random, home);
        names.push(who.name);
        insert('directory', {
          name:    who.name,
          address: who.address, city: who.city, state: who.state, zip: who.zip,
          phone:   who.phone,
          cell:    random.chance(0.6) ? who.phone : '',
          email:   who.email,
          gender:  m === 0 ? 'male' : who.gender,
          notes:   MARK,
        }, who.name);
      }

      // A couple gets an anniversary; everybody gets a birthday.
      if (size >= 2 && random.chance(0.7)) {
        const monthNum = random.int(1, 12);
        const day      = random.int(1, 28);
        insert('anniversaries', {
          month: months[monthNum - 1],
          date:  `${monthNum}/${day}`,
          names: `${names[0]} & ${names[1]}`,
          month_num: monthNum,
          day,
        }, `${names[0]} & ${names[1]}`);
      }
    }
  },
};
