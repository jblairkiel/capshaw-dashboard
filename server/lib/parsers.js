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
//   d) the date given as a heading (h2/h3/p/…) immediately before the table
//      rather than as a row inside it — common when each date gets its own
//      small table:  <h3>April 6</h3><table>service/job/name rows</table>
//
// A row that matches none of these is skipped rather than throwing, and the
// caller can tell a genuinely empty page from a parse miss by the row count.
// Every table on the page is walked independently (not just "the" biggest
// one) so shape (d)'s one-table-per-date layout is handled the same way as a
// single table holding a whole month — a table that turns out to hold none
// of these shapes simply contributes nothing.

const MONTH_NAMES = 'January|February|March|April|May|June|July|August|September|October|November|December';
const MONTH_ABBR  = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec';

// "April 6", "Apr 6", "Sunday, April 6, 2025", "4/6", "4/6/25"
// The (?!\d) guards stop the day/month digits from partial-matching inside a
// longer number — without it, "April 2025" (a month-year heading, not a day)
// matches as "April 20" followed by an unconsumed "25".
const DATE_CORE =
  '(?:(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)[a-z]*,?\\s*)?(?:' +
    // "April 6", "Apr. 6", optionally with a year
    `(?:${MONTH_NAMES}|${MONTH_ABBR})\\.?\\s+\\d{1,2}(?!\\d)(?:[,\\s]+\\d{2,4})?` +
  '|' +
    // "4/6", "4/6/25"
    '\\d{1,2}(?!\\d)/\\d{1,2}(?!\\d)(?:/\\d{2,4})?' +
  ')';
const DATE_RE = new RegExp(`^${DATE_CORE}$`, 'i');
// Same pattern, unanchored, for pulling a date out of a heading rather than
// requiring the whole cell/line to be nothing but the date.
const DATE_ANYWHERE_RE = new RegExp(DATE_CORE, 'gi');

const COLUMN_HEADINGS = new Set(['date', 'service', 'job', 'name', 'assignment', 'position', 'person']);

function looksLikeDate(cell) {
  return DATE_RE.test((cell || '').trim());
}

function isColumnHeaderRow(cells) {
  const filled = cells.filter(Boolean).map(c => c.toLowerCase());
  return filled.length > 0 && filled.every(c => COLUMN_HEADINGS.has(c));
}

// Finds every <table> on the page along with the date-like text (if any)
// immediately preceding it — the heading a table relies on for shape (d).
// Only a short window of text right before a table counts as "its" heading,
// so a date from much earlier on the page, or one belonging to the previous
// table, is never attached to the wrong one. The heading text must also be
// mostly just the date itself (allowing a short prefix like a day name or
// "Week of ") — a sentence that merely happens to mention a date in passing,
// with an unrelated table right after it, must not be mistaken for one.
const HEADING_SLACK_CHARS = 12;

function tablesWithHeadingDates(html) {
  const tableRe = /<table[\s\S]*?<\/table>/gi;
  const result = [];
  let prevEnd = 0;
  let m;

  while ((m = tableRe.exec(html))) {
    const between = stripTags(html.slice(Math.max(prevEnd, m.index - 200), m.index));
    const dateMatches = between.match(DATE_ANYWHERE_RE);
    const lastMatch = dateMatches ? dateMatches[dateMatches.length - 1] : null;
    const isJustTheDate = lastMatch && (between.length - lastMatch.length) <= HEADING_SLACK_CHARS;
    const headingDate = isJustTheDate ? lastMatch.trim() : '';
    prevEnd = m.index + m[0].length;

    const rows = [...m[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)].map(row =>
      [...row[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => stripTags(c[1]))
    ).filter(r => r.some(Boolean));

    result.push({ rows, headingDate });
  }
  return result;
}

// Walks one table's rows applying shapes (a)/(b)/(c), seeded with whatever
// date (if any) preceded the table — shape (d). A table irrelevant to
// assignments (nav, layout) never establishes a currentDate and never has a
// 3-or-more-cell row worth pushing, so it contributes nothing regardless of
// being walked; there is no need to first pick out "the" assignments table.
function assignmentsFromTable({ rows, headingDate }) {
  const assignments = [];
  let currentDate = headingDate || '';

  for (const row of rows) {
    const filled = row.filter(Boolean);

    // (a) date header row: a date plus the column captions.
    if (row.some(looksLikeDate) && row.some(c => (c || '').toLowerCase() === 'service')) {
      currentDate = row.find(looksLikeDate).trim();
      continue;
    }

    // (c)/(d) a row that is only a date.
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

  return assignments;
}

function parseJobAssignments(html) {
  const mMatch = html.match(new RegExp(`>\\s*((?:${MONTH_NAMES})\\s+\\d{4})\\s*<`));
  const month  = mMatch ? mMatch[1] : '';

  const assignments = tablesWithHeadingDates(html).flatMap(assignmentsFromTable);
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

// Parse the family cards on /members/directory. Each card links to a family
// page and carries that family's photo. This is where photos actually live —
// the vCard export carries no PHOTO property at all — and families without one
// share a `no-image` placeholder, flagged here so it is never downloaded.
const NO_IMAGE_RE = /no-image/i;

function parseDirectoryFamilies(html) {
  const families = [];
  const cardRe = /<a class="c-card" href="\/members\/directory\/family\/(\d+)">([\s\S]*?)<\/a>/g;

  for (const m of html.matchAll(cardRe)) {
    const inner = m[2];
    const src   = inner.match(/<img[^>]+src="([^"]+)"/)?.[1];
    if (!src) continue;

    const name = stripTags(inner.match(/<h2 class="c-title">([\s\S]*?)<\/h2>/)?.[1] || '')
      .replace(/\s+/g, ' ')
      .trim();

    const [thumbPath, query] = src.split('?');
    families.push({
      familyId:   m[1],
      familyName: name,
      thumbUrl:   src,
      // Full size lives at the same path without the /thumbs/ segment.
      fullUrl:    thumbPath.replace('/thumbs/', '/') + (query ? `?${query}` : ''),
      // The site's own cache-buster; it changes when the photo is replaced.
      version:    new URLSearchParams(query || '').get('h') || '',
      hasPhoto:   !NO_IMAGE_RE.test(thumbPath),
    });
  }

  return families;
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
  parseDirectoryFamilies,
  parseVCardPhoto,
};
