import { useState } from 'react';
import axios from 'axios';

const API = '/api';

export default function CalendarView() {
  const [calData, setCalData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

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

      {/* Structured events */}
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
