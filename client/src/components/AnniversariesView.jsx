import { useState } from 'react';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function daysUntil(monthNum, day) {
  const now   = new Date();
  const thisYear = now.getFullYear();
  let next = new Date(thisYear, monthNum - 1, day);
  if (next < now) next = new Date(thisYear + 1, monthNum - 1, day);
  return Math.ceil((next - now) / 86400000);
}

export default function AnniversariesView({ data }) {
  const [monthFilter, setMonthFilter] = useState('All');
  const [search, setSearch] = useState('');

  if (!data) {
    return (
      <div className="card flex items-center justify-center h-48 text-gray-400">
        No data — click Update Site to load.
      </div>
    );
  }

  const now       = new Date();
  const thisMonth = MONTHS[now.getMonth()];
  const nextMonth = MONTHS[(now.getMonth() + 1) % 12];

  const withDays = data.map(a => ({ ...a, daysUntil: daysUntil(a.monthNum, a.day) }));

  const upcoming = withDays
    .filter(a => a.daysUntil <= 30)
    .sort((a, b) => a.daysUntil - b.daysUntil);

  const thisMonthCount = data.filter(a => a.month === thisMonth).length;
  const nextMonthCount = data.filter(a => a.month === nextMonth).length;
  const sevenDayCount  = upcoming.filter(a => a.daysUntil <= 7).length;

  const filtered = withDays.filter(a => {
    const matchMonth  = monthFilter === 'All' || a.month === monthFilter;
    const matchSearch = !search || a.names.toLowerCase().includes(search.toLowerCase());
    return matchMonth && matchSearch;
  });

  const grouped = MONTHS.reduce((acc, m) => {
    const rows = filtered.filter(a => a.month === m);
    if (rows.length) acc[m] = rows;
    return acc;
  }, {});

  return (
    <div className="space-y-5">
      <h2 className="section-heading">Anniversaries</h2>

      {/* Metrics */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card text-center py-4">
          <p className="text-2xl font-bold text-church-navy">{sevenDayCount}</p>
          <p className="text-xs text-gray-500 mt-1">Within 7 days</p>
        </div>
        <div className="card text-center py-4">
          <p className="text-2xl font-bold text-church-gold">{thisMonthCount}</p>
          <p className="text-xs text-gray-500 mt-1">This month ({thisMonth})</p>
        </div>
        <div className="card text-center py-4">
          <p className="text-2xl font-bold text-gray-400">{nextMonthCount}</p>
          <p className="text-xs text-gray-500 mt-1">Next month ({nextMonth})</p>
        </div>
      </div>

      {/* Upcoming 30 days */}
      {upcoming.length > 0 && (
        <div className="card p-0 overflow-hidden">
          <div className="bg-church-navy px-4 py-2">
            <h3 className="text-church-gold text-sm font-semibold">Coming Up — Next 30 Days</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wide">
                <th className="px-4 py-2">Date</th>
                <th className="px-4 py-2">Couple</th>
                <th className="px-4 py-2 text-right">Days Away</th>
              </tr>
            </thead>
            <tbody>
              {upcoming.map((a, i) => (
                <tr key={i} className={`${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'} ${a.daysUntil <= 7 ? 'font-medium' : ''}`}>
                  <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{a.date}</td>
                  <td className="px-4 py-2 text-church-navy">{a.names}</td>
                  <td className="px-4 py-2 text-right">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      a.daysUntil <= 7  ? 'bg-red-100 text-red-700' :
                      a.daysUntil <= 14 ? 'bg-yellow-100 text-yellow-700' :
                                          'bg-gray-100 text-gray-600'
                    }`}>
                      {a.daysUntil === 0 ? 'Today!' : `${a.daysUntil}d`}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <input
          type="text"
          placeholder="Search names…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-church-navy w-48"
        />
        <div className="flex flex-wrap gap-1">
          {['All', ...MONTHS].map(m => (
            <button
              key={m}
              onClick={() => setMonthFilter(m)}
              className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                monthFilter === m ? 'bg-church-navy text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {m === 'All' ? 'All' : m.slice(0, 3)}
            </button>
          ))}
        </div>
      </div>

      {/* Full year table, grouped by month */}
      <div className="space-y-3">
        {Object.entries(grouped).map(([month, rows]) => (
          <div key={month} className="card p-0 overflow-hidden">
            <div className={`px-4 py-2 ${month === thisMonth ? 'bg-church-gold' : 'bg-gray-100'}`}>
              <h3 className={`text-sm font-semibold ${month === thisMonth ? 'text-church-navy' : 'text-gray-600'}`}>
                {month}
                {month === thisMonth && <span className="ml-2 text-xs font-normal opacity-75">← this month</span>}
              </h3>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {rows.map((a, i) => (
                  <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-4 py-2 text-gray-500 w-16">{a.date}</td>
                    <td className="px-4 py-2">{a.names}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        {Object.keys(grouped).length === 0 && (
          <div className="card text-center text-gray-400 py-12">No results match your filter.</div>
        )}
      </div>
    </div>
  );
}
