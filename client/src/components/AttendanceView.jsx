import { useState } from 'react';

const SERVICE_COLORS = {
  'Sun AM':                 'bg-blue-100 text-blue-800',
  'Sun AM Bible Study':     'bg-indigo-100 text-indigo-800',
  'Sun Bible Study':        'bg-indigo-100 text-indigo-800',
  'Wed Bible Study':        'bg-green-100 text-green-800',
  'Monthly Singing':        'bg-yellow-100 text-yellow-800',
  'Gospel Meeting':         'bg-orange-100 text-orange-800',
  'Prayer Service':         'bg-purple-100 text-purple-800',
};

function svcColor(service) {
  return SERVICE_COLORS[service] || 'bg-gray-100 text-gray-700';
}

export default function AttendanceView({ data }) {
  const [serviceFilter, setServiceFilter] = useState('All');

  if (!data) {
    return (
      <div className="card flex items-center justify-center h-48 text-gray-400">
        No data — click Update Site to load.
      </div>
    );
  }

  const services = ['All', ...new Set(data.map(r => r.service))];
  const filtered = serviceFilter === 'All' ? data : data.filter(r => r.service === serviceFilter);

  const avg = filtered.length ? Math.round(filtered.reduce((s, r) => s + r.count, 0) / filtered.length) : 0;
  const max = filtered.length ? Math.max(...filtered.map(r => r.count)) : 0;
  const min = filtered.length ? Math.min(...filtered.map(r => r.count)) : 0;

  return (
    <div className="space-y-4">
      <h2 className="section-heading">Attendance Records</h2>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card text-center py-4">
          <p className="text-2xl font-bold text-church-navy">{avg}</p>
          <p className="text-xs text-gray-500 mt-1">Average</p>
        </div>
        <div className="card text-center py-4">
          <p className="text-2xl font-bold text-green-600">{max}</p>
          <p className="text-xs text-gray-500 mt-1">Highest</p>
        </div>
        <div className="card text-center py-4">
          <p className="text-2xl font-bold text-gray-400">{min}</p>
          <p className="text-xs text-gray-500 mt-1">Lowest</p>
        </div>
      </div>

      {/* Service filter chips */}
      <div className="flex flex-wrap gap-2">
        {services.map(s => (
          <button
            key={s}
            onClick={() => setServiceFilter(s)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              serviceFilter === s
                ? 'bg-church-navy text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-church-navy text-left text-xs text-gray-300 uppercase tracking-wide">
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Service</th>
              <th className="px-4 py-3 text-right">Count</th>
              <th className="px-4 py-3 w-1/3">Bar</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{r.date}</td>
                <td className="px-4 py-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${svcColor(r.service)}`}>
                    {r.service}
                  </span>
                </td>
                <td className="px-4 py-2 text-right font-semibold text-church-navy">{r.count}</td>
                <td className="px-4 py-2">
                  <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-church-gold rounded-full"
                      style={{ width: `${max ? (r.count / max) * 100 : 0}%` }}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
