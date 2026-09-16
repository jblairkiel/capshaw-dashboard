const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { holdsArea } = require('../middleware/auth');
const actionLog = require('../lib/actionLog');

// ─── Who may write here ───────────────────────────────────────────────────────
//
// This one table is two pages. The announcement board is everything in it; the
// church calendar is the rows with a date on them. So:
//
//   · Announcements & Events — may write any row
//   · Church Calendar        — may write dated rows only
//
// A calendar editor adding an undated notice would be posting to the
// announcement board, which is somebody else's area, so it is refused rather
// than quietly allowed.
function isDated(row) {
  return !!String(row?.event_date || '').trim();
}

function mayWrite(user, row) {
  if (holdsArea(user, 'announcements')) return true;
  return holdsArea(user, 'calendar') && isDated(row);
}

// The area a write is recorded under, so the history separates a calendar edit
// from an announcement one.
function areaUsed(user) {
  return holdsArea(user, 'announcements') ? 'announcements' : 'calendar';
}

function refuse(res, dated) {
  return res.status(403).json({
    success: false,
    error: dated
      ? 'You do not look after announcements or the church calendar. Ask an admin if you should.'
      : 'Only whoever looks after announcements can post something without a date. Give it a date to put it on the calendar.',
    areas: ['announcements', 'calendar'],
  });
}

function guard(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, error: 'Authentication required' });
  if (!mayWrite(req.user, req.body)) return refuse(res, isDated(req.body));
  next();
}

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM announcements ORDER BY active DESC, created_at DESC').all();
  res.json({ success: true, items: rows });
});

router.post('/', guard, (req, res) => {
  const { type = 'announcement', title, body = '', event_date = null, event_time = null, location = null, priority = 'normal' } = req.body;
  if (!title?.trim()) return res.status(400).json({ success: false, error: 'title is required' });
  const { lastInsertRowid: id } = db
    .prepare('INSERT INTO announcements (type,title,body,event_date,event_time,location,priority) VALUES (?,?,?,?,?,?,?)')
    .run(type, title.trim(), body.trim(), event_date || null, event_time?.trim() || null, location?.trim() || null, priority);
  const item = db.prepare('SELECT * FROM announcements WHERE id=?').get(id);

  actionLog.record(req.user, {
    area:     areaUsed(req.user),
    action:   'create',
    entity:   isDated(item) ? 'event' : 'announcement',
    entityId: id,
    summary:  `Added ${isDated(item) ? 'event' : 'announcement'} "${item.title}"${item.event_date ? ` on ${item.event_date}` : ''}`,
    after:    item,
  });
  res.json({ success: true, item });
});

router.put('/:id', (req, res) => {
  if (!req.user) return res.status(401).json({ success: false, error: 'Authentication required' });

  const before = db.prepare('SELECT * FROM announcements WHERE id=?').get(req.params.id);
  if (!before) return res.status(404).json({ success: false, error: 'not found' });
  // Both what it is now and what it would become have to be yours to edit —
  // otherwise a calendar editor could take the date off an event and walk it
  // onto the announcement board.
  if (!mayWrite(req.user, before) || !mayWrite(req.user, req.body)) {
    return refuse(res, isDated(before) && isDated(req.body));
  }

  const { title, body = '', event_date = null, event_time = null, location = null, priority = 'normal' } = req.body;
  if (!title?.trim()) return res.status(400).json({ success: false, error: 'title is required' });
  // Anything the edit form did not send keeps what the row already had, rather
  // than being blanked by an undefined.
  const type   = req.body.type   ?? before.type;
  const active = req.body.active ?? before.active;
  db.prepare('UPDATE announcements SET type=?,title=?,body=?,event_date=?,event_time=?,location=?,priority=?,active=? WHERE id=?')
    .run(type, title.trim(), body.trim(), event_date || null, event_time?.trim() || null, location?.trim() || null, priority, active, req.params.id);

  const after = db.prepare('SELECT * FROM announcements WHERE id=?').get(req.params.id);
  actionLog.record(req.user, {
    area:     areaUsed(req.user),
    action:   'update',
    entity:   isDated(after) ? 'event' : 'announcement',
    entityId: req.params.id,
    summary:  `Edited ${isDated(after) ? 'event' : 'announcement'} "${after.title}"`,
    before,
    after,
  });
  res.json({ success: true });
});

router.patch('/:id/toggle', (req, res) => {
  if (!req.user) return res.status(401).json({ success: false, error: 'Authentication required' });

  const row = db.prepare('SELECT * FROM announcements WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ success: false, error: 'not found' });
  if (!mayWrite(req.user, row)) return refuse(res, isDated(row));

  const next = row.active ? 0 : 1;
  db.prepare('UPDATE announcements SET active=? WHERE id=?').run(next, req.params.id);

  actionLog.record(req.user, {
    area:     areaUsed(req.user),
    action:   'update',
    entity:   isDated(row) ? 'event' : 'announcement',
    entityId: req.params.id,
    summary:  `${next ? 'Showed' : 'Hid'} "${row.title}"`,
    details:  { active: next },
  });
  res.json({ success: true, active: next });
});

router.delete('/:id', (req, res) => {
  if (!req.user) return res.status(401).json({ success: false, error: 'Authentication required' });

  const row = db.prepare('SELECT * FROM announcements WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ success: false, error: 'not found' });
  if (!mayWrite(req.user, row)) return refuse(res, isDated(row));

  db.prepare('DELETE FROM announcements WHERE id=?').run(req.params.id);
  actionLog.record(req.user, {
    area:     areaUsed(req.user),
    action:   'delete',
    entity:   isDated(row) ? 'event' : 'announcement',
    entityId: req.params.id,
    summary:  `Deleted ${isDated(row) ? 'event' : 'announcement'} "${row.title}"`,
    before:   row,
  });
  res.json({ success: true });
});

module.exports = router;
