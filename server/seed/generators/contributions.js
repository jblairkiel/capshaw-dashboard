// Contributions, one total per week across the past year or so — the same
// shape as attendance.js, not a per-giver ledger, so the analytics view has
// something to draw a trend from.
module.exports = {
  id:    'contributions',
  label: 'Contributions',
  area:  'contributions',
  page:  'Contributions',
  order: 31,
  describe: 'A weekly contribution total across the past year.',
  tables: ['contributions'],

  generate({ insert, random, scale, helpers }) {
    const weeks = 52 * scale;
    // A base that wanders slowly rather than jumping every week, with a lift
    // around the winter holidays the way giving actually behaves.
    let base = 4200;
    for (let w = 0; w < weeks; w++) {
      base = Math.max(1500, base + random.int(-150, 150));
      const date  = helpers.asIsoDate(random.date(w * 7));
      const month = Number(date.slice(5, 7));
      const boost = (month === 12 || month === 1) ? 1.25 : 1;
      insert('contributions', {
        date,
        amount: Math.round(base * boost * 100) / 100,
      }, `week of ${date}`);
    }
  },
};
