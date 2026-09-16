import { useState, useMemo } from 'react';

// Assignments with no date of their own are not part of any week — the monthly
// visual preparation is the one that behaves this way — so they are called out
// above the table rather than being dropped into an arbitrary Sunday.
const MONTHLY_JOBS = new Set(['Visual Preparation']);

export default function JobAssignments({ data }) {
  const all = useMemo(() => data?.assignments || [], [data]);

  const weeks = useMemo(() => {
    const seen = [];
    for (const a of all) {
      if (a.date && !MONTHLY_JOBS.has(a.job) && !seen.includes(a.date)) seen.push(a.date);
    }
    return seen;
  }, [all]);

  const [week, setWeek] = useState('');

  if (!data) {
    return (
      <div className="card flex items-center justify-center h-48 text-gray-400">
        No data — click Update Site to load.
      </div>
    );
  }

  // The chosen week, until the roster is refreshed out from under it.
  const selected = weeks.includes(week) ? week : (weeks[0] || '');
  const rows     = all.filter(a => a.date === selected && !MONTHLY_JOBS.has(a.job));
  const monthly  = all.filter(a => MONTHLY_JOBS.has(a.job) && a.name);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h2 className="section-heading mb-1">Serving Schedule</h2>
          {data.month && <p className="text-sm text-gray-500">{data.month}</p>}
        </div>

        {weeks.length > 0 && (
          <label className="text-sm text-gray-500 flex items-center gap-2">
            <span className="whitespace-nowrap">Week of</span>
            <select
              value={selected}
              onChange={e => setWeek(e.target.value)}
              aria-label="Week"
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-church-navy font-medium focus:outline-none focus:ring-2 focus:ring-church-navy"
            >
              {weeks.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
        )}
      </div>

      {monthly.length > 0 && (
        <p className="text-xs text-gray-500">
          {monthly.map(m => `${m.job}: ${m.name}`).join(' · ')} <span className="text-gray-400">(all month)</span>
        </p>
      )}

      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-church-navy text-left text-xs text-gray-300 uppercase tracking-wide">
              <th className="px-4 py-3 w-1/2">Job</th>
              <th className="px-4 py-3">Name</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                <td className="px-4 py-2 font-medium text-church-navy">{r.job}</td>
                <td className="px-4 py-2">{r.name || <span className="text-gray-300">—</span>}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={2} className="px-4 py-12 text-center text-gray-400">
                  Nobody is rostered yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
