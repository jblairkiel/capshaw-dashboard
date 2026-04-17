import { useState } from 'react';

function DeaconCard({ deacon }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card p-0 overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <span className="font-medium text-church-navy">{deacon.name}</span>
        <span className="text-xs text-gray-400 flex items-center gap-1">
          {deacon.duties.length} {deacon.duties.length === 1 ? 'duty' : 'duties'}
          <svg className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </span>
      </button>
      {open && (
        <ul className="px-4 pb-3 space-y-1 border-t border-gray-100">
          {deacon.duties.map((d, i) => (
            <li key={i} className="text-sm text-gray-600 flex gap-2 pt-1">
              <span className="text-church-gold mt-0.5">•</span>
              {d}
            </li>
          ))}
        </ul>
      )}
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

  const deaconList  = deacons  || [];
  const bulletinList = bulletins || [];

  return (
    <div className="space-y-8">

      {/* Deacons */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="section-heading">Deacons</h2>
          <span className="text-sm text-gray-400">{deaconList.length} deacons</span>
        </div>

        {deaconList.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {deaconList.map((d, i) => (
              <DeaconCard key={i} deacon={d} />
            ))}
          </div>
        ) : (
          <div className="card text-center text-gray-400 py-12">No deacon data found.</div>
        )}
      </section>

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
