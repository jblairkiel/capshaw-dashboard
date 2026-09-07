import { useState, useEffect, useCallback, useRef } from 'react';
import { call, timeAgo } from '../lib/notifications';

const API = '/api/notifications';
const POLL_MS = 60 * 1000;

// The unread count in the header, and a peek at the newest few. The count is
// polled rather than pushed: this is a congregation dashboard, not a chat app,
// and a minute-old count is a fair trade for not holding a socket open.
export default function NotificationBell({ onOpenInbox }) {
  const [unread, setUnread] = useState(0);
  const [recent, setRecent] = useState([]);
  const [open,   setOpen]   = useState(false);
  const ref = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const json = await call(`${API}/summary`);
      setUnread(json.summary.unread);
    } catch {
      // A failed poll is not worth telling anybody about; the next one may work.
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    const close = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next) return;
    try {
      const json = await call(`${API}?limit=6`);
      setRecent(json.items);
      setUnread(json.summary.unread);
    } catch {
      setRecent([]);
    }
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={toggle}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        className="relative flex items-center rounded-lg px-2 py-1.5 hover:bg-white/10 transition-colors"
      >
        <svg className="w-5 h-5 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-church-gold text-church-navy text-[11px] font-bold flex items-center justify-center">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-80 max-w-[90vw] bg-white rounded-xl shadow-lg border border-gray-100 z-30 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between">
            <span className="text-sm font-semibold text-church-navy">Notifications</span>
            <span className="text-xs text-gray-400">{unread} unread</span>
          </div>

          <div className="max-h-80 overflow-y-auto divide-y divide-gray-50">
            {recent.length === 0 && (
              <p className="px-4 py-6 text-sm text-gray-400 text-center">Nothing yet.</p>
            )}
            {recent.map(item => (
              <div key={item.id} className={`px-4 py-2.5 ${item.read ? '' : 'bg-church-gold/5'}`}>
                <p className="text-xs text-gray-400">{item.typeLabel} · {timeAgo(item.createdAt)}</p>
                <p className={`text-sm leading-snug ${item.read ? 'text-gray-600' : 'text-church-navy font-medium'}`}>
                  {item.title}
                </p>
              </div>
            ))}
          </div>

          <button
            onClick={() => { setOpen(false); onOpenInbox(); }}
            className="w-full px-4 py-2.5 text-sm text-church-navy font-medium hover:bg-gray-50 border-t border-gray-100"
          >
            Open the inbox
          </button>
        </div>
      )}
    </div>
  );
}
