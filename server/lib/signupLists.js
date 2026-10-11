// ─── Sign-up lists ────────────────────────────────────────────────────────────
//
// Anything the congregation needs people for, made by any member: a meal
// train, a work day, a nursery rota. A list is either
//
//   one-date   — everything happens on one day (a fellowship meal: who brings
//                the drinks, the desserts, the plates), or
//   multi-date — the same sign-up over several days (who cooks for the
//                Smiths on each night of the week).
//
// What people sign up for is set items, each with how many are needed (or
// as many as like), or free sign-ups where they write what they will bring,
// or both. Each entry is one person against one date and item.
//
// Whoever made a list keeps it — edits, closes or deletes it, adds or takes
// off anybody's name, and emails the people on it. Whoever holds `signups`
// can do the same to every list, email a whole distribution group about one,
// and see the analytics.

const db = require('../db');
const { holdsArea } = require('./areas');

const AREA = 'signups';
const KINDS = ['one-date', 'multi-date'];
const LIMITS = { title: 120, description: 4000, label: 80, note: 200, name: 100, dates: 60, items: 40 };

const clean = (v, max) => String(v ?? '').replace(/[ \t]+/g, ' ').trim().slice(0, max);
const isIsoDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`));
const isTime = v => /^([01]?\d|2[0-3]):[0-5]\d$/.test(String(v || ''));
const nameKey = s => clean(s, 200).toLowerCase();

function isManager(user) { return holdsArea(user, AREA); }

function canEdit(user, list) {
  if (!user || !list) return false;
  return isManager(user) || (!!list.created_by && list.created_by === user.id);
}

function listRow(id) {
  return db.prepare('SELECT * FROM signup_lists WHERE id = ?').get(Number(id)) || null;
}

// ─── Reading what the form sent ───────────────────────────────────────────────

function readList(body = {}) {
  const title = clean(body.title, LIMITS.title);
  if (!title) return { error: 'Give the sign-up a title' };
  const kind = KINDS.includes(body.kind) ? body.kind : 'one-date';
  const description = String(body.description ?? '').trim().slice(0, LIMITS.description);
  const allowFree = !!body.allowFree;
  const freeLabel = clean(body.freeLabel, LIMITS.label);

  const dates = (Array.isArray(body.dates) ? body.dates : []).map(d => ({
    id: Number(d?.id) || null,
    date: String(d?.date || ''),
    time: isTime(d?.time) ? String(d.time).padStart(5, '0') : '',
    note: clean(d?.note, LIMITS.note),
  })).filter(d => d.date);
  if (!dates.length) return { error: 'Choose the date it is on' };
  if (dates.some(d => !isIsoDate(d.date))) return { error: 'One of the dates is not a date' };
  if (kind === 'one-date' && dates.length > 1) return { error: 'A one-date sign-up has a single date — choose several dates instead' };
  if (dates.length > LIMITS.dates) return { error: `No more than ${LIMITS.dates} dates on one sign-up` };
  dates.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));

  const items = (Array.isArray(body.items) ? body.items : []).map(i => {
    const needed = i?.needed === '' || i?.needed == null ? null : Number(i.needed);
    return { id: Number(i?.id) || null, label: clean(i?.label, LIMITS.label), needed };
  }).filter(i => i.label);
  if (items.length > LIMITS.items) return { error: `No more than ${LIMITS.items} things on one sign-up` };
  if (items.some(i => i.needed !== null && (!Number.isInteger(i.needed) || i.needed < 1 || i.needed > 500))) {
    return { error: 'How many are needed is a whole number from 1 to 500, or blank for as many as like' };
  }
  if (!items.length && !allowFree) return { error: 'Add what is needed, or allow free sign-ups' };

  return { list: { title, description, kind, allowFree, freeLabel }, dates, items };
}

// ─── Writing a list ───────────────────────────────────────────────────────────

function create(user, body) {
  const read = readList(body);
  if (read.error) return read;
  const { list, dates, items } = read;
  const id = db.transaction(() => {
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO signup_lists (title, description, kind, allow_free, free_label, created_by, created_by_name)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(list.title, list.description, list.kind, +list.allowFree, list.freeLabel, user?.id ?? null, user?.name || '');
    const addDate = db.prepare('INSERT INTO signup_dates (list_id, date, time, note, position) VALUES (?, ?, ?, ?, ?)');
    dates.forEach((d, i) => addDate.run(lastInsertRowid, d.date, d.time, d.note, i));
    const addItem = db.prepare('INSERT INTO signup_items (list_id, label, needed, position) VALUES (?, ?, ?, ?)');
    items.forEach((it, i) => addItem.run(lastInsertRowid, it.label, it.needed, i));
    return lastInsertRowid;
  })();
  return { id };
}

// Replaces the list's details. A date or item someone has already signed up
// for can be changed but not taken away while their name is on it.
function update(user, id, body) {
  const before = listRow(id);
  if (!before) return { error: 'No such sign-up', status: 404 };
  if (!canEdit(user, before)) return { error: 'Only whoever made this sign-up, or the sign-up manager, can change it', status: 403 };
  const read = readList(body);
  if (read.error) return read;
  const { list, dates, items } = read;

  const oldDates = db.prepare('SELECT * FROM signup_dates WHERE list_id = ?').all(before.id);
  const oldItems = db.prepare('SELECT * FROM signup_items WHERE list_id = ?').all(before.id);
  const used = (col, rowId) => db.prepare(`SELECT COUNT(*) AS n FROM signup_entries WHERE ${col} = ?`).get(rowId).n;
  const keptDates = new Set(dates.map(d => d.id).filter(Boolean));
  const keptItems = new Set(items.map(i => i.id).filter(Boolean));
  const droppedDate = oldDates.find(d => !keptDates.has(d.id) && used('date_id', d.id));
  if (droppedDate) return { error: `People have signed up for ${droppedDate.date} — take their names off before removing it` };
  const droppedItem = oldItems.find(i => !keptItems.has(i.id) && used('item_id', i.id));
  if (droppedItem) return { error: `People have signed up for “${droppedItem.label}” — take their names off before removing it` };
  if (!list.allowFree && db.prepare('SELECT COUNT(*) AS n FROM signup_entries WHERE list_id = ? AND item_id IS NULL').get(before.id).n) {
    return { error: 'People have made free sign-ups — take them off before turning free sign-ups off' };
  }

  db.transaction(() => {
    db.prepare(`
      UPDATE signup_lists SET title = ?, description = ?, kind = ?, allow_free = ?, free_label = ?, updated_at = datetime('now') WHERE id = ?
    `).run(list.title, list.description, list.kind, +list.allowFree, list.freeLabel, before.id);
    for (const d of oldDates) if (!keptDates.has(d.id)) db.prepare('DELETE FROM signup_dates WHERE id = ?').run(d.id);
    for (const i of oldItems) if (!keptItems.has(i.id)) db.prepare('DELETE FROM signup_items WHERE id = ?').run(i.id);
    dates.forEach((d, at) => {
      if (d.id && oldDates.some(o => o.id === d.id)) db.prepare('UPDATE signup_dates SET date = ?, time = ?, note = ?, position = ? WHERE id = ?').run(d.date, d.time, d.note, at, d.id);
      else db.prepare('INSERT INTO signup_dates (list_id, date, time, note, position) VALUES (?, ?, ?, ?, ?)').run(before.id, d.date, d.time, d.note, at);
    });
    items.forEach((it, at) => {
      if (it.id && oldItems.some(o => o.id === it.id)) db.prepare('UPDATE signup_items SET label = ?, needed = ?, position = ? WHERE id = ?').run(it.label, it.needed, at, it.id);
      else db.prepare('INSERT INTO signup_items (list_id, label, needed, position) VALUES (?, ?, ?, ?)').run(before.id, it.label, it.needed, at);
    });
  })();
  return { before, id: before.id };
}

function setClosed(user, id, closed) {
  const row = listRow(id);
  if (!row) return { error: 'No such sign-up', status: 404 };
  if (!canEdit(user, row)) return { error: 'Only whoever made this sign-up, or the sign-up manager, can close it', status: 403 };
  db.prepare("UPDATE signup_lists SET closed = ?, updated_at = datetime('now') WHERE id = ?").run(closed ? 1 : 0, row.id);
  return { list: row };
}

function remove(user, id) {
  const row = listRow(id);
  if (!row) return { error: 'No such sign-up', status: 404 };
  if (!canEdit(user, row)) return { error: 'Only whoever made this sign-up, or the sign-up manager, can delete it', status: 403 };
  const entries = db.prepare('SELECT COUNT(*) AS n FROM signup_entries WHERE list_id = ?').get(row.id).n;
  db.prepare('DELETE FROM signup_lists WHERE id = ?').run(row.id);
  return { list: row, entries };
}

// ─── Signing up ───────────────────────────────────────────────────────────────

function personFor(user) {
  const person = user?.directory_id ? db.prepare('SELECT id, name FROM directory WHERE id = ?').get(user.directory_id) : null;
  return { name: person?.name || clean(user?.name, LIMITS.name), directoryId: person?.id ?? null };
}

function directoryFor(name) {
  const rows = db.prepare('SELECT id, name FROM directory WHERE lower(trim(name)) = ?').all(nameKey(name));
  return rows.length === 1 ? rows[0] : null;
}

function isMine(entry, user) {
  if (!user || !entry) return false;
  if (entry.user_id === user.id) return true;
  return !!user.directory_id && entry.directory_id === user.directory_id;
}

// `today` is the church's date: a date already past cannot be signed up for.
function signUp(user, listId, body = {}, today) {
  const list = listRow(listId);
  if (!list) return { error: 'No such sign-up', status: 404 };
  if (list.closed) return { error: 'This sign-up is closed' };
  const date = db.prepare('SELECT * FROM signup_dates WHERE id = ? AND list_id = ?').get(Number(body.dateId), list.id);
  if (!date) return { error: 'Choose a date on this sign-up' };
  if (date.date < today) return { error: 'That date has passed' };

  const itemId = body.itemId == null || body.itemId === '' ? null : Number(body.itemId);
  const item = itemId ? db.prepare('SELECT * FROM signup_items WHERE id = ? AND list_id = ?').get(itemId, list.id) : null;
  if (itemId && !item) return { error: 'Choose something on this sign-up' };
  const note = clean(body.note, LIMITS.note);
  if (!item) {
    if (!list.allow_free) return { error: 'Choose one of the things that are needed' };
    if (!note) return { error: 'Say what you will bring or do' };
  }

  // Somebody else's name is the list keeper's to put down.
  const onBehalf = clean(body.name, LIMITS.name);
  let who;
  if (onBehalf) {
    if (!canEdit(user, list)) return { error: 'Only whoever made this sign-up, or the sign-up manager, can put somebody else down', status: 403 };
    const person = directoryFor(onBehalf);
    who = { name: person?.name || onBehalf, directoryId: person?.id ?? null, userId: null };
  } else {
    who = { ...personFor(user), userId: user.id };
    if (!who.name) return { error: 'Your account has no name to sign up with' };
  }

  if (item) {
    const taken = db.prepare('SELECT COUNT(*) AS n FROM signup_entries WHERE date_id = ? AND item_id = ?').get(date.id, item.id).n;
    if (item.needed !== null && taken >= item.needed) return { error: `“${item.label}” is full for that date`, status: 409 };
    const already = db.prepare(`
      SELECT 1 FROM signup_entries WHERE date_id = ? AND item_id = ?
         AND ((? IS NOT NULL AND directory_id = ?) OR lower(trim(name)) = ?)
    `).get(date.id, item.id, who.directoryId, who.directoryId, nameKey(who.name));
    if (already) return { error: `${who.name} is already down for “${item.label}” on that date`, status: 409 };
  }

  const { lastInsertRowid } = db.prepare(`
    INSERT INTO signup_entries (list_id, date_id, item_id, name, note, directory_id, user_id, added_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(list.id, date.id, item?.id ?? null, who.name, note, who.directoryId, who.userId, user?.id ?? null);
  return { entry: db.prepare('SELECT * FROM signup_entries WHERE id = ?').get(lastInsertRowid), list, date, item };
}

function removeEntry(user, entryId) {
  const entry = db.prepare('SELECT * FROM signup_entries WHERE id = ?').get(Number(entryId));
  if (!entry) return { error: 'No such sign-up', status: 404 };
  const list = listRow(entry.list_id);
  if (!isMine(entry, user) && !canEdit(user, list)) return { error: 'You can only take your own name off', status: 403 };
  db.prepare('DELETE FROM signup_entries WHERE id = ?').run(entry.id);
  return { entry, list };
}

// ─── Reading ──────────────────────────────────────────────────────────────────

function datesOf(listId) {
  return db.prepare('SELECT * FROM signup_dates WHERE list_id = ? ORDER BY date, time, position').all(listId);
}

// Everything the page shows for one list, for one person.
function detail(id, user, today) {
  const list = listRow(id);
  if (!list) return null;
  const dates = datesOf(list.id);
  const items = db.prepare('SELECT * FROM signup_items WHERE list_id = ? ORDER BY position, id').all(list.id);
  const entries = db.prepare('SELECT * FROM signup_entries WHERE list_id = ? ORDER BY created_at, id').all(list.id);
  const editable = canEdit(user, list);
  const entryShape = e => ({ id: e.id, name: e.name, note: e.note, mine: isMine(e, user), canRemove: isMine(e, user) || editable });

  return {
    id: list.id,
    title: list.title,
    description: list.description,
    kind: list.kind,
    allowFree: !!list.allow_free,
    freeLabel: list.free_label,
    closed: !!list.closed,
    createdBy: list.created_by_name,
    createdAt: list.created_at,
    canEdit: editable,
    past: dates.every(d => d.date < today),
    items: items.map(i => ({ id: i.id, label: i.label, needed: i.needed })),
    dates: dates.map(d => {
      const mine = entries.filter(e => e.date_id === d.id);
      return {
        id: d.id, date: d.date, time: d.time, note: d.note, past: d.date < today,
        items: items.map(i => {
          const on = mine.filter(e => e.item_id === i.id);
          return { itemId: i.id, taken: on.length, needed: i.needed, full: i.needed !== null && on.length >= i.needed, entries: on.map(entryShape) };
        }),
        free: mine.filter(e => e.item_id === null).map(entryShape),
      };
    }),
    totals: totalsOf(items, dates, entries),
  };
}

function totalsOf(items, dates, entries) {
  const needed = items.reduce((n, i) => n + (i.needed ?? 0), 0) * dates.length;
  // Only what was asked for counts towards being filled; "as many as like"
  // items and free sign-ups are counted, but cannot leave a list short.
  const filled = dates.reduce((n, d) => n + items.reduce((m, i) => {
    if (i.needed === null) return m;
    return m + Math.min(i.needed, entries.filter(e => e.date_id === d.id && e.item_id === i.id).length);
  }, 0), 0);
  return { entries: entries.length, needed, filled, people: new Set(entries.map(e => e.directory_id ? `d${e.directory_id}` : nameKey(e.name))).size };
}

// Every list, newest first, summarised for the index.
function summaries(user, today) {
  const lists = db.prepare('SELECT * FROM signup_lists ORDER BY created_at DESC, id DESC').all();
  return lists.map(list => {
    const dates = datesOf(list.id);
    const items = db.prepare('SELECT * FROM signup_items WHERE list_id = ?').all(list.id);
    const entries = db.prepare('SELECT * FROM signup_entries WHERE list_id = ?').all(list.id);
    return {
      id: list.id, title: list.title, kind: list.kind, closed: !!list.closed, createdBy: list.created_by_name,
      first: dates[0]?.date || '', last: dates.at(-1)?.date || '', dateCount: dates.length,
      past: dates.every(d => d.date < today),
      mine: entries.some(e => isMine(e, user)),
      madeByMe: !!user && list.created_by === user.id,
      totals: totalsOf(items, dates, entries),
    };
  });
}

// ─── Analytics, for the sign-up manager ───────────────────────────────────────

function analytics(today) {
  const lists = summaries(null, today);
  const entries = db.prepare(`
    SELECT e.*, d.date FROM signup_entries e JOIN signup_dates d ON d.id = e.date_id
  `).all();
  const byPerson = new Map();
  for (const e of entries) {
    const key = e.directory_id ? `d${e.directory_id}` : nameKey(e.name);
    if (!byPerson.has(key)) byPerson.set(key, { name: e.name, count: 0, lists: new Set() });
    const p = byPerson.get(key);
    p.count++; p.lists.add(e.list_id);
  }
  const byMonth = new Map();
  for (const e of entries) {
    const month = e.date.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) || 0) + 1);
  }
  const asked = lists.reduce((n, l) => n + l.totals.needed, 0);
  const filled = lists.reduce((n, l) => n + l.totals.filled, 0);
  const upcoming = lists.filter(l => !l.past && !l.closed);

  return {
    totals: {
      lists: lists.length,
      open: upcoming.length,
      entries: entries.length,
      people: byPerson.size,
      fillRate: asked ? Math.round((filled / asked) * 100) : null,
    },
    topPeople: [...byPerson.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 10)
      .map(p => ({ name: p.name, count: p.count, lists: p.lists.size })),
    byMonth: [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-12).map(([month, count]) => ({ month, count })),
    // Upcoming lists still short of what they asked for, the shortest first.
    short: upcoming.filter(l => l.totals.needed > l.totals.filled)
      .map(l => ({ id: l.id, title: l.title, first: l.first, missing: l.totals.needed - l.totals.filled, needed: l.totals.needed }))
      .sort((a, b) => a.first.localeCompare(b.first)),
    byCreator: [...lists.reduce((m, l) => m.set(l.createdBy || 'Someone', (m.get(l.createdBy || 'Someone') || 0) + 1), new Map()).entries()]
      .map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
}

// ─── Who an email about a list reaches ────────────────────────────────────────

// The addresses of everybody on a list: their directory entry's, else their
// own account's.
function peopleOn(listId) {
  const entries = db.prepare('SELECT DISTINCT name, directory_id, user_id FROM signup_entries WHERE list_id = ?').all(listId);
  const recipients = [];
  const missing = [];
  for (const e of entries) {
    const email = (e.directory_id && db.prepare(`
      SELECT COALESCE(NULLIF(d.email, ''), (SELECT u.email FROM users u WHERE u.directory_id = d.id AND u.email <> '' LIMIT 1), '') AS email
        FROM directory d WHERE d.id = ?`).get(e.directory_id)?.email)
      || (e.user_id && db.prepare('SELECT email FROM users WHERE id = ?').get(e.user_id)?.email) || '';
    if (email) recipients.push({ email, name: e.name });
    else missing.push(e.name);
  }
  return { recipients, missing: [...new Set(missing)] };
}

module.exports = {
  AREA, KINDS, LIMITS, isManager, canEdit, listRow, readList, create, update, setClosed, remove,
  signUp, removeEntry, detail, summaries, analytics, peopleOn,
};
