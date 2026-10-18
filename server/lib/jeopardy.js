// ─── Bible Jeopardy ───────────────────────────────────────────────────────────
//
// A game is built in Excel rather than on the site: whoever is making one
// downloads the template, fills in the categories, clues and answers, and
// uploads it with a name. It is saved as a board — categories across the top,
// clues worth more the further down they go, any of them a Daily Double, and
// an optional Final Jeopardy — and kept under its own permanent link, so a
// teacher can find it again next week or send it to someone else.
//
// Each game names its author, who wrote it, which is searched and can be
// filtered on. It starts as whoever uploads it and can be changed, since one
// teacher may put up a game another wrote.
//
// Any approved member can make one. Whoever made a game keeps it (renames it,
// uploads a corrected board, deletes it); whoever holds Bible Quiz Keeper can
// do the same to every game. Playing it — teams, scores, which clues are gone
// — happens in the browser and is not stored here.

const db = require('../db');
const { holdsArea } = require('./areas');
const { readWorkbook } = require('./xlsxReader');
const { writeWorkbook } = require('./xlsxWriter');

const AREA = 'bible-quiz';
const LIMITS = { title: 120, author: 80, category: 60, clue: 500, answer: 300, categories: 6, clues: 6, search: 100 };
const MAX_FILE_BYTES = 2 * 1024 * 1024;

const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// ─── The template ─────────────────────────────────────────────────────────────

const TEMPLATE_CATEGORIES = 6;
const TEMPLATE_POINTS = [100, 200, 300, 400, 500];

const INSTRUCTIONS = [
  'Fill in the Board sheet: one row for each clue.',
  'Category — write the category name on its first row. The rows under it belong to the same category until you write a new name.',
  'Points — what the clue is worth. Lower values are easier and sit at the top of the board.',
  'Clue — what is read out, worded the way Jeopardy does it: "He built an ark of gopher wood."',
  'Answer — the response you are looking for: "Who is Noah?"',
  'Daily Double — type yes beside any clue (one or two is usual). The team that picks it bets on it before seeing the clue.',
  'Up to 6 categories with up to 6 clues each. Leave a row\'s Clue empty to skip it, or delete a whole category\'s rows.',
  'Final Jeopardy is optional: fill in the Final sheet, or leave it empty for a game without one.',
  'When you are done, save it as an Excel Workbook (.xlsx) and upload it on the Bible Jeopardy page with a name for the game.',
];

async function template() {
  const board = [[
    { v: 'Category', style: 'header' }, { v: 'Points', style: 'header' }, { v: 'Clue', style: 'header' },
    { v: 'Answer', style: 'header' }, { v: 'Daily Double', style: 'header' },
  ]];
  for (let c = 1; c <= TEMPLATE_CATEGORIES; c++) {
    TEMPLATE_POINTS.forEach((points, i) => {
      // Alternate categories are shaded, so where one ends and the next starts is plain.
      const shade = c % 2 === 0;
      board.push([
        i === 0 ? { v: `Category ${c}`, style: shade ? 'shadedBold' : 'bold' } : { v: '', style: shade ? 'shaded' : 'plain' },
        { v: points, style: shade ? 'shaded' : 'plain' },
        { v: '', style: shade ? 'shaded' : 'plain' },
        { v: '', style: shade ? 'shaded' : 'plain' },
        { v: '', style: shade ? 'shaded' : 'plain' },
      ]);
    });
  }

  return writeWorkbook({
    sheets: [
      {
        name: 'Instructions', columns: [110],
        rows: [
          [{ v: 'Bible Jeopardy — game template', style: 'title' }],
          [null],
          ...INSTRUCTIONS.map((line, i) => [{ v: `${i + 1}. ${line}`, style: 'plain' }]),
          [null],
          [{ v: 'Example: Category "The Flood" · 100 · "He built an ark of gopher wood." · "Who is Noah?"', style: 'note' }],
        ],
      },
      { name: 'Board', columns: [22, 9, 60, 36, 13], freeze: true, rows: board },
      {
        name: 'Final', columns: [22, 60, 36], freeze: true,
        rows: [
          [{ v: 'Category', style: 'header' }, { v: 'Clue', style: 'header' }, { v: 'Answer', style: 'header' }],
          [{ v: '', style: 'bold' }, { v: '', style: 'plain' }, { v: '', style: 'plain' }],
        ],
      },
    ],
  });
}

// ─── Reading a filled-in template ─────────────────────────────────────────────

const text = cell => {
  const v = cell?.value;
  if (v === null || v === undefined || v === false) return '';
  return String(v).replace(/\s+/g, ' ').trim();
};
const YES = new Set(['yes', 'y', 'x', 'true', '1', 'dd', 'daily double', '✓', '✔']);

function sheetNamed(sheets, name) {
  return sheets.find(s => s.name.trim().toLowerCase() === name) || null;
}

// The row with the column names on it, and which column is which. Found by
// name rather than position, so a column moved or added in Excel still reads.
function headerOf(rows, wanted) {
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const cells = rows[r] || [];
    const at = {};
    cells.forEach((cell, c) => {
      const name = text(cell).toLowerCase();
      for (const [key, words] of Object.entries(wanted)) {
        if (at[key] === undefined && words.some(w => name === w || name.startsWith(`${w} `))) at[key] = c;
      }
    });
    if (at.category !== undefined && at.clue !== undefined) return { row: r, at };
  }
  return null;
}

// The board from a workbook, or { errors } saying what to put right, each
// with the row it is on so it can be found in Excel.
function boardFrom(workbook) {
  const errors = [];
  const sheet = sheetNamed(workbook.sheets, 'board')
    || workbook.sheets.find(s => headerOf(s.rows, { category: ['category'], clue: ['clue', 'question'] }));
  if (!sheet) return { errors: ['There is no Board sheet with Category and Clue columns. Start from the template on this page.'] };

  const header = headerOf(sheet.rows, {
    category: ['category'], points: ['points', 'value'], clue: ['clue', 'question'],
    answer: ['answer', 'response'], daily: ['daily double', 'daily', 'dd'],
  });
  if (!header) return { errors: ['The Board sheet needs Category and Clue columns. Start from the template on this page.'] };
  if (header.at.answer === undefined) return { errors: ['The Board sheet needs an Answer column.'] };
  if (header.at.points === undefined) return { errors: ['The Board sheet needs a Points column.'] };

  const categories = [];
  let current = null;
  for (let r = header.row + 1; r < sheet.rows.length; r++) {
    const cells = sheet.rows[r] || [];
    const line = r + 1;
    const name = clean(text(cells[header.at.category]), LIMITS.category);
    const clue = text(cells[header.at.clue]);
    const answer = text(cells[header.at.answer]);
    const pointsCell = cells[header.at.points]?.value;
    const daily = header.at.daily !== undefined && YES.has(text(cells[header.at.daily]).toLowerCase());

    // A new name starts a new category; rows under it without a name are its own.
    if (name) {
      current = categories.find(c => c.name.toLowerCase() === name.toLowerCase());
      if (!current) { current = { name, clues: [] }; categories.push(current); }
    }
    if (!clue && !answer) continue;   // an empty row, or one left blank to skip it

    if (!current) { errors.push(`Row ${line}: a clue with no category above it.`); continue; }
    if (!clue) { errors.push(`Row ${line}: there is an answer but no clue.`); continue; }
    if (!answer) { errors.push(`Row ${line}: "${clue.slice(0, 40)}" has no answer.`); continue; }
    if (clue.length > LIMITS.clue) errors.push(`Row ${line}: the clue is longer than ${LIMITS.clue} characters.`);
    if (answer.length > LIMITS.answer) errors.push(`Row ${line}: the answer is longer than ${LIMITS.answer} characters.`);
    const points = typeof pointsCell === 'number' ? pointsCell : Number(String(pointsCell ?? '').replace(/[$,\s]/g, ''));
    if (!Number.isInteger(points) || points <= 0 || points > 100000) {
      errors.push(`Row ${line}: the points need to be a whole number, like 100.`);
      continue;
    }
    current.clues.push({ points, clue, answer, daily });
  }

  const used = categories.filter(c => c.clues.length);
  if (!used.length && !errors.length) errors.push('There are no clues on the Board sheet yet.');
  if (used.length > LIMITS.categories) errors.push(`There are ${used.length} categories; a board has room for ${LIMITS.categories}.`);
  for (const c of used) {
    if (c.clues.length > LIMITS.clues) errors.push(`"${c.name}" has ${c.clues.length} clues; a category has room for ${LIMITS.clues}.`);
    c.clues.sort((a, b) => a.points - b.points);
  }

  // Final Jeopardy, if it was filled in.
  let final = null;
  const finalSheet = sheetNamed(workbook.sheets, 'final');
  if (finalSheet) {
    const fh = headerOf(finalSheet.rows, { category: ['category'], clue: ['clue', 'question'], answer: ['answer', 'response'] });
    if (fh) {
      for (let r = fh.row + 1; r < finalSheet.rows.length && !final; r++) {
        const cells = finalSheet.rows[r] || [];
        const category = clean(text(cells[fh.at.category]), LIMITS.category);
        const clue = text(cells[fh.at.clue]);
        const answer = fh.at.answer !== undefined ? text(cells[fh.at.answer]) : '';
        if (!category && !clue && !answer) continue;
        if (!clue || !answer) { errors.push(`Final sheet, row ${r + 1}: Final Jeopardy needs both a clue and an answer.`); break; }
        if (clue.length > LIMITS.clue) errors.push(`Final sheet, row ${r + 1}: the clue is longer than ${LIMITS.clue} characters.`);
        if (answer.length > LIMITS.answer) errors.push(`Final sheet, row ${r + 1}: the answer is longer than ${LIMITS.answer} characters.`);
        final = { category: category || 'Final Jeopardy', clue, answer };
      }
    }
  }

  if (errors.length) return { errors };
  return { board: { categories: used, final } };
}

async function readBoard(buffer) {
  const workbook = await readWorkbook(buffer);
  if (workbook.error) return { errors: [workbook.error] };
  return boardFrom(workbook);
}

// ─── Saved games ──────────────────────────────────────────────────────────────

function canEdit(user, game) {
  if (!user || !game) return false;
  return holdsArea(user, AREA) || (!!game.createdBy && game.createdBy === user.id);
}

function summaryOf(board) {
  return {
    categoryNames: board.categories.map(c => c.name),
    clueCount: board.categories.reduce((n, c) => n + c.clues.length, 0),
    hasFinal: !!board.final,
  };
}

function shape(row, user, { withBoard = false } = {}) {
  if (!row) return null;
  const board = JSON.parse(row.board || '{"categories":[]}');
  const game = {
    id: row.id,
    title: row.title,
    author: row.author || row.created_by_name || '',
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...summaryOf(board),
  };
  game.canEdit = canEdit(user, game);
  if (withBoard) game.board = board;
  return game;
}

// Every word a search should find on a board — not the JSON it is kept in,
// whose own key names ("clue", "answer") would match every game.
function searchTextOf(board) {
  return [
    ...board.categories.flatMap(c => [c.name, ...c.clues.flatMap(q => [q.clue, q.answer])]),
    ...(board.final ? [board.final.category, board.final.clue, board.final.answer] : []),
  ].join('\n').toLowerCase();
}

function row(id) {
  return db.prepare('SELECT * FROM jeopardy_games WHERE id = ?').get(Number(id)) || null;
}

function get(id, user) {
  return shape(row(id), user, { withBoard: true });
}

// Newest first. A search looks at the name, the author, who uploaded it, and
// everything on the board — so "Noah" finds a game with a clue about him,
// whatever it is called. `author` narrows the list to one author's games.
function list(user, query = '', { author = '' } = {}) {
  const q = clean(query, LIMITS.search).toLowerCase();
  const by = clean(author, LIMITS.author).toLowerCase();
  const where = []; const values = [];
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, c => `\\${c}`)}%`;
    where.push(`(lower(title) LIKE ? ESCAPE '\\' OR lower(author) LIKE ? ESCAPE '\\'
                 OR lower(created_by_name) LIKE ? ESCAPE '\\' OR search_text LIKE ? ESCAPE '\\')`);
    values.push(like, like, like, like);
  }
  if (by) { where.push('lower(author) = ?'); values.push(by); }
  const rows = db.prepare(`
    SELECT * FROM jeopardy_games ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY ${q ? `(lower(title) LIKE ? ESCAPE '\\') DESC, ` : ''}updated_at DESC, id DESC
  `).all(...values, ...(q ? [values[0]] : []));
  return rows.map(r => shape(r, user));
}

// Everyone who has written a game, with how many, for the author filter.
function authors() {
  return db.prepare(`
    SELECT author AS name, COUNT(*) AS games FROM jeopardy_games
     WHERE trim(author) <> '' GROUP BY lower(author) ORDER BY lower(author)
  `).all();
}

function create(user, { title, author, board }) {
  const name = clean(title, LIMITS.title);
  if (!name) return { error: 'Give the game a name' };
  const writer = clean(author, LIMITS.author) || clean(user.name, LIMITS.author);
  const { lastInsertRowid: id } = db.prepare(`
    INSERT INTO jeopardy_games (title, author, board, search_text, created_by, created_by_name) VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, writer, JSON.stringify(board), searchTextOf(board), user.id, user.name || '');
  return { game: get(id, user) };
}

function update(user, id, { title, author, board }) {
  const before = get(id, user);
  if (!before) return { error: 'No such game', status: 404 };
  if (!before.canEdit) return { error: 'Only whoever made this game can change it', status: 403 };
  const sets = []; const values = [];
  if (title !== undefined) {
    const name = clean(title, LIMITS.title);
    if (!name) return { error: 'Give the game a name' };
    sets.push('title = ?'); values.push(name);
  }
  if (author !== undefined) {
    const writer = clean(author, LIMITS.author);
    if (!writer) return { error: 'Say who wrote the game' };
    sets.push('author = ?'); values.push(writer);
  }
  if (board) { sets.push('board = ?', 'search_text = ?'); values.push(JSON.stringify(board), searchTextOf(board)); }
  if (!sets.length) return { error: 'Nothing to change' };
  db.prepare(`UPDATE jeopardy_games SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...values, before.id);
  return { before, game: get(before.id, user) };
}

function remove(user, id) {
  const before = get(id, user);
  if (!before) return { error: 'No such game', status: 404 };
  if (!before.canEdit) return { error: 'Only whoever made this game can delete it', status: 403 };
  db.prepare('DELETE FROM jeopardy_games WHERE id = ?').run(before.id);
  return { before };
}

module.exports = {
  AREA, LIMITS, MAX_FILE_BYTES,
  template, boardFrom, readBoard, searchTextOf,
  canEdit, list, authors, get, create, update, remove,
};
