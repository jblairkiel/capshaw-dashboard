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

const read = async buf => importer.readFiles([{ buffer: buf, name: 'attendance.xlsx' }]);

describe('a grid: a row per member, a column per date', () => {
  test('finds the header row of dates past the title, the name column, and the first visible sheet', async () => {
    const file = await read(await SHEET());
    expect(file.sheet).toBe('2025');
    expect(file.sheets).toEqual(['Old', '2025']);
    expect(file.pages).toMatchObject([{ layout: 'grid', headerRow: 2, nameColumn: 'A', problem: null }]);
    expect(file.dates).toEqual(['2025-09-07', '2025-09-14', '2025-09-21']);
  });

  test('matches names to the directory, "Last, First" included, and lists who it could not', async () => {
    const file = await read(await SHEET());
    expect(file.people.map(p => [p.key, p.name, p.personId])).toEqual([
      ['ada archer', 'Archer, Ada', ada], ['bob baker', 'Bob Baker', bob], ['cara nobody', 'Cara Nobody', null],
    ]);
  });

  test('every colour, and typed text where there is no colour; white is no colour', async () => {
    const file = await read(await SHEET());
    expect(file.keys.map(k => [k.key, k.count])).toEqual([['#00B050', 3], ['#FFC000', 1], ['#FF0000', 1], ['text:p', 1]]);
  });

  test('a sheet in neither shape says what it expected', async () => {
    const buf = await buildXlsx({ sheets: [{ name: 'Sheet1', rows: [['Name', 'Notes'], ['Ada Archer', 'x']] }] });
    expect((await read(buf)).pages[0].problem).toMatch(/First Name \/ Last Name columns, or a row of dates/);
  });
});

// The church's own sheet: one per service date, the date typed at the top, a
// legend of colours, and blocks of First Name / Last Name side by side.
const LIGHT_GREEN = { rgb: 'FFD8E4BC' }, LIGHT_BLUE = { rgb: 'FFB7DEE8' }, LIGHT_ORANGE = { rgb: 'FFFCD5B4' }, YELLOW_FILL = { rgb: 'FFFFFF00' };
const ROSTER = ({ date = '09 07 2025', ada: adaFill = LIGHT_GREEN, name = 'Week' } = {}) => ({
  name,
  rows: [
    [{ v: 'Capshaw church of Christ', fill: YELLOW_FILL }, null, null, null, { v: date, fill: YELLOW_FILL }],
    [{ v: 'Green = Present ', fill: LIGHT_GREEN }, null, null, { v: 'Blue = Sick or Caregiver', fill: LIGHT_BLUE }, null, null,
      { v: 'Orange = Out Town ', fill: LIGHT_ORANGE }, null, null, { v: 'Yellow = Work', fill: YELLOW_FILL }],
    ['First Name', 'Last Name', null, 'First Name', 'Last Name'],
    [{ v: 'Ada', fill: adaFill }, { v: 'Archer', fill: adaFill }, null, { v: 'Cara ', fill: WHITE }, { v: 'Nobody', fill: WHITE }],
    [{ v: 'Bob', fill: WHITE }, { v: 'Baker', fill: LIGHT_BLUE }, null, { v: 'Dee', fill: LIGHT_ORANGE }, { v: 'Unknown', fill: LIGHT_ORANGE }],
    [null, null, null, { v: 'Ed', fill: YELLOW_FILL }, { v: 'Unknown', fill: YELLOW_FILL }],
  ],
});

describe('a roster: one sheet per date', () => {
  test('reads the date, the legend, and every name in every block', async () => {
    const file = await read(await buildXlsx({ sheets: [ROSTER()] }));
    expect(file.pages).toMatchObject([{ layout: 'roster', dates: ['2025-09-07'], dateFound: true, people: 5, problem: null }]);
    expect(file.legend.map(l => [l.colour, l.name, l.label])).toEqual([
      ['#D8E4BC', 'Green', 'Present'], ['#B7DEE8', 'Blue', 'Sick or Caregiver'],
      ['#FCD5B4', 'Orange', 'Out Town'], ['#FFFF00', 'Yellow', 'Work'],
    ]);
    expect(file.people.map(p => [p.name, p.where])).toEqual([
      ['Ada Archer', 'Week A4'], ['Cara Nobody', 'Week D4'], ['Bob Baker', 'Week A5'], ['Dee Unknown', 'Week D5'], ['Ed Unknown', 'Week D6'],
    ]);
  });

  test('a name is keyed by the colour of either of its cells, or as having none', async () => {
    const file = await read(await buildXlsx({ sheets: [ROSTER()] }));
    const by = Object.fromEntries(file.keys.map(k => [k.key, k]));
    expect(Object.keys(by).sort()).toEqual(['#B7DEE8', '#D8E4BC', '#FCD5B4', '#FFFF00', 'none']);
    expect(by.none).toMatchObject({ none: true, count: 1 });
  });

  test('suggests a status from the legend — "Sick or Caregiver" is Sick, "Out Town" is Out of town — and Absent for no colour', async () => {
    const file = await read(await buildXlsx({ sheets: [ROSTER()] }));
    const by = Object.fromEntries(file.keys.map(k => [k.key, k]));
    expect(by['#D8E4BC']).toMatchObject({ legend: 'Green = Present', suggest: status('Present'), approximate: false });
    expect(by['#B7DEE8'].suggest).toBe(status('Sick'));
    expect(by['#FCD5B4'].suggest).toBe(status('Out of town'));
    expect(by['#FFFF00']).toMatchObject({ legendLabel: 'Work', suggest: null });
    expect(by.none.suggest).toBe(status('Absent'));
  });

  test('a shade close to a legend colour is suggested as that colour, and says so', async () => {
    const file = await read(await buildXlsx({ sheets: [ROSTER({ ada: { rgb: 'FFC4D79B' } })] }));
    expect(file.keys.find(k => k.key === '#C4D79B')).toMatchObject({ legend: 'Green = Present', approximate: true, suggest: status('Present') });
  });

  test('many weeks at once: each its own date, one person across them all', async () => {
    const files = [
      { buffer: await buildXlsx({ sheets: [ROSTER({ date: '09 07 2025' })] }), name: 'a.xlsx' },
      { buffer: await buildXlsx({ sheets: [ROSTER({ date: '', ada: LIGHT_BLUE })] }), name: 'Attendance_09_14_2025.xlsx' },
      { buffer: await buildXlsx({ sheets: [ROSTER({ date: '', name: 'Sheet1' })] }), name: 'undated.xlsx' },
    ];
    const file = await importer.readFiles(files);
    expect(file.pages.map(p => [p.file, p.dates, p.dateFound, !!p.problem])).toEqual([
      ['a.xlsx', ['2025-09-07'], true, false],
      ['Attendance_09_14_2025.xlsx', ['2025-09-14'], false, false],
      ['undated.xlsx', [], false, true],
    ]);
    expect(file.people.filter(p => p.name === 'Ada Archer')).toHaveLength(1);
    expect(file.people.find(p => p.name === 'Ada Archer').marks).toEqual([
      { date: '2025-09-07', key: '#D8E4BC' }, { date: '2025-09-14', key: '#B7DEE8' },
    ]);

    const dated = await importer.readFiles(files, { dateMap: { '2#Sheet1': '2025-09-21' } });
    expect(dated.pages[2]).toMatchObject({ dates: ['2025-09-21'], problem: null });
    expect(dated.dates).toEqual(['2025-09-07', '2025-09-14', '2025-09-21']);
  });

  test('imports with the suggestions, and matches people across the blocks', async () => {
    const file = await read(await buildXlsx({ sheets: [ROSTER()] }));
    const keyMap = Object.fromEntries(file.keys.filter(k => k.suggest).map(k => [k.key, k.suggest]));
    const planned = importer.plan(file, { service: 'Sunday AM Worship', keyMap, personMap: { 'cara nobody': bob } });
    expect(planned.writes).toEqual([
      { personId: ada, date: '2025-09-07', statusId: status('Present') },
      { personId: bob, date: '2025-09-07', statusId: status('Absent') },
    ]);
    // Bob was already marked from Cara's row (mapped to him), which came first.
    expect(planned.counts).toMatchObject({ add: 2, unmatchedPeople: 2 });
  });
});

describe('reading dates', () => {
  test.each([
    ['10 04 2026', '2026-10-04'], ['10/04/2026', '2026-10-04'], ['Attendance_10_04_2026.xlsx', '2026-10-04'],
    ['Oct 4, 2026', '2026-10-04'], ['Capshaw church of Christ', null], ['Week 3', null],
  ])('%s', (input, expected) => expect(importer.dateFromText(input)).toBe(expected));
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
    const res = await post({ service: 'sunday am worship', keyMap: MAP(), personMap: { 'cara nobody': cy } });
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
    const res = await post({ dryRun: 'true', service: 'Sunday AM Worship', keyMap: MAP(), personMap: { 'cara nobody': bob } });
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
    const res = await post({ dryRun: 'true', service: 'Sunday AM Worship', keyMap: MAP(), personMap: { 'bob baker': '' } });
    expect(res.body.counts).toMatchObject({ add: 3, skippedPeople: 1, unmatchedPeople: 1 });
  });

  test('needs a service and something to import', async () => {
    expect((await post({ keyMap: MAP() })).body.error).toMatch(/service/);
    expect((await post({ service: 'Sunday AM Worship', keyMap: {} })).body.error).toMatch(/nothing to import/);
  });

  test('several weekly roster files in one upload, one with its date typed in', async () => {
    const res = await request(buildApp(TRACKER)).post('/api/member-attendance/import')
      .attach('file', await buildXlsx({ sheets: [ROSTER({ date: '09 07 2025' })] }), 'Attendance_09_07_2025.xlsx')
      .attach('file', await buildXlsx({ sheets: [ROSTER({ date: '', name: 'Sheet1' })] }), 'old.xlsx')
      .field('service', 'Sunday AM Worship')
      .field('keyMap', JSON.stringify({ '#D8E4BC': status('Present'), none: status('Absent') }))
      .field('dateMap', JSON.stringify({ '1#Sheet1': '9/14/2025' }));
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(2); // Ada on each date; Bob's blue is not mapped, the rest are not in the directory
    expect(db.prepare('SELECT date, status_id FROM member_attendance WHERE person_id = ? ORDER BY date').all(ada))
      .toEqual([{ date: '2025-09-07', status_id: status('Present') }, { date: '2025-09-14', status_id: status('Present') }]);
    const log = db.prepare("SELECT summary FROM action_log WHERE entity = 'attendance import' ORDER BY id DESC").get();
    expect(log.summary).toMatch(/from 2 spreadsheets \(2 dates\)/);
  });

  test('is for the tracker only, and needs a file', async () => {
    expect((await post({ dryRun: 'true' }, MEMBER)).status).toBe(403);
    const none = await request(buildApp(TRACKER)).post('/api/member-attendance/import').field('dryRun', 'true');
    expect(none.body.error).toMatch(/Choose an Excel file/);
  });
});
