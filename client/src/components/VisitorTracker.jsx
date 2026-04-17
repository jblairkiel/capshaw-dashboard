import { useState } from 'react';

export default function VisitorTracker({ data }) {
  const [search,   setSearch]   = useState('');
  const [expanded, setExpanded] = useState({});

  if (!data) {
    return (
      <div className="card flex items-center justify-center h-48 text-gray-400">
        No data — click Update Site to load.
      </div>
    );
  }

  const filtered = data.filter(v =>
    !search || v.name.toLowerCase().includes(search.toLowerCase())
  );

  function toggle(i) {
    setExpanded(prev => ({ ...prev, [i]: !prev[i] }));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="section-heading mb-0">Visitor Tracker</h2>
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Search visitors…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-church-navy w-48"
          />
          <span className="text-xs text-gray-400">{filtered.length} visitor{filtered.length !== 1 ? 's' : ''}</span>
        </div>
      </div>

      <div className="space-y-2">
        {filtered.map((v, i) => (
          <div key={i} className="card p-0 overflow-hidden">
            <button
              onClick={() => toggle(i)}
              className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-church-navy text-white text-xs flex items-center justify-center font-bold shrink-0">
                  {v.visits.length}
                </div>
                <div>
                  <p className="font-medium text-church-navy text-sm">{v.name}</p>
                  <p className="text-xs text-gray-400">Last visit: {v.visits[0]?.date || '—'}</p>
                </div>
              </div>
              <svg
                className={`w-4 h-4 text-gray-400 transition-transform shrink-0 ${expanded[i] ? 'rotate-180' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {expanded[i] && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-white text-left text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
                    <th className="px-4 py-2">Date</th>
                    <th className="px-4 py-2">Service</th>
                  </tr>
                </thead>
                <tbody>
                  {v.visits.map((visit, j) => (
                    <tr key={j} className={j % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-4 py-2 text-gray-500">{visit.date}</td>
                      <td className="px-4 py-2">{visit.service}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="card text-center text-gray-400 py-12">No visitors match your search.</div>
        )}
      </div>
    </div>
  );
}
