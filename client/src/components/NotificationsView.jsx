import { useState, useEffect, useCallback } from 'react';
import { call, jsonBody, timeAgo, fullTimestamp } from '../lib/notifications';

const API = '/api/notifications';

// ─── One notification ─────────────────────────────────────────────────────────

function Item({ item, icon, onOpen, onToggleRead }) {
  return (
    <div className={`card flex gap-3 border-l-4 transition-colors ${
      item.read ? 'border-l-gray-200' : 'border-l-church-gold bg-church-gold/5'
    }`}>
      <div className="text-xl pt-0.5 shrink-0">{icon}</div>

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">{item.typeLabel}</span>
          <span className="text-xs text-gray-400" title={fullTimestamp(item.createdAt)}>{timeAgo(item.createdAt)}</span>
        </div>
        <p className={`text-sm leading-snug ${item.read ? 'text-gray-600' : 'text-church-navy font-semibold'}`}>
          {item.title}
        </p>
        {item.body && <p className="text-xs text-gray-500 whitespace-pre-wrap line-clamp-3">{item.body}</p>}

        <div className="flex gap-3 pt-0.5">
          {item.tab && (
            <button onClick={() => onOpen(item)} className="text-xs text-church-navy underline hover:text-church-gold">
              Open it
            </button>
          )}
          <button onClick={() => onToggleRead(item)} className="text-xs text-gray-400 hover:text-church-navy">
            {item.read ? 'Mark unread' : 'Mark read'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── The inbox ────────────────────────────────────────────────────────────────

// Everything the site has told this person, in drawers by category — the same
// categories their email settings are grouped by, so "I get too many of these"
// and "stop emailing me these" are the same idea in two places.
export default function NotificationsView({ onNavigate }) {
  const [items,      setItems]      = useState([]);
  const [categories, setCategories] = useState([]);
  const [summary,    setSummary]    = useState({ unread: 0, categories: {} });
  const [category,   setCategory]   = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams();
      if (category)   params.set('category', category);
      if (unreadOnly) params.set('unread', '1');

      const json = await call(`${API}?${params}`);
      setItems(json.items);
      setCategories(json.categories);
      setSummary(json.summary);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [category, unreadOnly]);

  useEffect(() => { load(); }, [load]);

  async function mark(payload) {
    try {
      await call(`${API}/read`, { method: 'POST', ...jsonBody(payload) });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  function open(item) {
    mark({ ids: [item.id] });
    onNavigate?.(item.tab);
  }

  const iconFor = id => categories.find(c => c.id === id)?.icon || '🔔';
  const drawers = categories.filter(c => c.total > 0);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="section-heading mb-0">Notifications</h2>
          <p className="text-sm text-gray-400 mt-0.5">
            {summary.unread ? `${summary.unread} unread` : 'Nothing unread'}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => mark(category ? { category } : {})}
            disabled={!summary.unread}
            className="text-sm px-3 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          >
            {category ? 'Mark this drawer read' : 'Mark all read'}
          </button>
        </div>
      </div>

      {/* Drawers */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setCategory('')}
          className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
            category === '' ? 'bg-church-navy text-church-gold border-church-navy' : 'border-gray-200 text-gray-600 hover:border-church-gold'
          }`}
        >
          All
          {summary.unread > 0 && <span className="ml-1.5 text-xs">({summary.unread})</span>}
        </button>
        {drawers.map(drawer => (
          <button
            key={drawer.id}
            onClick={() => setCategory(drawer.id)}
            title={drawer.description}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              category === drawer.id ? 'bg-church-navy text-church-gold border-church-navy' : 'border-gray-200 text-gray-600 hover:border-church-gold'
            }`}
          >
            <span className="mr-1">{drawer.icon}</span>
            {drawer.label}
            {drawer.unread > 0 && <span className="ml-1.5 text-xs">({drawer.unread})</span>}
          </button>
        ))}
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-500 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={unreadOnly}
          onChange={e => setUnreadOnly(e.target.checked)}
          className="accent-church-navy rounded"
        />
        Unread only
      </label>

      {loading && (
        <div className="flex justify-center py-10">
          <span className="animate-spin w-7 h-7 border-2 border-church-gold border-t-transparent rounded-full" />
        </div>
      )}
      {!loading && error && <p className="text-sm text-red-600">{error}</p>}

      {!loading && !error && items.length === 0 && (
        <div className="card flex flex-col items-center justify-center py-14 text-gray-400 space-y-2">
          <span className="text-3xl opacity-40">🔔</span>
          <p className="text-sm font-medium">Nothing here</p>
          <p className="text-xs text-center max-w-sm">
            Comments, announcements, events, workflow tasks and the worship schedule all land here.
            Choose what reaches your email under My Info.
          </p>
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="space-y-3">
          {items.map(item => (
            <Item
              key={item.id}
              item={item}
              icon={iconFor(item.category)}
              onOpen={open}
              onToggleRead={i => mark({ ids: [i.id], read: !i.read })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
