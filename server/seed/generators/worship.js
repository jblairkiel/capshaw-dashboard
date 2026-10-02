// Sunday itself: the sermons preached, the songs sung, who led them, and the
// song of the week.
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
  page:  'Upcoming Service',
  order: 40,
  describe: 'Sermons with speakers and series, a song list, who led the singing each week, the songs sung at each service, the song of the week, next Sunday\'s service as a song leader submitted it, and a few song requests.',
  tables: ['sermons', 'songs', 'song_services', 'service_songs', 'song_of_week', 'worship_plans', 'worship_plan_items', 'song_requests'],

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
    const songs = random.some(SONG_TITLES, Math.min(SONG_TITLES.length, 6 + scale))
      .map(title => ({
        title,
        id: insert('songs', {
          title,
          hymnal: random.pick(HYMNALS),
          number: String(random.int(2, 990)),
        }, title),
      }));

    for (let w = 0; w < 6 * scale; w++) {
      const service = insert('song_services', {
        date:    helpers.asIsoDate(random.date(w * 7)),
        service: random.pick(['AM', 'PM', 'Wednesday']),
        leader:  speaker(),
      }, `Singing, ${w} week(s) ago`);

      // Three or four songs at each, in the order they were sung.
      random.some(songs, Math.min(songs.length, random.int(3, 4)))
        .forEach((song, at) => insert('service_songs', {
          service_id: service, song_id: song.id, position: at,
        }, `${song.title}, ${w} week(s) ago`));
    }

    // One song of the week per week, keyed on the Monday it starts — the column
    // is unique, so the weeks are stepped rather than picked at random.
    for (let w = 0; w < Math.min(6, 2 + scale); w++) {
      const monday = random.date(w * 7);
      monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
      const song = random.pick(songs);
      insert('song_of_week', {
        song_id:    song.id,
        week_start: helpers.asIsoDate(monday),
        notes:      MARK,
      }, `${song.title}, week of ${helpers.asIsoDate(monday)}`);
    }

    // Next Sunday's service, submitted and waiting for the organizer, laid out
    // in the usual order. If somebody has really submitted that one (or an
    // earlier batch did), the first Sunday after it that is free.
    const service = db.prepare("SELECT name FROM service_types WHERE name LIKE '%AM%Worship%' ORDER BY sort_order LIMIT 1").get()?.name
      || db.prepare('SELECT name FROM service_types WHERE active = 1 ORDER BY sort_order LIMIT 1').get()?.name
      || 'Sunday AM Worship';
    const sunday = random.date(0);
    sunday.setDate(sunday.getDate() + ((7 - sunday.getDay()) % 7 || 7));
    let date = helpers.asIsoDate(sunday);
    for (let tries = 0; tries < 104 && db.prepare('SELECT 1 FROM worship_plans WHERE date = ? AND service = ?').get(date, service); tries++) {
      sunday.setDate(sunday.getDate() + 7);
      date = helpers.asIsoDate(sunday);
    }
    const leader = speaker();
    const plan = insert('worship_plans', {
      date, service, leader, status: 'submitted', submitted_by_name: leader, notes: MARK,
    }, `${service}, ${date}`);
    const parts = db.prepare(`
      SELECT p.* FROM worship_outlines o JOIN worship_parts p ON p.id = o.part_id
       WHERE o.service_type_id IS NULL AND p.active = 1 ORDER BY o.position
    `).all();
    // A database with no service parts yet still gets a service to look at.
    if (!parts.length) {
      parts.push(
        { id: null, name: 'Song', takes_song: 1, takes_person: 0, detail_label: '' },
        { id: null, name: 'Opening prayer', takes_song: 0, takes_person: 1, detail_label: '' },
        { id: null, name: 'Song', takes_song: 1, takes_person: 0, detail_label: '' },
      );
    }
    parts.forEach((part, position) => insert('worship_plan_items', {
      plan_id: plan, position, part_id: part.id, part_name: part.name,
      song_id: part.takes_song ? random.pick(songs).id : null,
      person:  part.takes_person ? speaker() : '',
      detail:  part.detail_label === 'Title' ? random.pick(SERMON_TITLES) : part.detail_label ? 'Psalm 23' : '',
      note:    part.takes_song && position % 3 === 0 ? random.pick(['vv. 1, 2 and 4', 'Start it slow', 'Last verse twice']) : '',
    }, `${part.name}, ${date}`));

    // A few members asking for a song.
    const people = db.prepare('SELECT name FROM directory ORDER BY id DESC LIMIT 20').all().map(r => r.name);
    for (const song of random.some(songs, Math.min(3, songs.length))) {
      insert('song_requests', {
        song_id: song.id,
        requester_name: people.length ? random.pick(people) : 'Sample Member',
        note: random.pick(['For my mother\'s birthday', 'One of my favorites', '']),
      }, `Request for ${song.title}`);
    }
  },
};
