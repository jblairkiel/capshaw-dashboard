const {
  stripTags,
  parseAttendance,
  parseSermons,
  parseJobAssignments,
  parseAnniversaries,
  parseVisitors,
  parseDeacons,
  parseBulletins,
} = require('../lib/parsers');

// ─── stripTags ────────────────────────────────────────────────────────────────

describe('stripTags', () => {
  test('removes HTML tags', () => {
    expect(stripTags('<b>Hello</b>')).toBe('Hello');
  });
  test('decodes common entities', () => {
    expect(stripTags('a &amp; b')).toBe('a & b');
    expect(stripTags('hello&nbsp;world')).toBe('hello world');
  });
  test('collapses whitespace', () => {
    expect(stripTags('  foo   bar  ')).toBe('foo bar');
  });
});

// ─── parseAttendance ─────────────────────────────────────────────────────────

describe('parseAttendance', () => {
  const html = `
    <table>
      <tr><td>Date</td><td>Service</td><td>Count</td></tr>
      <tr><td>04/13/25</td><td>AM</td><td>142</td></tr>
      <tr><td>04/06/25</td><td>AM</td><td>138</td></tr>
    </table>`;

  test('parses rows with date/service/count', () => {
    const result = parseAttendance(html);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ date: '04/13/25', service: 'AM', count: 142 });
  });

  test('skips header row', () => {
    const result = parseAttendance(html);
    expect(result.every(r => r.date !== 'Date')).toBe(true);
  });

  test('sorts descending by date', () => {
    const result = parseAttendance(html);
    expect(result[0].date).toBe('04/13/25');
    expect(result[1].date).toBe('04/06/25');
  });

  test('returns empty array for empty html', () => {
    expect(parseAttendance('<html></html>')).toEqual([]);
  });
});

// ─── parseSermons ─────────────────────────────────────────────────────────────

describe('parseSermons', () => {
  const html = `
    <table>
      <tr><td>Date</td><td>Title</td><td>Speaker</td><td>Type</td></tr>
      <tr><td>04/13/25</td><td>The Good Shepherd</td><td>John Smith</td><td>AM</td><td>Gospel Series</td><td>Sunday AM</td></tr>
    </table>`;

  test('parses sermon row', () => {
    const result = parseSermons(html);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      date: '04/13/25',
      title: 'The Good Shepherd',
      speaker: 'John Smith',
      type: 'AM',
      series: 'Gospel Series',
    });
  });

  test('skips header row', () => {
    const result = parseSermons(html);
    expect(result.every(r => r.date !== 'Date')).toBe(true);
  });
});

// ─── parseJobAssignments ──────────────────────────────────────────────────────

describe('parseJobAssignments', () => {
  const html = `
    <p>April 2025</p>
    <table>
      <tr><td>April 6</td><td>Service</td><td>Job</td><td>Name</td></tr>
      <tr><td>AM</td><td>Greeter</td><td>Jane Doe</td></tr>
      <tr><td>April 13</td><td>Service</td><td>Job</td><td>Name</td></tr>
      <tr><td>AM</td><td>Visuals</td><td>Bob Smith</td></tr>
    </table>`;

  test('extracts month', () => {
    const result = parseJobAssignments(html);
    expect(result.month).toBe('April 2025');
  });

  test('assigns correct date to rows', () => {
    const result = parseJobAssignments(html);
    expect(result.assignments[0]).toMatchObject({ date: 'April 6', service: 'AM', job: 'Greeter', name: 'Jane Doe' });
    expect(result.assignments[1]).toMatchObject({ date: 'April 13', job: 'Visuals', name: 'Bob Smith' });
  });

  test('returns empty assignments for html with no table', () => {
    expect(parseJobAssignments('<html></html>').assignments).toEqual([]);
  });
});

// ─── parseAnniversaries ───────────────────────────────────────────────────────

describe('parseAnniversaries', () => {
  const html = `
    <table>
      <tr><td>January</td></tr>
      <tr><td>1/15</td><td>John &amp; Jane Smith</td></tr>
      <tr><td>February</td></tr>
      <tr><td>2/14</td><td>Bob &amp; Alice Jones</td></tr>
    </table>`;

  test('parses entries under correct month', () => {
    const result = parseAnniversaries(html);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ month: 'January', date: '1/15', monthNum: 1, day: 15 });
    expect(result[1]).toMatchObject({ month: 'February', date: '2/14', monthNum: 2, day: 14 });
  });

  test('decodes names', () => {
    const result = parseAnniversaries(html);
    expect(result[0].names).toBe('John & Jane Smith');
  });

  test('returns empty for html with no table', () => {
    expect(parseAnniversaries('<html></html>')).toEqual([]);
  });
});

// ─── parseDeacons ─────────────────────────────────────────────────────────────

describe('parseDeacons', () => {
  const html = `
    <div>Our Deacons</div>
    <strong>James Wilson</strong>
    <ul>
      <li>Oversees benevolence fund</li>
      <li>Coordinates communion preparation</li>
    </ul>
    <strong>Their Duties</strong>
    <ul><li>This should be skipped</li></ul>`;

  test('parses deacon with duties', () => {
    const result = parseDeacons(html);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('James Wilson');
    expect(result[0].duties).toHaveLength(2);
  });

  test('skips entries in the SKIP set', () => {
    const result = parseDeacons(html);
    expect(result.every(d => d.name !== 'Their Duties')).toBe(true);
  });
});

// ─── parseBulletins ───────────────────────────────────────────────────────────

describe('parseBulletins', () => {
  const html = `
    <div>Capshaw Bulletin
      <a href="/files/bulletin-2025-04-13.pdf">April 13, 2025</a>
      <a href="/files/bulletin-2025-04-06.pdf">April 6, 2025</a>
    </div>
    <h2>Member News</h2>`;

  test('extracts PDF links and labels', () => {
    const result = parseBulletins(html);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ url: '/files/bulletin-2025-04-13.pdf', label: 'April 13, 2025' });
  });

  test('returns empty for html with no bulletin section', () => {
    expect(parseBulletins('<html><h2>Member News</h2></html>')).toEqual([]);
  });
});

// ─── parseVisitors ────────────────────────────────────────────────────────────
//
// The tracker gives each guest a heading, then splits what it knows about them
// under headings of its own. Pairing a heading with the table after it named
// every guest "Visit History" — the heading nearest their dates — so these
// pin the shapes down.

describe('parseVisitors', () => {
  const SECTIONED = `
    <h2>Visitor Tracker</h2>
    <h3>Pat Lane</h3>
      <h4>Comments</h4>
      <table><tr><th>Comment</th></tr><tr><td>Neighbour of the Carters</td></tr></table>
      <h4>Visit History</h4>
      <table>
        <tr><th>Date</th><th>Service</th></tr>
        <tr><td>04/13/25</td><td>Sun AM</td></tr>
        <tr><td>03/30/25</td><td>Sun PM</td></tr>
      </table>
    <h3>Sam Ford</h3>
      <h4>Comments</h4>
      <table><tr><th>Comment</th></tr><tr><td>Asked about the Wednesday class</td></tr></table>
      <h4>Visit History</h4>
      <table><tr><th>Date</th><th>Service</th></tr><tr><td>04/06/25</td><td>Sun AM</td></tr></table>
  `;

  test('names each guest after themselves, not after the section holding their dates', () => {
    const guests = parseVisitors(SECTIONED);
    expect(guests.map(g => g.name)).toEqual(['Pat Lane', 'Sam Ford']);
  });

  test('keeps every visit under the guest it belongs to', () => {
    const [pat, sam] = parseVisitors(SECTIONED);
    expect(pat.visits).toEqual([
      { date: '04/13/25', service: 'Sun AM' },
      { date: '03/30/25', service: 'Sun PM' },
    ]);
    expect(sam.visits).toEqual([{ date: '04/06/25', service: 'Sun AM' }]);
  });

  test('keeps what the tracker says about them rather than dropping it', () => {
    const [pat, sam] = parseVisitors(SECTIONED);
    expect(pat.comments).toBe('Neighbour of the Carters');
    expect(sam.comments).toBe('Asked about the Wednesday class');
  });

  test('a section heading never becomes a guest of its own', () => {
    const names = parseVisitors(SECTIONED).map(g => g.name);
    for (const label of ['Comments', 'Visit History', 'Visitor Tracker']) {
      expect(names).not.toContain(label);
    }
  });

  test('reads the simpler shape too: a name, then the dates', () => {
    const guests = parseVisitors(`
      <h2>Visitor Tracker</h2>
      <h3>Jo Reed</h3>
      <table><tr><th>Date</th><th>Service</th></tr><tr><td>05/04/25</td><td>Sun AM</td></tr></table>
    `);
    expect(guests).toEqual([
      { name: 'Jo Reed', comments: '', visits: [{ date: '05/04/25', service: 'Sun AM' }] },
    ]);
  });

  test('reads comments written as paragraphs rather than as a table', () => {
    const [guest] = parseVisitors(`
      <h3>Ray Nolan</h3>
      <h4>Comments</h4><p>Moving to Harvest in June.</p><p>Would like a study.</p>
      <h4>Visit History</h4><table><tr><td>06/01/25</td><td>Sun AM</td></tr></table>
    `);
    expect(guest.name).toBe('Ray Nolan');
    expect(guest.comments).toBe('Moving to Harvest in June.\nWould like a study.');
  });

  test('falls back to a single table of everybody, merging a guest\'s rows', () => {
    const guests = parseVisitors(`
      <h2>Visitor Tracker</h2>
      <table>
        <tr><th>Name</th><th>Date</th><th>Service</th><th>Comments</th></tr>
        <tr><td>Dana Webb</td><td>05/11/25</td><td>Sun AM</td><td>Came with the Carters</td></tr>
        <tr><td>Dana Webb</td><td>05/18/25</td><td>Sun PM</td><td></td></tr>
        <tr><td>Lee Park</td><td>05/18/25</td><td>Sun PM</td><td></td></tr>
      </table>
    `);
    expect(guests).toHaveLength(2);
    expect(guests[0]).toEqual({
      name: 'Dana Webb',
      comments: 'Came with the Carters',
      visits: [
        { date: '05/11/25', service: 'Sun AM' },
        { date: '05/18/25', service: 'Sun PM' },
      ],
    });
  });

  test('a heading with nothing under it is not a guest', () => {
    expect(parseVisitors('<h2>Visitor Tracker</h2><h3>Section Header</h3>')).toEqual([]);
  });

  test('a page with no guests on it parses to nothing rather than throwing', () => {
    expect(parseVisitors('<h2>Visitor Tracker</h2><p>No visitors recorded.</p>')).toEqual([]);
    expect(parseVisitors('')).toEqual([]);
  });

  test('a four-digit year is still a visit', () => {
    const [guest] = parseVisitors(`
      <h3>Ann Poole</h3>
      <table><tr><th>Date</th><th>Service</th></tr><tr><td>6/1/2025</td><td>Sun AM</td></tr></table>
    `);
    expect(guest.visits).toEqual([{ date: '6/1/2025', service: 'Sun AM' }]);
  });
});
