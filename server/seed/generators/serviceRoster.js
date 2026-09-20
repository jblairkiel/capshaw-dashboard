// What each man of the congregation will volunteer for: the Service Roster
// page, and the same rows My Household & Preferences writes.
//
// The vocabulary is read from server/lib/people.js rather than repeated here,
// because sample data that says "song-leader" where the site says "Song Leader"
// looks like data and shows up nowhere — the page renders the roles it knows.
//
// Deliberately not everybody: a roster where some men have said nothing yet is
// what the page is for, so the last few are left quiet.
const { WORSHIP_ROLES } = require('../../lib/people');
const { MARK } = require('../people');

const NOTES = [
  'Travels for work most other weeks',
  'Happy to lead singing, still learning the table',
  'Would rather not be up front two Sundays running',
  'Glad to fill in at short notice — call the cell',
  'Away the last Sunday of the month',
];

module.exports = {
  id:    'service-roster',
  label: 'Service Roster',
  area:  'serving-schedule',
  page:  'Church Office · Service Roster',
  // Before the serving schedule, which reads these when deciding who has been
  // signed off for what.
  order: 45,
  describe: 'What each man will volunteer for, role by role, with a scheduling note — and a few who have not said yet.',
  tables: ['worship_profile', 'worship_preferences'],

  generate({ insert, random, scale, db }) {
    const men = db.prepare("SELECT id, name FROM directory WHERE gender = 'male' ORDER BY id DESC LIMIT 40").all();
    if (!men.length) return;

    // Enough to fill the page at any scale, and never the whole directory —
    // the last couple are left with nothing on file on purpose.
    const speaking = men.slice(0, Math.max(1, Math.min(men.length - 2, 4 * scale)));

    for (const member of speaking) {
      insert('worship_profile', {
        directory_id: member.id,
        notes: random.chance(0.5) ? `${random.pick(NOTES)} (${MARK})` : MARK,
      }, member.name);

      for (const role of random.some(WORSHIP_ROLES, random.int(3, 6))) {
        insert('worship_preferences', {
          directory_id: member.id,
          role,
          // Weighted towards yes: a congregation that says no to everything is
          // not what a schedule keeper is looking at.
          level: random.pick(['preferred', 'preferred', 'willing', 'willing', 'unavailable']),
        }, `${member.name} — ${role}`);
      }
    }
  },
};
