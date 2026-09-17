// What each man is willing to do in worship, the song of the week, and which
// songs were sung at a service.
module.exports = {
  id:    'worship-preferences',
  label: 'Worship Preferences',
  area:  'serving-schedule',
  page:  'My Profile · Serving Schedule',
  order: 95,
  describe: 'Willingness to serve per member, the song of the week, and songs sung at a service.',
  tables: ['worship_profile', 'worship_preferences', 'song_of_week', 'service_songs'],

  generate({ insert, random, scale, helpers, db }) {
    const men = db.prepare("SELECT id, name FROM directory WHERE gender = 'male' ORDER BY id DESC LIMIT 20").all();
    const roles = ['song-leader', 'prayer', 'lords-table', 'scripture', 'announcements', 'usher'];

    for (const member of men.slice(0, 5 * scale)) {
      insert('worship_profile', { directory_id: member.id, notes: 'Sample data' }, member.name);
      for (const role of random.some(roles, random.int(2, 4))) {
        insert('worship_preferences', {
          directory_id: member.id, role,
          level: random.pick(['willing', 'willing', 'preferred', 'not-willing']),
        }, `${member.name} — ${role}`);
      }
    }

    const songs = db.prepare('SELECT id, title FROM songs ORDER BY id DESC LIMIT 10').all();
    const services = db.prepare('SELECT id FROM song_services ORDER BY id DESC LIMIT 6').all();

    for (let w = 0; w < Math.min(4, scale + 2); w++) {
      if (!songs.length) break;
      const song = random.pick(songs);
      const monday = random.date(w * 7 + 3);
      monday.setDate(monday.getDate() - monday.getDay() + 1);
      insert('song_of_week', {
        song_id: song.id, week_start: helpers.asIsoDate(monday), notes: 'Sample data',
      }, song.title);
    }

    for (const service of services) {
      random.some(songs, Math.min(songs.length, random.int(2, 4)))
        .forEach((song, at) => insert('service_songs', {
          service_id: service.id, song_id: song.id, position: at,
        }, `${song.title} at a service`));
    }
  },
};
