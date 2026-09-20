import { useState, useEffect, useCallback, useRef } from 'react';
import { call, timeAgo } from '../lib/groups';

// ─── The bell ─────────────────────────────────────────────────────────────────
//
// What has happened that this person has not seen yet: a meeting posted for
// their group, a reply on an event they are part of, somebody answering their
// invitation.
//
// Two deliberate choices about how it behaves:
//
//   · opening the panel does not mark everything read. Reading the list is not
//     the same as dealing with what is in it, and a bell that empties itself
//     the moment it is glanced at loses things.
//   · picking one marks that one and goes to the page it is about, which is
//     the only action most of them ever need.

const POLL_MS = 60_000;

export default function NotificationsBell({ onGoToPage }) {
  const [items,  setItems]  = useState([]);
  const [unread, setUnread] = useState(0);
  const [open,   setOpen]   = useState(false);
  const [loaded, setLoaded] = useState(false);
  const ref = useRef(null);

  const refreshCount = useCallback(() => {
    call('/api/notifications/count')
      .then(json => setUnread(json.unread ?? 0))
      // A bell that cannot be reached is a bell with nothing in it, not an
      // error across the top of the portal.
      .catch(() => {});
  }, []);

  const loadList = useCallback(() => {
    call('/api/notifications?limit=30')
      .then(json => { setItems(json.notifications ?? []); setUnread(json.unread ?? 0); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, []);

  useEffect(() => {
    refreshCount();
    const timer = setInterval(refreshCount, POLL_MS);
    return () => clearInterval(timer);
  }, [refreshCount]);

  useEffect(() => {
    const close = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) loadList();
  }

  async function markRead(ids) {
    try {
      const json = await call('/api/notifications/read', {
        method: 'POST',
        body: JSON.stringify(ids ? { ids } : {}),
      });
      setUnread(json.unread ?? 0);
      setItems(list => list.map(n => (!ids || ids.includes(n.id) ? { ...n, read: true } : n)));
    } catch { /* leave the badge as it was rather than lying about it */ }
  }

  function pick(notification) {
    if (!notification.read) markRead([notification.id]);
    if (notification.page) onGoToPage?.(notification.page);
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={toggle}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        className="relative flex items-center rounded-lg p-2 hover:bg-white/10 transition-colors"
      >
        <svg className="w-5 h-5 text-gray-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-church-gold text-church-navy text-[11px] font-bold flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-80 max-w-[calc(100vw-1.5rem)] bg-white rounded-xl shadow-lg border border-gray-100 z-30 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100">
            <p className="text-sm font-semibold text-church-navy">Notifications</p>
            {unread > 0 && (
              <button onClick={() => markRead(null)} className="text-xs text-church-gold hover:underline">
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {!loaded ? (
              <p className="px-4 py-6 text-sm text-gray-400 text-center">Loading…</p>
            ) : items.length === 0 ? (
              <p className="px-4 py-6 text-sm text-gray-400 text-center">Nothing new.</p>
            ) : (
              items.map(item => (
                <button
                  key={item.id}
                  onClick={() => pick(item)}
                  className={`w-full text-left px-4 py-3 border-b border-gray-50 last:border-0 transition-colors hover:bg-gray-50 ${
                    item.read ? '' : 'bg-church-cream/60'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {!item.read && <span className="w-1.5 h-1.5 rounded-full bg-church-gold mt-1.5 shrink-0" />}
                    <div className="min-w-0">
                      <p className={`text-sm leading-snug ${item.read ? 'text-gray-600' : 'text-church-navy font-medium'}`}>
                        {item.title}
                      </p>
                      {item.body && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{item.body}</p>}
                      <p className="text-xs text-gray-400 mt-0.5">{timeAgo(item.createdAt)}</p>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
