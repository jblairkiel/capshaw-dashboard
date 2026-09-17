// Guests, their visits, and what the tracker had to say about them — including
// the shapes the Guests page has to cope with: somebody who came once and was
// never reached, somebody who keeps coming back, somebody with no details at
// all beyond a name.
const { person, MARK } = require('../people');

const COMMENTS = [
  'Just moved to the area and looking for a home congregation',
  'Came with a neighbour',
  'Visiting family for the weekend',
  'Found us through the website',
  'Back for a second time — asked about the Wednesday class',
];

module.exports = {
  id:    'visitors',
  label: 'Guests',
  area:  'visitors',
  page:  'Guests',
  order: 20,
  describe: 'Guests with visit histories, contact details and the tracker\'s comments.',
  tables: ['visitors', 'visitor_visits'],

  generate({ insert, random, scale, helpers, db }) {
    const services = db.prepare("SELECT name FROM service_types WHERE active = 1 ORDER BY sort_order").all()
      .map(r => r.name);
    const pickService = () => (services.length ? random.pick(services) : 'Sunday AM Worship');

    const inviters = db.prepare('SELECT name FROM directory ORDER BY id DESC LIMIT 40').all().map(r => r.name);

    for (let i = 0; i < 5 * scale; i++) {
      const who = person(random);
      // One guest in four is only a name, which is what the tracker gives us
      // when somebody signs the book and nothing else.
      const sparse = random.chance(0.25);

      const id = insert('visitors', {
        name:       who.name,
        phone:      sparse ? '' : who.phone,
        email:      sparse ? '' : who.email,
        address:    sparse ? '' : who.address,
        city:       sparse ? '' : who.city,
        state:      sparse ? '' : who.state,
        zip:        sparse ? '' : who.zip,
        invited_by: inviters.length && random.chance(0.4) ? random.pick(inviters) : '',
        status:     '',
        notes:      MARK,
        comments:   random.chance(0.5) ? random.pick(COMMENTS) : '',
        created_at: new Date().toISOString(),
      }, who.name);

      // Most came once; some keep coming, which is what the page is for.
      const visits = random.chance(0.4) ? random.int(2, 9) : 1;
      let daysAgo  = random.int(1, 40);
      for (let v = 0; v < visits; v++) {
        insert('visitor_visits', {
          visitor_id: id,
          date:       helpers.asShortDate(random.date(daysAgo)),
          service:    pickService(),
        }, `${who.name} — a visit`);
        daysAgo += random.int(7, 60);
      }
    }
  },
};
