import { useState, useEffect, useCallback, useMemo } from 'react';
import { isAdmin } from '../lib/roles';

// The calendar is a view over announcements, not a store of its own. Anything
// with an event_date shows up here, and adding or editing a day writes back to
// the announcements table — so the two can never drift apart.
const API = '/api/announcements';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Dates are stored as plain YYYY-MM-DD. Parsing them with `new Date(str)`
// would read them as UTC and shift the day backwards for anyone west of
// Greenwich, so the pieces are handled as text throughout.
function toKey(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function monthLabel(year, month) {
  return new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function todayKey() {
  const now = new Date();
  return toKey(now.getFullYear(), now.getMonth(), now.getDate());
}

// Weeks of the month, padded with the blank leading/trailing days a grid needs.
function buildWeeks(year, month) {
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth  = new Date(year, month + 1, 0).getDate();

  const cells = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

const BLANK = { type: 'event', title: '', body: '', event_date: '', event_time: '', location: '', priority: 'normal', active: 1 };

// ─── Add / edit an event ──────────────────────────────────────────────────────

function EventModal({ event, onSaved, onClose, onDeleted }) {
  const isNew = !event?.id;
  const [form, setForm]   = useState({ ...BLANK, ...event });
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');

  const set = (key, value) => setForm(p => ({ ...p, [key]: value }));

  async function submit(e) {
    e.preventDefault();
    if (!form.title.trim()) return setError('A title is required');
    setBusy(true); setError('');
    try {
      const res = await fetch(isNew ? API : `${API}/${event.id}`, {
        method:      isNew ? 'POST' : 'PUT',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify(form),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Could not save');
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm('Delete this event?')) return;
    setBusy(true);
    try {
      const res  = await fetch(`${API}/${event.id}`, { method: 'DELETE', credentials: 'include' });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Could not delete');
      onDeleted();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const field = 'mt-1 block w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold';
  const labelText = 'text-xs font-medium text-gray-500 uppercase tracking-wide';

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-5 space-y-4"
      >
        <h3 className="font-semibold text-church-navy">{isNew ? 'New event' : 'Edit event'}</h3>

        <label className="block">
          <span className={labelText}>Title <span className="text-red-400" aria-hidden="true">*</span></span>
          <input autoFocus required value={form.title} onChange={e => set('title', e.target.value)} className={field} />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={labelText}>Date</span>
            <input type="date" value={form.event_date || ''} onChange={e => set('event_date', e.target.value)} className={field} />
          </label>
          <label className="block">
            <span className={labelText}>Time</span>
            <input placeholder="6:00 PM" value={form.event_time || ''} onChange={e => set('event_time', e.target.value)} className={field} />
          </label>
        </div>

        <label className="block">
          <span className={labelText}>Location</span>
          <input placeholder="Fellowship Hall" value={form.location || ''} onChange={e => set('location', e.target.value)} className={field} />
        </label>

        <label className="block">
          <span className={labelText}>Details</span>
          <textarea rows={3} value={form.body || ''} onChange={e => set('body', e.target.value)} className={field} />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={labelText}>Shows as</span>
            <select value={form.type} onChange={e => set('type', e.target.value)} className={field}>
              <option value="event">Event</option>
              <option value="announcement">Announcement</option>
            </select>
          </label>
          <label className="block">
            <span className={labelText}>Priority</span>
            <select value={form.priority} onChange={e => set('priority', e.target.value)} className={field}>
              <option value="normal">Normal</option>
              <option value="urgent">Urgent</option>
            </select>
          </label>
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={!!form.active} onChange={e => set('active', e.target.checked ? 1 : 0)} />
          Visible on the announcements page
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button type="submit" disabled={busy} className="btn-primary text-sm disabled:opacity-50">
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={onClose} className="text-sm px-4 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
          {!isNew && (
            <button type="button" onClick={remove} disabled={busy} className="text-sm px-4 py-2 rounded-lg text-red-600 hover:bg-red-50 ml-auto">
              Delete
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

// ─── Calendar ─────────────────────────────────────────────────────────────────

export default function CalendarView({ user }) {
  const now = new Date();
  const [year,  setYear]  = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [items, setItems] = useState([]);
  const [modal, setModal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const canEdit = isAdmin(user);

  const load = useCallback(async () => {
    setError('');
    try {
      const res  = await fetch(API, { credentials: 'include' });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Could not load the calendar');
      setItems(json.items.filter(i => i.event_date));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const byDate = useMemo(() => {
    const map = new Map();
    for (const item of items) {
      if (!map.has(item.event_date)) map.set(item.event_date, []);
      map.get(item.event_date).push(item);
    }
    // Untimed events first, then by the time as written.
    for (const list of map.values()) {
      list.sort((a, b) => (a.event_time || '').localeCompare(b.event_time || ''));
    }
    return map;
  }, [items]);

  const weeks = useMemo(() => buildWeeks(year, month), [year, month]);
  const today = todayKey();

  function shift(by) {
    const next = new Date(year, month + by, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth());
  }

  function goToday() {
    const n = new Date();
    setYear(n.getFullYear());
    setMonth(n.getMonth());
  }

  const monthCount = items.filter(i => i.event_date?.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`)).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="section-heading mb-0">Church Calendar</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {monthCount} {monthCount === 1 ? 'event' : 'events'} this month · shared with Announcements
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => shift(-1)} aria-label="Previous month" className="px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">‹</button>
          <button onClick={goToday} className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50">Today</button>
          <button onClick={() => shift(1)} aria-label="Next month" className="px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">›</button>
          {canEdit && (
            <button onClick={() => setModal({ ...BLANK, event_date: toKey(year, month, 1) })} className="btn-primary text-sm">
              Add event
            </button>
          )}
        </div>
      </div>

      <h3 className="text-lg font-semibold text-church-navy">{monthLabel(year, month)}</h3>

      {error && <div className="card border border-red-200 bg-red-50 text-sm text-red-700">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-church-gold" />
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="grid grid-cols-7 border-b border-gray-100 bg-gray-50/60">
            {WEEKDAYS.map(d => (
              <div key={d} className="px-2 py-2 text-xs font-medium text-gray-500 text-center">{d}</div>
            ))}
          </div>

          {weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7 border-b border-gray-100 last:border-b-0">
              {week.map((day, di) => {
                if (day === null) return <div key={di} className="min-h-24 bg-gray-50/40 border-r border-gray-100 last:border-r-0" />;

                const key    = toKey(year, month, day);
                const events = byDate.get(key) || [];
                const isToday = key === today;

                return (
                  <div
                    key={di}
                    onClick={canEdit ? () => setModal({ ...BLANK, event_date: key }) : undefined}
                    className={`min-h-24 p-1.5 border-r border-gray-100 last:border-r-0 align-top ${
                      canEdit ? 'cursor-pointer hover:bg-church-gold/5' : ''
                    } ${isToday ? 'bg-church-gold/10' : ''}`}
                  >
                    <span className={`text-xs ${isToday ? 'font-bold text-church-navy' : 'text-gray-400'}`}>{day}</span>
                    <div className="mt-1 space-y-1">
                      {events.map(ev => (
                        <button
                          key={ev.id}
                          onClick={e => { e.stopPropagation(); if (canEdit) setModal(ev); }}
                          title={[ev.event_time, ev.location].filter(Boolean).join(' · ') || ev.title}
                          className={`block w-full text-left text-xs px-1.5 py-1 rounded leading-tight truncate ${
                            !ev.active            ? 'bg-gray-100 text-gray-400 line-through'
                            : ev.priority === 'urgent' ? 'bg-red-100 text-red-800'
                            : ev.type === 'event'      ? 'bg-church-navy/10 text-church-navy'
                            :                            'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {ev.event_time && <span className="opacity-70">{ev.event_time} </span>}
                          {ev.title}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {!canEdit && (
        <p className="text-xs text-gray-400">
          Events come from the announcements page. Ask an admin to add or change one.
        </p>
      )}

      {modal && (
        <EventModal
          event={modal}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
          onDeleted={() => { setModal(null); load(); }}
        />
      )}
    </div>
  );
}
