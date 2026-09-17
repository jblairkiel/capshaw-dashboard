// Sunday itself: the sermons preached, the songs sung, and who led them.
const { MARK } = require('../people');

const SERMON_TITLES = [
  'Faith That Works', 'The Weight of Mercy', 'A House Not Made With Hands',
  'What Love Requires', 'The Long Obedience', 'Seed and Soil',
  'Counting the Cost', 'Rest for the Weary', 'The Narrow Gate',
];
const SERIES = ['James', 'The Sermon on the Mount', 'Letters to the Seven', 'Psalms of Ascent', ''];
const HYMNALS = ['Songs of Faith and Praise', 'Praise for the Lord', 'Hymns for Worship'];
const SONG_TITLES = [
  'Come Thou Fount', 'Be With Me Lord', 'How Great Thou Art', 'Night With Ebon Pinion',
  'Our God He Is Alive', 'Sing to Me of Heaven', 'Just As I Am', 'Blest Be the Tie',
  'There Is a Habitation', 'Hallelujah Praise Jehovah', 'The Greatest Commands',
];

module.exports = {
  id:    'worship',
  label: 'Sermons & Songs',
  area:  'songs',
  page:  'Songs We Sing · This Sunday',
  order: 40,
  describe: 'Sermons with speakers and series, a song list, and who led the singing each week.',
  tables: ['sermons', 'songs', 'song_services'],

  generate({ insert, random, scale, helpers, db }) {
    const men = db.prepare("SELECT name FROM directory WHERE gender = 'male' ORDER BY id DESC LIMIT 30")
      .all().map(r => r.name);
    const speaker = () => (men.length ? random.pick(men) : 'Sample Speaker');

    for (let w = 0; w < 6 * scale; w++) {
      const date = helpers.asShortDate(random.date(w * 7));
      const title = random.pick(SERMON_TITLES);
      insert('sermons', {
        date,
        title,
        speaker: speaker(),
        type:    random.pick(['Expository', 'Topical', 'Textual']),
        series:  random.pick(SERIES),
        service: random.pick(['AM', 'PM']),
      }, title);
    }

    // The song list, then which of them were sung and who led.
    const songs = random.some(SONG_TITLES, Math.min(SONG_TITLES.length, 6 + scale));
    for (const title of songs) {
      insert('songs', {
        title,
        hymnal: random.pick(HYMNALS),
        number: String(random.int(2, 990)),
      }, title);
    }

    for (let w = 0; w < 6 * scale; w++) {
      insert('song_services', {
        date:    helpers.asIsoDate(random.date(w * 7)),
        service: random.pick(['AM', 'PM', 'Wednesday']),
        leader:  speaker(),
      }, `Singing, ${w} week(s) ago`);
    }
  },
};
