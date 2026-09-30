// ─── Upcoming services ────────────────────────────────────────────────────────
//
// A song leader submits a whole service — every part of it in order, with the
// songs, who does what, the passage and the sermon title — and whoever looks
// after the worship order (the worship-order area) is emailed, looks it over
// and confirms it. Confirming writes its songs into the song tracker
// (song_services / service_songs), which is where the history, the analytics
// and the Record Keeping report read them. The organizer can change a service
// after confirming it, and the tracker follows.
//
// What a service is made of is not fixed here: the parts, and the usual order
// of them for each service, are kept by the organizer (worship_parts,
// worship_outlines). The Serving Schedule already says who is praying and who
// is leading singing, so a new submission starts from that.
//
// Members can ask for a song (song_requests). A request is "planned" once a
// submitted service includes that song, and "done" when that service is
// confirmed.

const db = require('../db');
const library = require('./songLibrary');
const { holdsArea } = require('./areas');
const { dateOf } = require('./blackouts');
const { churchToday, addDays } = require('./recordKeeping');

const STATUSES = ['submitted', 'confirmed'];
const REQUEST_STATUSES = ['open', 'planned', 'done', 'withdrawn', 'declined'];
const isIso = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`));
const clean = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// ─── Who may do what ──────────────────────────────────────────────────────────

const isApproved = user => !!user && user.role !== 'pending';
const canOrganize = user => holdsArea(user, 'worship-order');
const keepsSongs  = user => holdsArea(user, 'songs');

// Names are written "Blair Kiel" in one place and "Kiel, Blair" in another.
const nameKey = name => String(name || '').toLowerCase().replace(/[^a-z ,]/g, '').split(/[\s,]+/).filter(Boolean).sort().join(' ');

function nameOf(user) {
  if (user?.directory_id) {
    const row = db.prepare('SELECT name FROM directory WHERE id = ?').get(user.directory_id);
    if (row?.name) return row.name;
  }
  return user?.name || '';
}

// ─── Services and the Serving Schedule ────────────────────────────────────────

function serviceType(name) {
  return db.prepare('SELECT * FROM service_types WHERE lower(name) = lower(?)').get(String(name || '')) || null;
}

function activeServices() {
  return db.prepare('SELECT id, name, weekday, tracking, song_names FROM service_types WHERE active = 1 ORDER BY sort_order, name').all();
}

// The Serving Schedule names its services its own way.
function servingServiceFor(name) {
  if (/wed/i.test(name)) return 'Wednesday';
  if (/\b(pm|evening|night)\b/i.test(name)) return 'Sunday Evening';
  if (/sunday/i.test(name)) return 'Sunday Worship';
  return null;
}

// Who the Serving Schedule has down for each job at one service.
function servingFor(date, service) {
  const wanted = servingServiceFor(service);
  const jobs = {};
  if (wanted) {
    for (const r of db.prepare("SELECT month, date, service, job, name FROM job_assignments WHERE month <> '' AND service = ?").all(wanted)) {
      if (dateOf(r.month, r.date) !== date || !r.name) continue;
      (jobs[r.job] ||= []).push(r.name);
    }
  }
  const leaderJob = Object.keys(jobs).find(j => /^song\s*lead/i.test(j));
  return { jobs, leader: leaderJob ? jobs[leaderJob].join(', ') : '' };
}

function isScheduledLeader(user, date, service) {
  const mine = nameKey(nameOf(user));
  if (!mine) return false;
  const { jobs } = servingFor(date, service);
  return Object.entries(jobs).some(([job, names]) => /^song\s*lead/i.test(job) && names.some(n => nameKey(n) === mine));
}

function canSubmit(user, date, service) {
  if (!isApproved(user)) return false;
  return keepsSongs(user) || canOrganize(user) || isScheduledLeader(user, date, service);
}

function canEdit(user, plan) {
  if (!plan || !isApproved(user)) return false;
  if (canOrganize(user)) return true;
  if (plan.status !== 'submitted') return false;
  return plan.submittedBy === user.id || canSubmit(user, plan.date, plan.service);
}

// ─── Parts and the usual order ────────────────────────────────────────────────

function toPart(r) {
  return {
    id: r.id, name: r.name,
    takesSong: !!r.takes_song, takesPerson: !!r.takes_person,
    detailLabel: r.detail_label, servingJob: r.serving_job,
    active: !!r.active, sortOrder: r.sort_order,
  };
}

function listParts({ includeRetired = true } = {}) {
  return db.prepare(`SELECT * FROM worship_parts ${includeRetired ? '' : 'WHERE active = 1'} ORDER BY sort_order, name`).all().map(toPart);
}

function partFields(fields, before = {}) {
  const name = clean(fields.name ?? before.name, 60);
  if (!name) return { error: 'A part needs a name' };
  const takesSong   = fields.takesSong   ?? before.takesSong   ?? false;
  const takesPerson = fields.takesPerson ?? before.takesPerson ?? false;
  const detailLabel = clean(fields.detailLabel ?? before.detailLabel ?? '', 40);
  if (!takesSong && !takesPerson && !detailLabel) return { error: 'A part has to collect something: a song, a person, or a detail' };
  return {
    name, takesSong: !!takesSong, takesPerson: !!takesPerson, detailLabel,
    servingJob: clean(fields.servingJob ?? before.servingJob ?? '', 60),
    active: fields.active ?? before.active ?? true,
  };
}

function addPart(fields) {
  const f = partFields(fields);
  if (f.error) return f;
  if (db.prepare('SELECT 1 FROM worship_parts WHERE lower(name) = lower(?)').get(f.name)) return { error: `There is already a part called ${f.name}` };
  const { top } = db.prepare('SELECT MAX(sort_order) AS top FROM worship_parts').get();
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO worship_parts (name, takes_song, takes_person, detail_label, serving_job, active, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(f.name, +f.takesSong, +f.takesPerson, f.detailLabel, f.servingJob, +!!f.active, (top ?? -1) + 1);
  return { part: toPart(db.prepare('SELECT * FROM worship_parts WHERE id = ?').get(lastInsertRowid)) };
}

function updatePart(id, fields) {
  const row = db.prepare('SELECT * FROM worship_parts WHERE id = ?').get(Number(id));
  if (!row) return { error: 'No such part' };
  const before = toPart(row);
  const f = partFields(fields, before);
  if (f.error) return f;
  if (db.prepare('SELECT 1 FROM worship_parts WHERE lower(name) = lower(?) AND id <> ?').get(f.name, row.id)) return { error: `There is already a part called ${f.name}` };
  db.prepare(`
    UPDATE worship_parts SET name = ?, takes_song = ?, takes_person = ?, detail_label = ?, serving_job = ?, active = ? WHERE id = ?
  `).run(f.name, +f.takesSong, +f.takesPerson, f.detailLabel, f.servingJob, +!!f.active, row.id);
  return { before, part: toPart(db.prepare('SELECT * FROM worship_parts WHERE id = ?').get(row.id)) };
}

// The part ids, in order. A service with no order of its own uses the default.
function outlineFor(serviceTypeId) {
  const own = serviceTypeId
    ? db.prepare('SELECT part_id FROM worship_outlines WHERE service_type_id = ? ORDER BY position').all(serviceTypeId)
    : [];
  const rows = own.length ? own
    : db.prepare('SELECT part_id FROM worship_outlines WHERE service_type_id IS NULL ORDER BY position').all();
  return { partIds: rows.map(r => r.part_id), own: own.length > 0 };
}

function outlines() {
  return {
    default: outlineFor(null).partIds,
    services: activeServices().map(s => ({ id: s.id, name: s.name, ...outlineFor(s.id) })),
  };
}

// `partIds` null takes a service back to the default order.
function setOutline(serviceTypeId, partIds) {
  if (serviceTypeId !== null && !db.prepare('SELECT 1 FROM service_types WHERE id = ?').get(serviceTypeId)) return { error: 'No such service' };
  if (partIds !== null) {
    if (!Array.isArray(partIds) || partIds.length > 60) return { error: 'An order is a list of parts' };
    const known = new Set(listParts().map(p => p.id));
    if (partIds.some(id => !known.has(Number(id)))) return { error: 'That order names a part that does not exist' };
    if (serviceTypeId === null && !partIds.length) return { error: 'The default order needs at least one part' };
  }
  db.transaction(() => {
    db.prepare(`DELETE FROM worship_outlines WHERE ${serviceTypeId === null ? 'service_type_id IS NULL' : 'service_type_id = ?'}`)
      .run(...(serviceTypeId === null ? [] : [serviceTypeId]));
    const add = db.prepare('INSERT INTO worship_outlines (service_type_id, part_id, position) VALUES (?, ?, ?)');
    (partIds || []).forEach((id, i) => add.run(serviceTypeId, Number(id), i));
  })();
  return { outline: outlineFor(serviceTypeId) };
}

// ─── Plans ────────────────────────────────────────────────────────────────────

function toPlan(row, { items = true } = {}) {
  if (!row) return null;
  const plan = {
    id: row.id, date: row.date, service: row.service, leader: row.leader, notes: row.notes,
    status: row.status,
    submittedBy: row.submitted_by, submittedByName: row.submitted_by_name, submittedAt: row.submitted_at,
    confirmedBy: row.confirmed_by, confirmedByName: row.confirmed_by_name, confirmedAt: row.confirmed_at,
    updatedAt: row.updated_at, songServiceId: row.song_service_id,
  };
  if (items) {
    plan.items = db.prepare(`
      SELECT i.*, s.title, s.hymnal, s.number, p.takes_song, p.takes_person, p.detail_label
        FROM worship_plan_items i
        LEFT JOIN songs s ON s.id = i.song_id
        LEFT JOIN worship_parts p ON p.id = i.part_id
       WHERE i.plan_id = ? ORDER BY i.position
    `).all(row.id).map(i => ({
      partId: i.part_id, partName: i.part_name,
      takesSong: i.part_id ? !!i.takes_song : !!i.song_id,
      takesPerson: i.part_id ? !!i.takes_person : !!i.person,
      detailLabel: i.part_id ? i.detail_label : (i.detail ? 'Detail' : ''),
      song: i.song_id ? { id: i.song_id, title: i.title, hymnal: i.hymnal, number: i.number } : null,
      person: i.person, detail: i.detail,
    }));
  }
  return plan;
}

function getPlan(id) {
  return toPlan(db.prepare('SELECT * FROM worship_plans WHERE id = ?').get(Number(id)));
}

function planFor(date, service) {
  return toPlan(db.prepare('SELECT * FROM worship_plans WHERE date = ? AND lower(service) = lower(?)').get(date, service));
}

function plansBetween(from, to) {
  return db.prepare('SELECT * FROM worship_plans WHERE date BETWEEN ? AND ? ORDER BY date, service')
    .all(from, to).map(r => toPlan(r));
}

// A blank service to fill in: the usual order for it, with whoever the
// Serving Schedule has down already against each part that says who.
function template(date, service) {
  const type = serviceType(service);
  const { jobs, leader } = servingFor(date, service);
  const parts = new Map(listParts().map(p => [p.id, p]));
  const items = outlineFor(type?.id ?? null).partIds.map(id => parts.get(id)).filter(p => p?.active).map(p => ({
    partId: p.id, partName: p.name, takesSong: p.takesSong, takesPerson: p.takesPerson, detailLabel: p.detailLabel,
    song: null,
    person: p.takesPerson && p.servingJob ? (jobs[p.servingJob] || []).join(', ') : '',
    detail: '',
  }));
  return { date, service, leader, items, serving: jobs };
}

// Reads what the form sent into rows, or says what is wrong with it.
function readItems(items) {
  if (!Array.isArray(items) || !items.length) return { error: 'A service needs at least one part' };
  if (items.length > 60) return { error: 'That is more parts than a service has' };
  const parts = new Map(listParts().map(p => [p.id, p]));
  const out = [];
  for (const [i, item] of items.entries()) {
    const part = parts.get(Number(item?.partId));
    if (!part) return { error: `Part ${i + 1} is not one of the service parts` };
    const songId = item.songId ?? item.song?.id ?? null;
    let song = null;
    if (part.takesSong) {
      song = songId ? library.get(songId) : null;
      if (!song) return { error: `Choose a song for part ${i + 1} (${part.name}), or remove it` };
    }
    out.push({
      partId: part.id, partName: part.name, songId: song?.id ?? null,
      person: part.takesPerson ? clean(item.person, 100) : '',
      detail: part.detailLabel ? clean(item.detail, 200) : '',
    });
  }
  return { items: out };
}

function writeItems(planId, items) {
  db.prepare('DELETE FROM worship_plan_items WHERE plan_id = ?').run(planId);
  const add = db.prepare('INSERT INTO worship_plan_items (plan_id, position, part_id, part_name, song_id, person, detail) VALUES (?, ?, ?, ?, ?, ?, ?)');
  items.forEach((it, i) => add.run(planId, i, it.partId, it.partName, it.songId, it.person, it.detail));
}

// Submit a service, or change one already submitted. Returns the plan and
// whether it was new, so the caller knows whether to tell the organizer.
function submit(user, { date, service, leader, notes, items }) {
  if (!isIso(date)) return { error: 'Choose the date of the service' };
  const type = serviceType(service);
  if (!type || !type.active) return { error: 'Choose which service it is' };
  if (!canSubmit(user, date, type.name)) {
    return { error: 'Only the song leader on the Serving Schedule for that service, or whoever keeps the songs, can submit it', status: 403 };
  }
  const read = readItems(items);
  if (read.error) return read;

  const existing = planFor(date, type.name);
  if (existing && !canEdit(user, existing)) {
    return { error: `${existing.submittedByName || 'Somebody'} has already submitted this service${existing.status === 'confirmed' ? ', and it has been confirmed' : ''}`, status: 409 };
  }

  const fields = {
    leader: clean(leader, 100) || servingFor(date, type.name).leader || nameOf(user),
    notes:  clean(notes, 1000),
  };

  const id = db.transaction(() => {
    let planId = existing?.id;
    if (planId) {
      db.prepare("UPDATE worship_plans SET leader = ?, notes = ?, updated_at = datetime('now') WHERE id = ?").run(fields.leader, fields.notes, planId);
    } else {
      planId = db.prepare(`
        INSERT INTO worship_plans (date, service, leader, notes, status, submitted_by, submitted_by_name)
        VALUES (?, ?, ?, ?, 'submitted', ?, ?)
      `).run(date, type.name, fields.leader, fields.notes, user?.id ?? null, nameOf(user)).lastInsertRowid;
    }
    writeItems(planId, read.items);
    return planId;
  })();

  let plan = getPlan(id);
  const planned = syncRequests(plan);
  // A confirmed service being corrected: the tracker follows.
  if (plan.status === 'confirmed') { writeToTracker(plan); plan = getPlan(id); }
  return { plan, created: !existing, before: existing, planned };
}

function confirm(user, id) {
  const plan = getPlan(id);
  if (!plan) return { error: 'No such service', status: 404 };
  if (!canOrganize(user)) return { error: 'Only whoever looks after the worship order can confirm a service', status: 403 };
  if (plan.status === 'confirmed') return { error: 'That service is already confirmed' };

  db.transaction(() => {
    db.prepare(`
      UPDATE worship_plans SET status = 'confirmed', confirmed_by = ?, confirmed_by_name = ?, confirmed_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ?
    `).run(user?.id ?? null, nameOf(user), plan.id);
    writeToTracker(getPlan(plan.id));
    db.prepare("UPDATE song_requests SET status = 'done', updated_at = datetime('now') WHERE plan_id = ? AND status = 'planned'").run(plan.id);
  })();
  return { plan: getPlan(plan.id) };
}

// Withdraw a service nobody has confirmed yet. Requests it would have answered
// go back to waiting.
function remove(user, id) {
  const plan = getPlan(id);
  if (!plan) return { error: 'No such service', status: 404 };
  if (plan.status === 'confirmed') return { error: 'A confirmed service can be changed, not withdrawn' };
  if (!canEdit(user, plan)) return { error: 'You cannot withdraw that service', status: 403 };
  db.transaction(() => {
    db.prepare("UPDATE song_requests SET status = 'open', plan_id = NULL, updated_at = datetime('now') WHERE plan_id = ? AND status = 'planned'").run(plan.id);
    db.prepare('DELETE FROM worship_plans WHERE id = ?').run(plan.id);
  })();
  return { removed: plan };
}

// What the song tracker calls this service ('AM', 'Wednesday', …), so a
// confirmed service sits with the rest of that service's history.
function trackerName(service) {
  const type = serviceType(service);
  const alias = String(type?.song_names || '').split(',').map(s => s.trim()).find(Boolean);
  return alias || service;
}

function writeToTracker(plan) {
  const name = trackerName(plan.service);
  let serviceId = plan.songServiceId && db.prepare('SELECT id FROM song_services WHERE id = ?').get(plan.songServiceId)?.id;
  // A service already on file for that day — imported, say — is the same
  // service, not a second one.
  serviceId ||= db.prepare('SELECT id FROM song_services WHERE date = ? AND lower(service) = lower(?) ORDER BY id LIMIT 1').get(plan.date, name)?.id;

  if (serviceId) {
    db.prepare('UPDATE song_services SET date = ?, service = ?, leader = ? WHERE id = ?').run(plan.date, name, plan.leader, serviceId);
  } else {
    serviceId = library.nextPortalId('song_services');
    db.prepare("INSERT INTO song_services (id, date, service, leader, source) VALUES (?, ?, ?, ?, 'portal')").run(serviceId, plan.date, name, plan.leader);
  }
  db.prepare('DELETE FROM service_songs WHERE service_id = ?').run(serviceId);
  const add = db.prepare('INSERT OR IGNORE INTO service_songs (service_id, song_id, position) VALUES (?, ?, ?)');
  plan.items.filter(i => i.song).forEach((i, at) => add.run(serviceId, i.song.id, at));
  db.prepare('UPDATE worship_plans SET song_service_id = ? WHERE id = ?').run(serviceId, plan.id);
  return serviceId;
}

// ─── Requests ─────────────────────────────────────────────────────────────────

function toRequest(r) {
  return {
    id: r.id, status: r.status, forDate: r.for_date, note: r.note,
    requestedBy: r.requested_by, requesterName: r.requester_name,
    createdAt: r.created_at, updatedAt: r.updated_at,
    song: { id: r.song_id, title: r.title, hymnal: r.hymnal, number: r.number },
    plan: r.plan_id ? { id: r.plan_id, date: r.plan_date, service: r.plan_service } : null,
  };
}

const REQUEST_SELECT = `
  SELECT r.*, s.title, s.hymnal, s.number, p.date AS plan_date, p.service AS plan_service
    FROM song_requests r
    JOIN songs s ON s.id = r.song_id
    LEFT JOIN worship_plans p ON p.id = r.plan_id
`;

function getRequest(id) {
  const row = db.prepare(`${REQUEST_SELECT} WHERE r.id = ?`).get(Number(id));
  return row ? toRequest(row) : null;
}

function listRequests({ statuses = ['open', 'planned'], limit = 200 } = {}) {
  const wanted = statuses.filter(s => REQUEST_STATUSES.includes(s));
  if (!wanted.length) return [];
  return db.prepare(`
    ${REQUEST_SELECT} WHERE r.status IN (${wanted.map(() => '?').join(',')})
    ORDER BY CASE WHEN r.for_date = '' THEN 1 ELSE 0 END, r.for_date, r.created_at DESC LIMIT ?
  `).all(...wanted, limit).map(toRequest);
}

function addRequest(user, { songId, forDate = '', note = '' }) {
  if (!isApproved(user)) return { error: 'Your account has to be approved first', status: 403 };
  const song = library.get(songId);
  if (!song) return { error: 'Choose a song from the list, or add it first' };
  if (forDate && !isIso(forDate)) return { error: 'That is not a date' };
  if (forDate && forDate < churchToday()) return { error: 'That date has passed' };
  const same = db.prepare("SELECT id FROM song_requests WHERE song_id = ? AND requested_by = ? AND status IN ('open', 'planned')").get(song.id, user.id);
  if (same) return { error: 'You have already asked for that song', status: 409 };
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO song_requests (song_id, requested_by, requester_name, for_date, note) VALUES (?, ?, ?, ?, ?)
  `).run(song.id, user.id, nameOf(user), forDate || '', clean(note, 300));
  return { request: getRequest(lastInsertRowid) };
}

// The person who asked may withdraw it; whoever keeps the songs or the worship
// order may decline it, mark it done, or open it again.
function setRequestStatus(user, id, status) {
  const request = getRequest(id);
  if (!request) return { error: 'No such request', status: 404 };
  if (!REQUEST_STATUSES.includes(status) || status === 'planned') return { error: 'That is not something a request can be set to' };
  const manager = keepsSongs(user) || canOrganize(user);
  const own = request.requestedBy && request.requestedBy === user?.id;
  if (!(manager || (own && status === 'withdrawn'))) return { error: 'You cannot change that request', status: 403 };
  db.prepare(`UPDATE song_requests SET status = ?, plan_id = ${status === 'open' ? 'NULL' : 'plan_id'}, updated_at = datetime('now') WHERE id = ?`).run(status, request.id);
  return { before: request, request: getRequest(request.id) };
}

// A submitted service that has a requested song answers the request; changing
// the service so it no longer does puts the request back. Returns the requests
// newly planned, so their askers can be told.
function syncRequests(plan) {
  const songs = [...new Set(plan.items.filter(i => i.song).map(i => i.song.id))];
  const marks = songs.map(() => '?').join(',');
  db.prepare(`
    UPDATE song_requests SET status = 'open', plan_id = NULL, updated_at = datetime('now')
     WHERE plan_id = ? AND status = 'planned' ${songs.length ? `AND song_id NOT IN (${marks})` : ''}
  `).run(plan.id, ...songs);
  if (!songs.length) return [];

  const newly = db.prepare(`
    SELECT id FROM song_requests
     WHERE status = 'open' AND song_id IN (${marks}) AND (for_date = '' OR for_date <= ?)
  `).all(...songs, plan.date).map(r => r.id);
  const set = db.prepare(`UPDATE song_requests SET status = ?, plan_id = ?, updated_at = datetime('now') WHERE id = ?`);
  for (const id of newly) set.run(plan.status === 'confirmed' ? 'done' : 'planned', plan.id, id);
  return newly.map(getRequest);
}

// ─── The page's overview ──────────────────────────────────────────────────────

// The services coming up: every weekly one on its day, and anything else
// somebody has already submitted for, over the next `days`.
function upcoming(user, { days = 14, today = churchToday() } = {}) {
  const until = addDays(today, days - 1);
  const slots = new Map();
  for (const s of activeServices()) {
    if (s.tracking !== 'weekly' || s.weekday === null) continue;
    for (let d = 0; d < days; d++) {
      const date = addDays(today, d);
      if (new Date(`${date}T12:00:00Z`).getUTCDay() === s.weekday) slots.set(`${date}|${s.name}`, { date, service: s.name });
    }
  }
  for (const p of plansBetween(today, until)) slots.set(`${p.date}|${p.service}`, { date: p.date, service: p.service });

  const order = new Map(activeServices().map((s, i) => [s.name, i]));
  return [...slots.values()]
    .sort((a, b) => a.date.localeCompare(b.date) || (order.get(a.service) ?? 99) - (order.get(b.service) ?? 99))
    .map(({ date, service }) => {
      const plan = planFor(date, service);
      return {
        date, service,
        leader: plan?.leader || servingFor(date, service).leader,
        plan,
        canSubmit: canSubmit(user, date, service),
        canEdit: plan ? canEdit(user, plan) : false,
      };
    });
}

function holdersOfOrganizer() {
  const holders = db.prepare(`
    SELECT u.id, u.name, u.email FROM users u JOIN user_areas a ON a.user_id = u.id
     WHERE a.area = 'worship-order' AND u.role = 'approved'
  `).all();
  return holders.length ? holders : db.prepare("SELECT id, name, email FROM users WHERE role = 'admin'").all();
}

module.exports = {
  STATUSES, REQUEST_STATUSES,
  canOrganize, keepsSongs, canSubmit, canEdit, isScheduledLeader,
  servingFor, servingServiceFor, trackerName,
  listParts, addPart, updatePart, outlines, outlineFor, setOutline,
  getPlan, planFor, plansBetween, template, submit, confirm, remove,
  getRequest, listRequests, addRequest, setRequestStatus,
  upcoming, holdersOfOrganizer,
};
