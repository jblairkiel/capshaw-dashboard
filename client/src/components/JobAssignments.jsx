import { useState } from 'react';

function groupByDate(assignments) {
  const groups = {};
  for (const a of assignments) {
    if (!groups[a.date]) groups[a.date] = [];
    groups[a.date].push(a);
  }
  return groups;
}

function AVColumn({ assignments }) {
  const monthlyPrep = assignments.find(a => a.job === 'Visual Preparation');
  const rotation = assignments.filter(a => a.job === 'Visuals');

  return (
    <div className="card p-0 overflow-hidden flex flex-col">
      <div className="bg-church-navy px-4 py-3">
        <h3 className="text-church-gold font-semibold text-sm">AV Operator</h3>
        {monthlyPrep && (
          <p className="text-gray-300 text-xs mt-0.5">
            Monthly prep: {monthlyPrep.name}
          </p>
        )}
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wide">
            <th className="px-4 py-2">Date</th>
            <th className="px-4 py-2">Operator</th>
          </tr>
        </thead>
        <tbody>
          {rotation.length > 0 ? rotation.map((r, i) => (
            <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
              <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{r.date}</td>
              <td className="px-4 py-2 font-medium text-church-navy">{r.name}</td>
            </tr>
          )) : (
            <tr>
              <td colSpan={2} className="px-4 py-6 text-center text-gray-400 text-xs">
                No AV assignments found
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function JobAssignments({ data }) {
  const [filter, setFilter] = useState('');

  if (!data) {
    return (
      <div className="card flex items-center justify-center h-48 text-gray-400">
        No data — click Update Site to load.
      </div>
    );
  }

  const all = data.assignments || [];

  // AV column uses all assignments (unaffected by filter)
  // Main column excludes Visuals/Visual Preparation (shown in AV column)
  const AV_JOBS = new Set(['Visuals', 'Visual Preparation']);
  const mainAssignments = all.filter(a => !AV_JOBS.has(a.job));

  const groups = groupByDate(mainAssignments);
  const filtered = filter
    ? Object.fromEntries(
        Object.entries(groups)
          .map(([date, rows]) => [
            date,
            rows.filter(r =>
              r.job.toLowerCase().includes(filter.toLowerCase()) ||
              r.name.toLowerCase().includes(filter.toLowerCase()) ||
              r.service.toLowerCase().includes(filter.toLowerCase())
            ),
          ])
          .filter(([, rows]) => rows.length > 0)
      )
    : groups;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="section-heading mb-1">Job Assignments</h2>
          {data.month && <p className="text-sm text-gray-500">{data.month}</p>}
        </div>
        <input
          type="text"
          placeholder="Filter by job, name, or service…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-church-navy w-64"
        />
      </div>

      {/* Two-column layout: stacks on mobile, side-by-side on lg+ */}
      <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 items-start">

        {/* Left: main assignments, scrollable */}
        <div className="flex-1 min-w-0 space-y-4 w-full">
          {Object.entries(filtered).map(([date, rows]) => (
            <div key={date} className="card p-0 overflow-hidden">
              <div className="bg-church-navy px-4 py-2">
                <h3 className="text-church-gold text-sm font-semibold">{date}</h3>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wide">
                    <th className="px-4 py-2 w-1/4">Service</th>
                    <th className="px-4 py-2 w-1/3">Job</th>
                    <th className="px-4 py-2">Name</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-4 py-2 text-gray-500">{r.service}</td>
                      <td className="px-4 py-2 font-medium text-church-navy">{r.job}</td>
                      <td className="px-4 py-2">{r.name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          {Object.keys(filtered).length === 0 && (
            <div className="card text-center text-gray-400 py-12">
              No assignments match your filter.
            </div>
          )}
        </div>

        {/* Right: AV Operator rotation — full width on mobile, fixed sidebar on lg+ */}
        <div className="w-full lg:w-72 lg:shrink-0 lg:sticky lg:top-16">
          <AVColumn assignments={all} />
        </div>

      </div>
    </div>
  );
}
