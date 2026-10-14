// Two rotations — the ladies' class teachers and the baby shower hosts — each
// a line of people from the directory, with a few turns already taken and one
// still to come, and a coordinator from among them.
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const SAMPLES = [
  { name: 'Ladies\' class teachers', description: 'Teaching the Wednesday evening ladies\' class, a quarter at a time.', size: 7, every: 91 },
  { name: 'Baby shower hosts', description: 'Hosting the next baby shower in the fellowship hall.', size: 9, every: 60 },
];

module.exports = {
  id:    'rotations',
  label: 'Rotations',
  area:  'rotations',
  page:  'Rotations',
  order: 47,
  describe: 'Two rotations (class teachers and baby shower hosts) of people from the directory, with turns already taken and one coming up.',
  tables: ['rotations', 'rotation_members', 'rotation_coordinators', 'rotation_turns'],

  generate({ insert, random, db }) {
    const women = db.prepare("SELECT id, name FROM directory WHERE trim(name) <> '' AND gender = 'female' ORDER BY id DESC LIMIT 40").all();
    const people = women.length >= 6 ? women : db.prepare("SELECT id, name FROM directory WHERE trim(name) <> '' ORDER BY id DESC LIMIT 40").all();
    if (people.length < 3) return;

    for (const sample of SAMPLES) {
      const rotationId = insert('rotations', { name: sample.name, description: sample.description }, sample.name);
      const line = random.some(people, Math.min(sample.size, people.length));
      line.forEach((p, i) => insert('rotation_members', { rotation_id: rotationId, directory_id: p.id, position: i + 1 }, `${p.name} in ${sample.name}`));
      insert('rotation_coordinators', { rotation_id: rotationId, directory_id: line[0].id }, `${line[0].name} coordinates ${sample.name}`);

      // The last few turns, oldest first, from people now at the back of the
      // line — and the one booked next, from the front, sent to the back.
      const taken = line.slice(-3);
      taken.forEach((p, i) => {
        const date = iso(random.date(sample.every * (taken.length - i)));
        insert('rotation_turns', { rotation_id: rotationId, directory_id: p.id, name: p.name, date, note: '' }, `${p.name}'s turn, ${date}`);
      });
      const booked = line[0];
      const date = iso(random.date(-random.int(10, 40)));
      insert('rotation_turns', { rotation_id: rotationId, directory_id: booked.id, name: booked.name, date, note: '' }, `${booked.name}'s turn, ${date}`);
      db.prepare('UPDATE rotation_members SET position = ? WHERE rotation_id = ? AND directory_id = ?').run(line.length + 1, rotationId, booked.id);
    }
  },
};
