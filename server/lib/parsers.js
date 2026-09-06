// ─── HTML helpers ─────────────────────────────────────────────────────────────

function stripTags(str) {
  return str
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&bull;/g, '•').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&laquo;/g, '«')
    .replace(/&raquo;/g, '»').replace(/&lsaquo;/g, '‹').replace(/&rsaquo;/g, '›')
    .replace(/&#\d+;/g, '').replace(/&[a-z]+;/g, '')
    .replace(/\s+/g, ' ').trim();
}

function extractTables(html) {
  return [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map(t => {
    const rows = [...t[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)];
    return rows.map(row =>
      [...row[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
        .map(c => stripTags(c[1])).filter(Boolean)
    ).filter(r => r.length > 0);
  });
}

// Same, but keeps empty cells so a row's shape survives. Blank cells are
// meaningful in the job-assignment tables: a continuation row leaves the date
// column empty, and an unfilled slot leaves the name empty.
function extractTablesPreservingCells(html) {
  return [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map(t => {
    const rows = [...t[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)];
    return rows.map(row =>
      [...row[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => stripTags(c[1]))
    ).filter(r => r.some(Boolean));
  });
}

// ─── Page parsers ─────────────────────────────────────────────────────────────

// ─── Job assignments ──────────────────────────────────────────────────────────
// The church site renders this table in more than one shape, so the parser
// recognises each rather than assuming one layout:
//
//   a) a date header row  [ "April 6", "Service", "Job", "Name" ]
//      followed by 3-cell rows  [ service, job, name ]
//   b) a date in the first column [ "April 6", service, job, name ], left
//      blank on continuation rows
//   c) a standalone date row  [ "April 6" ] (often a colspan) then 3-cell rows
//
// A row that matches none of these is skipped rather than throwing, and the
// caller can tell a genuinely empty page from a parse miss by the row count.

const MONTH_NAMES = 'January|February|March|April|May|June|July|August|September|October|November|December';
const MONTH_ABBR  = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec';

// "April 6", "Apr 6", "Sunday, April 6, 2025", "4/6", "4/6/25"
const DATE_RE = new RegExp(
  '^(?:(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)[a-z]*,?\\s*)?(?:' +
    // "April 6", "Apr. 6", optionally with a year
    `(?:${MONTH_NAMES}|${MONTH_ABBR})\\.?\\s+\\d{1,2}(?:[,\\s]+\\d{2,4})?` +
  '|' +
    // "4/6", "4/6/25"
    '\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?' +
  ')$',
  'i'
);

const COLUMN_HEADINGS = new Set(['date', 'service', 'job', 'name', 'assignment', 'position', 'person']);

function looksLikeDate(cell) {
  return DATE_RE.test((cell || '').trim());
}

function isColumnHeaderRow(cells) {
  const filled = cells.filter(Boolean).map(c => c.toLowerCase());
  return filled.length > 0 && filled.every(c => COLUMN_HEADINGS.has(c));
}

// Prefer the table that actually holds assignments over whichever is longest —
// CMS pages often wrap everything in a bigger layout table.
function scoreAssignmentTable(rows) {
  let score = 0;
  for (const row of rows) {
    const lower = row.map(c => (c || '').toLowerCase());
    if (lower.includes('service') && (lower.includes('job') || lower.includes('name'))) score += 10;
    if (row.some(looksLikeDate)) score += 2;
    if (row.filter(Boolean).length === 3) score += 1;
  }
  return score;
}

function parseJobAssignments(html) {
  const tables = extractTablesPreservingCells(html);
  const mMatch = html.match(new RegExp(`>\\s*((?:${MONTH_NAMES})\\s+\\d{4})\\s*<`));
  const month  = mMatch ? mMatch[1] : '';

  if (!tables.length) return { month, assignments: [] };

  const best = tables
    .map(rows => ({ rows, score: scoreAssignmentTable(rows) }))
    .sort((a, b) => b.score - a.score || b.rows.length - a.rows.length)[0];
  const main = best.rows;

  const assignments = [];
  let currentDate = '';

  for (const row of main) {
    const filled = row.filter(Boolean);

    // (a) date header row: a date plus the column captions.
    if (row.some(looksLikeDate) && row.some(c => (c || '').toLowerCase() === 'service')) {
      currentDate = row.find(looksLikeDate).trim();
      continue;
    }

    // (c) a row that is only a date.
    if (filled.length === 1 && looksLikeDate(filled[0])) {
      currentDate = filled[0].trim();
      continue;
    }

    if (isColumnHeaderRow(row)) continue;

    // (b) date in the first column, blank on continuation rows.
    if (row.length >= 4) {
      const [first, ...rest] = row;
      if (looksLikeDate(first)) currentDate = first.trim();
      if (first === '' || looksLikeDate(first)) {
        const [service, job, name] = rest;
        if (currentDate && (job || name)) {
          assignments.push({ date: currentDate, service: service || '', job: job || '', name: name || '' });
        }
        continue;
      }
    }

    // Plain data row: service, job, name.
    if (row.length === 3 && currentDate) {
      const [service, job, name] = row;
      if (job || name) {
        assignments.push({ date: currentDate, service: service || '', job: job || '', name: name || '' });
      }
    }
  }

  return { month, assignments };
}

function parseAttendance(html) {
  const records = [];
  for (const table of extractTables(html)) {
    for (const row of table) {
      if (row[0] === 'Date') continue;
      if (row.length >= 3 && row[0].match(/\d{2}\/\d{2}\/\d{2}/)) {
        records.push({ date: row[0], service: row[1], count: parseInt(row[2], 10) || 0 });
      }
    }
  }
  return records.sort((a, b) => b.date.localeCompare(a.date));
}

function parseSermons(html) {
  const sermons = [];
  for (const table of extractTables(html)) {
    for (const row of table) {
      if (row[0] === 'Date') continue;
      if (row.length >= 4 && row[0].match(/\d{2}\/\d{2}\/\d{2}/)) {
        sermons.push({ date: row[0], title: row[1], speaker: row[2], type: row[3] || '', series: row[4] || '', service: row[5] || '' });
      }
    }
  }
  return sermons;
}

function parseVisitors(html) {
  const visitors = [];
  for (const sec of [...html.matchAll(/<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>[\s\S]*?(<table[\s\S]*?<\/table>)/gi)]) {
    const name = stripTags(sec[1]);
    if (name === 'Visitor Tracker') continue;
    const visits = (extractTables(sec[2])[0] || [])
      .filter(r => r[0] !== 'Date' && r[0]?.match(/\d{2}\/\d{2}\/\d{2}/))
      .map(r => ({ date: r[0], service: r[1] || '' }));
    if (visits.length > 0) visitors.push({ name, visits });
  }
  return visitors;
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function parseAnniversaries(html) {
  const tables = extractTables(html);
  const main   = tables.sort((a, b) => b.length - a.length)[0] || [];
  const entries = [];
  let currentMonth = '';
  for (const row of main) {
    if (row.length === 1 && MONTHS.includes(row[0])) {
      currentMonth = row[0];
    } else if (row.length === 2 && currentMonth && row[0].match(/^\d+\/\d+/)) {
      const [m, d] = row[0].split('/').map(Number);
      entries.push({ month: currentMonth, date: row[0], names: row[1], monthNum: m, day: d });
    }
  }
  return entries;
}

function parseDeacons(html) {
  const SKIP = new Set(['Our Deacons', 'Their Duties', 'Deacons', 'Capshaw', 'Sunday', 'Wednesday', 'YouTube', 'Menu']);
  const deacons = [];
  const bodyStart = html.indexOf('Our Deacons');
  const bodyContent = bodyStart > -1 ? html.slice(bodyStart) : html;
  const parts = bodyContent.split(/<strong[^>]*>/i);
  for (const part of parts) {
    const nameMatch = part.match(/^([^<]{4,50})<\/strong>/i);
    if (!nameMatch) continue;
    const name = stripTags(nameMatch[1]);
    if (!name || SKIP.has(name) || name.includes('Duties') || name.includes('shepherds') || name.length > 50) continue;
    const duties = [...part.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
      .map(m => stripTags(m[1]))
      .filter(d => d.length > 5 && d.length < 120 && !d.includes('Bible Study') && !d.includes('YouTube'));
    if (duties.length > 0) deacons.push({ name, duties });
  }
  return deacons;
}

function parseBulletins(html) {
  const section = html.match(/Capshaw Bulletin([\s\S]*?)(?:Member News|<h[1-4])/i)?.[1] || '';
  return [...section.matchAll(/href="([^"]+\.pdf[^"]*)"[^>]*>\s*([^<]+)/gi)]
    .map(m => ({ url: m[1], label: stripTags(m[2]).trim() }))
    .filter(b => b.label && b.label.length > 3);
}

// Parse vCard 2.1 export from /members/directory/vcard
// vCard photos come either inline as base64 or as a URL, with the encoding
// spelled several different ways depending on the exporter. Returns null when
// there is no usable photo.
function parseVCardPhoto(props) {
  const key = Object.keys(props).find(k => k.startsWith('PHOTO'));
  if (!key) return null;

  const raw = (props[key][0] || '').trim();
  if (!raw) return null;

  const mimeFromKey = key.match(/TYPE=([\w/+.-]+)/i)?.[1];
  const toMime = t => {
    if (!t) return 'image/jpeg';
    const lower = t.toLowerCase();
    return lower.startsWith('image/') ? lower : `image/${lower === 'jpg' ? 'jpeg' : lower}`;
  };

  // vCard 4.0 data URI: PHOTO:data:image/jpeg;base64,....
  const dataUri = raw.match(/^data:([\w/+.-]+);base64,(.*)$/i);
  if (dataUri) return { base64: dataUri[2], mime: dataUri[1].toLowerCase(), url: null };

  // A plain URL: PHOTO;VALUE=URI:https://...
  if (/^https?:\/\//i.test(raw)) return { base64: null, mime: toMime(mimeFromKey), url: raw };

  // vCard 3.0 inline: PHOTO;ENCODING=b;TYPE=JPEG:<base64>
  if (/ENCODING=(b|base64)/i.test(key)) {
    const base64 = raw.replace(/\s+/g, '');
    return base64 ? { base64, mime: toMime(mimeFromKey), url: null } : null;
  }

  return null;
}

function parseDirectory(vcf) {
  const members = [];
  // Unfold continuation lines (CRLF/LF + whitespace = folded)
  const text = vcf.replace(/\r\n|\r/g, '\n').replace(/\n[ \t]/g, '');
  const blocks = text.split(/\n(?=BEGIN:VCARD)/i).filter(b => /BEGIN:VCARD/i.test(b));

  for (const block of blocks) {
    const props = {};
    for (const line of block.split('\n')) {
      if (/^BEGIN:|^END:/i.test(line.trim())) continue;
      const ci = line.indexOf(':');
      if (ci < 0) continue;
      const key = line.slice(0, ci).toUpperCase();
      const val = line.slice(ci + 1).trim();
      if (!props[key]) props[key] = [];
      props[key].push(val);
    }

    const fn = (props['FN'] || [])[0] || '';
    if (!fn) continue;

    const adrKey = Object.keys(props).find(k => k.startsWith('ADR'));
    let street = '', city = '', state = '', zip = '';
    if (adrKey) {
      const parts = (props[adrKey][0] || '').split(';');
      street = parts[2] || '';
      city   = parts[3] || '';
      state  = parts[4] || '';
      zip    = parts[5] || '';
    }

    const cellKey = Object.keys(props).find(k => k.startsWith('TEL') && k.includes('CELL'));
    const homeKey = Object.keys(props).find(k => k.startsWith('TEL') && !k.includes('CELL'));
    const emailKey = Object.keys(props).find(k => k.startsWith('EMAIL'));

    members.push({
      name:    fn,
      address: street,
      city,
      state,
      zip,
      phone:   homeKey  ? (props[homeKey][0]  || '') : '',
      cell:    cellKey  ? (props[cellKey][0]  || '') : '',
      email:   emailKey ? (props[emailKey][0] || '') : '',
      notes:   '',
      photo:   parseVCardPhoto(props),
    });
  }

  return members;
}

module.exports = {
  stripTags,
  extractTables,
  extractTablesPreservingCells,
  parseJobAssignments,
  parseAttendance,
  parseSermons,
  parseVisitors,
  parseAnniversaries,
  parseDeacons,
  parseBulletins,
  parseDirectory,
  parseVCardPhoto,
};
