// Bringing an attendance spreadsheet into Member Attendance.
//
// The sheet this was written for keeps the roll by colouring in cells: one row
// per member, their name on the left, and a column per service date with the
// cell coloured for how they were marked (green for there, say). So the import
// reads it in that shape:
//
//   - the header row is the first row with dates in it, and those cells say
//     which date each column is
//   - the name column is the first column of the header row that is not a date
//   - every row under it with a name is a member, and each date cell is keyed by
//     its fill colour — or, for a cell with no fill, by what is typed in it
//
// Nothing is guessed about what a colour means. The first read (a dry run)
// returns every colour found and every name, matched to the directory where it
// can be; the tracker says which status each colour is and who any unmatched
// name is, and the second read saves it. A mark already on the roll is kept
// unless the tracker asks for the file to win.

const db = require('../db');
const { readWorkbook, serialToIso, columnName } = require('./xlsxReader');
const { parseAnyDate } = require('./contributions');
const attendance = require('./memberAttendance');

// White is what an uncoloured cell looks like, whether or not Excel stored it.
const BLANK_COLOURS = new Set(['#FFFFFF']);

function cellDate(value, date1904) {
  if (typeof value === 'number') return value > 20000 && value < 80000 ? serialToIso(value, date1904) : null;
  return typeof value === 'string' ? parseAnyDate(value) : null;
}

const text = v => (v === null || v === undefined || typeof v === 'boolean' ? '' : String(v).trim());

// A cell's key: its colour, or what is written in it when it has none.
function keyOf(cell) {
  if (!cell) return null;
  if (cell.colour && !BLANK_COLOURS.has(cell.colour)) return cell.colour;
  const t = text(cell.value);
  return t ? `text:${t.toLowerCase()}` : null;
}

// ─── Reading the shape of the sheet ───────────────────────────────────────────

// A title row with one date in it ("Attendance from 1/5/25") is not the
// header: the first row with two or more dates is, or failing that one with one.
function layout(rows, date1904) {
  return headerAt(rows, date1904, 2) || headerAt(rows, date1904, 1);
}

function headerAt(rows, date1904, least) {
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const cells = rows[r] || [];
    const dates = [];
    cells.forEach((cell, col) => {
      const date = cell && cellDate(cell.value, date1904);
      if (date) dates.push({ column: col, letter: columnName(col), date, heading: text(cell.value) || date });
    });
    if (dates.length < least) continue;
    let nameColumn = 0;
    for (let col = 0; col < dates[0].column; col++) {
      if (cells[col] && !cellDate(cells[col].value, date1904)) { nameColumn = col; break; }
    }
    // Headings before the name column, or text headings among the dates
    // (a "Total" column), are not dates and are left out.
    return { headerRow: r, nameColumn, dates: dates.filter(d => d.column > nameColumn) };
  }
  return null;
}

// ─── Who is who ───────────────────────────────────────────────────────────────

const normal = name => String(name || '').toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').replace(/\s+/g, ' ').trim();

// "Archer, Ada" is the same person as "Ada Archer".
function nameForms(name) {
  const s = String(name || '').trim();
  const forms = [normal(s)];
  const comma = s.match(/^([^,]+),\s*(.+)$/);
  if (comma) forms.push(normal(`${comma[2]} ${comma[1]}`));
  return forms;
}

function matcher() {
  const byName = new Map();
  for (const p of attendance.people()) {
    const key = normal(p.name);
    byName.set(key, byName.has(key) ? null : p); // two people with one name match neither
  }
  return name => {
    for (const form of nameForms(name)) {
      const p = byName.get(form);
      if (p) return p;
    }
    return null;
  };
}

// ─── The two reads ────────────────────────────────────────────────────────────

async function readFile(buffer, sheetName) {
  const book = await readWorkbook(buffer);
  if (book.error) return book;
  const visible = book.sheets.filter(s => !s.hidden);
  const sheet = (sheetName && book.sheets.find(s => s.name === sheetName)) || visible[0] || book.sheets[0];
  const shape = layout(sheet.rows, book.date1904);
  if (!shape) return { error: `No row of dates was found on "${sheet.name}". The first row should have the service dates across it, one per column.`, sheets: book.sheets.map(s => s.name), sheet: sheet.name };

  const match = matcher();
  const people = [];
  const keys = new Map();
  for (let r = shape.headerRow + 1; r < sheet.rows.length; r++) {
    const cells = sheet.rows[r] || [];
    const name = text(cells[shape.nameColumn]?.value);
    if (!name || cellDate(cells[shape.nameColumn]?.value, book.date1904)) continue;
    const marks = [];
    for (const d of shape.dates) {
      const key = keyOf(cells[d.column]);
      if (!key) continue;
      marks.push({ date: d.date, key });
      if (!keys.has(key)) {
        const cell = cells[d.column];
        keys.set(key, { key, colour: key.startsWith('#') ? key : null, text: key.startsWith('#') ? '' : text(cell.value), count: 0, sample: text(cell.value) });
      }
      keys.get(key).count++;
    }
    const person = match(name);
    people.push({ row: r + 1, name, personId: person?.id ?? null, matchedName: person?.name ?? null, marks });
  }

  return {
    sheets: book.sheets.map(s => s.name),
    sheet: sheet.name,
    headerRow: shape.headerRow + 1,
    nameColumn: columnName(shape.nameColumn),
    dates: shape.dates.map(({ letter, date, heading }) => ({ column: letter, date, heading })),
    keys: [...keys.values()].sort((a, b) => b.count - a.count),
    people,
  };
}

// What the import would do, or does: { keyMap: { key: statusId }, personMap:
// { row: personId | '' }, service, overwrite }.
function plan(file, { service, keyMap = {}, personMap = {}, overwrite = false }) {
  const name = service ? db.prepare('SELECT name FROM service_types WHERE lower(name) = lower(?)').get(String(service).trim())?.name : null;
  const statuses = new Map(attendance.statuses().filter(s => s.active).map(s => [s.id, s]));
  const known = new Set(db.prepare('SELECT id FROM directory').all().map(p => p.id));
  const existing = new Map(
    name ? db.prepare('SELECT person_id, date, status_id FROM member_attendance WHERE service = ?').all(name).map(m => [`${m.person_id}|${m.date}`, m.status_id]) : [],
  );

  const writes = [];
  const counts = { add: 0, replace: 0, same: 0, keep: 0, unmapped: 0, unmatchedPeople: 0, skippedPeople: 0 };
  const seen = new Set();
  for (const p of file.people) {
    const chosen = Object.prototype.hasOwnProperty.call(personMap, p.row) ? personMap[p.row] : p.personId;
    if (chosen === '' || chosen === null || chosen === undefined) {
      counts[p.personId === null && !Object.prototype.hasOwnProperty.call(personMap, p.row) ? 'unmatchedPeople' : 'skippedPeople']++;
      continue;
    }
    const personId = Number(chosen);
    if (!known.has(personId)) { counts.unmatchedPeople++; continue; }
    for (const m of p.marks) {
      const status = statuses.get(Number(keyMap[m.key]));
      if (!status) { counts.unmapped++; continue; }
      const id = `${personId}|${m.date}`;
      if (seen.has(id)) continue; // the same person twice on the sheet: the first row wins
      seen.add(id);
      const before = existing.get(id);
      if (before === status.id) counts.same++;
      else if (before !== undefined && !overwrite) counts.keep++;
      else {
        counts[before === undefined ? 'add' : 'replace']++;
        writes.push({ personId, date: m.date, statusId: status.id });
      }
    }
  }
  return { service: name, counts, writes };
}

const save = db.transaction((writes, service, user) => {
  const upsert = db.prepare(`
    INSERT INTO member_attendance (person_id, date, service, status_id, user_id, user_name, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT (person_id, date, service) DO UPDATE SET
      status_id = excluded.status_id, user_id = excluded.user_id,
      user_name = excluded.user_name, updated_at = excluded.updated_at
  `);
  for (const w of writes) upsert.run(w.personId, w.date, service, w.statusId, user?.id ?? null, user?.name || '');
});

module.exports = { readFile, plan, save, keyOf, layout, nameForms };
