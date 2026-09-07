import { useState, useEffect } from 'react';
import axios from 'axios';
import CommentThread from './CommentThread';

const API = '/api';

const formatEventDate = (value) => {
  if (!value) return '';
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
};

// ─── An event posted on the dashboard ─────────────────────────────────────────

// The events the congregation adds here, as opposed to the ones scraped from
// capshawchurch.org: these have an id of their own, so they can be talked
// about.
function EventCard({ event, canComment }) {
  const [showComments, setShowComments] = useState(false);
  const [count, setCount] = useState(event.comment_count ?? 0);

  return (
    <div className="card border-l-4 border-l-blue-500 space-y-2">
      <h3 className="font-semibold text-church-navy">{event.title}</h3>

      <div className="flex flex-wrap gap-3 text-xs text-gray-500">
        {event.event_date && <span>📆 {formatEventDate(event.event_date)}</span>}
        {event.event_time && <span>🕐 {event.event_time}</span>}
        {event.location   && <span>📍 {event.location}</span>}
      </div>

      {event.body && <p className="text-sm text-gray-600 whitespace-pre-wrap">{event.body}</p>}

      {canComment ? (
        <>
          <button
            onClick={() => setShowComments(open => !open)}
            aria-expanded={showComments}
            className="text-xs text-gray-500 hover:text-church-navy"
          >
            💬 {count || 'No'} comment{count === 1 ? '' : 's'}
            <span className="ml-1 text-gray-300">{showComments ? '▲' : '▼'}</span>
          </button>

          {showComments && (
            <div className="pt-3 border-t border-gray-100">
              <CommentThread subjectType="event" subjectId={event.id} onCountChange={setCount} />
            </div>
          )}
        </>
      ) : (
        <p className="text-xs text-gray-400">Sign in to join the conversation about this event.</p>
      )}
    </div>
  );
}

export default function CalendarView({ user }) {
  const [events,  setEvents]  = useState([]);
  const [counts,  setCounts]  = useState({});
  const [calData, setCalData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  // Events posted on the dashboard, which is where the conversation happens.
  useEffect(() => {
    fetch('/api/announcements')
      .then(r => r.json())
      .then(j => {
        if (!j.success) return;
        setEvents(j.items.filter(i => i.type === 'event' && i.active));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!user || !events.length) return;
    const ids = events.map(e => e.id).join(',');
    fetch(`/api/comments/event/counts?ids=${ids}`, { credentials: 'include' })
      .then(r => r.json())
      .then(j => { if (j.success) setCounts(j.counts); })
      .catch(() => {});
  }, [user, events]);

  async function fetchCalendar() {
    setLoading(true);
    setError('');
    try {
      const { data } = await axios.get(`${API}/scraper/calendar`);
      if (data.success) {
        setCalData(data.data);
      } else {
        setError(data.error || 'Could not load calendar');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Network error');
    } finally {
      setLoading(false);
    }
  }

  async function clearCache() {
    await axios.delete(`${API}/scraper/cache`);
    setCalData(null);
    setError('Cache cleared — click Load again.');
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="section-heading mb-0">Church Calendar</h2>
        <div className="flex gap-2">
          <button onClick={clearCache} className="text-xs text-gray-500 hover:underline">
            Clear Cache
          </button>
          <button onClick={fetchCalendar} className="btn-primary text-sm">
            {loading ? 'Loading…' : 'Sync from capshawchurch.org'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-church-gold"></div>
        </div>
      )}

      {/* Events posted on the dashboard */}
      {events.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-church-navy">Church events</h3>
          {events
            .slice()
            .sort((a, b) => String(a.event_date || '').localeCompare(String(b.event_date || '')))
            .map(event => (
              <EventCard
                key={event.id}
                event={{ ...event, comment_count: counts[event.id] ?? 0 }}
                canComment={!!user}
              />
            ))}
        </div>
      )}

      {/* Structured events scraped from capshawchurch.org */}
      {calData?.events?.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {calData.events.map((event, i) => (
            <div key={i} className="card hover:shadow-lg transition-shadow">
              <h3 className="font-semibold text-church-navy mb-1">{event.title}</h3>
              {event.date && (
                <p className="text-church-gold text-sm font-medium mb-1">{event.date}</p>
              )}
              {event.description && (
                <p className="text-gray-600 text-sm">{event.description}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Raw text fallback */}
      {calData?.rawText && !calData?.events?.length && (
        <div className="card">
          <h3 className="section-heading">Calendar Content</h3>
          <pre className="text-xs whitespace-pre-wrap text-gray-700 font-mono leading-relaxed">
            {calData.rawText}
          </pre>
        </div>
      )}

      {/* Regular service times — always visible */}
      <div className="card bg-church-navy text-white">
        <h3 className="text-church-gold font-serif text-lg font-semibold mb-4">Regular Service Schedule</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="text-church-gold font-medium text-sm uppercase tracking-wider mb-2">Sunday</p>
            <ul className="space-y-1 text-sm text-gray-200">
              <li>9:00 AM &mdash; Bible Study</li>
              <li>9:50 AM &mdash; Worship Service</li>
            </ul>
          </div>
          <div>
            <p className="text-church-gold font-medium text-sm uppercase tracking-wider mb-2">Wednesday</p>
            <ul className="space-y-1 text-sm text-gray-200">
              <li>7:00 PM &mdash; Bible Study</li>
            </ul>
          </div>
        </div>
        <p className="mt-4 text-xs text-gray-400">
          8941 Wall Triana Hwy &bull; Harvest, AL 35749 &bull; (256) 742-1012
        </p>
      </div>

      {/* Empty state */}
      {!calData && !loading && !error && (
        <div className="card flex flex-col items-center justify-center h-48 text-gray-400">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-12 h-12 mb-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <p className="text-center">Click &quot;Sync&quot; to load upcoming events from capshawchurch.org</p>
        </div>
      )}
    </div>
  );
}
