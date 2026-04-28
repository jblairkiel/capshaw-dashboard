import { useState, useEffect, useRef, useCallback } from 'react';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatDate = (str) => {
  if (!str) return null;
  const d = new Date(str + 'T12:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
};

const INTERVALS = [5, 8, 12, 20];

// ─── Item editor ──────────────────────────────────────────────────────────────

function Field({ label, children }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</label>
      {children}
    </div>
  );
}

function ItemEditor({ initial, onSave, onCancel }) {
  const isEdit = !!initial?.id;
  const [type,      setType]      = useState(initial?.type      || 'announcement');
  const [title,     setTitle]     = useState(initial?.title     || '');
  const [body,      setBody]      = useState(initial?.body      || '');
  const [priority,  setPriority]  = useState(initial?.priority  || 'normal');
  const [eventDate, setEventDate] = useState(initial?.event_date || '');
  const [eventTime, setEventTime] = useState(initial?.event_time || '');
  const [location,  setLocation]  = useState(initial?.location  || '');
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState('');

  const handleSave = async () => {
    if (!title.trim()) { setError('Title is required.'); return; }
    setSaving(true); setError('');
    const payload = {
      type, title: title.trim(), body: body.trim(), priority,
      event_date: eventDate || null,
      event_time: eventTime.trim() || null,
      location:   location.trim()  || null,
      active: initial?.active ?? 1,
    };
    try {
      const url    = isEdit ? `/api/announcements/${initial.id}` : '/api/announcements';
      const method = isEdit ? 'PUT' : 'POST';
      const res    = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const json   = await res.json();
      if (!json.success) throw new Error(json.error);
      onSave(isEdit ? { ...initial, ...payload } : json.item);
    } catch (e) { setError(e.message); }
    finally     { setSaving(false); }
  };

  return (
    <div className="card space-y-4 border-2 border-church-gold">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-church-navy">{isEdit ? 'Edit Item' : 'New Item'}</h3>
        <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
      </div>

      {/* Type */}
      <Field label="Type">
        <div className="flex gap-2">
          {[['announcement','📢 Announcement'],['event','📅 Event']].map(([val, lbl]) => (
            <button key={val} onClick={() => setType(val)}
              className={`flex-1 py-2.5 rounded-lg font-medium text-sm border-2 transition-all ${type === val ? 'bg-church-navy text-church-gold border-church-gold' : 'bg-white text-church-navy border-gray-200 hover:border-church-gold'}`}
            >{lbl}</button>
          ))}
        </div>
      </Field>

      {/* Priority (announcements only) */}
      {type === 'announcement' && (
        <Field label="Priority">
          <div className="flex gap-2">
            {[['normal','Normal'],['urgent','⚠️ Urgent']].map(([val, lbl]) => (
              <button key={val} onClick={() => setPriority(val)}
                className={`flex-1 py-2 rounded-lg font-medium text-sm border-2 transition-all ${priority === val
                  ? val === 'urgent' ? 'bg-red-600 text-white border-red-600' : 'bg-church-navy text-church-gold border-church-gold'
                  : 'bg-white text-gray-700 border-gray-200 hover:border-church-gold'}`}
              >{lbl}</button>
            ))}
          </div>
        </Field>
      )}

      {/* Title */}
      <Field label="Title">
        <input
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold"
          placeholder={type === 'event' ? 'e.g. Men\'s Fellowship Breakfast' : 'e.g. Vacation Bible School Registration Open'}
          value={title} onChange={e => setTitle(e.target.value)}
        />
      </Field>

      {/* Body */}
      <Field label={type === 'event' ? 'Description (optional)' : 'Details (optional)'}>
        <textarea
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold resize-none"
          rows={3} placeholder="Additional details shown on the display slide…"
          value={body} onChange={e => setBody(e.target.value)}
        />
      </Field>

      {/* Event fields */}
      {type === 'event' && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Date">
            <input type="date" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold"
              value={eventDate} onChange={e => setEventDate(e.target.value)} />
          </Field>
          <Field label="Time">
            <input type="text" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold"
              placeholder="e.g. 8:00 AM" value={eventTime} onChange={e => setEventTime(e.target.value)} />
          </Field>
          <Field label="Location">
            <input type="text" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold"
              placeholder="e.g. Fellowship Hall" value={location} onChange={e => setLocation(e.target.value)} />
          </Field>
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex gap-2 pt-1">
        <button onClick={onCancel} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-500 hover:bg-gray-50 transition-colors">Cancel</button>
        <button onClick={handleSave} disabled={saving}
          className="flex-1 py-2 bg-church-gold text-church-navy font-bold rounded-lg text-sm hover:bg-amber-400 disabled:opacity-50 transition-colors"
        >{saving ? 'Saving…' : isEdit ? 'Update' : 'Save'}</button>
      </div>
    </div>
  );
}

// ─── Item card (manage view) ──────────────────────────────────────────────────

function ItemCard({ item, onEdit, onDelete, onToggle, canWrite }) {
  const isEvent  = item.type === 'event';
  const isUrgent = item.priority === 'urgent';

  return (
    <div className={`card flex gap-4 border-l-4 transition-opacity ${item.active ? 'opacity-100' : 'opacity-50'} ${isUrgent ? 'border-l-red-500' : isEvent ? 'border-l-blue-500' : 'border-l-church-gold'}`}>
      <div className="text-2xl pt-0.5">{isEvent ? '📅' : isUrgent ? '⚠️' : '📢'}</div>

      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-start gap-2 flex-wrap">
          <span className={`text-xs font-bold px-2 py-0.5 rounded uppercase tracking-wide shrink-0 ${
            isUrgent ? 'bg-red-100 text-red-700' : isEvent ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'
          }`}>{isUrgent ? 'Urgent' : isEvent ? 'Event' : 'Announcement'}</span>
          {!item.active && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded font-medium">Inactive</span>}
        </div>
        <p className="font-semibold text-church-navy leading-snug">{item.title}</p>
        {isEvent && (
          <div className="flex flex-wrap gap-3 text-xs text-gray-500">
            {item.event_date && <span>📆 {formatDate(item.event_date)}</span>}
            {item.event_time && <span>🕐 {item.event_time}</span>}
            {item.location   && <span>📍 {item.location}</span>}
          </div>
        )}
        {item.body && <p className="text-sm text-gray-500 line-clamp-2">{item.body}</p>}
      </div>

      {canWrite && (
        <div className="flex flex-col gap-1.5 shrink-0">
          <button onClick={() => onToggle(item)} title={item.active ? 'Deactivate' : 'Activate'}
            className={`p-1.5 rounded-lg text-xs font-bold border transition-colors ${item.active
              ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
              : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100'}`}
          >{item.active ? '✓ On' : '○ Off'}</button>
          <button onClick={() => onEdit(item)} className="p-1.5 rounded-lg text-gray-400 hover:text-church-navy hover:bg-gray-50 border border-transparent hover:border-gray-200 transition-colors" title="Edit">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
          </button>
          <button onClick={() => onDelete(item.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 border border-transparent hover:border-red-100 transition-colors" title="Delete">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Fullscreen display ───────────────────────────────────────────────────────

function FullscreenDisplay({ items, onExit }) {
  const [idx,       setIdx]       = useState(0);
  const [paused,    setPaused]    = useState(false);
  const [interval,  setInterval_] = useState(8);
  const [showCtrl,  setShowCtrl]  = useState(true);
  const [,          setNativeFS]  = useState(false);
  const overlayRef = useRef(null);
  const hideTimer  = useRef(null);

  const total = items.length;
  const item  = items[idx] ?? null;

  const next = useCallback(() => setIdx(i => (i + 1) % Math.max(total, 1)), [total]);
  const prev = useCallback(() => setIdx(i => (i - 1 + total) % Math.max(total, 1)), [total]);

  // Auto-advance
  useEffect(() => {
    if (paused || total <= 1) return;
    const id = setInterval(next, interval * 1000);
    return () => clearInterval(id);
  }, [paused, total, interval, next, idx]);

  // Keyboard nav
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === ' ') { e.preventDefault(); setPaused(p => !p); }
      else if (e.key === 'Escape' && !document.fullscreenElement) onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, onExit]);

  // Native fullscreen
  useEffect(() => {
    const el = overlayRef.current;
    if (el?.requestFullscreen) {
      el.requestFullscreen().then(() => setNativeFS(true)).catch(() => {});
    } else if (el?.webkitRequestFullscreen) {
      el.webkitRequestFullscreen(); setNativeFS(true);
    }
    const onFSChange = () => {
      if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        setNativeFS(false); onExit();
      }
    };
    document.addEventListener('fullscreenchange', onFSChange);
    document.addEventListener('webkitfullscreenchange', onFSChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFSChange);
      document.removeEventListener('webkitfullscreenchange', onFSChange);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, [onExit]);

  // Auto-hide controls
  const showControls = () => {
    setShowCtrl(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShowCtrl(false), 3000);
  };
  useEffect(() => { showControls(); return () => clearTimeout(hideTimer.current); }, []);

  const isEvent  = item?.type === 'event';
  const isUrgent = item?.priority === 'urgent';

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex flex-col select-none cursor-none"
      style={{ background: '#0f1a2e' }}
      onMouseMove={showControls}
      onClick={showControls}
    >
      <style>{`@keyframes pgbar{from{width:0}to{width:100%}} @keyframes fadeUp{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:translateY(0)}}`}</style>

      {/* Top controls */}
      <div className={`flex items-center justify-between px-6 py-4 transition-opacity duration-500 ${showCtrl ? 'opacity-100' : 'opacity-0'}`}
        style={{ cursor: showCtrl ? 'default' : 'none' }}>
        <div className="flex items-center gap-3">
          <span className="text-church-gold font-bold text-sm tracking-widest uppercase">Capshaw Church of Christ</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Interval */}
          <div className="flex gap-1">
            {INTERVALS.map(s => (
              <button key={s} onClick={() => setInterval_(s)}
                className={`px-2 py-1 rounded text-xs font-bold transition-colors ${interval === s ? 'bg-church-gold text-church-navy' : 'text-gray-500 hover:text-gray-200'}`}
              >{s}s</button>
            ))}
          </div>
          {/* Pause */}
          <button onClick={() => setPaused(p => !p)}
            className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors" title={paused ? 'Play' : 'Pause'}>
            {paused
              ? <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
              : <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
            }
          </button>
          {/* Exit */}
          <button onClick={onExit}
            className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors" title="Exit (Esc)">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Slide content */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 sm:px-16 text-center">
        {!item ? (
          <div className="space-y-4">
            <p className="text-gray-500 text-xl">No active announcements or events.</p>
            <button onClick={onExit} className="text-church-gold underline text-sm">Exit fullscreen</button>
          </div>
        ) : (
          <div key={idx} style={{ animation: 'fadeUp 0.5s ease forwards' }} className="space-y-6 max-w-4xl w-full">
            {/* Type label */}
            <div className="flex items-center justify-center gap-3">
              <div className={`h-px flex-1 ${isUrgent ? 'bg-red-500/40' : 'bg-church-gold/30'}`} />
              <span className={`text-sm font-bold uppercase tracking-widest ${isUrgent ? 'text-red-400' : isEvent ? 'text-blue-400' : 'text-church-gold'}`}>
                {isUrgent ? '⚠ Urgent Announcement' : isEvent ? '📅 Upcoming Event' : '📢 Announcement'}
              </span>
              <div className={`h-px flex-1 ${isUrgent ? 'bg-red-500/40' : 'bg-church-gold/30'}`} />
            </div>

            {/* Title */}
            <h1 className={`font-bold leading-tight ${
              item.title.length > 40 ? 'text-3xl sm:text-5xl' : 'text-4xl sm:text-6xl'
            } ${isUrgent ? 'text-red-300' : 'text-white'}`}>
              {item.title}
            </h1>

            {/* Event details */}
            {isEvent && (item.event_date || item.event_time || item.location) && (
              <div className="space-y-2">
                {item.event_date && (
                  <p className="text-2xl sm:text-3xl font-semibold text-church-gold">{formatDate(item.event_date)}</p>
                )}
                <div className="flex items-center justify-center gap-6 text-lg text-gray-300">
                  {item.event_time && <span>🕐 {item.event_time}</span>}
                  {item.location   && <span>📍 {item.location}</span>}
                </div>
              </div>
            )}

            {/* Body */}
            {item.body && (
              <p className="text-lg sm:text-2xl text-gray-300 leading-relaxed max-w-3xl mx-auto">{item.body}</p>
            )}
          </div>
        )}
      </div>

      {/* Slide dots + counter */}
      <div className={`flex flex-col items-center gap-3 pb-6 transition-opacity duration-500 ${showCtrl ? 'opacity-100' : 'opacity-30'}`}>
        {total > 1 && (
          <div className="flex items-center gap-4">
            <button onClick={prev} className="text-gray-500 hover:text-white transition-colors p-2">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/>
              </svg>
            </button>
            <div className="flex gap-2">
              {items.map((_, i) => (
                <button key={i} onClick={() => setIdx(i)}
                  className={`rounded-full transition-all ${i === idx ? 'w-6 h-2.5 bg-church-gold' : 'w-2.5 h-2.5 bg-white/25 hover:bg-white/50'}`}
                />
              ))}
            </div>
            <button onClick={next} className="text-gray-500 hover:text-white transition-colors p-2">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/>
              </svg>
            </button>
          </div>
        )}
        <span className="text-xs text-gray-600">{idx + 1} / {total}</span>
      </div>

      {/* Progress bar */}
      {!paused && total > 1 && (
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/5">
          <div key={`${idx}-${interval}`}
            style={{ animation: `pgbar ${interval}s linear forwards` }}
            className="h-full bg-church-gold/60"
          />
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AnnouncementsView({ user }) {
  const canWrite = user?.role === 'admin';
  const [items,       setItems]       = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');
  const [filter,      setFilter]      = useState('all');       // 'all' | 'announcement' | 'event'
  const [showInactive, setShowInactive] = useState(false);
  const [editing,     setEditing]     = useState(null);        // null | 'new' | itemObject
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    fetch('/api/announcements')
      .then(r => r.json())
      .then(j => { if (j.success) setItems(j.items); else setError(j.error); })
      .catch(() => setError('Could not load announcements.'))
      .finally(() => setLoading(false));
  }, []);

  const handleSaved = (saved) => {
    setItems(prev => editing?.id ? prev.map(i => i.id === saved.id ? saved : i) : [saved, ...prev]);
    setEditing(null);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this item?')) return;
    await fetch(`/api/announcements/${id}`, { method: 'DELETE' });
    setItems(prev => prev.filter(i => i.id !== id));
  };

  const handleToggle = async (item) => {
    const res  = await fetch(`/api/announcements/${item.id}/toggle`, { method: 'PATCH' });
    const json = await res.json();
    if (json.success) setItems(prev => prev.map(i => i.id === item.id ? { ...i, active: json.active } : i));
  };

  const activeItems   = items.filter(i => i.active);
  const filteredItems = items.filter(i => {
    if (!showInactive && !i.active) return false;
    if (filter !== 'all' && i.type !== filter) return false;
    return true;
  });

  if (isFullscreen) {
    return <FullscreenDisplay items={activeItems} onExit={() => setIsFullscreen(false)} />;
  }

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="section-heading mb-0">Announcements &amp; Events</h2>
          <p className="text-sm text-gray-400 mt-0.5">
            {activeItems.length} active · {items.length} total
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setIsFullscreen(true)}
            disabled={activeItems.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border-2 border-church-navy text-church-navy font-medium text-sm hover:bg-church-navy hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0-4l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5h-4m4 0v-4m0 4l-5-5"/>
            </svg>
            Fullscreen Display
          </button>
          {canWrite && (
            <button onClick={() => setEditing('new')} className="btn-primary flex items-center gap-1.5 text-sm px-4">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/>
              </svg>
              Add Item
            </button>
          )}
        </div>
      </div>

      {/* Editor (inline) */}
      {editing !== null && (
        <ItemEditor
          initial={editing === 'new' ? null : editing}
          onSave={handleSaved}
          onCancel={() => setEditing(null)}
        />
      )}

      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex rounded-lg border border-gray-200 overflow-hidden">
          {[['all','All'],['announcement','Announcements'],['event','Events']].map(([val, lbl]) => (
            <button key={val} onClick={() => setFilter(val)}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${filter === val ? 'bg-church-navy text-church-gold' : 'text-gray-600 hover:bg-gray-50'}`}
            >{lbl}</button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-500 cursor-pointer select-none">
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)}
            className="accent-church-navy rounded" />
          Show inactive
        </label>
        <span className="text-xs text-gray-400 ml-auto">{filteredItems.length} item{filteredItems.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Loading / error */}
      {loading && (
        <div className="flex justify-center py-12">
          <span className="animate-spin w-7 h-7 border-2 border-church-gold border-t-transparent rounded-full" />
        </div>
      )}
      {!loading && error && <p className="text-sm text-red-600 text-center py-6">{error}</p>}

      {/* Empty state */}
      {!loading && !error && filteredItems.length === 0 && (
        <div className="card flex flex-col items-center justify-center py-16 text-gray-400 space-y-3">
          <svg className="w-12 h-12 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z"/>
          </svg>
          <p className="text-sm font-medium">No items to show</p>
          <p className="text-xs">
            {items.length > 0 ? 'Try changing the filter or enabling "Show inactive".' : 'Click "+ Add Item" to create your first announcement or event.'}
          </p>
        </div>
      )}

      {/* List */}
      {!loading && filteredItems.length > 0 && (
        <div className="space-y-3">
          {filteredItems.map(item => (
            <ItemCard
              key={item.id}
              item={item}
              onEdit={setEditing}
              onDelete={handleDelete}
              onToggle={handleToggle}
              canWrite={canWrite}
            />
          ))}
        </div>
      )}

      {/* Fullscreen hint */}
      {activeItems.length > 0 && !loading && (
        <div className="card bg-church-navy/5 border border-church-navy/10 flex items-center gap-3 py-3">
          <svg className="w-5 h-5 text-church-gold shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          <p className="text-sm text-gray-600">
            <strong className="text-church-navy">{activeItems.length} active item{activeItems.length !== 1 ? 's' : ''}</strong> will display in fullscreen mode.
            Use ←→ arrow keys to navigate, Space to pause, Esc to exit.
          </p>
        </div>
      )}
    </div>
  );
}
