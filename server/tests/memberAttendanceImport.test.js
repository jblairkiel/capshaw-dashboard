// Importing an attendance spreadsheet kept by colouring in cells: reading the
// workbook's colours, finding the dates and the names, and saving only what
// the tracker has said each colour means.
jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const request = require('supertest');
const express = require('express');
const db      = require('../db');
const { readWorkbook, serialToIso, applyTint } = require('../lib/xlsxReader');
const importer = require('../lib/memberAttendanceImport');
const router  = require('../routes/memberAttendance');
const { buildXlsx } = require('./helpers/xlsxFixture');

const TRACKER = { id: 2, name: 'Roll Keeper', role: 'approved', areas: ['member-attendance'] };
const MEMBER  = { id: 3, name: 'Member', role: 'approved', areas: [] };

const GREEN  = { rgb: 'FF00B050' };
const RED    = { rgb: 'FFFF0000' };
const YELLOW = { theme: 7 };            // accent4, FFC000
const WHITE  = { rgb: 'FFFFFFFF' };

// Excel serials for Sundays 7, 14 and 21 September 2025.
const SEP7 = 45907, SEP14 = 45914, SEP21 = 45921;

const status = label => db.prepare('SELECT id FROM attendance_statuses WHERE label = ?').get(label).id;

function buildApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/member-attendance', router);
  return app;
}

let ada, bob;

beforeAll(() => {
  const add = db.prepare("INSERT INTO users (id, provider, provider_id, email, name, role) VALUES (?, 'local', ?, ?, ?, ?)");
  for (const u of [TRACKER, MEMBER]) add.run(u.id, `u${u.id}`, `u${u.id}@example.invalid`, u.name, u.role);
});

beforeEach(() => {
  db.prepare('DELETE FROM member_attendance').run();
  db.prepare('DELETE FROM directory').run();
  ada = db.prepare("INSERT INTO directory (name) VALUES ('Ada Archer')").run().lastInsertRowid;
  bob = db.prepare("INSERT INTO directory (name) VALUES ('Bob Baker')").run().lastInsertRowid;
});

const SHEET = () => buildXlsx({ sheets: [
  { name: 'Old', hidden: true, rows: [['nothing here']] },
  { name: '2025', rows: [
    ['Attendance 2025'],
    ['Name', SEP7, '9/14/2025', { v: SEP21 }, 'Total'],
    ['Archer, Ada', { fill: GREEN }, { fill: GREEN }, { fill: YELLOW }, 2],
    ['Bob Baker',   { fill: RED },   { fill: WHITE }, { v: 'P' },      0],
    ['Cara Nobody', { fill: GREEN }, null,            null,            1],
    [],
  ] },
] });

describe('reading a workbook', () => {
  test('cells, their text, and their fill colours — direct, theme and tinted', async () => {
    const book = await readWorkbook(await SHEET());
    expect(book.sheets.map(s => [s.name, s.hidden])).toEqual([['Old', true], ['2025', false]]);
    const rows = book.sheets[1].rows;
    expect(rows[1][0]).toEqual({ value: 'Name', colour: null });
    expect(rows[1][1].value).toBe(SEP7);
    expect(rows[2][1].colour).toBe('#00B050');
    expect(rows[2][3].colour).toBe('#FFC000');
    expect(rows[3][3]).toEqual({ value: 'P', colour: null });
  });

  test('a tint lightens or darkens, as Excel draws it', () => {
    expect(applyTint('4472C4', 0.7999816888943144)).toBe('DAE3F3');
    expect(applyTint('70AD47', -0.249977111117893)).toBe('548235');
  });

  test('dates are counted from 1899-12-30, or 1904', () => {
    expect(serialToIso(SEP7)).toBe('2025-09-07');
    expect(serialToIso(0)).toBeNull();
  });

  test('something that is not a workbook says so', async () => {
    expect((await readWorkbook(Buffer.from('not a zip'))).error).toMatch(/not an Excel workbook/);
  });
});

describe('what is in the sheet', () => {
  test('finds the header row of dates past the title, the name column, and the first visible sheet', async () => {
    const file = await importer.readFile(await SHEET());
    expect(file.sheet).toBe('2025');
    expect(file.headerRow).toBe(2);
    expect(file.nameColumn).toBe('A');
    expect(file.dates.map(d => [d.column, d.date])).toEqual([['B', '2025-09-07'], ['C', '2025-09-14'], ['D', '2025-09-21']]);
  });

  test('matches names to the directory, "Last, First" included, and lists who it could not', async () => {
    const file = await importer.readFile(await SHEET());
    expect(file.people.map(p => [p.row, p.name, p.personId])).toEqual([
      [3, 'Archer, Ada', ada], [4, 'Bob Baker', bob], [5, 'Cara Nobody', null],
    ]);
  });

  test('every colour, and typed text where there is no colour; white is no colour', async () => {
    const file = await importer.readFile(await SHEET());
    expect(file.keys.map(k => [k.key, k.count])).toEqual([['#00B050', 3], ['#FFC000', 1], ['#FF0000', 1], ['text:p', 1]]);
  });

  test('a sheet with no dates says what it expected', async () => {
    const buf = await buildXlsx({ sheets: [{ name: 'Sheet1', rows: [['Name', 'Notes'], ['Ada Archer', 'x']] }] });
    expect((await importer.readFile(buf)).error).toMatch(/No row of dates/);
  });
});

describe('importing', () => {
  const MAP = () => ({ '#00B050': status('Present'), '#FF0000': status('Absent'), '#FFC000': status('Sick') });
  const post = async (fields, user = TRACKER) => {
    const req = request(buildApp(user)).post('/api/member-attendance/import').attach('file', await SHEET(), 'attendance.xlsx');
    for (const [k, v] of Object.entries(fields)) req.field(k, typeof v === 'string' ? v : JSON.stringify(v));
    return req;
  };

  test('a dry run says what would happen and saves nothing', async () => {
    const res = await post({ dryRun: 'true', service: 'Sunday AM Worship', keyMap: MAP() });
    expect(res.status).toBe(200);
    expect(res.body.counts).toMatchObject({ add: 4, unmapped: 1, unmatchedPeople: 1 });
    expect(res.body.people[0]).toMatchObject({ name: 'Archer, Ada', marks: 3 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM member_attendance').get().n).toBe(0);
  });

  test('saves the mapped colours for the matched people, and an unmatched name once given a person', async () => {
    const cy = db.prepare("INSERT INTO directory (name) VALUES ('Cy Zimmer')").run().lastInsertRowid;
    const res = await post({ service: 'sunday am worship', keyMap: MAP(), personMap: { 5: cy } });
    expect(res.body.imported).toBe(5);
    const marks = db.prepare('SELECT person_id, date, service, status_id FROM member_attendance ORDER BY person_id, date').all();
    const row = (person, date, label) => ({ person_id: person, date, service: 'Sunday AM Worship', status_id: status(label) });
    expect(marks).toEqual([
      row(ada, '2025-09-07', 'Present'), row(ada, '2025-09-14', 'Present'), row(ada, '2025-09-21', 'Sick'),
      row(bob, '2025-09-07', 'Absent'),
      row(cy, '2025-09-07', 'Present'),
    ]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM action_log WHERE entity = 'attendance import'").get().n).toBe(1);
  });

  test('the same person on two rows: the first row wins', async () => {
    const res = await post({ dryRun: 'true', service: 'Sunday AM Worship', keyMap: MAP(), personMap: { 5: bob } });
    expect(res.body.counts).toMatchObject({ add: 4 });
  });

  test('keeps a mark already on the roll unless told the file wins', async () => {
    db.prepare('INSERT INTO member_attendance (person_id, date, service, status_id) VALUES (?, ?, ?, ?)')
      .run(ada, '2025-09-07', 'Sunday AM Worship', status('Out of town'));
    let res = await post({ dryRun: 'true', service: 'Sunday AM Worship', keyMap: MAP() });
    expect(res.body.counts).toMatchObject({ add: 3, keep: 1 });
    res = await post({ dryRun: 'true', service: 'Sunday AM Worship', keyMap: MAP(), overwrite: 'true' });
    expect(res.body.counts).toMatchObject({ add: 3, replace: 1, keep: 0 });
  });

  test('a person left out is left out', async () => {
    const res = await post({ dryRun: 'true', service: 'Sunday AM Worship', keyMap: MAP(), personMap: { 4: '' } });
    expect(res.body.counts).toMatchObject({ add: 3, skippedPeople: 1, unmatchedPeople: 1 });
  });

  test('needs a service and something to import', async () => {
    expect((await post({ keyMap: MAP() })).body.error).toMatch(/service/);
    expect((await post({ service: 'Sunday AM Worship', keyMap: {} })).body.error).toMatch(/nothing to import/);
  });

  test('is for the tracker only, and needs a file', async () => {
    expect((await post({ dryRun: 'true' }, MEMBER)).status).toBe(403);
    const none = await request(buildApp(TRACKER)).post('/api/member-attendance/import').field('dryRun', 'true');
    expect(none.body.error).toMatch(/Choose an Excel file/);
  });
});
