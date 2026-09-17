// Made-up people, and the words to build the rest out of.
//
// The surnames are deliberately not ones this congregation uses, so a sample
// row reads as a stranger at a glance even before the batch it belongs to is
// looked up. Nothing here should ever be mistaken for somebody real.

const FIRST_NAMES = [
  'Alder', 'Bramwell', 'Calloway', 'Delphine', 'Ember', 'Fennimore', 'Gwendolyn',
  'Hollis', 'Isolde', 'Jarrah', 'Kestrel', 'Linden', 'Marlowe', 'Nyssa',
  'Orrin', 'Peregrine', 'Quill', 'Rosalind', 'Sable', 'Tamsin', 'Ulric',
  'Verity', 'Wren', 'Yarrow', 'Zephyr', 'Bellamy', 'Corwin', 'Dovey',
];

const SURNAMES = [
  'Ashdown', 'Blackmoor', 'Cindermere', 'Dunhollow', 'Evermont', 'Farrowdale',
  'Glassbrook', 'Hartlin', 'Ironwood', 'Junipero', 'Kettleby', 'Larkspur',
  'Mossgrove', 'Northwilde', 'Oakhaven', 'Pinecroft', 'Quarrington', 'Ravensby',
  'Stonewick', 'Thornbury', 'Umberfield', 'Vexley', 'Westmarch', 'Yarborough',
];

const STREETS = [
  'Wisteria Lane', 'Copper Kettle Road', 'Marchmont Drive', 'Hollow Creek Way',
  'Pennyroyal Street', 'Foxglove Court', 'Amberline Road', 'Saltmarsh Drive',
];

const TOWNS = [
  ['Harvest', 'AL', '35749'], ['Madison', 'AL', '35757'], ['Athens', 'AL', '35611'],
  ['Huntsville', 'AL', '35801'], ['Toney', 'AL', '35773'], ['Ardmore', 'AL', '35739'],
];

// Held apart so a generator can build a whole household that hangs together —
// the same surname, the same address — rather than a list of unrelated rows.
function household(random) {
  const surname = random.pick(SURNAMES);
  const [city, state, zip] = random.pick(TOWNS);
  return {
    surname,
    address: `${random.int(100, 9899)} ${random.pick(STREETS)}`,
    city, state, zip,
  };
}

function person(random, home = null) {
  const at    = home || household(random);
  const first = random.pick(FIRST_NAMES);
  return {
    name:   `${first} ${at.surname}`,
    first,
    surname: at.surname,
    address: at.address,
    city: at.city, state: at.state, zip: at.zip,
    phone: `(256) 555-${String(random.int(100, 999)).padStart(3, '0')}${random.int(0, 9)}`,
    email: `${first.toLowerCase()}.${at.surname.toLowerCase()}@example.invalid`,
    gender: random.chance(0.5) ? 'male' : 'female',
  };
}

// Every sample row that has somewhere to say so says so, so the site reads
// honestly even before anybody opens the panel that lists the batch.
const MARK = 'Sample data';

module.exports = { FIRST_NAMES, SURNAMES, STREETS, TOWNS, household, person, MARK };
