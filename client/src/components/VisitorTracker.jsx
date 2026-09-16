import { useState, useMemo } from 'react';
import Dialog from './Dialog';

// Visit dates come off the church site as MM/DD/YY. Sorting them as text would
// put December before February, so they are turned into a comparable number
// and anything unrecognised is left at the end.
function dateKey(raw) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(String(raw || '').trim());
  if (!m) return -1;
  const [, mm, dd, yy] = m;
  const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
  return year * 10000 + Number(mm) * 100 + Number(dd);
}

function summarise(visitor) {
  const visits = [...(visitor.visits || [])].sort((a, b) => dateKey(b.date) - dateKey(a.date));
  return {
    name:   visitor.name,
    visits,
    count:  visits.length,
    last:   visits[0]?.date || '',
    first:  visits[visits.length - 1]?.date || '',
    lastKey: visits.length ? dateKey(visits[0].date) : -1,
  };
}

function Stat({ value, label, tone = 'text-church-navy' }) {
  return (
    <div className="card text-center py-4">
      <p className={`text-2xl font-bold ${tone}`}>{value}</p>
      <p className="text-xs text-gray-500 mt-1">{label}</p>
    </div>
  );
}

export default function VisitorTracker({ data }) {
  const [search, setSearch] = useState('');
  const [open,   setOpen]   = useState(null);

  const guests = useMemo(() => (data || []).map(summarise), [data]);

  if (!data) {
    return (
      <div className="card flex items-center justify-center h-48 text-gray-400">
        No data — click Update Site to load.
      </div>
    );
  }

  const filtered = guests.filter(g =>
    !search || g.name.toLowerCase().includes(search.toLowerCase())
  );

  const totalVisits = filtered.reduce((s, g) => s + g.count, 0);
  const returning   = filtered.filter(g => g.count > 1).length;
  const maxVisits   = filtered.length ? Math.max(...filtered.map(g => g.count)) : 0;
  const mostRecent  = filtered.reduce(
    (best, g) => (g.lastKey > (best?.lastKey ?? -1) ? g : best),
    null,
  );

  return (
    <div className="space-y-4">
      <h2 className="section-heading">Our Guests</h2>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Stat value={filtered.length} label={filtered.length === 1 ? 'Guest' : 'Guests'} />
        <Stat value={totalVisits} label="Visits recorded" tone="text-green-600" />
        <Stat value={returning} label="Came back" tone="text-church-gold" />
        <Stat value={mostRecent?.last || '—'} label="Most recent visit" tone="text-gray-400" />
      </div>

      {/* Search */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <input
          type="text"
          placeholder="Search guests…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-church-navy w-64"
        />
        <span className="text-xs text-gray-400">{filtered.length} guest{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="bg-church-navy text-left text-xs text-gray-300 uppercase tracking-wide">
              <th className="px-4 py-3">Guest</th>
              <th className="px-4 py-3 text-right whitespace-nowrap">Visits</th>
              <th className="px-4 py-3 whitespace-nowrap">First visit</th>
              <th className="px-4 py-3 whitespace-nowrap">Last visit</th>
              <th className="px-4 py-3 w-1/4">Bar</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((g, i) => (
              <tr
                key={i}
                onClick={() => setOpen(g)}
                className={`cursor-pointer hover:bg-blue-50/60 transition-colors ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}
              >
                <td className="px-4 py-2">
                  <button
                    onClick={e => { e.stopPropagation(); setOpen(g); }}
                    className="font-medium text-church-navy hover:text-church-gold transition-colors text-left"
                  >
                    {g.name}
                  </button>
                </td>
                <td className="px-4 py-2 text-right font-semibold text-church-navy">{g.count}</td>
                <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{g.first || '—'}</td>
                <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{g.last || '—'}</td>
                <td className="px-4 py-2">
                  <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-church-gold rounded-full"
                      style={{ width: `${maxVisits ? (g.count / maxVisits) * 100 : 0}%` }}
                    />
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-gray-400">
                  No visitors match your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {open && (
        <Dialog
          title={open.name}
          subtitle={`${open.count} visit${open.count === 1 ? '' : 's'} on record`}
          onClose={() => setOpen(null)}
          width="max-w-lg"
        >
          {open.visits.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
                  <th className="py-2 pr-4">Date</th>
                  <th className="py-2">Service</th>
                </tr>
              </thead>
              <tbody>
                {open.visits.map((v, j) => (
                  <tr key={j} className="border-b border-gray-50 last:border-0">
                    <td className="py-2 pr-4 text-gray-500 whitespace-nowrap">{v.date}</td>
                    <td className="py-2">{v.service}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-gray-400">No visits recorded yet.</p>
          )}
        </Dialog>
      )}
    </div>
  );
}
