import { useState, useEffect, useRef, useCallback } from 'react';

const formatDate = (str) => {
  if (!str) return null;
  const d = new Date(str + 'T12:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
};

const INTERVALS = [5, 8, 12, 20];

export default function AnnouncementsDisplay() {
  const [items,    setItems]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [idx,      setIdx]      = useState(0);
  const [paused,   setPaused]   = useState(false);
  const [interval, setInterval_] = useState(8);
  const [showCtrl, setShowCtrl] = useState(true);
  const overlayRef = useRef(null);
  const hideTimer  = useRef(null);

  useEffect(() => {
    fetch('/api/announcements')
      .then(r => r.json())
      .then(j => {
        if (j.success) setItems(j.items.filter(i => i.active));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const total = items.length;

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
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev]);

  // Native fullscreen on mount
  useEffect(() => {
    const el = overlayRef.current;
    if (el?.requestFullscreen) {
      el.requestFullscreen().catch(() => {});
    } else if (el?.webkitRequestFullscreen) {
      el.webkitRequestFullscreen();
    }
  }, []);

  // Auto-hide controls
  const showControls = () => {
    setShowCtrl(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShowCtrl(false), 3000);
  };
  useEffect(() => {
    showControls();
    return () => clearTimeout(hideTimer.current);
  }, []);

  const item     = items[idx] ?? null;
  const isEvent  = item?.type === 'event';
  const isUrgent = item?.priority === 'urgent';

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: '#0f1a2e' }}>
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-church-gold" />
      </div>
    );
  }

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex flex-col select-none cursor-none"
      style={{ background: '#0f1a2e' }}
      onMouseMove={showControls}
      onClick={showControls}
    >
      <style>{`@keyframes pgbar{from{width:0}to{width:100%}} @keyframes fadeUp{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:translateY(0)}}`}</style>

      {/* Top bar */}
      <div className={`flex items-center justify-between px-6 py-4 transition-opacity duration-500 ${showCtrl ? 'opacity-100' : 'opacity-0'}`}
        style={{ cursor: showCtrl ? 'default' : 'none' }}>
        <span className="text-church-gold font-bold text-sm tracking-widest uppercase">Capshaw Church of Christ</span>
        <div className="flex items-center gap-2">
          {INTERVALS.map(s => (
            <button key={s} onClick={() => setInterval_(s)}
              className={`px-2 py-1 rounded text-xs font-bold transition-colors ${interval === s ? 'bg-church-gold text-church-navy' : 'text-gray-500 hover:text-gray-200'}`}
            >{s}s</button>
          ))}
          <button onClick={() => setPaused(p => !p)}
            className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors">
            {paused
              ? <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
              : <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
            }
          </button>
        </div>
      </div>

      {/* Slide content */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 sm:px-16 text-center">
        {!item ? (
          <p className="text-gray-500 text-xl">No active announcements or events.</p>
        ) : (
          <div key={idx} style={{ animation: 'fadeUp 0.5s ease forwards' }} className="space-y-6 max-w-4xl w-full">
            <div className="flex items-center justify-center gap-3">
              <div className={`h-px flex-1 ${isUrgent ? 'bg-red-500/40' : 'bg-church-gold/30'}`} />
              <span className={`text-sm font-bold uppercase tracking-widest ${isUrgent ? 'text-red-400' : isEvent ? 'text-blue-400' : 'text-church-gold'}`}>
                {isUrgent ? '⚠ Urgent Announcement' : isEvent ? '📅 Upcoming Event' : '📢 Announcement'}
              </span>
              <div className={`h-px flex-1 ${isUrgent ? 'bg-red-500/40' : 'bg-church-gold/30'}`} />
            </div>

            <h1 className={`font-bold leading-tight ${
              item.title.length > 40 ? 'text-3xl sm:text-5xl' : 'text-4xl sm:text-6xl'
            } ${isUrgent ? 'text-red-300' : 'text-white'}`}>
              {item.title}
            </h1>

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

            {item.body && (
              <p className="text-lg sm:text-2xl text-gray-300 leading-relaxed max-w-3xl mx-auto">{item.body}</p>
            )}
          </div>
        )}
      </div>

      {/* Nav dots */}
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
        <span className="text-xs text-gray-600">{idx + 1} / {Math.max(total, 1)}</span>
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
