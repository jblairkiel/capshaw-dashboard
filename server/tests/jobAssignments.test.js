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
