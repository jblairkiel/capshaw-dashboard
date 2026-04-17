import { useState } from 'react';

export default function SermonsView({ data }) {
  const [search,  setSearch]  = useState('');
  const [speaker, setSpeaker] = useState('All');
  const [type,    setType]    = useState('All');

  if (!data) {
    return (
      <div className="card flex items-center justify-center h-48 text-gray-400">
        No data — click Update Site to load.
      </div>
    );
  }

  const speakers = ['All', ...new Set(data.map(s => s.speaker).filter(Boolean))];
  const types    = ['All', ...new Set(data.map(s => s.type).filter(Boolean))];

  const filtered = data.filter(s => {
    const q = search.toLowerCase();
    return (
      (!q || s.title.toLowerCase().includes(q) || s.speaker.toLowerCase().includes(q) || s.series.toLowerCase().includes(q)) &&
      (speaker === 'All' || s.speaker === speaker) &&
      (type    === 'All' || s.type    === type)
    );
  });

  return (
    <div className="space-y-4">
      <h2 className="section-heading">Sermon Archive</h2>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <input
          type="text"
          placeholder="Search title, speaker, series…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-church-navy w-64"
        />
        <select
          value={speaker}
          onChange={e => setSpeaker(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-church-navy"
        >
          {speakers.map(s => <option key={s}>{s}</option>)}
        </select>
        <select
          value={type}
          onChange={e => setType(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-church-navy"
        >
          {types.map(t => <option key={t}>{t}</option>)}
        </select>
        <span className="text-xs text-gray-400">{filtered.length} result{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="bg-church-navy text-left text-xs text-gray-300 uppercase tracking-wide">
              <th className="px-4 py-3 whitespace-nowrap">Date</th>
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3 whitespace-nowrap">Speaker</th>
              <th className="px-4 py-3 whitespace-nowrap">Type</th>
              <th className="px-4 py-3">Series</th>
              <th className="px-4 py-3 whitespace-nowrap">Service</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s, i) => (
              <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{s.date}</td>
                <td className="px-4 py-2 font-medium text-church-navy">{s.title}</td>
                <td className="px-4 py-2 whitespace-nowrap">{s.speaker}</td>
                <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{s.type}</td>
                <td className="px-4 py-2 text-gray-500 text-xs">{s.series}</td>
                <td className="px-4 py-2 text-gray-500 whitespace-nowrap text-xs">{s.service}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">No sermons match your filter.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
