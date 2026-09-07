const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { requireAdmin } = require('../middleware/auth');
const notifications = require('../notifications');
const mailer = require('../mail/mailer');

// ─── Telling the congregation ─────────────────────────────────────────────────
// Posting, changing or taking down an announcement or a calendar event is
// activity the whole site can see, so each of those raises a notification of
// its own type. An urgent announcement is its own type rather than a flag, so
// somebody can leave the ordinary ones for their digest and still be told
// straight away when something matters.

function typeFor(item, action) {
  if (item.type === 'event') return `event.${action === 'created' ? 'posted' : action}`;
  if (action === 'created' && item.priority === 'urgent') return 'announcement.urgent';
  if (action === 'created') return 'announcement.posted';
  return `announcement.${action}`;
}

function describe(item) {
  return [
    item.body,
    item.event_date ? `When: ${[item.event_date, item.event_time].filter(Boolean).join(' ')}` : '',
    item.location   ? `Where: ${item.location}` : '',
  ].filter(Boolean).join('\n');
}

function announce(item, action, user) {
  const kind = item.type === 'event' ? 'Event' : item.priority === 'urgent' ? 'Urgent' : 'Announcement';
  const verb = { created: '', updated: 'Updated', cancelled: 'Cancelled' }[action] || action;

  try {
    notifications.emit({
      type:        typeFor(item, action),
      title:       `${[kind, verb].filter(Boolean).join(' · ')}: ${item.title}`,
      body:        describe(item),
      subjectType: item.type === 'event' ? 'event' : 'announcement',
      subjectId:   item.id,
      actor:       user,
      context:     `announcement:${item.id}:${action}`,
    });
    mailer.drainOutbox().catch(err => console.error('[mail] drain failed:', err.message));
  } catch (err) {
    console.error('[announcements] could not raise notification:', err.message);
  }
}

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM announcements ORDER BY active DESC, created_at DESC').all();
  res.json({ success: true, items: rows });
});

router.post('/', requireAdmin, (req, res) => {
  const { type = 'announcement', title, body = '', event_date = null, event_time = null, location = null, priority = 'normal' } = req.body;
  if (!title?.trim()) return res.status(400).json({ success: false, error: 'title is required' });
  const { lastInsertRowid: id } = db
    .prepare('INSERT INTO announcements (type,title,body,event_date,event_time,location,priority) VALUES (?,?,?,?,?,?,?)')
    .run(type, title.trim(), body.trim(), event_date || null, event_time?.trim() || null, location?.trim() || null, priority);
  const item = db.prepare('SELECT * FROM announcements WHERE id=?').get(id);
  if (item.active) announce(item, 'created', req.user);
  res.json({ success: true, item });
});

router.put('/:id', requireAdmin, (req, res) => {
  const { type, title, body = '', event_date = null, event_time = null, location = null, priority = 'normal', active } = req.body;
  if (!title?.trim()) return res.status(400).json({ success: false, error: 'title is required' });
  db.prepare('UPDATE announcements SET type=?,title=?,body=?,event_date=?,event_time=?,location=?,priority=?,active=? WHERE id=?')
    .run(type, title.trim(), body.trim(), event_date || null, event_time?.trim() || null, location?.trim() || null, priority, active ?? 1, req.params.id);
  const item = db.prepare('SELECT * FROM announcements WHERE id=?').get(req.params.id);
  if (item?.active) announce(item, 'updated', req.user);
  res.json({ success: true });
});

// Taking an item off the display is what "cancelled" means here; putting it
// back is an ordinary update.
router.patch('/:id/toggle', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM announcements WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ success: false, error: 'not found' });
  const next = row.active ? 0 : 1;
  db.prepare('UPDATE announcements SET active=? WHERE id=?').run(next, req.params.id);

  const item = { ...row, active: next };
  if (item.type === 'event') announce(item, next ? 'updated' : 'cancelled', req.user);
  else if (next)             announce(item, 'updated', req.user);

  res.json({ success: true, active: next });
});

router.delete('/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM announcements WHERE id=?').get(req.params.id);
  db.prepare('DELETE FROM announcements WHERE id=?').run(req.params.id);
  if (row?.active && row.type === 'event') announce(row, 'cancelled', req.user);
  res.json({ success: true });
});

module.exports = router;
