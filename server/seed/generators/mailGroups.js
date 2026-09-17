// Distribution groups with people in them. The groups an admin set up already
// are left alone — only sample ones are made, so removing the batch cannot
// empty a real list.
const { person } = require('../people');

module.exports = {
  id:    'mail-groups',
  label: 'Email Groups',
  area:  'mail',
  page:  'Email Groups',
  order: 90,
  describe: 'Sample distribution groups with members drawn from the directory.',
  tables: ['mail_groups', 'mail_group_members'],

  generate({ insert, random, scale, db }) {
    const people = db.prepare('SELECT id, name, email FROM directory ORDER BY id DESC LIMIT 40').all();

    const groups = [
      ['sample-greeters', 'Greeters (sample)', 'Whoever is on the door this month'],
      ['sample-teachers', 'Class Teachers (sample)', 'Everybody teaching a class this quarter'],
    ];

    for (const [key, name, description] of groups.slice(0, 1 + scale)) {
      const id = insert('mail_groups', {
        key: `${key}-${random.int(1000, 9999)}`, name, description, sort_order: 100,
      }, name);

      for (const member of random.some(people, Math.min(people.length, random.int(2, 5)))) {
        insert('mail_group_members', {
          group_id: id, directory_id: member.id, email: member.email || '',
        }, `${member.name} in ${name}`);
      }
    }
  },
};
