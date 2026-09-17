// Announcements and events, including one of each kind the page tells apart:
// a plain notice, a dated event, and one that has been retired.
const { MARK } = require('../people');

const NOTICES = [
  ['Gospel meeting next month', 'Brother Alder Ashdown will be with us for four evenings. Invite a neighbour.'],
  ['Ladies\' Bible class resumes', 'Thursday mornings at ten, in the fellowship room.'],
  ['Building work on the north wing', 'The north entrance will be closed for two weeks. Please use the main doors.'],
  ['Directory photographs', 'We are updating the directory. See the table in the foyer to book a slot.'],
];
const EVENTS = [
  ['Fellowship meal', 'Bring a dish to share. Everybody is welcome.', 'Fellowship Hall'],
  ['Singing night', 'An evening of songs and devotional thoughts.', 'Auditorium'],
  ['Youth devotional', 'For everybody in school, with food afterwards.', 'The Hartlin home'],
];

module.exports = {
  id:    'announcements',
  label: 'Announcements & Events',
  area:  'announcements',
  page:  'Announcements',
  order: 60,
  describe: 'Notices and dated events, one of them already retired.',
  tables: ['announcements'],

  generate({ insert, random, scale, helpers }) {
    for (let i = 0; i < scale; i++) {
      for (const [title, body] of NOTICES) {
        insert('announcements', {
          type: 'announcement', title, body: `${body} (${MARK})`,
          event_date: '', event_time: '', location: '',
          priority: random.pick(['normal', 'normal', 'high']),
          // One in five is retired, so the page has something inactive in it.
          active: random.chance(0.8) ? 1 : 0,
          created_at: new Date().toISOString(),
        }, title);
      }

      for (const [title, body, location] of EVENTS) {
        const when = new Date();
        when.setDate(when.getDate() + random.int(3, 60));
        insert('announcements', {
          type: 'event', title, body: `${body} (${MARK})`,
          event_date: helpers.asIsoDate(when),
          event_time: random.pick(['09:00', '17:00', '18:30', '19:00']),
          location,
          priority: 'normal',
          active: 1,
          created_at: new Date().toISOString(),
        }, title);
      }
    }
  },
};
