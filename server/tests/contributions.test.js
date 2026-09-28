// Weekly contribution totals from a CSV: the finance export the old
// church-management site produces, and anything shaped like it. The fixture
// copies that export's layout — two heading rows, "Income / Giving" beside
// "Expenses / Other / Total Expenses", a totals row — with made-up figures.
jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const request = require('supertest');
const express = require('express');
const db      = require('../db');
const router  = require('../routes/contributions');
const {
  parseCsv, parseAnyDate, parseMoney, parseContributionsCsv,
} = require('../lib/contributions');

const EXPORT = [
  '"","Income","Expenses","",',
  '"","Giving","Other","Total Expenses",',
  '"10/03/21","$4,978.00","$0.00","$0.00",',
  '"10/10/21","$4,868.00","$0.00","$0.00",',
  '"10/17/21","$3,858.50","$12.00","$12.00",',
  '"","$13,704.50","$12.00","$12.00",',
  '"","","N/A","",',
  '',
].join('\r\n');

// ─── Reading the file ─────────────────────────────────────────────────────────

describe('parseCsv', () => {
  test('keeps a quoted comma inside its field', () => {
    expect(parseCsv('"a","$4,978.00"\n')).toEqual([['a', '$4,978.00']]);
  });

  test('handles doubled quotes, CRLF, a BOM, and drops blank lines', () => {
    expect(parseCsv('﻿"say ""hi""",x\r\n\r\n,\r\ny,z')).toEqual([['say "hi"', 'x'], ['y', 'z']]);
  });
});

describe('parseAnyDate / parseMoney', () => {
  test.each([
    ['10/03/21', '2021-10-03'],
    ['9/21/2026', '2026-09-21'],
    ['2026-09-21', '2026-09-21'],
    ['Sep 21, 2026', '2026-09-21'],
    ['21 Sept 2026', '2026-09-21'],
  ])('%s is %s', (text, iso) => expect(parseAnyDate(text)).toBe(iso));

  test('what is not a date is not one', () => {
    for (const text of ['', 'Total', '$4,978.00', '13/45/2026']) expect(parseAnyDate(text)).toBeNull();
  });

  test.each([
    ['$4,978.00', 4978], ['4978', 4978], ['$ 4,978', 4978], ['(120.00)', -120], ['-$120', -120],
  ])('%s is %d', (text, n) => expect(parseMoney(text)).toBe(n));

  test('a date, a blank or a word is not money', () => {
    for (const text of ['', 'N/A', '10/03/21', 'Giving']) expect(parseMoney(text)).toBeNull();
  });
});

describe('parseContributionsCsv', () => {
  test('reads the old site\'s export: the giving column, as ISO dates, checked against its total', () => {
    const read = parseContributionsCsv(EXPORT);
    expect(read.records).toEqual([
      { date: '2021-10-03', amount: 4978 },
      { date: '2021-10-10', amount: 4868 },
      { date: '2021-10-17', amount: 3858.5 },
    ]);
    expect(read).toMatchObject({ amountColumn: 'Income Giving', total: 13704.5, statedTotal: 13704.5, warnings: [] });
  });

  test('takes the giving column wherever it sits, not the last money cell', () => {
    const csv = 'Budget,Week,Contribution,Over/Under\n$5000,9/21/2026,"$4,200.00",($800.00)\n';
    expect(parseContributionsCsv(csv).records).toEqual([{ date: '2026-09-21', amount: 4200 }]);
  });

  test('with no headings, the first money column after the date — not a count', () => {
    const csv = '09/21/2026,142,"$4,200.00","$5,000.00"\n';
    expect(parseContributionsCsv(csv).records).toEqual([{ date: '2026-09-21', amount: 4200 }]);
  });

  test('a week listed once per fund is added up, unless it has its own total row', () => {
    const perFund = 'Date,Fund,Amount\n9/21/2026,General,4000\n9/21/2026,Building,200\n';
    expect(parseContributionsCsv(perFund).records).toEqual([{ date: '2026-09-21', amount: 4200 }]);

    const withTotal = `${perFund}9/21/2026,Total,4200\n`;
    expect(parseContributionsCsv(withTotal).records).toEqual([{ date: '2026-09-21', amount: 4200 }]);
  });

  test('says so when the weeks do not add up to the file\'s own total', () => {
    const csv = EXPORT.replace('"$13,704.50","$12.00"', '"$99,999.00","$12.00"');
    expect(parseContributionsCsv(csv).warnings[0]).toMatch(/add up to \$13704\.50, but the file's own total is \$99999\.00/);
  });

  test('a file with no dates, or no amounts, says which is missing', () => {
    expect(parseContributionsCsv('Type,Category,Amount,%\nIncome,Giving,$9,100%\n').error).toMatch(/No column of dates/);
    expect(parseContributionsCsv('Date,Notes\n9/21/2026,rain\n').error).toMatch(/No column of amounts/);
    expect(parseContributionsCsv('').error).toMatch(/empty/);
  });
});

// ─── POST /api/contributions/import ───────────────────────────────────────────

function buildApp(user = null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/contributions', router);
  return app;
}

const ADMIN      = { id: 1, role: 'admin',    name: 'Ada' };
const COUNTER    = { id: 2, role: 'approved', name: 'Cal', areas: ['contributions'] };
const ATTENDANCE = { id: 3, role: 'approved', name: 'Ann', areas: ['attendance'] };

beforeEach(() => {
  for (const table of ['action_log', 'contributions', 'users']) db.prepare(`DELETE FROM ${table}`).run();
  const insert = db.prepare('INSERT INTO users (id, provider, provider_id, email, name, role) VALUES (?,?,?,?,?,?)');
  for (const u of [ADMIN, COUNTER, ATTENDANCE]) insert.run(u.id, 'google', `${u.name}-id`, `${u.name}@example.com`, u.name, u.role);
});

const post = (user, body) => request(buildApp(user)).post('/api/contributions/import').send(body);
const rows = () => db.prepare('SELECT date, amount FROM contributions ORDER BY date').all();

describe('POST /api/contributions/import', () => {
  test('401 signed out; 403 for anybody without the contributions area', async () => {
    expect((await post(null, { csv: EXPORT })).status).toBe(401);
    expect((await post(ATTENDANCE, { csv: EXPORT })).status).toBe(403);
    expect(rows()).toEqual([]);
  });

  test('a dry run summarises the file and saves nothing', async () => {
    const res = await post(COUNTER, { csv: EXPORT, dryRun: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true, dryRun: true, found: 3, added: 0, alreadyOnFile: 0,
      first: '2021-10-03', last: '2021-10-17', total: 13704.5, statedTotal: 13704.5,
      amountColumn: 'Income Giving',
    });
    expect(rows()).toEqual([]);
  });

  test('importing saves every week and records it once in the history', async () => {
    const res = await post(COUNTER, { csv: EXPORT, filename: 'finances.csv' });
    expect(res.body).toMatchObject({ success: true, dryRun: false, found: 3, added: 3 });
    expect(rows()).toEqual([
      { date: '2021-10-03', amount: 4978 },
      { date: '2021-10-10', amount: 4868 },
      { date: '2021-10-17', amount: 3858.5 },
    ]);

    const log = db.prepare('SELECT * FROM action_log').all();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ user_id: COUNTER.id, area: 'contributions', action: 'create' });
    expect(log[0].summary).toBe('Imported 3 week(s) of contributions from finances.csv');
  });

  test('a week already on file is never overwritten, however its date was written', async () => {
    db.prepare('INSERT INTO contributions (date, amount) VALUES (?, ?)').run('10/03/21', 9999);
    db.prepare('INSERT INTO contributions (date, amount) VALUES (?, ?)').run('2021-10-10', 1234);

    const res = await post(COUNTER, { csv: EXPORT });
    expect(res.body).toMatchObject({ found: 3, added: 1, alreadyOnFile: 2 });
    expect(rows()).toContainEqual({ date: '10/03/21', amount: 9999 });
    expect(rows()).toContainEqual({ date: '2021-10-10', amount: 1234 });
    expect(rows()).toHaveLength(3);
  });

  test('importing the same file twice adds nothing the second time', async () => {
    await post(COUNTER, { csv: EXPORT });
    const again = await post(COUNTER, { csv: EXPORT });
    expect(again.body).toMatchObject({ added: 0, alreadyOnFile: 3 });
    expect(rows()).toHaveLength(3);
    expect(db.prepare('SELECT COUNT(*) n FROM action_log').get().n).toBe(1);
  });

  test('an admin may import too', async () => {
    expect((await post(ADMIN, { csv: EXPORT })).body.added).toBe(3);
  });

  test('a file with nothing readable is refused and says what it needs', async () => {
    const res = await post(COUNTER, { csv: 'Type,Category,Amount,%\nIncome,Giving,$9,100%\n' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No weekly totals could be read.*column of dates/);
    expect((await post(COUNTER, {})).status).toBe(400);
  });
});
