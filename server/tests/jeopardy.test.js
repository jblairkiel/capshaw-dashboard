// Bible Jeopardy: a game is built in the Excel template, uploaded with a name,
// and kept under its own link. Any member makes one; whoever made it keeps it;
// the Bible Quiz Keeper keeps them all.
jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const request = require('supertest');
const express = require('express');
const db = require('../db');
const router = require('../routes/jeopardy');
const jeopardy = require('../lib/jeopardy');
const { readWorkbook } = require('../lib/xlsxReader');
const { writeWorkbook } = require('../lib/xlsxWriter');

function buildApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/jeopardy', router);
  return app;
}

function addUser(name, { areas = [], role = 'approved' } = {}) {
  const id = db.prepare('INSERT INTO users (provider, provider_id, email, name, role) VALUES (?,?,?,?,?)')
    .run('google', `${name}-id`, `${name.toLowerCase()}@example.com`, name, role).lastInsertRowid;
  for (const a of areas) db.prepare('INSERT INTO user_areas (user_id, area) VALUES (?, ?)').run(id, a);
  return { ...db.prepare('SELECT * FROM users WHERE id = ?').get(id), areas };
}

const HEADER = ['Category', 'Points', 'Clue', 'Answer', 'Daily Double'];

// A filled-in template, the way it comes back from Excel.
function workbook({ board, final = null, boardName = 'Board' }) {
  const sheets = [{ name: 'Instructions', rows: [['Fill in the Board sheet']] }, { name: boardName, rows: [HEADER, ...board] }];
  if (final) sheets.push({ name: 'Final', rows: [['Category', 'Clue', 'Answer'], final] });
  return writeWorkbook({ sheets });
}

const BOARD = [
  ['The Flood', 100, 'He built an ark of gopher wood.', 'Who is Noah?', ''],
  [null, 200, 'Days and nights it rained.', 'What is 40?', 'yes'],
  ['Kings', 100, 'The first king of Israel.', 'Who is Saul?', null],
  [null, 300, 'The wisest king.', 'Who is Solomon?', null],
  [null, 200, 'He killed Goliath, then became king.', 'Who is David?', null],
];
const FINAL = ['Apostles', 'He was chosen to replace Judas.', 'Who is Matthias?'];

let MAKER, OTHER, KEEPER;
beforeEach(() => {
  for (const t of ['jeopardy_games', 'action_log', 'user_areas', 'users']) db.prepare(`DELETE FROM ${t}`).run();
  MAKER = addUser('Maker');
  OTHER = addUser('Other');
  KEEPER = addUser('Keeper', { areas: ['bible-quiz'] });
});

async function upload(user, title, file) {
  const req = request(buildApp(user)).post('/api/jeopardy').field('title', title);
  return file ? req.attach('file', file, 'game.xlsx') : req;
}

describe('the template', () => {
  test('downloads as a workbook with the instructions, a board to fill in and a Final sheet', async () => {
    const res = await request(buildApp(MAKER)).get('/api/jeopardy/template').buffer(true).parse((r, cb) => {
      const chunks = []; r.on('data', c => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/Bible Jeopardy template\.xlsx/);

    const book = await readWorkbook(res.body);
    expect(book.sheets.map(s => s.name)).toEqual(['Instructions', 'Board', 'Final']);
    const board = book.sheets[1].rows;
    expect(board[0].map(c => c.value)).toEqual(HEADER);
    expect(board[1][0].value).toBe('Category 1');
    expect(board.slice(1, 6).map(r => r[1].value)).toEqual([100, 200, 300, 400, 500]);
    expect(board.length).toBe(31);   // header + 6 categories × 5 clues
  });

  test('uploaded untouched, it says there is nothing on it yet', async () => {
    const res = await upload(MAKER, 'Empty', await jeopardy.template());
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(['There are no clues on the Board sheet yet.']);
  });
});

describe('reading a filled-in template', () => {
  test('categories carry down until a new name, clues sort by points, and Daily Doubles are kept', async () => {
    const { board } = await jeopardy.readBoard(await workbook({ board: BOARD, final: FINAL }));
    expect(board.categories.map(c => c.name)).toEqual(['The Flood', 'Kings']);
    expect(board.categories[1].clues.map(c => c.points)).toEqual([100, 200, 300]);
    expect(board.categories[0].clues[1]).toEqual({ points: 200, clue: 'Days and nights it rained.', answer: 'What is 40?', daily: true });
    expect(board.final).toEqual({ category: 'Apostles', clue: 'He was chosen to replace Judas.', answer: 'Who is Matthias?' });
  });

  test('placeholder categories with no clues, and empty rows, are left out', async () => {
    const { board } = await jeopardy.readBoard(await workbook({ board: [
      ['Category 1', 100, null, null, null],
      ['Creation', 100, 'Day one.', 'What is light?', null],
      [null, 200, null, null, null],
      ['Category 3', 100, null, null, null],
    ] }));
    expect(board.categories).toEqual([{ name: 'Creation', clues: [{ points: 100, clue: 'Day one.', answer: 'What is light?', daily: false }] }]);
    expect(board.final).toBeNull();
  });

  test('says which row needs putting right', async () => {
    const { errors } = await jeopardy.readBoard(await workbook({ board: [
      ['Creation', 100, 'Day one.', null, null],
      [null, 'lots', 'Day two.', 'What is the sky?', null],
      [null, 300, null, 'What is land?', null],
    ] }));
    expect(errors).toEqual([
      'Row 2: "Day one." has no answer.',
      'Row 3: the points need to be a whole number, like 100.',
      'Row 4: there is an answer but no clue.',
    ]);
  });

  test('a board has room for six categories', async () => {
    const rows = Array.from({ length: 7 }, (_, i) => [`Cat ${i}`, 100, `Clue ${i}`, `Answer ${i}`, null]);
    const { errors } = await jeopardy.readBoard(await workbook({ board: rows }));
    expect(errors).toEqual(['There are 7 categories; a board has room for 6.']);
  });

  test('a Final with a clue but no answer is caught', async () => {
    const { errors } = await jeopardy.readBoard(await workbook({ board: BOARD, final: ['Apostles', 'Who replaced Judas?', null] }));
    expect(errors).toEqual(['Final sheet, row 2: Final Jeopardy needs both a clue and an answer.']);
  });

  test('something that is not a workbook is turned away', async () => {
    const { errors } = await jeopardy.readBoard(Buffer.from('not a spreadsheet'));
    expect(errors[0]).toMatch(/not an Excel workbook/);
  });
});

describe('saving games', () => {
  test('a member uploads a game with a name, and it is kept under its own link', async () => {
    const res = await upload(MAKER, '  Genesis review  ', await workbook({ board: BOARD, final: FINAL }));
    expect(res.status).toBe(201);
    expect(res.body.game).toMatchObject({ title: 'Genesis review', clueCount: 5, hasFinal: true, createdByName: 'Maker', canEdit: true });

    const one = await request(buildApp(OTHER)).get(`/api/jeopardy/${res.body.game.id}`);
    expect(one.body.game.board.categories[0].clues[0].answer).toBe('Who is Noah?');
    expect(one.body.game.canEdit).toBe(false);
    expect(db.prepare('SELECT summary FROM action_log').get().summary).toBe('Made the Bible Jeopardy game "Genesis review"');
  });

  test('a game needs a name and a file, and a template with mistakes saves nothing', async () => {
    expect((await upload(MAKER, '', await workbook({ board: BOARD }))).body.error).toBe('Give the game a name');
    expect((await upload(MAKER, 'No file')).body.errors).toEqual(['Choose the filled-in template to upload']);
    const bad = await upload(MAKER, 'Bad', await workbook({ board: [['Creation', 100, 'Day one.', null, null]] }));
    expect(bad.status).toBe(400);
    expect(bad.body.errors).toEqual(['Row 2: "Day one." has no answer.']);
    expect(db.prepare('SELECT COUNT(*) n FROM jeopardy_games').get().n).toBe(0);
  });

  test('searching finds a game by its name, who made it, or anything on its board', async () => {
    await upload(MAKER, 'Genesis review', await workbook({ board: BOARD }));
    await upload(OTHER, 'Gospels', await workbook({ board: [['Miracles', 100, 'Water into wine.', 'What is Cana?', null]] }));

    const find = async q => (await request(buildApp(MAKER)).get('/api/jeopardy').query({ q })).body.games.map(g => g.title);
    expect(await find('')).toEqual(['Gospels', 'Genesis review']);
    expect(await find('genesis')).toEqual(['Genesis review']);
    expect(await find('solomon')).toEqual(['Genesis review']);
    expect(await find('other')).toEqual(['Gospels']);
    expect(await find('100%')).toEqual([]);
    expect(await find('answer')).toEqual([]);   // a word in how the board is stored, not on it
  });

  test('whoever made it renames it or uploads a correction, keeping the same link', async () => {
    const { id } = (await upload(MAKER, 'Genesis', await workbook({ board: BOARD }))).body.game;
    const renamed = await request(buildApp(MAKER)).put(`/api/jeopardy/${id}`).field('title', 'Genesis review');
    expect(renamed.body.game.title).toBe('Genesis review');

    const corrected = await request(buildApp(MAKER)).put(`/api/jeopardy/${id}`).field('title', 'Genesis review')
      .attach('file', await workbook({ board: [['Abraham', 100, 'Called out of Ur.', 'Who is Abraham?', null]] }), 'game.xlsx');
    expect(corrected.body.game).toMatchObject({ id, categoryNames: ['Abraham'], clueCount: 1 });
  });

  test('nobody else may change or delete it, but the Bible Quiz Keeper may', async () => {
    const { id } = (await upload(MAKER, 'Genesis', await workbook({ board: BOARD }))).body.game;
    expect((await request(buildApp(OTHER)).put(`/api/jeopardy/${id}`).field('title', 'Mine now')).status).toBe(403);
    expect((await request(buildApp(OTHER)).delete(`/api/jeopardy/${id}`)).status).toBe(403);

    expect((await request(buildApp(KEEPER)).get(`/api/jeopardy/${id}`)).body.game.canEdit).toBe(true);
    expect((await request(buildApp(KEEPER)).delete(`/api/jeopardy/${id}`)).status).toBe(200);
    expect((await request(buildApp(MAKER)).get(`/api/jeopardy/${id}`)).status).toBe(404);
  });

  test('somebody still waiting for approval cannot see or make games', async () => {
    const pending = addUser('Pending', { role: 'pending' });
    expect((await request(buildApp(pending)).get('/api/jeopardy')).status).toBe(403);
    expect((await upload(pending, 'Nope', await workbook({ board: BOARD }))).status).toBe(403);
  });
});
