// Church groups with people on their rolls, a meeting each, and the answers,
// sign-ups and replies a meeting collects — so the page can be looked at with
// something in it rather than as an empty shell.
//
// The groups are made up: real groups belong to whoever looks after them, and
// a sample batch must never take one away when it is removed. Their
// distribution lists are deliberately not created here, because a list is a
// thing mail actually goes to; sample membership stays on the roll.
const { MARK } = require('../people');

const GROUPS = [
  ['North Harvest (sample)', 'Second Sunday evening', 'The Ashdown home'],
  ['Wall Triana (sample)',   'Last Friday of the month', 'The Hartlin home'],
  ['Young Families (sample)', 'Sunday afternoons, fortnightly', 'Fellowship Hall'],
];

const MEETINGS = [
  ['Fellowship meal and singing', 'Come and eat, then we will sing for an hour.'],
  ['Devotional at the Ashdowns', 'A short lesson, and time to pray for one another.'],
  ['Games night for the children', 'Bring the whole family. Nothing formal.'],
];

const BRING = ['Main dish', 'Salad or vegetable', 'Dessert', 'Drinks', 'Paper plates and cups'];

const REPLIES = [
  'We will be there — looking forward to it.',
  'Sorry to miss this one, we are away that weekend.',
  'Can we bring anything else?',
  'What time should we arrive to help set up?',
];

module.exports = {
  id:    'church-groups',
  label: 'Church Groups',
  area:  'church-groups',
  page:  'Church Groups',
  order: 95,
  describe: 'Sample church groups with rolls, a meeting each, RSVPs, a sign-up list and replies.',
  // Only what this can always write. Answers, sign-ups and replies each belong
  // to an account, and accounts are never sample data — they are added below
  // for accounts that already exist, and a fresh install simply has none.
  // server/seed/index.js says so where the coverage test reads it.
  tables: ['church_groups', 'church_group_members', 'group_events', 'group_event_signup_items'],

  generate({ insert, random, scale, db, helpers }) {
    const people = db.prepare('SELECT id, name FROM directory ORDER BY id DESC LIMIT 60').all();
    // Accounts are never sample data, so an RSVP or a reply can only be
    // attributed to somebody who really signed in. With nobody signed in yet,
    // the groups and their meetings are still made — they are simply quiet.
    const accounts = db.prepare("SELECT id, name FROM users WHERE role <> 'pending' LIMIT 12").all();

    for (const [name, meets, location] of GROUPS.slice(0, Math.min(GROUPS.length, 1 + scale))) {
      const key = `sample-group-${random.int(1000, 9999)}`;
      const groupId = insert('church_groups', {
        key,
        name,
        description: `A sample church group (${MARK})`,
        meets,
        location,
        email: '',
        active: 1,
        sort_order: 200,
      }, name);

      // A group with no leader is a group nobody can post a meeting for, so
      // the first person on the roll always gets it.
      const roll = random.some(people, Math.min(people.length, random.int(4, 9)));
      roll.forEach((member, index) => {
        insert('church_group_members', {
          group_id: groupId,
          directory_id: member.id,
          role: index === 0 ? 'leader' : index === 1 ? 'co-leader' : index === 2 ? 'host' : 'member',
        }, `${member.name} in ${name}`);
      });

      const [title, description] = random.pick(MEETINGS);
      const when = new Date();
      when.setDate(when.getDate() + random.int(4, 40));

      const eventId = insert('group_events', {
        group_id: groupId,
        title,
        description: `${description} (${MARK})`,
        event_date: helpers.asIsoDate(when),
        event_time: random.pick(['17:00', '18:00', '18:30']),
        end_time: '',
        location,
        host_name: roll[0]?.name || '',
        rsvp_enabled: 1,
        rsvp_deadline: '',
        capacity: 0,
        signup_enabled: 1,
        signup_title: 'What to bring',
        status: 'published',
        created_at: new Date().toISOString(),
        published_at: new Date().toISOString(),
      }, `${title} — ${name}`);

      const items = random.some(BRING, random.int(3, 5)).map(label => ({
        label,
        id: insert('group_event_signup_items', {
          event_id: eventId, label, notes: '', needed: random.int(1, 3), sort_order: 0,
        }, `${label} for ${title}`),
      }));

      for (const account of random.some(accounts, Math.min(accounts.length, random.int(2, 6)))) {
        insert('group_event_rsvps', {
          event_id: eventId,
          user_id: account.id,
          person_name: account.name,
          response: random.pick(['yes', 'yes', 'yes', 'maybe', 'no']),
          guests: random.chance(0.4) ? random.int(1, 3) : 0,
          note: '',
        }, `${account.name} answered ${title}`);

        if (items.length && random.chance(0.6)) {
          const item = random.pick(items);
          insert('group_event_signups', {
            item_id: item.id,
            user_id: account.id,
            user_name: account.name,
            detail: '',
            quantity: 1,
          }, `${account.name} is bringing ${item.label}`);
        }

        if (random.chance(0.5)) {
          insert('event_comments', {
            subject_type: 'group-event',
            subject_id: eventId,
            user_id: account.id,
            author_name: account.name,
            body: `${random.pick(REPLIES)} (${MARK})`,
          }, `reply on ${title}`);
        }
      }
    }
  },
};
