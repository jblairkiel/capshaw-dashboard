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

// ─── Visitors ─────────────────────────────────────────────────────────────────
//
// The visitor tracker gives each guest a heading, and then splits what it knows
// about them under headings of its own:
//
//   <h3>Pat Lane</h3>
//     <h4>Comments</h4>       <table>…what was said…</table>
//     <h4>Visit History</h4>  <table>…dates they came…</table>
//
// Pairing each heading with the table after it — which is what this used to do
// — therefore names every guest "Visit History", because that is the heading
// nearest their dates. The guest's own name is the last heading that is *not*
// one of the tracker's section labels, so that is what is tracked here, and
// the sections are read for what they hold rather than for their name.

const VISITOR_SECTION_LABELS = new Set([
  'visitor tracker', 'visitors', 'visitor', 'guests', 'guest',
  'comments', 'comment', 'notes', 'note',
  'visit history', 'visits', 'visit', 'history', 'attendance',
  'member news', 'menu', 'search',
]);

// Which part of a guest's entry a heading opens. '' means the heading is the
// guest themselves.
function visitorSection(heading) {
  const label = heading.toLowerCase();
  if (!VISITOR_SECTION_LABELS.has(label)) return null;
  if (label.includes('comment') || label.includes('note')) return 'comments';
  if (label.includes('visit') || label === 'history' || label === 'attendance') return 'visits';
  return 'other';
}

// A visit date as the tracker writes them: 04/13/25, and tolerant of 4/13/2025.
const VISIT_DATE_RE = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/;

function looksLikeVisitRow(row) {
  return VISIT_DATE_RE.test((row[0] || '').trim());
}

function parseVisitors(html) {
  const byHeading = parseVisitorsByHeading(html);
  if (byHeading.length) return byHeading;

  // The headings on this page are the tracker's own section labels, and the
  // guest's name is in something else — a line in a card header. Rather than
  // guess which element, read the page in order. See parseVisitorsInOrder.
  const inOrder = parseVisitorsInOrder(html);
  if (inOrder.length) return inOrder;

  // Some versions of the page put every guest in one table instead.
  return parseVisitorTable(html);
}

// The shape the tracker documents: a heading per guest, then a heading per
// section beneath them.
function parseVisitorsByHeading(html) {
  const guests  = [];
  let   current = null;
  let   section = '';

  function keep() {
    if (!current) return;
    // A heading with nothing under it is a page artifact, not a guest.
    if (current.visits.length || current.comments.length) {
      guests.push({
        name:     current.name,
        visits:   current.visits,
        comments: current.comments.join('\n'),
      });
    }
    current = null;
  }

  // Headings, tables and paragraphs in the order they appear, so a guest's
  // sections can be read in sequence rather than guessed at by proximity.
  const tokens = html.matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>|<table[\s\S]*?<\/table>|<p[^>]*>([\s\S]*?)<\/p>/gi);

  for (const token of tokens) {
    const [match, , headingText, paragraphText] = token;

    // ── A heading: either a guest's name, or one of their sections ──────────
    if (headingText !== undefined) {
      const heading = stripTags(headingText);
      if (!heading) continue;

      const known = visitorSection(heading);
      if (known) { section = known; continue; }

      keep();
      current = { name: heading, visits: [], comments: [] };
      section = '';
      continue;
    }

    if (!current) continue;

    // ── A table: visit rows if it holds dates, comments otherwise ───────────
    if (paragraphText === undefined) {
      const rows = extractTables(match)[0] || [];
      const visits = rows.filter(looksLikeVisitRow).map(r => ({ date: r[0], service: r[1] || '' }));

      if (visits.length) { current.visits.push(...visits); continue; }

      if (section === 'comments') {
        for (const row of rows) {
          const text = row.join(' — ').trim();
          // Skip the header row, whatever it is called.
          if (text && !/^comments?$/i.test(text)) current.comments.push(text);
        }
      }
      continue;
    }

    // ── A paragraph under a comments heading ────────────────────────────────
    if (section === 'comments') {
      const text = stripTags(paragraphText);
      if (text) current.comments.push(text);
    }
  }

  keep();
  return guests;
}

// ─── Reading a guest's entry when the name is not a heading ───────────────────
//
// The live tracker gives each guest a card: a header holding their name and a
// summary line, a body with however much it knows about them — address, phone,
// comments — and a table of their visits. Only the section labels inside the
// card are headings ("Comments", "Visit History"), so keying on headings finds
// the sections and never the guest.
//
// So the page is read in order — a guest, then their sections — taking the
// name from whatever element holds it. Two things about that order are what
// this gets right, both learned from the page itself rather than assumed:
//
//   1. What sits *closest* above a guest's dates is their comment, not their
//      name. Text following a "Comments" label belongs to the guest named
//      before it; only text arriving outside any section is somebody new.
//
//   2. A guest's name is not the only line above their dates. The header runs
//      "Pat Lane" then "Last on 09/13/26", and the body adds an address and a
//      phone number, so neither the first line nor the last is reliably the
//      name. Every candidate between one guest's dates and the next's is
//      collected, and the one that actually looks like a person is chosen.

// Text-bearing elements a name or a comment might be written in. The upper
// bound is generous because it has to hold a comment; a name is held to 80
// characters where the name is chosen.
const LABEL_RE = /<(h[1-6]|p|div|span|strong|b|em|a|td|th|caption|li|dt|summary)[^>]*>([^<]{2,300})<\/\1>/gi;

// Things that sit inside a card and are plainly not a guest: a column heading,
// a date, a count.
const NOT_A_NAME = /^(date|service|comments?|notes?|visits?|visit history|history|attendance|print|back|next|previous|more|«|»|\d+|[^a-z]*)$/i;

// The site's own navigation, which surrounds the tracker on every page. These
// are ruled out by name as well as by where they sit, because a link like
// "About Us" reads exactly like a person otherwise — two capitalised words —
// and it only takes one to appear outside a <nav> to be listed as a guest.
const SITE_FURNITURE = new Set([
  'home', 'menu', 'search', 'about', 'about us', 'contact', 'contact us',
  'our staff', 'staff', 'leadership', 'elders', 'deacons', 'ministries',
  'directions', 'visit us', 'plan your visit', 'give', 'giving', 'donate',
  'events', 'calendar', 'sermons', 'bulletin', 'bulletins', 'media', 'watch',
  'livestream', 'live stream', 'news', 'blog', 'members', 'member login',
  'log in', 'login', 'log out', 'logout', 'sign in', 'sign out', 'my profile',
  'profile', 'account', 'admin', 'church office', 'directory', 'worship',
  'bible study', 'privacy', 'privacy policy', 'terms', 'site map', 'sitemap',
  'read more', 'learn more', 'view all', 'close', 'open', 'toggle navigation',
  // The site hides addresses behind a link whose text is the placeholder
  // rather than the address, and the placeholder is not a person either.
  'protected email', 'email protected', '[email protected]',
]);

// Lowercase words that belong inside a surname rather than marking the text as
// a sentence.
const NAME_PARTICLES = new Set(['de', 'del', 'della', 'da', 'di', 'dos', 'du', 'van', 'von', 'der', 'den', 'la', 'le', 'bin', 'ter']);

// 0 — not a name at all. 1 — could be, but nothing says so. 2 — reads like a
// person's name. The middle rank is what keeps a single-word guest readable
// while still losing to a proper name when both are on offer.
function nameScore(text) {
  if (!text || text.length > 80) return 0;
  if (NOT_A_NAME.test(text)) return 0;
  if (SITE_FURNITURE.has(text.toLowerCase().replace(/\s+/g, ' '))) return 0;
  // However the site writes its obfuscated-address placeholder.
  if (/e-?mail[\s_-]*protected|protected[\s_-]*e-?mail/i.test(text)) return 0;
  // "Last on 09/13/26", a visit date, a phone number, a count — a person's
  // name does not carry a digit, and every line in the card that is not the
  // name carries one or is an address.
  if (/\d/.test(text)) return 0;
  if (text.includes('@')) return 0;
  if (!/[a-z]{2}/i.test(text)) return 0;

  const words = text.split(/\s+/);
  const readsLikeAPerson = words.length >= 2 && words.length <= 4 &&
    words.every(w => /^[A-Z]/.test(w) || NAME_PARTICLES.has(w.toLowerCase()));
  return readsLikeAPerson ? 2 : 1;
}

// The likeliest name among the lines gathered for one guest. Ties go to the
// first, which is the order a card puts the name in.
function bestName(candidates) {
  let best = null;
  for (const candidate of candidates) {
    const score = nameScore(candidate.text);
    if (score > 0 && (!best || score > best.score)) best = { ...candidate, score };
  }
  return best;
}

// ─── What the card says about the guest besides their name ────────────────────
//
// The tracker writes these without captions — an icon, then the value — so
// each is recognised by its own shape rather than by a label beside it. The
// address is taken from the map link the site wraps it in, whose query is
// already "street, city, state zip".

const MAPS_LINK_RE  = /maps\.google\.com\/[^"'\s]*[?&]q=([^"'&\s]+)/i;
const MAILTO_RE     = /mailto:([^"'?>\s]+)/i;
const PHONE_RE      = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]\d{4}/;
const STATE_ZIP_RE  = /^([A-Za-z]{2})\.?\s+(\d{5}(?:-\d{4})?)$/;

function detailsBetween(html, from, to) {
  if (!(to > from)) return {};
  const markup  = html.slice(from, to);
  const details = {};

  const mail = markup.match(MAILTO_RE);
  if (mail) details.email = decodeURIComponent(mail[1]).trim();

  // Digits inside a tag — an svg path, a href — are not a phone number.
  const phone = stripTags(markup).match(PHONE_RE);
  if (phone) details.phone = phone[0].trim();

  const maps = markup.match(MAPS_LINK_RE);
  if (maps) {
    let query = '';
    try { query = decodeURIComponent(maps[1].replace(/\+/g, ' ')); } catch { query = ''; }
    const parts = query.split(',').map(p => p.trim()).filter(Boolean);
    if (parts.length) {
      details.address = parts[0];
      const last = parts[parts.length - 1];
      const stateZip = parts.length > 1 ? last.match(STATE_ZIP_RE) : null;
      if (stateZip) {
        details.state = stateZip[1].toUpperCase();
        details.zip   = stateZip[2];
        if (parts.length > 2) details.city = parts.slice(1, -1).join(', ');
      } else if (parts.length > 1) {
        details.city = parts.slice(1).join(', ');
      }
    }
  }

  return details;
}

function parseVisitorsInOrder(html) {
  // Every table, and every piece of text outside one, in the order the page
  // gives them. Text inside a table is that table's contents — a comment, a
  // date, a service — and never a guest's name, which is worth ruling out by
  // position rather than by trying to recognise prose.
  const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)]
    .map(m => ({ at: m.index, end: m.index + m[0].length, kind: 'table', html: m[0] }));
  const insideATable = at => tables.some(t => at >= t.at && at < t.end);

  // The site's navigation and footer wrap every page, and a link in them reads
  // like anything else once it is just text. Ruling them out by where they sit
  // costs nothing and does not depend on knowing what this site happens to
  // call its pages. The card's own header is a <button>, not a <header>, so
  // nothing a guest's entry holds is inside one of these.
  const chromeRanges = [...html.matchAll(/<(nav|footer|aside)[\s>][\s\S]*?<\/\1>/gi)]
    .map(m => [m.index, m.index + m[0].length]);
  const insideChrome = at => chromeRanges.some(([from, to]) => at >= from && at < to);

  const tokens = [...tables];
  for (const match of html.matchAll(LABEL_RE)) {
    if (insideATable(match.index) || insideChrome(match.index)) continue;
    const text = stripTags(match[2]);
    if (!text) continue;

    // A section label is recognised in whatever element the page wrote it in,
    // not only in a heading — the same reason the name is.
    const section = visitorSection(text);
    tokens.push(section ? { at: match.index, kind: 'section', section }
                        : { at: match.index, kind: 'label', text });
  }
  tokens.sort((a, b) => a.at - b.at);

  const guests  = [];
  let   pending = [];    // lines seen since the last guest's contents: one is the name
  let   current = null;  // the guest being assembled, started once their contents arrive
  let   section = '';

  // A guest is only worth starting when there is something to put under them,
  // which is also what keeps the page's own furniture from becoming one.
  function startGuest() {
    if (current) return current;
    const best = bestName(pending);
    if (!best) return null;
    current = { name: best.text, at: best.at, visits: [], comments: [], details: null };
    return current;
  }

  function keep() {
    if (current && (current.visits.length || current.comments.length)) {
      guests.push({
        name:     current.name,
        visits:   current.visits,
        comments: current.comments.join('\n'),
        ...(current.details || {}),
      });
    }
    current = null;
    pending = [];
  }

  for (const token of tokens) {
    if (token.kind === 'section') { section = token.section; continue; }

    // ── A line of text: the guest's comment, or one of the lines naming the
    //    next guest ───────────────────────────────────────────────────────────
    if (token.kind === 'label') {
      if (section === 'comments') {
        const guest = startGuest();
        if (guest) { guest.comments.push(token.text); continue; }
      }
      if (current) keep();   // their contents are already gathered: this is somebody new
      pending.push(token);
      continue;
    }

    // ── A table: visit rows if it holds dates, comments otherwise ───────────
    const guest = startGuest();
    if (!guest) { section = ''; continue; }
    // Everything between the name and the first table is the card's own body,
    // which is where the address and the phone number are.
    if (!guest.details) guest.details = detailsBetween(html, guest.at, token.at);

    const rows   = extractTables(token.html)[0] || [];
    const visits = rows.filter(looksLikeVisitRow).map(r => ({ date: r[0], service: r[1] || '' }));

    if (visits.length) {
      guest.visits.push(...visits);
    } else {
      const comments = rows
        .map(r => r.join(' — ').trim())
        .filter(text => text && !/^comments?$/i.test(text) && !/^date\b/i.test(text));
      guest.comments.push(...comments);
    }

    // The section has delivered what it holds, so the next line of text is a
    // new guest rather than more of it.
    section = '';
  }

  keep();
  return guests;
}

// ─── Following the tracker's own controls ─────────────────────────────────────
//
// The tracker shows a slice of its guests: a dropdown picks how far back to
// look, and what is left over runs onto further pages. Scraping the page as it
// arrives therefore collects whatever the site happened to default to.
//
// Rather than hard-code a query this site is not obliged to keep, both are read
// off the page the way a person uses them — find the dropdown, set it to its
// widest span, then follow the pager. What was actually followed is reported,
// so a scrape that came back short can be told from one that had nothing more
// to fetch.

function attr(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  if (!match) return '';
  return decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
}

function decodeEntities(str) {
  return String(str).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;/g, "'");
}

// A link or action as a path this site can be asked for, or '' when it points
// somewhere else entirely.
function asPath(href, from) {
  const raw = decodeEntities((href || '').trim());
  if (!raw || /^(#|javascript:|mailto:|tel:)/i.test(raw)) return '';
  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      if (!/capshawchurch\.org$/i.test(url.hostname)) return '';
      return url.pathname + url.search;
    } catch { return ''; }
  }
  if (raw.startsWith('/')) return raw;
  if (raw.startsWith('?')) return from.split('?')[0] + raw;
  const dir = from.split('?')[0].replace(/\/[^/]*$/, '');
  return `${dir}/${raw}`;
}

// How much of the past an option asks for. Infinity is "everything".
function spanWeight(text) {
  const label = text.trim().toLowerCase();
  if (!label) return -1;
  if (/^(all|any|everything|no limit|show all|full)\b/.test(label) || /\ball (time|dates|history|visits)\b/.test(label)) {
    return Infinity;
  }
  const counted = label.match(/(\d+)\s*(day|week|month|year)/);
  if (counted) {
    const per = { day: 1, week: 7, month: 30, year: 365 };
    return Number(counted[1]) * per[counted[2]];
  }
  const singular = label.match(/\b(day|week|month|year)\b/);
  if (singular) return { day: 1, week: 7, month: 30, year: 365 }[singular[1]];
  return 0;
}

// The page asked for with its date-span dropdown set as wide as it goes, or ''
// when the page has no such dropdown.
function widestSpanQuery(html, path) {
  for (const form of html.matchAll(/<form([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const [, openTag, body] = form;
    // A filter submitted by POST cannot be asked for as a link, and guessing
    // at one would be worse than leaving the page as it came.
    if (/\bmethod\s*=\s*["']?post/i.test(openTag)) continue;

    const selects = [...body.matchAll(/<select([^>]*)>([\s\S]*?)<\/select>/gi)];
    if (!selects.length) continue;

    const fields = new Map();
    for (const input of body.matchAll(/<input([^>]*)>/gi)) {
      const tag  = input[1];
      const type = (attr(tag, 'type') || 'text').toLowerCase();
      const name = attr(tag, 'name');
      if (!name || type === 'submit' || type === 'button' || type === 'reset') continue;
      if ((type === 'checkbox' || type === 'radio') && !/\bchecked\b/i.test(tag)) continue;
      fields.set(name, attr(tag, 'value'));
    }

    let widened = '';
    for (const [, selectTag, options] of selects) {
      const name = attr(selectTag, 'name');
      if (!name) continue;

      const choices = [...options.matchAll(/<option([^>]*)>([\s\S]*?)<\/option>/gi)].map(o => ({
        value:    /\bvalue\s*=/i.test(o[1]) ? attr(o[1], 'value') : stripTags(o[2]),
        label:    stripTags(o[2]),
        selected: /\bselected\b/i.test(o[1]),
      }));
      if (!choices.length) continue;

      // Whatever it is set to now, unless this is the dropdown we came for.
      const current = choices.find(c => c.selected) || choices[0];
      fields.set(name, current.value);

      const widest = choices.reduce((best, c) =>
        spanWeight(c.label) > spanWeight(best.label) ? c : best, choices[0]);
      if (spanWeight(widest.label) > spanWeight(current.label)) {
        fields.set(name, widest.value);
        widened = widest.label;
      }
    }
    if (!widened) continue;

    const action = asPath(attr(openTag, 'action'), path) || path.split('?')[0];
    const query  = [...fields].map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    return query ? `${action}?${query}` : action;
  }
  return '';
}

// Links that lead to more of the same listing: a numbered pager, a "next", a
// "»". Anything pointing at another page of the site is left alone.
const PAGER_TEXT_RE  = /^(\d{1,3}|»|›|>|>>|next|last|older|more)$/i;
const PAGER_PARAM_RE = /[?&](page|pg|p|start|offset|from|skip)\b\s*=/i;

function pagerLinks(html, path) {
  const here  = path.split('?')[0];
  const found = new Map();

  for (const link of html.matchAll(/<a([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const tag  = link[1];
    const text = stripTags(link[2]);
    const rel  = attr(tag, 'rel').toLowerCase();
    const aria = attr(tag, 'aria-label').toLowerCase();

    const looksLikeAPager =
      PAGER_TEXT_RE.test(text) || rel === 'next' || /\bnext\b|\bpage\b/.test(aria);
    if (!looksLikeAPager) continue;

    const target = asPath(attr(tag, 'href'), path);
    if (!target || target.split('?')[0] !== here) continue;     // somewhere else on the site
    if (target === path) continue;                              // the page we are already on
    if (!target.includes('?') || !PAGER_PARAM_RE.test(target)) {
      // A same-path link with no page-ish parameter is not a pager link, it is
      // something else the listing links to — a guest, a sort, a filter.
      if (rel !== 'next') continue;
    }
    if (!found.has(target)) found.set(target, true);
  }

  return [...found.keys()];
}

// One guest per name, with everything each page knew about them. A guest whose
// visits run across a page break has their rows joined rather than replaced,
// and a detail the later page leaves blank keeps the earlier page's.
function mergeVisitors(pages) {
  const byName = new Map();

  for (const guest of pages.flat()) {
    const key = guest.name.trim().toLowerCase();
    if (!key) continue;

    const seen = byName.get(key);
    if (!seen) {
      byName.set(key, { ...guest, visits: [...(guest.visits || [])] });
      continue;
    }

    const dates = new Set(seen.visits.map(v => `${v.date}|${v.service}`));
    for (const visit of (guest.visits || [])) {
      const id = `${visit.date}|${visit.service}`;
      if (!dates.has(id)) { dates.add(id); seen.visits.push(visit); }
    }
    for (const [field, value] of Object.entries(guest)) {
      if (field === 'visits' || field === 'name') continue;
      if (!seen[field] && value) seen[field] = value;
    }
  }

  return [...byName.values()];
}

// One table, a guest per row: Name | Date | Service, in whatever order the
// header gives them. Rows for the same person are merged into one guest.
function parseVisitorTable(html) {
  for (const rows of extractTables(html)) {
    if (rows.length < 2) continue;

    const header = rows[0].map(c => c.toLowerCase());
    const nameAt = header.findIndex(c => c.includes('name') || c.includes('visitor') || c.includes('guest'));
    const dateAt = header.findIndex(c => c.includes('date'));
    if (nameAt < 0 || dateAt < 0) continue;

    const serviceAt = header.findIndex(c => c.includes('service'));
    const commentAt = header.findIndex(c => c.includes('comment') || c.includes('note'));

    const byName = new Map();
    for (const row of rows.slice(1)) {
      const name = (row[nameAt] || '').trim();
      if (!name) continue;

      if (!byName.has(name)) byName.set(name, { name, visits: [], comments: '' });
      const guest = byName.get(name);

      const date = (row[dateAt] || '').trim();
      if (VISIT_DATE_RE.test(date)) {
        guest.visits.push({ date, service: serviceAt >= 0 ? (row[serviceAt] || '') : '' });
      }
      const comment = commentAt >= 0 ? (row[commentAt] || '').trim() : '';
      if (comment) guest.comments = guest.comments ? `${guest.comments}\n${comment}` : comment;
    }

    if (byName.size) return [...byName.values()];
  }

  return [];
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
  parseVisitorTable,
  parseVisitorsInOrder,
  widestSpanQuery,
  pagerLinks,
  mergeVisitors,
  nameScore,
  parseAnniversaries,
  parseDeacons,
  parseBulletins,
  parseDirectory,
  parseDirectoryFamilies,
  parseVCardPhoto,
};
