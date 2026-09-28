// ─── Weekly contribution totals from a spreadsheet ───────────────────────────
//
// The old church-management site exports its finances as a CSV: a heading row
// or two ("Income / Giving", "Expenses / Other"), one row per Sunday, and a
// totals row at the bottom. Other exports put the columns in another order or
// call them something else, so the date and amount columns are found by what
// they are headed and what they hold rather than by position — "Giving |
// Other | Total Expenses" must give the giving, not the last money cell in the
// row. One total a week, never a per-giver ledger.

// ─── CSV ──────────────────────────────────────────────────────────────────────

// RFC 4180: quoted fields may hold commas ("$4,978.00"), line breaks and
// doubled quotes. A byte-order mark from Excel is dropped.
function parseCsv(text) {
  const s = String(text ?? '').replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }

  return rows
    .map(r => r.map(c => c.trim()))
    .filter(r => r.some(Boolean));
}

// ─── Dates and money ──────────────────────────────────────────────────────────

const MONTH_INDEX = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

function isoDate(year, month, day) {
  const y = year < 100 ? 2000 + year : year;
  if (y < 1990 || y > 2100 || month < 0 || month > 11 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(y, month, day));
  if (d.getUTCMonth() !== month) return null;
  return `${y}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function monthIndex(word) {
  const w = word.toLowerCase();
  return MONTH_INDEX[w.slice(0, 4)] ?? MONTH_INDEX[w.slice(0, 3)];
}

// "2026-09-21", "9/21/2026", "10/03/21", "Sep 21, 2026", "21 Sep 2026" — as
// ISO, so a week imported and the same week typed in by hand are one week.
function parseAnyDate(text) {
  const s = String(text ?? '').trim();
  let m;
  if ((m = s.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/))) return isoDate(+m[1], +m[2] - 1, +m[3]);
  if ((m = s.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})\b/))) return isoDate(+m[3], +m[1] - 1, +m[2]);
  if ((m = s.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/))) {
    const month = monthIndex(m[1]);
    if (month !== undefined) return isoDate(+m[3], month, +m[2]);
  }
  if ((m = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/))) {
    const month = monthIndex(m[2]);
    if (month !== undefined) return isoDate(+m[3], month, +m[1]);
  }
  return null;
}

// "$4,978.00", "4978", "$ 4,978", "(120.00)", "-$120", "4,978.00 USD".
function parseMoney(text) {
  let s = String(text ?? '').replace(/ /g, ' ').trim();
  if (!s || parseAnyDate(s)) return null;
  const negative = /^\(.*\)$/.test(s) || /^-/.test(s) || /^\$\s*-/.test(s);
  s = s.replace(/^\(|\)$/g, '').replace(/\busd\b/i, '').replace(/[$\s,]/g, '').replace(/^-/, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = parseFloat(s);
  return negative ? -n : n;
}

function roundCents(n) {
  return Math.round(n * 100) / 100;
}

// ─── Which column is which ────────────────────────────────────────────────────

const DATE_HEADER_RE       = /\b(date|week|sunday|period|day)\b/i;
const NOT_AMOUNT_HEADER_RE = /\b(budget|goal|need(ed)?|diff(erence)?|over|under|variance|short(fall)?|ytd|year.to.date|average|avg|expenses?|spent|balance|attendance|count|per.capita|pledged?|%|percent)\b/i;

// How strongly a heading says "this is what was given". Zero means it does not.
function amountHeaderScore(text) {
  const s = String(text ?? '');
  if (NOT_AMOUNT_HEADER_RE.test(s) || s.includes('%')) return 0;
  if (/\b(giving|given|collections?|contributions?|offerings?|tithes?)\b/i.test(s)) return 4;
  if (/\b(income|received|receipts|deposits?|actual)\b/i.test(s)) return 3;
  if (/\bamount\b/i.test(s)) return 2;
  if (/\btotal\b/i.test(s)) return 1;
  return 0;
}

/**
 * Weekly totals out of rows of cells.
 *
 * The heading is every leading row that holds no date, read down each column
 * — so an export that heads a column "Income" on one row and "Giving" on the
 * next is read as "Income Giving". A week listed once per fund is added up,
 * unless one of its rows is that week's own total. A row with no date but an
 * amount is the file's totals row, kept to check the import against.
 */
function readContributionRows(rows) {
  const headerRows = [];
  for (const r of rows.slice(0, 3)) {
    if (r.some(c => parseAnyDate(c))) break;
    headerRows.push(r);
  }
  const body   = rows.slice(headerRows.length);
  const width  = Math.max(0, ...rows.map(r => r.length));
  const header = Array.from({ length: width }, (_, i) =>
    headerRows.map(r => r[i] ?? '').filter(Boolean).join(' '));

  const share = (col, test) => {
    const cells = body.map(r => r[col] ?? '').filter(Boolean);
    return cells.length ? cells.filter(test).length / cells.length : 0;
  };

  let dateCol = header.findIndex((h, i) => DATE_HEADER_RE.test(h) && share(i, v => !!parseAnyDate(v)) >= 0.5);
  if (dateCol < 0) {
    for (let i = 0; i < width; i++) if (share(i, v => !!parseAnyDate(v)) >= 0.5) { dateCol = i; break; }
  }
  if (dateCol < 0) return { records: [], error: 'No column of dates was found.' };

  let amountCol = -1;
  let best = 0;
  header.forEach((h, i) => {
    const score = amountHeaderScore(h);
    if (i !== dateCol && score > best && share(i, v => parseMoney(v) !== null) >= 0.5) {
      best = score;
      amountCol = i;
    }
  });
  // No heading says which column was given: the first column that reads as
  // money — with a dollar sign or cents, so a count is not taken for one — and
  // is not headed as a budget, an expense or a running total.
  if (amountCol < 0) {
    for (let i = 0; i < width; i++) {
      if (i === dateCol || NOT_AMOUNT_HEADER_RE.test(header[i]) || header[i].includes('%')) continue;
      if (share(i, v => parseMoney(v) !== null && /\$|\.\d{2}\b/.test(v)) >= 0.5) { amountCol = i; break; }
    }
  }
  if (amountCol < 0) return { records: [], error: 'No column of amounts given was found.' };

  const byDate = new Map();
  let statedTotal = null;
  let unreadable  = 0;
  for (const row of body) {
    const date   = parseAnyDate(row[dateCol] ?? '');
    const amount = parseMoney(row[amountCol] ?? '');
    if (!date) {
      if (amount !== null) statedTotal = amount;
      continue;
    }
    if (amount === null) { unreadable++; continue; }
    const isTotal = /\btotal\b/i.test(row.filter((_, i) => i !== dateCol && i !== amountCol).join(' '));
    const seen = byDate.get(date);
    if (!seen || (isTotal && !seen.isTotal)) byDate.set(date, { amount, isTotal });
    else if (!isTotal && !seen.isTotal) seen.amount = roundCents(seen.amount + amount);
  }

  const records = [...byDate]
    .map(([date, v]) => ({ date, amount: v.amount }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    records,
    dateColumn:   header[dateCol] || `column ${dateCol + 1}`,
    amountColumn: header[amountCol] || `column ${amountCol + 1}`,
    statedTotal,
    unreadable,
  };
}

/**
 * Everything the import needs to say about a CSV before anything is saved:
 * the weeks it holds, which columns they came from, and whether they add up
 * to the file's own total.
 */
function parseContributionsCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) return { records: [], warnings: [], error: 'The file is empty.' };

  const read = readContributionRows(rows);
  if (read.error) return { ...read, warnings: [] };

  const warnings = [];
  const total = roundCents(read.records.reduce((s, r) => s + r.amount, 0));
  if (read.statedTotal !== null && Math.abs(read.statedTotal - total) >= 0.01) {
    warnings.push(`The weeks read add up to $${total.toFixed(2)}, but the file's own total is $${read.statedTotal.toFixed(2)}.`);
  }
  if (read.unreadable) {
    warnings.push(`${read.unreadable} dated row(s) had no amount that could be read, and were left out.`);
  }
  return { ...read, total, warnings };
}

module.exports = { parseCsv, parseAnyDate, parseMoney, readContributionRows, parseContributionsCsv };
