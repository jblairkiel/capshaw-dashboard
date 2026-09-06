const { parseJobAssignments } = require('../lib/parsers');

// Each of these is a table shape the church site could plausibly render. The
// original parser only understood the first and returned nothing for the rest,
// which is indistinguishable from "no assignments this month".
describe('parseJobAssignments — table shapes', () => {
  test('(a) date header row followed by three-cell rows', () => {
    const html = `
      <p>April 2025</p>
      <table>
        <tr><td>April 6</td><td>Service</td><td>Job</td><td>Name</td></tr>
        <tr><td>AM</td><td>Greeter</td><td>Jane Doe</td></tr>
        <tr><td>PM</td><td>Usher</td><td>Bob Smith</td></tr>
      </table>`;
    const { month, assignments } = parseJobAssignments(html);
    expect(month).toBe('April 2025');
    expect(assignments).toEqual([
      { date: 'April 6', service: 'AM', job: 'Greeter', name: 'Jane Doe' },
      { date: 'April 6', service: 'PM', job: 'Usher',   name: 'Bob Smith' },
    ]);
  });

  test('(b) date in the first column, blank on continuation rows', () => {
    const html = `
      <p>April 2025</p>
      <table>
        <tr><th>Date</th><th>Service</th><th>Job</th><th>Name</th></tr>
        <tr><td>April 6</td><td>AM</td><td>Greeter</td><td>Jane Doe</td></tr>
        <tr><td></td><td>AM</td><td>Usher</td><td>Bob Smith</td></tr>
        <tr><td>April 13</td><td>AM</td><td>Greeter</td><td>Ann Lee</td></tr>
      </table>`;
    const { assignments } = parseJobAssignments(html);
    expect(assignments).toEqual([
      { date: 'April 6',  service: 'AM', job: 'Greeter', name: 'Jane Doe' },
      { date: 'April 6',  service: 'AM', job: 'Usher',   name: 'Bob Smith' },
      { date: 'April 13', service: 'AM', job: 'Greeter', name: 'Ann Lee' },
    ]);
  });

  test('(c) a standalone date row above its assignments', () => {
    const html = `
      <p>April 2025</p>
      <table>
        <tr><td colspan="3">April 6</td></tr>
        <tr><td>AM</td><td>Greeter</td><td>Jane Doe</td></tr>
        <tr><td colspan="3">April 13</td></tr>
        <tr><td>AM</td><td>Greeter</td><td>Bob Smith</td></tr>
      </table>`;
    const { assignments } = parseJobAssignments(html);
    expect(assignments).toEqual([
      { date: 'April 6',  service: 'AM', job: 'Greeter', name: 'Jane Doe' },
      { date: 'April 13', service: 'AM', job: 'Greeter', name: 'Bob Smith' },
    ]);
  });

  test('keeps a slot whose name is still blank', () => {
    const html = `
      <table>
        <tr><td>April 6</td><td>Service</td><td>Job</td><td>Name</td></tr>
        <tr><td>AM</td><td>Greeter</td><td></td></tr>
      </table>`;
    const { assignments } = parseJobAssignments(html);
    expect(assignments).toEqual([{ date: 'April 6', service: 'AM', job: 'Greeter', name: '' }]);
  });

  test('picks the assignment table over a bigger layout table', () => {
    const html = `
      <table>
        ${Array.from({ length: 40 }, (_, i) => `<tr><td>nav ${i}</td><td>link</td></tr>`).join('')}
      </table>
      <table>
        <tr><td>April 6</td><td>Service</td><td>Job</td><td>Name</td></tr>
        <tr><td>AM</td><td>Greeter</td><td>Jane Doe</td></tr>
      </table>`;
    const { assignments } = parseJobAssignments(html);
    expect(assignments).toEqual([{ date: 'April 6', service: 'AM', job: 'Greeter', name: 'Jane Doe' }]);
  });

  test('understands abbreviated and slashed dates', () => {
    for (const date of ['Apr 6', 'Sunday, April 6', '4/6', '4/6/25']) {
      const html = `<table>
        <tr><td>${date}</td><td>Service</td><td>Job</td><td>Name</td></tr>
        <tr><td>AM</td><td>Greeter</td><td>Jane Doe</td></tr>
      </table>`;
      expect(parseJobAssignments(html).assignments).toEqual([
        { date, service: 'AM', job: 'Greeter', name: 'Jane Doe' },
      ]);
    }
  });

  test('skips the column header row rather than storing it as an assignment', () => {
    const html = `
      <table>
        <tr><th>Service</th><th>Job</th><th>Name</th></tr>
        <tr><td colspan="3">April 6</td></tr>
        <tr><td>AM</td><td>Greeter</td><td>Jane Doe</td></tr>
      </table>`;
    const { assignments } = parseJobAssignments(html);
    expect(assignments).toEqual([{ date: 'April 6', service: 'AM', job: 'Greeter', name: 'Jane Doe' }]);
  });

  test('returns nothing, without throwing, for a page with no table', () => {
    expect(parseJobAssignments('<html><body>Nothing here</body></html>')).toEqual({ month: '', assignments: [] });
  });

  test('reads the month even when the table is unparseable', () => {
    expect(parseJobAssignments('<p>April 2025</p>').month).toBe('April 2025');
  });
});

// ─── The shape that emptied the table ─────────────────────────────────────────
// parseJobAssignments returns { month, assignments } while every other parser
// returns an array — and the failure fallback was an array. _saveScraped ran
// DELETE before checking `.assignments`, so one failed fetch of the job page
// silently emptied the table and the tab rendered nothing.

describe('normaliseJobAssignments', () => {
  const { normaliseJobAssignments } = require('../routes/scraper');

  test('passes through the parser shape', () => {
    const rows = [{ date: 'April 6', service: 'AM', job: 'Greeter', name: 'Jane' }];
    expect(normaliseJobAssignments({ month: 'April 2025', assignments: rows }))
      .toEqual({ month: 'April 2025', assignments: rows });
  });

  test('accepts a bare array, as the old fallback supplied', () => {
    const rows = [{ date: 'April 6', service: 'AM', job: 'Greeter', name: 'Jane' }];
    expect(normaliseJobAssignments(rows)).toEqual({ month: '', assignments: rows });
  });

  test('turns every unusable value into an empty set rather than throwing', () => {
    for (const bad of [null, undefined, [], {}, 'nope', 42, { assignments: 'no' }]) {
      expect(normaliseJobAssignments(bad)).toEqual({ month: '', assignments: [] });
    }
  });
});

// ─── (d) date as a heading before the table, not inside it ────────────────────
// A plausible CMS layout the first three shapes don't cover: each date gets
// its own small table (just Service/Job/Name), with the date rendered as a
// heading immediately before it rather than as a row inside it.

describe('parseJobAssignments — date given as a heading before the table', () => {
  test('one table per date, with an h3 heading', () => {
    const html = `
      <h3>April 6</h3>
      <table>
        <tr><th>Service</th><th>Job</th><th>Name</th></tr>
        <tr><td>AM</td><td>Greeter</td><td>Jane Doe</td></tr>
      </table>
      <h3>April 13</h3>
      <table>
        <tr><th>Service</th><th>Job</th><th>Name</th></tr>
        <tr><td>AM</td><td>Greeter</td><td>Bob Smith</td></tr>
      </table>`;
    expect(parseJobAssignments(html).assignments).toEqual([
      { date: 'April 6',  service: 'AM', job: 'Greeter', name: 'Jane Doe' },
      { date: 'April 13', service: 'AM', job: 'Greeter', name: 'Bob Smith' },
    ]);
  });

  test('works with a <p> or <strong> heading, and no explicit column header row', () => {
    const html = `
      <p>Sunday, April 6</p>
      <table><tr><td>AM</td><td>Greeter</td><td>Jane Doe</td></tr></table>
      <strong>April 13</strong>
      <table><tr><td>AM</td><td>Greeter</td><td>Bob Smith</td></tr></table>`;
    expect(parseJobAssignments(html).assignments).toEqual([
      { date: 'Sunday, April 6', service: 'AM', job: 'Greeter', name: 'Jane Doe' },
      { date: 'April 13',        service: 'AM', job: 'Greeter', name: 'Bob Smith' },
    ]);
  });

  test('ignores a table that merely follows a sentence mentioning a date', () => {
    // A page could have both a genuine assignments table AND, elsewhere, some
    // unrelated small table sitting right after prose that happens to
    // mention a date in passing (e.g. "next Sunday is April 13"). Unlike a
    // real heading, that text is not *just* the date, so it must not be
    // mistaken for one.
    const html = `
      <table>
        <tr><td>April 6</td><td>Service</td><td>Job</td><td>Name</td></tr>
        <tr><td>AM</td><td>Greeter</td><td>Jane Doe</td></tr>
      </table>
      <p>Next Sunday is April 13</p>
      <table><tr><td>irrelevant</td><td>noise</td><td>row</td></tr></table>`;
    expect(parseJobAssignments(html).assignments).toEqual([
      { date: 'April 6', service: 'AM', job: 'Greeter', name: 'Jane Doe' },
    ]);
  });

  test('ignores a table with no date-like heading anywhere near it', () => {
    const html = `<p>Welcome!</p><table><tr><td>AM</td><td>Greeter</td><td>Jane Doe</td></tr></table>`;
    expect(parseJobAssignments(html).assignments).toEqual([]);
  });

  test('only attaches the heading immediately preceding a table, not one from much earlier', () => {
    const html = `
      <h3>April 6</h3>
      <p>${'x'.repeat(300)}</p>
      <table><tr><td>AM</td><td>Greeter</td><td>Jane Doe</td></tr></table>`;
    expect(parseJobAssignments(html).assignments).toEqual([]);
  });

  test('a standalone date row inside the table can still update the running date', () => {
    const html = `
      <h3>April 6</h3>
      <table>
        <tr><td>AM</td><td>Greeter</td><td>Jane Doe</td></tr>
        <tr><td colspan="3">April 13</td></tr>
        <tr><td>AM</td><td>Greeter</td><td>Bob Smith</td></tr>
      </table>`;
    expect(parseJobAssignments(html).assignments).toEqual([
      { date: 'April 6',  service: 'AM', job: 'Greeter', name: 'Jane Doe' },
      { date: 'April 13', service: 'AM', job: 'Greeter', name: 'Bob Smith' },
    ]);
  });

  test('multiple date-headed tables all contribute, not just one', () => {
    // The scenario that motivated this shape in the first place: a layout
    // with several small, independent per-date tables rather than one big
    // table. Every one of them must be read, not just whichever "wins".
    const html = `
      <h3>April 6</h3>
      <table><tr><td>AM</td><td>Greeter</td><td>Jane Doe</td></tr></table>
      <h3>April 13</h3>
      <table><tr><td>AM</td><td>Greeter</td><td>Bob Smith</td></tr></table>
      <h3>April 20</h3>
      <table><tr><td>AM</td><td>Greeter</td><td>Ann Lee</td></tr></table>`;
    expect(parseJobAssignments(html).assignments).toEqual([
      { date: 'April 6',  service: 'AM', job: 'Greeter', name: 'Jane Doe' },
      { date: 'April 13', service: 'AM', job: 'Greeter', name: 'Bob Smith' },
      { date: 'April 20', service: 'AM', job: 'Greeter', name: 'Ann Lee' },
    ]);
  });

  test('a short prefix like "Week of" before the date still counts as a heading', () => {
    const html = `<p>Week of April 6</p><table><tr><td>AM</td><td>Greeter</td><td>Jane Doe</td></tr></table>`;
    expect(parseJobAssignments(html).assignments).toEqual([
      { date: 'April 6', service: 'AM', job: 'Greeter', name: 'Jane Doe' },
    ]);
  });

  test('a month/year page heading (no day) is never mistaken for a per-table date', () => {
    // Without care, "April 2025" partial-matches as the day-date "April 20".
    const html = `<p>April 2025</p><table><tr><td>AM</td><td>Greeter</td><td>Jane Doe</td></tr></table>`;
    expect(parseJobAssignments(html).assignments).toEqual([]);
  });
});
