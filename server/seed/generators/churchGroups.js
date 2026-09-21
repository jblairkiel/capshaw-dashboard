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
  tables: [
    'church_groups', 'church_group_members', 'group_events',
    'group_event_signup_items', 'group_event_rsvps', 'group_event_signups',
    'event_comments',
  ],

  generate({ insert, random, scale, db, helpers }) {
    const people = db.prepare('SELECT id, name FROM directory ORDER BY id DESC LIMIT 60').all();
    // Everything below is attributed to directory people rather than to
    // accounts: an answer, a sign-up and a reply each belong to a person, and
    // accounts are never sample data. A fresh install with nobody in the
    // directory yet still gets its groups and meetings — there is simply
    // nobody to put on the rolls.
    if (!people.length) return;

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

      // ── What is needed, and who has taken it on ──────────────────────────
      // Deliberately left part-covered: a list with something still wanted on
      // it is what the page has to render well, and a full one never shows it.
      const items = random.some(BRING, random.int(3, 5)).map(label => ({
        label,
        needed: random.int(1, 2),
      }));

      const willBring = [...roll];
      for (const item of items) {
        const itemId = insert('group_event_signup_items', {
          event_id: eventId, label: item.label, notes: '', needed: item.needed, sort_order: 0,
        }, `${item.label} for ${title}`);

        // Never more than the list asks for, so what is left over is right.
        const takers = random.some(willBring, Math.min(willBring.length, random.int(0, item.needed)));
        for (const taker of takers) {
          insert('group_event_signups', {
            item_id: itemId,
            user_id: null,
            directory_id: taker.id,
            user_name: taker.name,
            detail: '',
            quantity: 1,
          }, `${taker.name} is bringing ${item.label}`);
        }
      }

      // ── Who is coming ────────────────────────────────────────────────────
      for (const member of random.some(roll, Math.min(roll.length, random.int(3, roll.length)))) {
        insert('group_event_rsvps', {
          event_id: eventId,
          user_id: null,
          directory_id: member.id,
          person_name: member.name,
          response: random.pick(['yes', 'yes', 'yes', 'maybe', 'no']),
          guests: random.chance(0.4) ? random.int(1, 3) : 0,
          note: '',
        }, `${member.name} answered ${title}`);

        // ── And what they have said about it ───────────────────────────────
        if (random.chance(0.5)) {
          insert('event_comments', {
            subject_type: 'group-event',
            subject_id: eventId,
            user_id: null,
            author_name: member.name,
            body: `${random.pick(REPLIES)} (${MARK})`,
          }, `reply on ${title}`);
        }
      }

      // The announcement board is the portal's other kind of event, and its
      // thread is the same table — so a batch fills both rather than leaving
      // half of the feature looking unused.
      const notice = db.prepare(
        "SELECT id, title FROM announcements WHERE trim(coalesce(event_date, '')) <> '' ORDER BY id DESC LIMIT 1"
      ).get();
      if (notice) {
        for (const member of random.some(roll, Math.min(roll.length, 2))) {
          insert('event_comments', {
            subject_type: 'announcement',
            subject_id: notice.id,
            user_id: null,
            author_name: member.name,
            body: `${random.pick(REPLIES)} (${MARK})`,
          }, `reply on ${notice.title}`);
        }
      }
    }
  },
};
