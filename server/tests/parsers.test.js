const {
  stripTags,
  parseAttendance,
  parseSermons,
  parseJobAssignments,
  parseAnniversaries,
  parseVisitors,
  parseDeacons,
  parseBulletins,
  widestSpanQuery, pagerLinks, mergeVisitors,
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

// ─── parseVisitors — when the name is not in a heading ────────────────────────
//
// The live tracker turned out to keep only its own section labels in headings:
// "Comments" and "Visit History". The guest's name is in something else, which
// is why keying on headings found seven tables of visits and nobody to attach
// them to. These pin the fallback that reads the name from whatever sits
// closest above the table, whichever element that is.

describe('parseVisitors — the name above the table', () => {
  const VISITS = `
    <table>
      <tr><th>Date</th><th>Service</th></tr>
      <tr><td>09/13/26</td><td>Sun AM</td></tr>
      <tr><td>09/06/26</td><td>Sun AM</td></tr>
    </table>`;

  function namesAndVisits(html) {
    return parseVisitors(html).map(g => [g.name, g.visits.length]);
  }

  test('a name in a paragraph, with the tracker\'s own headings above the tables', () => {
    const guests = parseVisitors(`
      <h2>Visitor Tracker</h2>
      <p class="visitor-name">Pat Lane</p>
        <h4>Comments</h4><table><tr><td>Came with the Carters</td></tr></table>
        <h4>Visit History</h4>${VISITS}
      <p class="visitor-name">Sam Ford</p>
        <h4>Visit History</h4>${VISITS}
    `);

    expect(guests.map(g => g.name)).toEqual(['Pat Lane', 'Sam Ford']);
    expect(guests[0].visits).toHaveLength(2);
    expect(guests[0].comments).toBe('Came with the Carters');
  });

  test('a comment is never mistaken for the next guest\'s name', () => {
    // The text inside a table is that table's contents, whatever it says.
    const guests = parseVisitors(`
      <p>Pat Lane</p>
      <h4>Comments</h4><table><tr><td>Spoke to Ray Harris about a study</td></tr></table>
      <h4>Visit History</h4>${VISITS}
    `);

    expect(guests).toHaveLength(1);
    expect(guests[0].name).toBe('Pat Lane');
    expect(guests[0].visits).toHaveLength(2);
  });

  test('a name in a card title, a bold line, a link or a caption all read the same', () => {
    expect(namesAndVisits(`
      <div class="card"><div class="card-title">Pat Lane</div><h5>Visit History</h5>${VISITS}</div>
      <div class="card"><div class="card-title">Sam Ford</div><h5>Visit History</h5>${VISITS}</div>
    `)).toEqual([['Pat Lane', 2], ['Sam Ford', 2]]);

    expect(namesAndVisits(`<strong>Pat Lane</strong><h4>Visit History</h4>${VISITS}`))
      .toEqual([['Pat Lane', 2]]);

    expect(namesAndVisits(`<a href="/members/visitor/12">Pat Lane</a>${VISITS}`))
      .toEqual([['Pat Lane', 2]]);

    expect(namesAndVisits(`<caption>Pat Lane</caption>${VISITS}`))
      .toEqual([['Pat Lane', 2]]);
  });

  test('the page\'s own furniture is not a guest', () => {
    const guests = parseVisitors(`
      <h2>Visitor Tracker</h2>
      <a href="/">Home</a><a href="/members">Members</a><span>«</span><span>12</span>
      <p>Pat Lane</p>
      <h4>Visit History</h4>${VISITS}
    `);

    expect(guests.map(g => g.name)).toEqual(['Pat Lane']);
  });

  test('several tables under one name land on one guest', () => {
    const guests = parseVisitors(`
      <p>Pat Lane</p>
      <h4>Visit History</h4>${VISITS}
      <h4>Visit History</h4><table><tr><th>Date</th><th>Service</th></tr><tr><td>08/30/26</td><td>Sun PM</td></tr></table>
    `);

    expect(guests).toHaveLength(1);
    expect(guests[0].visits).toHaveLength(3);
  });

  test('a comment between the name and the dates is not the guest\'s name', () => {
    // What the live tracker does, and what naming a guest after the nearest
    // text above their table gets wrong: the nearest text is their comment.
    const guests = parseVisitors(`
      <h2>Visitor Tracker</h2>
      <p class="visitor-name">Pat Lane</p>
        <h4>Comments</h4><p>Just moved from Foley, AL</p>
        <h4>Visit History</h4>${VISITS}
      <p class="visitor-name">Sam Ford</p>
        <h4>Comments</h4><p>Invited by the Carters</p>
        <h4>Visit History</h4>${VISITS}
    `);

    expect(guests.map(g => g.name)).toEqual(['Pat Lane', 'Sam Ford']);
    expect(guests[0].comments).toBe('Just moved from Foley, AL');
    expect(guests[0].visits).toHaveLength(2);
    expect(guests[1].comments).toBe('Invited by the Carters');
  });

  test('a section label is recognised in whatever element it is written in', () => {
    // The labels are only headings on some of the tracker's pages, so keying
    // on <h*> would put us back to naming the guest after their comment.
    const guests = parseVisitors(`
      <div class="card-title">Pat Lane</div>
      <div class="section">Comments</div><div>Just moved from Foley, AL</div>
      <div class="section">Visit History</div>${VISITS}
    `);

    expect(guests.map(g => g.name)).toEqual(['Pat Lane']);
    expect(guests[0].comments).toBe('Just moved from Foley, AL');
  });

  test('every line of a multi-paragraph comment is kept, and none of them is a name', () => {
    const guests = parseVisitors(`
      <p>Pat Lane</p>
      <h4>Comments</h4><p>Just moved from Foley, AL</p><p>Looking for a home congregation</p>
      <h4>Visit History</h4>${VISITS}
    `);

    expect(guests).toHaveLength(1);
    expect(guests[0].comments).toBe('Just moved from Foley, AL\nLooking for a home congregation');
  });

  // ─── The live tracker's own card, rebuilt from the debug report ────────────
  // Everything here is the shape the site actually serves: a header holding
  // the name and a "Last on …" summary, a body of uncaptioned values beside
  // icons, the comment at the bottom, then the dates. Three separate misreads
  // came out of this one card, so it is worth having verbatim.
  describe('the card the tracker actually serves', () => {
    const chevron = '<span class="vt-chev"><svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg></span>';

    function card({ name, last = '09/13/26', phone, address, comment }) {
      const addressRow = address
        ? `<div class="dir-row"><span class="dir-i"><svg><path d="M21 10c0 7-9 13-9 13"/></svg></span>` +
          `<span class="dir-v"><a href="https://maps.google.com/?q=${encodeURIComponent(address.join(','))}" ` +
          `target="_blank" rel="noopener">${address[0]}<br>${address[1]}<br>${address[2]}</a></span></div>`
        : '';
      const phoneRow = phone
        ? `<div class="dir-row"><span class="dir-i"><svg><path d="M22 16.92v3a2 2 0 0 1-2.18 2z"/></svg></span><span class="dir-v">${phone}</span></div>`
        : '';
      const commentCol = comment
        ? `<div class="vt-col"> <h4 class="vt-sub">Comments</h4> <p class="dir-note">${comment}</p> </div>`
        : '';
      return `
        <div class="vt-card">
          <button class="vt-head" type="button">
            <span class="vt-name">${name}</span>
            <span class="vt-meta">Last on ${last}</span>
            ${chevron}
          </button>
          <div class="vt-body">
            <div class="vt-cols"><div class="vt-col"> ${addressRow} ${phoneRow} </div>${commentCol}</div>
            <h4 class="vt-sub">Visit History</h4>${VISITS}
          </div>
        </div>`;
    }

    const trackerPage = cards => `<html><body>
      <nav><a href="/">Home</a><a href="/members">Members</a></nav>
      <h2>Visitor Tracker</h2>${cards.map(card).join('')}</body></html>`;

    test('the guest is named, not their summary line', () => {
      // "Last on 09/13/26" sits between the name and everything else in the
      // card, so taking either the first or the last line above the dates gets
      // it. A line carrying a digit is never somebody's name.
      const guests = parseVisitors(trackerPage([
        { name: 'Dana Whitfield' }, { name: 'Sam Ford' },
      ]));

      expect(guests.map(g => g.name)).toEqual(['Dana Whitfield', 'Sam Ford']);
      expect(guests[0].visits).toHaveLength(2);
    });

    test('the address, phone and comment on the card are read too', () => {
      const [guest] = parseVisitors(trackerPage([{
        name:    'Ray Ann Boyd',
        phone:   '(662) 312-9064',
        address: ['6617 Camilla Drive', 'Madison', 'AL 35757'],
        comment: 'Just moved from Foley, AL',
      }]));

      expect(guest).toMatchObject({
        name:    'Ray Ann Boyd',
        phone:   '(662) 312-9064',
        address: '6617 Camilla Drive',
        city:    'Madison',
        state:   'AL',
        zip:     '35757',
        comments: 'Just moved from Foley, AL',
      });
    });

    test('a card holds only its own details', () => {
      const guests = parseVisitors(trackerPage([
        { name: 'Dana Whitfield', address: ['12 Oak St', 'Athens', 'AL 35611'] },
        { name: 'Sam Ford' },
        { name: 'Marcus Reed', phone: '(256) 777-4009' },
      ]));

      expect(guests.map(g => [g.name, g.city || '', g.phone || ''])).toEqual([
        ['Dana Whitfield', 'Athens', ''],
        ['Sam Ford',       '',       ''],
        ['Marcus Reed',    '',       '(256) 777-4009'],
      ]);
    });

    test('the svg path data inside the icons is not mistaken for a phone number', () => {
      const [guest] = parseVisitors(trackerPage([{ name: 'Sam Ford' }]));
      expect(guest.phone).toBeUndefined();
    });
  });

  test("the site's own menu is not a guest", () => {
    // "About Us" reads exactly like a person — two capitalised words — so it
    // is ruled out twice: by where it sits, and by what it says. Either alone
    // would leave the other shape listed as a guest.
    const inChrome = parseVisitors(`
      <nav><a href="/about">About Us</a><a href="/contact">Contact Us</a></nav>
      <span>Pat Lane</span><h4>Visit History</h4>${VISITS}
      <footer><a href="/about">About Us</a></footer>
    `);
    expect(inChrome.map(g => g.name)).toEqual(['Pat Lane']);

    const looseInThePage = parseVisitors(`
      <div class="menu"><a href="/about">About Us</a><a href="/staff">Our Staff</a></div>
      <span>Pat Lane</span><h4>Visit History</h4>${VISITS}
    `);
    expect(looseInThePage.map(g => g.name)).toEqual(['Pat Lane']);
  });

  test("a section of the site is not a guest, however much it reads like one", () => {
    // "Our Elders" and "Visitor Notes" are two capitalised words, the same
    // shape as "Pat Lane", and each was listed as a guest with somebody else's
    // visits under it. A title is ruled out by how it is built — nobody is
    // called "Our" anything, and no surname is "Notes" — rather than by
    // listing the ones this site happens to have.
    const guests = parseVisitors(`
      <div class="site-menu">
        <a href="/about-us">About Us</a>
        <a href="/our-elders">Our Elders</a>
        <a href="/visitor-notes">Visitor Notes</a>
        <a href="/our-church-family">Our Church Family</a>
      </div>
      <span class="vt-name">Ray Ann Boyd</span><span class="vt-meta">Last on 09/13/26</span>
      <h4 class="vt-sub">Visit History</h4>${VISITS}
    `);

    expect(guests.map(g => g.name)).toEqual(['Ray Ann Boyd']);
  });

  test("a link is a weaker candidate than the name written in the card", () => {
    // The menu sits above the first guest's card, so the two compete in the
    // same run. Even where a menu item is not a title at all, a guest's name
    // is written in their card rather than as a link off to another page.
    const guests = parseVisitors(`
      <div class="site-menu"><a href="/giving">Support Capshaw</a><a href="/staff">Ministry Team</a></div>
      <span class="vt-name">Ray Ann Boyd</span>
      <h4 class="vt-sub">Visit History</h4>${VISITS}
    `);

    expect(guests.map(g => g.name)).toEqual(['Ray Ann Boyd']);
  });

  test("a guest whose name is the only candidate still reads, link or not", () => {
    // The demotion must not become a refusal: a page that links a guest to
    // their own record has nothing else to offer.
    expect(parseVisitors(`<a href="/members/visitor/12">Pat Lane</a>${VISITS}`).map(g => g.name))
      .toEqual(['Pat Lane']);
  });

  test("the placeholder standing in for a hidden address is not a guest", () => {
    const guests = parseVisitors(`
      <a href="/cdn-cgi/l/email-protection"><span class="__cf_email__">Protected Email</span></a>
      <span>Pat Lane</span><h4>Visit History</h4>${VISITS}
    `);
    expect(guests.map(g => g.name)).toEqual(['Pat Lane']);
  });

  test('the heading shape still wins when the page does use headings for names', () => {
    // The fallback only runs when reading the headings found nobody, so a page
    // that names its guests properly is unaffected by any of the above.
    const guests = parseVisitors(`
      <h2>Visitor Tracker</h2>
      <h3>Jo Reed</h3>
      <h4>Visit History</h4>${VISITS}
    `);

    expect(guests.map(g => g.name)).toEqual(['Jo Reed']);
  });
});

describe("the tracker's own controls", () => {
  const PATH = '/members/visitor-tracker';

  describe('the date-span dropdown', () => {
    test('asks for the widest span the dropdown offers, carrying the form with it', () => {
      const query = widestSpanQuery(`
        <form method="get" action="/members/visitor-tracker">
          <input type="hidden" name="view" value="cards">
          <select name="range">
            <option value="30">Last 30 Days</option>
            <option value="365" selected>Last 12 Months</option>
            <option value="all">All Time</option>
          </select>
          <input type="submit" value="Go">
        </form>`, PATH);

      expect(query).toBe('/members/visitor-tracker?view=cards&range=all');
    });

    test('an option with no value attribute is submitted as its own text', () => {
      expect(widestSpanQuery('<form><select name="span"><option selected>Last 6 Months</option><option>All Dates</option></select></form>', PATH))
        .toBe('/members/visitor-tracker?span=All%20Dates');
    });

    test('the widest span is measured, not assumed to be last', () => {
      expect(widestSpanQuery('<form><select name="r"><option>Last 5 Years</option><option selected>Last 30 Days</option><option>Last 6 Months</option></select></form>', PATH))
        .toBe('/members/visitor-tracker?r=Last%205%20Years');
    });

    test('a form action carrying its own query is added to, not appended past', () => {
      expect(widestSpanQuery(
        '<form action="/members/visitor-tracker?view=cards&amp;b=2"><select name="r"><option selected>Last 30 Days</option><option value="all">All Time</option></select></form>',
        PATH)).toBe('/members/visitor-tracker?view=cards&b=2&r=all');
    });

    test('a field the action already sets is overridden by the form, not repeated', () => {
      expect(widestSpanQuery(
        '<form action="/members/visitor-tracker?r=30"><select name="r"><option selected>Last 30 Days</option><option value="all">All Time</option></select></form>',
        PATH)).toBe('/members/visitor-tracker?r=all');
    });

    test('an entity is decoded once, so a value the page escaped twice survives', () => {
      // The option's value is the characters a&quot;b. Decoding &amp; and then
      // decoding &quot; out of the result would submit a quotation mark
      // instead — the page said what it meant, and it is not ours to reread.
      expect(widestSpanQuery(
        '<form><select name="r"><option selected>Last 30 Days</option><option value="a&amp;quot;b">All Time</option></select></form>',
        PATH)).toBe('/members/visitor-tracker?r=a%26quot%3Bb');
    });

    test('a page already showing everything is left as it came', () => {
      expect(widestSpanQuery('<form><select name="r"><option value="30">Last 30 Days</option><option value="all" selected>All Time</option></select></form>', PATH))
        .toBe('');
    });

    test('a dropdown that is not about dates is not touched', () => {
      expect(widestSpanQuery('<form><select name="sort"><option selected>By Name</option><option>By Date Added</option></select></form>', PATH))
        .toBe('');
    });

    test('a filter submitted by POST is left alone rather than guessed at', () => {
      expect(widestSpanQuery('<form method="POST"><select name="r"><option selected>Last 30 Days</option><option>All Time</option></select></form>', PATH))
        .toBe('');
    });
  });

  describe('the pager', () => {
    test('finds a numbered pager', () => {
      expect(pagerLinks('<a href="?page=1">1</a><a href="?page=2">2</a><a href="?page=3">3</a>', PATH))
        .toEqual(['/members/visitor-tracker?page=1', '/members/visitor-tracker?page=2', '/members/visitor-tracker?page=3']);
    });

    test('finds a next link that carries no page number of its own', () => {
      expect(pagerLinks('<a rel="next" href="/members/visitor-tracker?start=25">Next &rsaquo;</a>', PATH))
        .toEqual(['/members/visitor-tracker?start=25']);
    });

    test('a link to a guest is not a pager link', () => {
      expect(pagerLinks('<a href="?id=44">Pat Lane</a><a href="?page=2">2</a>', PATH))
        .toEqual(['/members/visitor-tracker?page=2']);
    });

    test('a pager on another page of the site is not followed', () => {
      expect(pagerLinks('<a href="/members/attendance?page=2">2</a>', PATH)).toEqual([]);
    });

    test('the page it is already on is not offered back', () => {
      expect(pagerLinks('<a href="/members/visitor-tracker?page=2">2</a>', '/members/visitor-tracker?page=2')).toEqual([]);
    });
  });

  describe('joining the pages together', () => {
    test('a guest whose visits run across a page break is one guest', () => {
      const merged = mergeVisitors([
        [{ name: 'Pat Lane', visits: [{ date: '09/13/26', service: 'Sun AM' }], comments: 'Came with the Carters' }],
        [{ name: 'Pat Lane', visits: [{ date: '09/13/26', service: 'Sun AM' }, { date: '08/30/26', service: 'Sun AM' }], phone: '(256) 555-0134' }],
        [{ name: 'Sam Ford', visits: [{ date: '09/06/26', service: 'Sun AM' }] }],
      ]);

      expect(merged).toHaveLength(2);
      // The repeated visit is not recorded twice, and each page's details survive.
      expect(merged[0]).toMatchObject({ name: 'Pat Lane', comments: 'Came with the Carters', phone: '(256) 555-0134' });
      expect(merged[0].visits).toHaveLength(2);
      expect(merged[1].name).toBe('Sam Ford');
    });

    test('a later page does not blank a detail an earlier one had', () => {
      const merged = mergeVisitors([
        [{ name: 'Pat Lane', visits: [], phone: '(256) 555-0134' }],
        [{ name: 'Pat Lane', visits: [], phone: '' }],
      ]);
      expect(merged[0].phone).toBe('(256) 555-0134');
    });
  });
});
