// Elders and deacons, each with what they look after, plus the bulletins the
// dashboard links to.
const { person, MARK } = require('../people');

const ELDER_DUTIES  = ['Benevolence', 'Education', 'Worship', 'Missions', 'Membership care', 'Finance'];
const DEACON_DUTIES = ['Grounds', 'Building', 'Sound & media', 'Transport', 'Hospitality', 'Youth', 'Library'];

module.exports = {
  id:    'leadership',
  label: 'Elders & Deacons',
  area:  'leadership',
  page:  'Elders & Deacons',
  order: 70,
  describe: 'Elders and deacons with the duties each of them looks after, and a few bulletins.',
  tables: ['elders', 'elder_duties', 'deacons', 'deacon_duties', 'bulletins'],

  generate({ insert, random, scale, helpers }) {
    for (let i = 0; i < 3 * scale; i++) {
      const who = person(random);
      const id  = insert('elders', {
        name: who.name, phone: who.phone, email: who.email, notes: MARK,
      }, who.name);
      random.some(ELDER_DUTIES, random.int(1, 3))
        .forEach((duty, at) => insert('elder_duties', { elder_id: id, duty, position: at }, `${who.name} — ${duty}`));
    }

    for (let i = 0; i < 4 * scale; i++) {
      const who = person(random);
      const id  = insert('deacons', { name: who.name }, who.name);
      random.some(DEACON_DUTIES, random.int(1, 3))
        .forEach((duty, at) => insert('deacon_duties', { deacon_id: id, duty, position: at }, `${who.name} — ${duty}`));
    }

    for (let w = 0; w < 4; w++) {
      const when = random.date(w * 7);
      insert('bulletins', {
        url:   `/media/bulletins/sample-${helpers.asIsoDate(when)}.pdf`,
        label: `${when.toLocaleString('en-US', { month: 'long' })} ${when.getDate()} Bulletin`,
      }, `Bulletin, ${w} week(s) ago`);
    }
  },
};
