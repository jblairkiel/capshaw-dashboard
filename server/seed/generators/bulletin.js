// A few weeks of the weekly newsletter — the half of it that is typed rather
// than queried, which is what bulletin_issues holds. Everything else the
// newsletter prints is read live from the pages that own it, so the other
// generators (announcements, attendance, leadership, serving) are what fill
// the rest of the page out.
//
// One issue per week going back from this Sunday. The dates have to be real
// Sundays and distinct, because bulletin_issues.sunday is unique — hence
// reusing the newsletter's own week arithmetic rather than a second copy of it.
const { MARK } = require('../people');
const { sundayOf, addDays } = require('../../lib/bulletinData');

const ONGOING = [
  'Jeannie and Robyn Thornton',
  'Dean Coffield',
  'Luke Smith, still a long road ahead in the NICU',
  'Ruby Rundt',
  'Melvin Workman',
  'Virginia Darmer',
];

const SHUT_INS = [
  'Sharrin Baird, Mark Denton, Roberta Latimer',
  'James & Nancy Terry, Jeannie Thornton',
];

const PREGNANCIES = [
  'Hailey Westbrook – June (boy)',
  'Catie Stinson – October (boy)',
  'Amanda Woodlee – October (girl)',
];

const EVANGELISTS = [
  'Samuel Lopez – Ocosingo, Mexico',
  'Luis Mota – Chiapas, Mexico',
  'Ossafa Gordon – St. George, Grenada',
  'Joshuah Mutahi Wambugu – Nyeri, Kenya',
  'Wes Webb – High Springs, Florida',
];

const UPDATES = [
  'Elise Mowrer is home from hospital and improving',
  'The Hartlins are back from their trip and send their thanks',
  'Brother Alder is recovering well after surgery',
];

const VERSES = [
  ['Let us not become weary in doing good, for at the proper time we will reap a harvest if we do not give up.', 'Gal. 6:9'],
  ['Bear one another’s burdens, and so fulfil the law of Christ.', 'Gal. 6:2'],
  ['Let us consider how to stir up one another to love and good works.', 'Heb. 10:24'],
];

const LEADERS = ['Hunter Reece', 'Brett Westbrook', 'Barton Barrett', 'Blair Kiel', 'Adam Mowrer', 'Hayden Phillips'];

module.exports = {
  id:    'bulletin',
  label: 'Weekly Newsletter',
  area:  'bulletin',
  page:  'Weekly Newsletter',
  order: 75,
  describe: 'A few weeks of prayer lists, giving figures and group leaders for the newsletter.',
  tables: ['bulletin_issues'],

  generate({ insert, random, scale, helpers }) {
    const thisSunday = sundayOf(helpers.asIsoDate(new Date()));

    // Three weeks per unit of scale, this Sunday backwards, so the page opens
    // on an issue and has earlier ones to carry forward from.
    for (let week = 0; week < scale * 3; week++) {
      const sunday = addDays(thisSunday, -7 * week);
      const [quote, ref] = random.pick(VERSES);

      const groupNotes = {};
      LEADERS.forEach((leader, i) => {
        groupNotes[`group-${i + 1}`] = {
          leader,
          // Most weeks a group has nothing coming up.
          note: random.chance(0.2) ? `Meeting at the ${random.pick(['Reece', 'Hartlin', 'Mowrer'])} home` : '',
        };
      });

      insert('bulletin_issues', {
        sunday,
        quote,
        quote_ref: ref,
        updates:     random.some(UPDATES, random.int(1, 2)).join('\n'),
        ongoing:     random.some(ONGOING, random.int(3, ONGOING.length)).join('\n'),
        shut_ins:    SHUT_INS.join('\n'),
        pregnancies: PREGNANCIES.join('\n'),
        evangelists: EVANGELISTS.join('\n'),
        offering:    `$${random.int(5, 9)},${String(random.int(0, 999)).padStart(3, '0')}`,
        building:    `$${random.int(80, 95)},${String(random.int(0, 999)).padStart(3, '0')} (${random.int(30, 45)}%)`,
        group_notes: JSON.stringify(groupNotes),
        // The mark goes where it will be seen if a batch is ever left behind:
        // the newsletter prints this line under Updates.
        created_at:  new Date().toISOString(),
        updated_at:  new Date().toISOString(),
      }, `${MARK}: newsletter for ${sunday}`);
    }
  },
};
