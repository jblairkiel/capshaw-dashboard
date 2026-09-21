// ─── The half of the newsletter that is typed rather than queried ─────────────
//
// The prayer lists, the offering, the quote and who leads each fellowship group
// have no page in the portal keeping them, so they are stored per week here.
// Everything else the newsletter prints is read live from the tables that own
// it — see server/lib/bulletinData.js — and the two halves are merged by
// compose() below into the single object the .docx and .pdf renderers read.
//
// Carry-forward is the point of the table. A shut-in list barely changes from
// one week to the next, so opening a week that has never been written offers
// the previous week's words to edit rather than an empty box. Nothing is
// written to the database until somebody saves, so looking at a week does not
// create it.
const db       = require('../db');
const data     = require('./bulletinData');
const config   = require('./bulletinConfig');

// The fields a person types. Kept as one list so the route, the carry-forward
// and the blank issue cannot disagree about what an issue consists of.
const TEXT_FIELDS = [
  'quote', 'quote_ref',
  'updates', 'ongoing', 'shut_ins', 'pregnancies', 'evangelists',
  'offering', 'building',
];

// What a new week does *not* inherit. Last week's collection is last week's
// fact; repeating it would be reporting a number that was never counted. The
// building total is cumulative, so it does carry.
const NOT_CARRIED = new Set(['offering']);

function blank() {
  const issue = {};
  for (const f of TEXT_FIELDS) issue[f] = '';
  issue.group_notes = {};
  return issue;
}

function parseNotes(raw) {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    // A row we cannot read is one somebody edited by hand into invalid JSON.
    // An empty map loses the leaders rather than the whole newsletter.
    return {};
  }
}

function rowToIssue(row) {
  if (!row) return null;
  const issue = {};
  for (const f of TEXT_FIELDS) issue[f] = row[f] ?? '';
  issue.group_notes = parseNotes(row.group_notes);
  issue.sunday      = row.sunday;
  issue.updated_at  = row.updated_at;
  return issue;
}

// The issue stored for a week, or null when nobody has saved one.
function find(sunday) {
  return rowToIssue(db.prepare('SELECT * FROM bulletin_issues WHERE sunday = ?').get(sunday));
}

// The most recent issue *before* a week, which is what a fresh week inherits.
function previous(sunday) {
  return rowToIssue(
    db.prepare('SELECT * FROM bulletin_issues WHERE sunday < ? ORDER BY sunday DESC LIMIT 1').get(sunday)
  );
}

// What the compose screen should show for a week: what was saved, or last
// week's carried forward, or nothing. `saved` tells the screen which of the
// three it is looking at, so it can say so rather than implying a draft exists.
function draftFor(sunday) {
  const mine = find(sunday);
  if (mine) return { issue: mine, saved: true, carriedFrom: null };

  const prior = previous(sunday);
  if (!prior) return { issue: blank(), saved: false, carriedFrom: null };

  const carried = blank();
  for (const f of TEXT_FIELDS) carried[f] = NOT_CARRIED.has(f) ? '' : prior[f];
  carried.group_notes = prior.group_notes;
  return { issue: carried, saved: false, carriedFrom: prior.sunday };
}

// Write a week's typed half. Upserts on the Sunday, so saving twice edits one
// row rather than making a second issue for the same week.
function save(sunday, input = {}) {
  const issue = blank();
  for (const f of TEXT_FIELDS) {
    if (input[f] !== undefined && input[f] !== null) issue[f] = String(input[f]);
  }
  if (input.group_notes && typeof input.group_notes === 'object' && !Array.isArray(input.group_notes)) {
    issue.group_notes = input.group_notes;
  }

  db.prepare(`
    INSERT INTO bulletin_issues
      (sunday, quote, quote_ref, updates, ongoing, shut_ins, pregnancies, evangelists, offering, building, group_notes)
    VALUES
      (@sunday, @quote, @quote_ref, @updates, @ongoing, @shut_ins, @pregnancies, @evangelists, @offering, @building, @group_notes)
    ON CONFLICT(sunday) DO UPDATE SET
      quote       = excluded.quote,
      quote_ref   = excluded.quote_ref,
      updates     = excluded.updates,
      ongoing     = excluded.ongoing,
      shut_ins    = excluded.shut_ins,
      pregnancies = excluded.pregnancies,
      evangelists = excluded.evangelists,
      offering    = excluded.offering,
      building    = excluded.building,
      group_notes = excluded.group_notes,
      updated_at  = datetime('now')
  `).run({
    sunday,
    ...Object.fromEntries(TEXT_FIELDS.map(f => [f, issue[f]])),
    group_notes: JSON.stringify(issue.group_notes),
  });

  return find(sunday);
}

// Which weeks have been written, newest first — the compose screen's history.
function list(limit = 26) {
  return db.prepare('SELECT sunday, updated_at FROM bulletin_issues ORDER BY sunday DESC LIMIT ?').all(limit);
}

// ─── Merging the two halves ───────────────────────────────────────────────────

// A typed block becomes one entry per non-empty line. Trailing blank lines and
// stray whitespace are a consequence of typing, not content.
function lines(block) {
  return String(block || '')
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);
}

// ─── Rich text ────────────────────────────────────────────────────────────────
//
// Three of the newsletter's blocks are a running paragraph rather than a list,
// with each person's name in bold and what follows it in ordinary weight — the
// evangelists, the elders and the deacons all read that way. Both renderers
// need that distinction, so it is expressed once here as a list of segments
// and walked twice, rather than each renderer re-deriving it from a string.
function segment(text, bold = false) {
  return { text, bold };
}

// 'Samuel Lopez – Ocosingo, Mexico' → the name bold, the rest plain. The split
// is on the first dash of either kind; a line without one is all name, which is
// what a bare list of people should look like.
function splitName(entry) {
  const m = String(entry).match(/^(.*?)\s*[–—-]\s*(.+)$/);
  return m ? { name: m[1].trim(), rest: m[2].trim() } : { name: String(entry).trim(), rest: '' };
}

// What the newsletter prints for a deacon's responsibilities. Sixteen of them
// at full length is a wall of text, so the longest are clipped at a word
// boundary rather than mid-word — '…' says the rest was left out instead of
// letting a cut look like a typo. The ellipsis counts towards the limit, so
// nothing printed is ever longer than it.
function clip(text, max) {
  const whole = String(text || '').trim();
  if (whole.length <= max) return whole;

  const room = max - 1;
  const cut  = whole.slice(0, room);
  const space = cut.lastIndexOf(' ');
  // Only break on a space when one is far enough in to leave something
  // readable; a duty whose first word is longer than the limit is cut anyway.
  const kept = space > max / 2 ? cut.slice(0, space) : cut;

  return `${kept.replace(/[\s/,&-]+$/, '')}\u2026`;
}

// A deacon's primary responsibility.
//
// The Elders & Deacons page takes responsibilities one to a line, so the first
// line is the primary one. Plenty of them are written as one line with several
// packed into it — 'Treasurer & Finance / New Building' — so the first of those
// counts too. The split needs a space on one side of the slash or the other:
// without that rule 'Audio/Video & Sound Booth' would come out as 'Audio'.
function primaryDuty(duties) {
  const first = String((duties || [])[0] || '').trim();
  return first.split(/\s\/\s*|\s*\/\s/)[0].trim();
}

// Joins people into one paragraph: bold name, plain remainder, separated.
function nameParagraph(entries, { separator = ', ', wrap = null, joiner = ' ' } = {}) {
  const out = [];
  entries.forEach((entry, i) => {
    if (i) out.push(segment(separator));
    const { name, rest } = typeof entry === 'string' ? splitName(entry) : entry;
    out.push(segment(name, true));
    if (rest) out.push(segment(wrap ? ` ${wrap[0]}${rest}${wrap[1]}` : `${joiner}${rest}`));
  });
  return out;
}

// Everything both renderers need, in the order the newsletter prints it. The
// renderers walk this and nothing else: a section added here appears in the
// .docx and the .pdf together, which is the only way the two stay identical.
function compose(sunday) {
  const auto  = data.gather({ sunday });
  const { issue, saved, carriedFrom } = draftFor(auto.sunday);

  const attendance = auto.lastWeek.attendance;

  return {
    sunday:      auto.sunday,
    sundayLabel: auto.sundayLabel,
    masthead:    config.masthead,
    saved,
    carriedFrom,

    quote:    issue.quote,
    quoteRef: issue.quote_ref,

    reminders: auto.reminders.map(r => r.text),

    prayer: {
      updates:     lines(issue.updates),
      ongoing:     lines(issue.ongoing),
      shutIns:     lines(issue.shut_ins),
      pregnancies: lines(issue.pregnancies),
      // The one prayer block the newsletter sets as a paragraph rather than a
      // list, because it is long and every entry is the same shape.
      evangelists: nameParagraph(lines(issue.evangelists), { separator: '; ', joiner: ' \u2013 ' }),
    },

    lastWeek: {
      sunday:    attendance.sunday    ? attendance.sunday.count    : null,
      wednesday: attendance.wednesday ? attendance.wednesday.count : null,
      offering:  issue.offering,
      building:  issue.building,
    },

    // The printed newsletter dates an anniversary in brackets after the names
    // and a birthday after a dash. Both are the recurrence's day in this week.
    anniversaries: auto.anniversaries.map(a => `${a.names} (${data.shortDate(a.date)})`),
    birthdays:     auto.birthdays.map(b => `${b.names} – ${data.shortDate(b.date)}`),

    // The key travels with the group so the compose screen can write a leader
    // back against the right one without inferring it from the row's position.
    groups: auto.groups.map(g => ({
      key:    g.key,
      name:   g.name,
      email:  g.email,
      leader: issue.group_notes?.[g.key]?.leader || '',
      note:   issue.group_notes?.[g.key]?.note   || '',
    })),

    serviceTimes: config.serviceTimes,

    dutyRoster: auto.dutyRoster,

    leadership: {
      elders: nameParagraph(
        auto.elders.map(e => ({ name: e.name, rest: e.phone })),
      ),
      evangelist: config.evangelist,
      // Only the primary responsibility. A deacon may look after several
      // things and the Elders & Deacons page lists them all; the newsletter
      // has room for one, and the first is the one that page puts first.
      deacons: nameParagraph(
        auto.deacons.map(d => ({
          name: d.name,
          rest: clip(primaryDuty(d.duties), config.deaconDutyMaxLength),
        })),
        { wrap: ['(', ')'] },
      ),
    },

    contacts: {
      groups: auto.emailContacts,
      admins: config.websiteAdmins,
    },

    footer: {
      address: config.address,
      phone:   config.phone,
      website: config.website,
      social:  config.social,
    },
  };
}

module.exports = { TEXT_FIELDS, blank, find, previous, draftFor, save, list, compose, lines, nameParagraph, splitName, clip, primaryDuty };
