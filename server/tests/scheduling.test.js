const {
  parseMonth, datesFor, servicesIn, generateSchedule, asPreview, assignmentsFor,
} = require('../workflows/scheduling');

const PEOPLE = [
  { id: 1, name: 'Ray Harris' },
  { id: 2, name: 'Sam Nolan' },
  { id: 3, name: 'Tom Reed' },
  { id: 4, name: 'Bill Shaw' },
];

function prefs(...entries) {
  return entries.map(([directory_id, role, level]) => ({ directory_id, role, level }));
}

// June 2026 has Sundays on the 7th, 14th, 21st and 28th.
const JUNE = 'June 2026';

function songLeaders(result) {
  return result.rows.filter(r => r.job === 'Song Leader').map(r => r.name);
}

// ─── Reading the month ────────────────────────────────────────────────────────

describe('parseMonth', () => {
  test('accepts a month and year in any casing', () => {
    expect(parseMonth('June 2026')).toMatchObject({ monthIndex: 5, year: 2026, label: 'June 2026' });
    expect(parseMonth('  june 2026 ')).toMatchObject({ label: 'June 2026' });
  });

  test('rejects anything else', () => {
    for (const bad of ['Junuary 2026', '2026', 'June', '', null, '6/2026']) {
      expect(parseMonth(bad)).toBeNull();
    }
  });
});

describe('datesFor', () => {
  test('finds every Sunday in the month', () => {
    const sundays = datesFor(parseMonth(JUNE), 0).map(d => d.getUTCDate());
    expect(sundays).toEqual([7, 14, 21, 28]);
  });

  test('finds every Wednesday in the month', () => {
    expect(datesFor(parseMonth(JUNE), 3).map(d => d.getUTCDate())).toEqual([3, 10, 17, 24]);
  });

  test('handles a month starting on the chosen weekday', () => {
    // 1 February 2026 is a Sunday.
    expect(datesFor(parseMonth('February 2026'), 0).map(d => d.getUTCDate())).toEqual([1, 8, 15, 22]);
  });

  test('handles a leap February without spilling into March', () => {
    const days = datesFor(parseMonth('February 2028'), 2).map(d => d.getUTCDate());
    expect(Math.max(...days)).toBeLessThanOrEqual(29);
  });
});

describe('servicesIn', () => {
  test('puts the services in the order they happen', () => {
    const occasions = servicesIn(parseMonth(JUNE), ['Sunday Worship', 'Wednesday']);
    expect(occasions.slice(0, 3).map(o => `${o.dateLabel} ${o.service}`))
      .toEqual(['June 3 Wednesday', 'June 7 Sunday Worship', 'June 10 Wednesday']);
  });

  test('only includes the services asked for', () => {
    const occasions = servicesIn(parseMonth(JUNE), ['Sunday Worship']);
    expect([...new Set(occasions.map(o => o.service))]).toEqual(['Sunday Worship']);
  });
});

// ─── The rules ────────────────────────────────────────────────────────────────

describe('generateSchedule', () => {
  test('refuses a month it cannot read, rather than producing nonsense', () => {
    expect(generateSchedule({ month: 'Smarch 2026', people: PEOPLE }).error).toMatch(/not a month/);
  });

  test('rule 1: never schedules somebody who said they are unavailable', () => {
    const result = generateSchedule({
      month: JUNE,
      people: PEOPLE,
      preferences: prefs([1, 'Song Leader', 'unavailable'], [2, 'Song Leader', 'willing']),
      services: ['Sunday Worship'],
    });
    expect(songLeaders(result)).not.toContain('Ray Harris');
    expect([...new Set(songLeaders(result))]).toEqual(['Sam Nolan']);
  });

  test('rule 2: never schedules the same person twice in one service', () => {
    // One person willing to do several jobs: they can still only take one a service.
    const result = generateSchedule({
      month: JUNE,
      people: [PEOPLE[0]],
      preferences: prefs(
        [1, 'Song Leader', 'willing'],
        [1, 'Opening Prayer', 'willing'],
        [1, 'Closing Prayer', 'willing'],
      ),
      services: ['Sunday Worship'],
    });

    for (const date of ['June 7', 'June 14', 'June 21', 'June 28']) {
      const namesThatDay = result.rows.filter(r => r.date === date && r.name).map(r => r.name);
      expect(namesThatDay).toEqual([...new Set(namesThatDay)]);
      expect(namesThatDay).toHaveLength(1);
    }
  });

  test('rule 3: spreads the load rather than giving one keen person every turn', () => {
    const result = generateSchedule({
      month: JUNE,
      people: PEOPLE,
      preferences: prefs([1, 'Song Leader', 'preferred'], [2, 'Song Leader', 'willing']),
      services: ['Sunday Worship'],
    });

    // Four Sundays, two candidates: two turns each, alternating.
    expect(songLeaders(result)).toEqual(['Ray Harris', 'Sam Nolan', 'Ray Harris', 'Sam Nolan']);
  });

  test('rule 4: on equal turns, the keen volunteer goes first', () => {
    const result = generateSchedule({
      month: JUNE,
      people: PEOPLE,
      // Sam sorts first by name, but Ray is the keen one.
      preferences: prefs([1, 'Song Leader', 'preferred'], [2, 'Song Leader', 'willing']),
      services: ['Sunday Worship'],
    });
    expect(songLeaders(result)[0]).toBe('Ray Harris');
  });

  test('rule 5: an otherwise dead heat is broken by name, so it is stable', () => {
    const result = generateSchedule({
      month: JUNE,
      people: PEOPLE,
      preferences: prefs([1, 'Song Leader', 'willing'], [2, 'Song Leader', 'willing']),
      services: ['Sunday Worship'],
    });
    expect(songLeaders(result)[0]).toBe('Ray Harris');   // sorts before Sam Nolan
  });

  test('load stays even across a bigger pool', () => {
    const preferences = PEOPLE.flatMap(p => prefs([p.id, 'Song Leader', 'willing']));
    const result = generateSchedule({ month: JUNE, people: PEOPLE, preferences, services: ['Sunday Worship'] });

    const counts = result.load.filter(l => l.turns > 0).map(l => l.turns);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  test('reports a role nobody can cover instead of leaving it quietly blank', () => {
    const result = generateSchedule({
      month: JUNE,
      people: PEOPLE,
      preferences: prefs([1, 'Song Leader', 'willing']),
      services: ['Sunday Worship'],
    });

    expect(result.unfilled.length).toBeGreaterThan(0);
    expect(result.unfilled.every(u => u.role !== 'Song Leader')).toBe(true);
    // The row still exists, with an empty name, so the shape of the month is clear.
    const blank = result.rows.find(r => r.job === 'Usher');
    expect(blank).toMatchObject({ name: '' });
  });

  test('is deterministic', () => {
    const args = {
      month: JUNE, people: PEOPLE, services: ['Sunday Worship'],
      preferences: prefs([1, 'Song Leader', 'willing'], [2, 'Song Leader', 'preferred']),
    };
    expect(generateSchedule(args)).toEqual(generateSchedule(args));
  });

  test('a different attempt gives a different draft, still evenly loaded', () => {
    const args = {
      month: JUNE, people: PEOPLE, services: ['Sunday Worship'],
      preferences: PEOPLE.flatMap(p => prefs([p.id, 'Song Leader', 'willing'])),
    };
    const first  = generateSchedule({ ...args, attempt: 0 });
    const second = generateSchedule({ ...args, attempt: 1 });

    expect(songLeaders(second)).not.toEqual(songLeaders(first));
    const counts = second.load.filter(l => l.turns > 0).map(l => l.turns);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  test('ignores a preference belonging to somebody no longer in the directory', () => {
    const result = generateSchedule({
      month: JUNE,
      people: PEOPLE,
      preferences: prefs([999, 'Song Leader', 'preferred'], [1, 'Song Leader', 'willing']),
      services: ['Sunday Worship'],
    });
    expect([...new Set(songLeaders(result))]).toEqual(['Ray Harris']);
  });

  test('with no preferences at all, nothing is invented', () => {
    const result = generateSchedule({ month: JUNE, people: PEOPLE, preferences: [], services: ['Sunday Worship'] });
    expect(result.rows.every(r => r.name === '')).toBe(true);
    expect(result.unfilled).toHaveLength(result.rows.length);
  });

  test('covers every service asked for, and only those', () => {
    const result = generateSchedule({
      month: JUNE, people: PEOPLE, services: ['Sunday Worship', 'Wednesday'],
      preferences: prefs([1, 'Song Leader', 'willing']),
    });
    expect([...new Set(result.rows.map(r => r.service))].sort()).toEqual(['Sunday Worship', 'Wednesday']);
  });
});

// ─── Presentation helpers ─────────────────────────────────────────────────────

describe('asPreview', () => {
  test('turns the draft into a table, naming empty slots plainly', () => {
    const draft = generateSchedule({
      month: JUNE, people: PEOPLE, services: ['Sunday Worship'],
      preferences: prefs([1, 'Song Leader', 'willing']),
    });
    const preview = asPreview(draft);

    expect(preview.columns).toEqual(['Date', 'Service', 'Job', 'Name']);
    expect(preview.rows[0]).toEqual(['June 7', 'Sunday Worship', 'Song Leader', 'Ray Harris']);
    expect(preview.rows.some(r => r[3] === '— nobody available —')).toBe(true);
  });

  test('copes with no draft at all', () => {
    expect(asPreview(null).rows).toEqual([]);
  });
});

describe('assignmentsFor', () => {
  test('picks out one person\'s turns, ignoring case and spacing', () => {
    const draft = generateSchedule({
      month: JUNE, people: PEOPLE, services: ['Sunday Worship'],
      preferences: prefs([1, 'Song Leader', 'willing']),
    });

    expect(assignmentsFor(draft, '  ray harris ')).toHaveLength(4);
    expect(assignmentsFor(draft, 'Nobody At All')).toEqual([]);
  });
});
