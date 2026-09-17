// Saved lesson plans, in the shape the planner writes them.
module.exports = {
  id:    'lesson-plans',
  label: 'Lesson Planner',
  area:  'bible-class',
  page:  'Lesson Planner',
  order: 85,
  describe: 'Saved lesson plans with their focuses and outline.',
  tables: ['lesson_plans'],

  generate({ insert, random, scale }) {
    const lessons = [
      ['The Good Samaritan', 'Luke 10:25-37', '3rd-4th'],
      ['Daniel and the Lions', 'Daniel 6', '1st-2nd'],
      ['Paul at Athens', 'Acts 17:16-34', '7th-8th'],
    ];

    for (let i = 0; i < scale; i++) {
      for (const [title, passage, grade] of lessons) {
        insert('lesson_plans', {
          title, passage, grade,
          duration: random.pick([30, 40, 45]),
          focuses:  JSON.stringify(random.some(['memory work', 'discussion', 'craft', 'application'], 2)),
          plan_json: JSON.stringify({
            opening: 'Settle the class and read the passage together.',
            middle:  [{ heading: 'What happened', minutes: 10 }, { heading: 'What it means for us', minutes: 15 }],
            closing: 'Memory verse and prayer.',
            sample:  true,
          }),
        }, title);
      }
    }
  },
};
