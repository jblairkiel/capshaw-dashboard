const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { requireAdmin } = require('../middleware/auth');

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
  res.json({ success: true, item });
});

router.put('/:id', requireAdmin, (req, res) => {
  const { type, title, body = '', event_date = null, event_time = null, location = null, priority = 'normal', active } = req.body;
  if (!title?.trim()) return res.status(400).json({ success: false, error: 'title is required' });
  db.prepare('UPDATE announcements SET type=?,title=?,body=?,event_date=?,event_time=?,location=?,priority=?,active=? WHERE id=?')
    .run(type, title.trim(), body.trim(), event_date || null, event_time?.trim() || null, location?.trim() || null, priority, active ?? 1, req.params.id);
  res.json({ success: true });
});

router.patch('/:id/toggle', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT active FROM announcements WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ success: false, error: 'not found' });
  const next = row.active ? 0 : 1;
  db.prepare('UPDATE announcements SET active=? WHERE id=?').run(next, req.params.id);
  res.json({ success: true, active: next });
});

router.delete('/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM announcements WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
