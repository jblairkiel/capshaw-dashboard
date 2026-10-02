// Bringing attendance spreadsheets into Member Attendance.
//
// The roll has been kept in Excel by colouring in cells, and two shapes of
// sheet are read:
//
//   roster — one sheet per service date, the way the church's own sheet is
//     laid out: the date typed near the top ("10 04 2026"), a legend of what
//     each colour means ("Green = Present", each in a cell of that colour),
//     then side-by-side blocks of First Name / Last Name columns with a person
//     per row. The person's name cells are coloured for how they were marked;
//     a name left uncoloured is listed as "no colour", which the legend does
//     not mention and so most likely means absent. When the date is not on
//     the sheet, the file name ("Attendance_10_04_2026.xlsx") or the sheet's
//     name is used, and the tracker can type it in.
//
//   grid — one row per member with their name on the left and a column per
//     date, each cell coloured (or, with no colour, typed in).
//
// Several files are read at once, so a run of old weekly sheets comes in
// together. Every roster sheet in a file is read; a grid workbook is read one
// sheet at a time.
//
// The first read (a dry run) returns every colour found with what the legend
// says it is and the status that looks like it, and every name matched to the
// directory where it can be. The tracker confirms which status each colour
// is and who any unmatched name is, and the second read saves it. A mark
// already on the roll is kept unless the tracker asks for the file to win.

const db = require('../db');
const { readWorkbook, serialToIso, columnName } = require('./xlsxReader');
const { parseAnyDate } = require('./contributions');
const attendance = require('./memberAttendance');

// White is what an uncoloured cell looks like, whether or not Excel stored it.
const BLANK_COLOURS = new Set(['#FFFFFF']);
const NONE = 'none';

const text = v => (v === null || v === undefined || typeof v === 'boolean' ? '' : String(v).trim());
const fill = cell => (cell?.colour && !BLANK_COLOURS.has(cell.colour) ? cell.colour : null);

// ─── Dates ────────────────────────────────────────────────────────────────────

// "10/04/2026", "Oct 4, 2026", and the sheet's own "10 04 2026" or a file
// called "Attendance_10_04_2026.xlsx".
function dateFromText(value) {
  const s = text(value);
  if (!s) return null;
  const direct = parseAnyDate(s);
  if (direct) return direct;
  const m = s.match(/(?:^|\D)(\d{1,2})[\s_.-]+(\d{1,2})[\s_.-]+(\d{4}|\d{2})(?:\D|$)/);
  return m ? parseAnyDate(`${m[1]}/${m[2]}/${m[3]}`) : null;
}

function cellDate(value, date1904) {
  if (typeof value === 'number') return value > 20000 && value < 80000 ? serialToIso(value, date1904) : null;
  return dateFromText(value);
}

// ─── Names ────────────────────────────────────────────────────────────────────

const normal = name => String(name || '').toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').replace(/\s+/g, ' ').trim();

// "Archer, Ada" is the same person as "Ada Archer".
function nameForms(name) {
  const s = String(name || '').trim();
  const forms = [normal(s)];
  const comma = s.match(/^([^,]+),\s*(.+)$/);
  if (comma) forms.unshift(normal(`${comma[2]} ${comma[1]}`));
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

// ─── What a colour means ──────────────────────────────────────────────────────

const COLOUR_WORDS = /^(green|blue|orange|yellow|red|pink|purple|grey|gray|white|black|brown|teal|light \w+|dark \w+)$/i;

// "Green = Present" (or "Present = Green") in a filled cell.
function legendEntry(cell) {
  const colour = fill(cell);
  const t = text(cell?.value);
  const m = t.match(/^(.+?)\s*=\s*(.+)$/) || t.match(/^(.+?)\s*[:–]\s*(.+)$/);
  if (!colour || !m) return null;
  const [a, b] = [m[1].trim(), m[2].trim()];
  if (COLOUR_WORDS.test(b) && !COLOUR_WORDS.test(a)) return { colour, name: b, label: a };
  return { colour, name: a, label: b };
}

const STOP = new Set(['or', 'of', 'the', 'and', 'a', 'an', 'at', 'in', 'is']);
const words = s => new Set(normal(s).split(/[\s/-]+/).filter(w => w && !STOP.has(w)));

// The status a legend label most looks like: "Sick or Caregiver" is Sick,
// "Out Town" is Out of town. Nothing when no status shares a word with it.
function statusLike(label, statuses) {
  const want = words(label);
  let best = null, bestScore = 0;
  for (const s of statuses) {
    const have = words(s.label);
    const shared = [...have].filter(w => want.has(w)).length;
    const covers = shared === have.size || shared === want.size;
    const score = covers ? shared : 0;
    if (score > bestScore) { best = s; bestScore = score; }
  }
  return best;
}

const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const distance = (a, b) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]));

// ─── Reading one sheet ────────────────────────────────────────────────────────

// The row of First Name / Last Name headings, and the column pairs it sets out.
function rosterHeader(rows) {
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const cells = rows[r] || [];
    const blocks = [];
    cells.forEach((cell, c) => {
      if (/^first(\s*name)?$/i.test(text(cell?.value)) && /^(last|sur)(\s*name)?$/i.test(text(cells[c + 1]?.value))) blocks.push({ first: c, last: c + 1 });
    });
    if (blocks.length) return { row: r, blocks };
  }
  return null;
}

function readRoster(sheet, header, { date1904, fileDate }) {
  let found = null;
  const legend = [];
  for (let r = 0; r < header.row; r++) {
    for (const cell of sheet.rows[r] || []) {
      if (!cell) continue;
      const entry = legendEntry(cell);
      if (entry) legend.push(entry);
      else found ||= cellDate(cell.value, date1904);
    }
  }
  const date = found || fileDate || dateFromText(sheet.name);

  const entries = [];
  for (let r = header.row + 1; r < sheet.rows.length; r++) {
    const cells = sheet.rows[r] || [];
    for (const { first, last } of header.blocks) {
      const name = [text(cells[first]?.value), text(cells[last]?.value)].filter(Boolean).join(' ');
      if (!name) continue;
      entries.push({ name, where: `${columnName(first)}${r + 1}`, cells: [{ date, key: fill(cells[first]) || fill(cells[last]) || NONE }] });
    }
  }
  return { layout: 'roster', dates: date ? [date] : [], dateFound: !!found, legend, entries };
}

// A title row with one date in it is not the header: the first row with two
// or more dates is, or failing that one with one.
function gridHeader(rows, date1904) {
  for (const least of [2, 1]) {
    for (let r = 0; r < Math.min(rows.length, 30); r++) {
      const cells = rows[r] || [];
      const dates = [];
      cells.forEach((cell, col) => {
        const date = cell && cellDate(cell.value, date1904);
        if (date) dates.push({ column: col, date });
      });
      if (dates.length < least) continue;
      let nameColumn = 0;
      for (let col = 0; col < dates[0].column; col++) {
        if (cells[col] && !cellDate(cells[col].value, date1904)) { nameColumn = col; break; }
      }
      return { row: r, nameColumn, dates: dates.filter(d => d.column > nameColumn) };
    }
  }
  return null;
}

function readGrid(sheet, header, { date1904 }) {
  const entries = [];
  for (let r = header.row + 1; r < sheet.rows.length; r++) {
    const cells = sheet.rows[r] || [];
    const name = text(cells[header.nameColumn]?.value);
    if (!name || cellDate(cells[header.nameColumn]?.value, date1904)) continue;
    const marks = [];
    for (const d of header.dates) {
      const cell = cells[d.column];
      const t = text(cell?.value);
      const key = fill(cell) || (t ? `text:${t.toLowerCase()}` : null);
      if (key) marks.push({ date: d.date, key, text: t });
    }
    entries.push({ name, where: `${columnName(header.nameColumn)}${r + 1}`, cells: marks });
  }
  return {
    layout: 'grid', dates: header.dates.map(d => d.date), dateFound: true, legend: [], entries,
    nameColumn: columnName(header.nameColumn), headerRow: header.row + 1,
  };
}

// ─── Reading the files ────────────────────────────────────────────────────────

// files: [{ buffer, name }]. options.sheet picks the sheet of a single grid
// workbook; options.dateMap gives a roster page ({ "file#sheet": date }) the
// date its sheet does not say.
async function readFiles(files, { sheet: wanted = '', dateMap = {} } = {}) {
  const pages = [];
  let sheets = [];
  for (const [index, file] of files.entries()) {
    const book = await readWorkbook(file.buffer);
    const label = file.name || `File ${index + 1}`;
    if (book.error) { pages.push({ id: `${index}#`, file: label, sheet: '', problem: book.error }); continue; }
    const visible = book.sheets.filter(s => !s.hidden);
    const fileDate = dateFromText(label);

    const rosters = visible.map(s => ({ s, header: rosterHeader(s.rows) })).filter(x => x.header);
    if (rosters.length) {
      for (const { s, header } of rosters) {
        const id = `${index}#${s.name}`;
        const read = readRoster(s, header, { date1904: book.date1904, fileDate });
        const override = dateFromText(dateMap[id]);
        if (override) {
          read.dates = [override];
          read.entries.forEach(e => e.cells.forEach(c => { c.date = override; }));
        }
        pages.push({ id, file: label, sheet: s.name, ...read, problem: read.dates.length ? null : 'No date found on this sheet. Enter it.' });
      }
      continue;
    }

    // A grid: one sheet, the one asked for or the first that is visible.
    if (files.length === 1) sheets = book.sheets.map(s => s.name);
    const s = (wanted && book.sheets.find(x => x.name === wanted)) || visible[0] || book.sheets[0];
    const header = gridHeader(s.rows, book.date1904);
    pages.push(header
      ? { id: `${index}#${s.name}`, file: label, sheet: s.name, ...readGrid(s, header, { date1904: book.date1904 }), problem: null }
      : { id: `${index}#${s.name}`, file: label, sheet: s.name, layout: 'unknown', dates: [], legend: [], entries: [],
        problem: `"${s.name}" is not laid out in a way the import knows. It needs First Name / Last Name columns, or a row of dates across the top.` });
  }

  // The legend, once per colour, across every page.
  const legend = new Map();
  for (const p of pages) for (const e of p.legend || []) if (!legend.has(e.colour)) legend.set(e.colour, e);

  // Everybody, once each across every page: the same name on two sheets is one person.
  const match = matcher();
  const people = new Map();
  const keys = new Map();
  for (const p of pages) {
    for (const e of p.entries || []) {
      const id = nameForms(e.name)[0];
      if (!people.has(id)) {
        const person = match(e.name);
        people.set(id, { key: id, name: e.name, where: `${p.sheet || p.file} ${e.where}`, personId: person?.id ?? null, matchedName: person?.name ?? null, marks: [] });
      }
      for (const c of e.cells) {
        if (!c.date) continue;
        people.get(id).marks.push({ date: c.date, key: c.key });
        if (!keys.has(c.key)) {
          keys.set(c.key, {
            key: c.key,
            colour: c.key.startsWith('#') ? c.key : null,
            text: c.key.startsWith('text:') ? c.text : '',
            none: c.key === NONE,
            count: 0,
          });
        }
        keys.get(c.key).count++;
      }
    }
  }

  const statuses = attendance.statuses().filter(s => s.active);
  const absent = statuses.find(s => normal(s.label) === 'absent') || null;
  for (const k of keys.values()) {
    if (k.colour) {
      const exact = legend.get(k.colour);
      const near = exact || [...legend.values()]
        .map(l => ({ l, d: distance(l.colour, k.colour) }))
        .filter(x => x.d < 90)
        .sort((a, b) => a.d - b.d)[0]?.l;
      if (near) {
        k.legend = `${near.name} = ${near.label}`;
        k.approximate = !exact;
        k.suggest = statusLike(near.label, statuses)?.id ?? null;
        k.legendLabel = near.label;
      }
    } else if (k.none) {
      k.suggest = absent?.id ?? null;
    } else {
      k.suggest = statusLike(k.text, statuses)?.id ?? null;
    }
  }

  const dates = [...new Set(pages.flatMap(p => p.dates || []))].sort();
  return {
    pages: pages.map(({ entries, legend: l, ...p }) => ({ ...p, people: entries?.length ?? 0 })),
    sheets,
    sheet: pages.length === 1 ? pages[0].sheet : '',
    dates,
    legend: [...legend.values()],
    keys: [...keys.values()].sort((a, b) => b.count - a.count),
    people: [...people.values()],
  };
}

// What the import would do, or does: { keyMap: { key: statusId }, personMap:
// { personKey: personId | '' }, service, overwrite }.
function plan(file, { service, keyMap = {}, personMap = {}, overwrite = false }) {
  const name = service ? db.prepare('SELECT name FROM service_types WHERE lower(name) = lower(?)').get(String(service).trim())?.name : null;
  const statuses = new Map(attendance.statuses().filter(s => s.active).map(s => [s.id, s]));
  const known = new Set(db.prepare('SELECT id FROM directory').all().map(p => p.id));
  const existing = new Map(
    name ? db.prepare('SELECT person_id, date, status_id FROM member_attendance WHERE service = ?').all(name).map(m => [`${m.person_id}|${m.date}`, m.status_id]) : [],
  );
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  const writes = [];
  const counts = { add: 0, replace: 0, same: 0, keep: 0, unmapped: 0, unmatchedPeople: 0, skippedPeople: 0 };
  const seen = new Set();
  for (const p of file.people) {
    const chosen = has(personMap, p.key) ? personMap[p.key] : p.personId;
    if (chosen === '' || chosen === null || chosen === undefined) {
      counts[p.personId === null && !has(personMap, p.key) ? 'unmatchedPeople' : 'skippedPeople']++;
      continue;
    }
    const personId = Number(chosen);
    if (!known.has(personId)) { counts.unmatchedPeople++; continue; }
    for (const m of p.marks) {
      const status = statuses.get(Number(keyMap[m.key]));
      if (!status) { counts.unmapped++; continue; }
      const id = `${personId}|${m.date}`;
      if (seen.has(id)) continue; // the same person twice: the first one read wins
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

module.exports = { readFiles, plan, save, dateFromText, nameForms, statusLike, legendEntry, NONE };
