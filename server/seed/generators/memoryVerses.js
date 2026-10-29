// Memory Verses: two sets a member might have made, and two classes with
// students from the directory (and one typed-in name) and a few weeks of
// recitations scored. The built-in sets are not sample data — every site
// starts with them (schema.js) — and nobody's own practice is made up.
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const MEMBER_SETS = [
  {
    title: 'Verses for VBS Week', category: 'Christian Living', difficulty: 'beginner', audience: 'children',
    description: 'One short verse for each night of Vacation Bible School.', tags: ['vbs', 'short'],
    verses: [
      ['Psalm 56:3', 'When I am afraid, I will put my trust in You.'],
      ['1 Thessalonians 5:17', 'pray without ceasing;'],
      ['Psalm 136:1', 'Give thanks to the LORD, for He is good, For His lovingkindness is everlasting.'],
      ['John 14:15', 'If you love Me, you will keep My commandments.'],
    ],
  },
  {
    title: 'Men\'s Class: Joshua', category: 'Old Testament', difficulty: 'intermediate', audience: 'adults',
    description: 'The verses from our quarter in Joshua.', tags: ['joshua', 'quarter study'],
    verses: [
      ['Joshua 1:8', 'This book of the law shall not depart from your mouth, but you shall meditate on it day and night, so that you may be careful to do according to all that is written in it; for then you will make your way prosperous, and then you will have success.'],
      ['Joshua 21:45', 'Not one of the good promises which the LORD had made to the house of Israel failed; all came to pass.'],
      ['Joshua 23:14b', 'not one word of all the good words which the LORD your God spoke concerning you has failed; all have been fulfilled for you, not one of them has failed.'],
    ],
  },
];

const CLASSES = [
  { name: 'Wednesday 3rd–5th Grade', description: 'Wednesday night children\'s class', size: 7, set: 'first-verses', typed: 'Ava (visitor)' },
  { name: 'Sunday Teen Class', description: 'Sunday morning, grades 7–12', size: 6, set: 'way-of-salvation' },
];

module.exports = {
  id:    'memory-verses',
  label: 'Memory Verses',
  page:  'Bible Class · Memory Verses',
  order: 62,
  describe: 'Two member-made verse sets, and two classes of directory people (and a visitor) with a few weeks of recitations scored.',
  // Who teaches a class is an account, so it is not claimed (seed/index.js
  // NOT_FILLED): the classes go to the site's first admin when there is one.
  tables: ['memory_sets', 'memory_verses', 'memory_classes', 'memory_class_students', 'memory_scores'],

  generate({ insert, random, db }) {
    const people = db.prepare("SELECT id, name FROM directory WHERE trim(name) <> '' ORDER BY id DESC LIMIT 60").all();
    // A class is seen only by its teachers, who are accounts: the site's first
    // admin — most likely whoever is making the sample data — teaches these.
    // With no account to give them to, they are made untaught.
    const teacher = db.prepare("SELECT id, name FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get()
      || db.prepare("SELECT id, name FROM users WHERE role <> 'pending' ORDER BY id LIMIT 1").get();

    const made = [];
    for (const sample of MEMBER_SETS) {
      const by = people.length ? random.pick(people).name : 'A member';
      const setId = insert('memory_sets', {
        title: sample.title, description: sample.description, category: sample.category, difficulty: sample.difficulty,
        audience: sample.audience, translation: 'NASB 1995', tags: JSON.stringify(sample.tags), created_by_name: by,
      }, sample.title);
      made.push(setId);
      sample.verses.forEach(([reference, text], i) => insert('memory_verses', { set_id: setId, position: i, reference, text }, `${reference} in ${sample.title}`));
    }

    if (people.length < 3) return;
    for (const sample of CLASSES) {
      const classId = insert('memory_classes', { name: sample.name, description: sample.description, created_by: teacher?.id ?? null, created_by_name: teacher?.name || '' }, sample.name);
      if (teacher) insert('memory_class_teachers', { class_id: classId, user_id: teacher.id }, `${teacher.name} teaches ${sample.name}`);
      const students = random.some(people, Math.min(sample.size, people.length))
        .map(p => ({ id: insert('memory_class_students', { class_id: classId, directory_id: p.id, name: p.name }, `${p.name} in ${sample.name}`), name: p.name }));
      if (sample.typed) students.push({ id: insert('memory_class_students', { class_id: classId, directory_id: null, name: sample.typed }, `${sample.typed} in ${sample.name}`), name: sample.typed });

      // The built-in set the class is learning, or — if it has gone — one of
      // the sets just made.
      const set = db.prepare('SELECT id FROM memory_sets WHERE slug = ?').get(sample.set) || { id: made[0] };
      const verses = db.prepare('SELECT id, reference FROM memory_verses WHERE set_id = ? ORDER BY position').all(set.id);
      // A verse a week, the last few weeks; most students recite most weeks.
      verses.slice(0, 4).forEach((verse, week) => {
        const day = iso(random.date(7 * (4 - week)));
        for (const s of students) {
          if (!random.chance(0.8)) continue;
          const stars = random.pick([3, 3, 3, 2, 2, 1]);
          insert('memory_scores', {
            class_id: classId, student_id: s.id, set_id: set.id, verse_id: verse.id, reference: verse.reference,
            stars, note: '', scored_on: day, scored_by: teacher?.id ?? null, scored_by_name: teacher?.name || '',
          }, `${s.name} ${stars}★ on ${verse.reference}`);
        }
      });
    }
  },
};
