import { useState, useMemo } from 'react';

function SortIcon({ active, dir }) {
  if (!active) return (
    <svg className="w-3 h-3 opacity-30 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
    </svg>
  );
  return (
    <svg className="w-3 h-3 text-church-gold shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d={dir === 'asc' ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7'} />
    </svg>
  );
}

function SortHeader({ col, label, sort, onSort, className = '' }) {
  return (
    <th className={`px-4 py-3 ${className}`}>
      <button
        onClick={() => onSort(col)}
        aria-label={`Sort by ${label}`}
        className="flex items-center gap-1 font-medium text-xs uppercase tracking-wide hover:text-church-gold transition-colors"
      >
        <span>{label}</span>
        <SortIcon active={sort.col === col} dir={sort.dir} />
      </button>
    </th>
  );
}

// One row per deacon, with everything he looks after in a single cell. Sorting
// and filtering are done here rather than on the server: the whole diaconate
// is a few dozen rows, and they arrive with the rest of the scraped data.
function DeaconGrid({ deacons }) {
  const [filter, setFilter] = useState('');
  const [sort,   setSort]   = useState({ col: 'name', dir: 'asc' });

  function toggleSort(col) {
    setSort(s => (s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' }));
  }

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const matched = deacons.filter(d =>
      !q ||
      d.name.toLowerCase().includes(q) ||
      (d.duties || []).some(duty => duty.toLowerCase().includes(q))
    );

    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...matched].sort((a, b) => (
      sort.col === 'duties'
        ? ((a.duties?.length || 0) - (b.duties?.length || 0)) * dir
        : a.name.localeCompare(b.name) * dir
    ));
  }, [deacons, filter, sort]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="section-heading mb-0">Deacons</h2>
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Filter by name or responsibility…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-church-navy w-72 max-w-full"
          />
          <span className="text-sm text-gray-400 whitespace-nowrap">
            {rows.length} deacon{rows.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      <div className="card p-0 overflow-hidden overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="bg-church-navy text-left text-gray-300">
              <SortHeader col="name"   label="Deacon"           sort={sort} onSort={toggleSort} className="w-56 align-top" />
              <SortHeader col="duties" label="Responsibilities" sort={sort} onSort={toggleSort} className="align-top" />
            </tr>
          </thead>
          <tbody>
            {rows.map((d, i) => (
              <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                <td className="px-4 py-3 font-medium text-church-navy align-top whitespace-nowrap">{d.name}</td>
                <td className="px-4 py-3 align-top">
                  {d.duties?.length ? (
                    <ul className="space-y-1">
                      {d.duties.map((duty, j) => (
                        <li key={j} className="flex gap-2 text-gray-600">
                          <span className="text-church-gold shrink-0">•</span>
                          <span>{duty}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={2} className="px-4 py-12 text-center text-gray-400">
                  {deacons.length ? 'No deacons match your filter.' : 'No deacon data found.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function LeadershipView({ deacons, bulletins }) {
  if (!deacons && !bulletins) {
    return (
      <div className="card flex items-center justify-center h-48 text-gray-400">
        No data — click Update Site to load.
      </div>
    );
  }

  const bulletinList = bulletins || [];

  return (
    <div className="space-y-8">
      <DeaconGrid deacons={deacons || []} />

      {/* Bulletins */}
      <section className="space-y-4">
        <h2 className="section-heading">Recent Bulletins</h2>

        {bulletinList.length > 0 ? (
          <div className="card p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wide">
                  <th className="px-4 py-2">Bulletin</th>
                  <th className="px-4 py-2 text-right">Download</th>
                </tr>
              </thead>
              <tbody>
                {bulletinList.map((b, i) => (
                  <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-4 py-2 text-church-navy">{b.label}</td>
                    <td className="px-4 py-2 text-right">
                      <a
                        href={b.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-church-navy hover:text-church-gold transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        PDF
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="card text-center text-gray-400 py-12">No bulletins found.</div>
        )}
      </section>

    </div>
  );
}
