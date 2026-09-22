import { useState, useEffect, useCallback } from 'react';
import { areaInfo } from '../lib/roles';
import Dialog from './Dialog';
import { useIsNarrow } from '../lib/useMediaQuery';

// Who changed what, and when.
//
// Every create, edit and delete anybody makes through the portal is recorded by
// the route that made it — this page only reads. It is admin-only: it is how an
// admin answers "who took that off the roster?" without needing the server.
const API = '/api/admin/action-log';

const ACTIONS = [
  { value: '',       label: 'Everything' },
  { value: 'create', label: 'Added' },
  { value: 'update', label: 'Changed' },
  { value: 'delete', label: 'Deleted' },
  { value: 'other',  label: 'Other' },
];

const ACTION_TONE = {
  create: 'bg-green-100 text-green-700',
  update: 'bg-blue-100 text-blue-700',
  delete: 'bg-red-100 text-red-700',
  other:  'bg-gray-100 text-gray-600',
};

const PAGE_SIZE = 50;

function when(value) {
  if (!value) return '';
  // SQLite hands back 'YYYY-MM-DD HH:MM:SS' in UTC with no zone marker, which
  // the browser would otherwise read as local time and show hours adrift.
  const date = new Date(`${String(value).replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function areaLabel(area) {
  if (!area) return 'Elsewhere';
  if (area === 'accounts')      return 'Members & Access';
  if (area === 'my-household')  return 'Their own household';
  if (area === 'impersonation') return 'Viewing as somebody';
  if (area === 'bug-reports')   return 'Bug Reports';
  return areaInfo(area).label;
}

// Who to credit a change to. Ordinarily the account that made it; while an
// admin was viewing the portal as a member, the change is the member's and the
// admin is who was really at the keyboard, so both are named.
function Who({ row }) {
  if (!row.acting_user_name) return <span className="text-church-navy">{row.user_name || 'Somebody'}</span>;
  return (
    <span className="text-church-navy">
      {row.acting_user_name}
      <span className="block text-xs text-amber-700">viewing as {row.user_name || 'somebody'}</span>
    </span>
  );
}

// What actually changed, for the entry somebody opens. Kept as a plain list of
// field → before/after, because that is what a question about an edit is.
function Changes({ details }) {
  const changes = details?.changes;
  const created = details?.created;
  const removed = details?.removed;

  if (changes) {
    return (
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
            <th className="py-2 pr-4">Field</th>
            <th className="py-2 pr-4">Was</th>
            <th className="py-2">Became</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(changes).map(([field, { from, to }]) => (
            <tr key={field} className="border-b border-gray-50 last:border-0 align-top">
              <td className="py-2 pr-4 text-gray-500 whitespace-nowrap">{field}</td>
              <td className="py-2 pr-4 text-gray-400 line-through break-words">{String(from ?? '') || '—'}</td>
              <td className="py-2 text-church-navy break-words">{String(to ?? '') || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  const snapshot = created || removed;
  if (snapshot) {
    return (
      <dl className="grid grid-cols-2 gap-2 text-sm">
        {Object.entries(snapshot).map(([field, value]) => (
          <div key={field}>
            <dt className="text-xs text-gray-400 uppercase tracking-wide">{field}</dt>
            <dd className="text-gray-700 break-words">{String(value ?? '') || '—'}</dd>
          </div>
        ))}
      </dl>
    );
  }

  const rest = Object.entries(details || {});
  if (!rest.length) return <p className="text-sm text-gray-400">Nothing more was recorded.</p>;

  return (
    <dl className="grid grid-cols-2 gap-2 text-sm">
      {rest.map(([field, value]) => (
        <div key={field}>
          <dt className="text-xs text-gray-400 uppercase tracking-wide">{field}</dt>
          <dd className="text-gray-700 break-words">
            {typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default function ActionHistoryView() {
  const [rows, setRows]       = useState([]);
  const [total, setTotal]     = useState(0);
  const [actors, setActors]   = useState([]);
  const [areas, setAreas]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [open, setOpen]       = useState(null);

  const onPhone = useIsNarrow();

  const [impersonated, setImpersonated] = useState(0);
  const [filters, setFilters] = useState({ area: '', action: '', userId: '', search: '', actingOnly: '' });
  const [offset, setOffset]   = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    const query = new URLSearchParams({
      ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
      limit:  String(PAGE_SIZE),
      offset: String(offset),
    });
    try {
      const res  = await fetch(`${API}?${query}`, { credentials: 'include' });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Could not load the history');
      setRows(json.rows);
      setTotal(json.total);
      setActors(json.actors);
      setAreas(json.areas);
      setImpersonated(json.impersonated ?? 0);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filters, offset]);

  useEffect(() => { load(); }, [load]);

  function setFilter(key, value) {
    setOffset(0);
    setFilters(f => ({ ...f, [key]: value }));
  }

  const showing = rows.length ? `${offset + 1}–${offset + rows.length}` : '0';

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h2 className="section-heading mb-1">Action History</h2>
          <p className="text-sm text-gray-500">
            Every change anybody has made through the portal. Showing {showing} of {total}.
          </p>
        </div>
        <button onClick={load} className="text-sm text-church-gold hover:text-church-navy transition-colors px-2">Refresh</button>
      </div>

      {/* Filters */}
      <div className="card flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Area</span>
          <select
            value={filters.area}
            onChange={e => setFilter('area', e.target.value)}
            className="mt-1 block border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-church-gold"
          >
            <option value="">Everywhere</option>
            {areas.map(a => (
              <option key={a.area} value={a.area}>{areaLabel(a.area)} ({a.entries})</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">What happened</span>
          <select
            value={filters.action}
            onChange={e => setFilter('action', e.target.value)}
            className="mt-1 block border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-church-gold"
          >
            {ACTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Who</span>
          <select
            value={filters.userId}
            onChange={e => setFilter('userId', e.target.value)}
            className="mt-1 block border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-church-gold"
          >
            <option value="">Anybody</option>
            {actors.filter(a => a.id).map(a => (
              <option key={a.id} value={a.id}>{a.name} ({a.entries})</option>
            ))}
          </select>
        </label>

        {impersonated > 0 && (
          <label className="flex items-center gap-2 text-sm text-gray-600 pb-2">
            <input
              type="checkbox"
              checked={filters.actingOnly === 'true'}
              onChange={e => setFilter('actingOnly', e.target.checked ? 'true' : '')}
              className="accent-church-gold"
            />
            Only while viewing as somebody ({impersonated})
          </label>
        )}

        <label className="block flex-1 min-w-48">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Search</span>
          <input
            type="text"
            value={filters.search}
            placeholder="A name, a title, anything in the summary…"
            onChange={e => setFilter('search', e.target.value)}
            className="mt-1 block w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold"
          />
        </label>
      </div>

      {error && <div className="card border border-red-200 bg-red-50 text-sm text-red-700">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-church-gold" />
        </div>
      ) : (
        <>
          {/* Phones: one card per entry. */}
          {onPhone ? (
          <div className="space-y-2">
            {rows.map(row => (
              <button key={row.id} onClick={() => setOpen(row)} className="card w-full text-left hover:border-church-gold transition-colors">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ACTION_TONE[row.action] || ACTION_TONE.other}`}>
                    {row.action}
                  </span>
                  <span className="text-xs text-gray-400">{areaLabel(row.area)}</span>
                </div>
                <p className="text-sm text-church-navy mt-1">{row.summary}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {row.acting_user_name
                    ? `${row.acting_user_name} viewing as ${row.user_name || 'somebody'}`
                    : (row.user_name || 'Somebody')} · {when(row.created_at)}
                </p>
              </button>
            ))}
            {rows.length === 0 && <p className="card text-center text-gray-400 text-sm py-8">Nothing matches these filters.</p>}
          </div>
          ) : (
          /* Tablets up: the table. */
          <div className="card p-0 overflow-hidden overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="bg-church-navy text-left text-xs text-gray-300 uppercase tracking-wide">
                  <th className="px-4 py-3 whitespace-nowrap">When</th>
                  <th className="px-4 py-3">Who</th>
                  <th className="px-4 py-3">Area</th>
                  <th className="px-4 py-3">What</th>
                  <th className="px-4 py-3">Change</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr
                    key={row.id}
                    onClick={() => setOpen(row)}
                    className={`cursor-pointer hover:bg-blue-50/60 transition-colors ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}
                  >
                    <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{when(row.created_at)}</td>
                    <td className="px-4 py-2"><Who row={row} /></td>
                    <td className="px-4 py-2 text-gray-500">{areaLabel(row.area)}</td>
                    <td className="px-4 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ACTION_TONE[row.action] || ACTION_TONE.other}`}>
                        {row.action}
                      </span>
                      <span className="text-gray-400 text-xs ml-2">{row.entity}</span>
                    </td>
                    <td className="px-4 py-2 text-gray-700">{row.summary}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-gray-400">Nothing matches these filters.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          )}

          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between">
              <button
                onClick={() => setOffset(o => Math.max(0, o - PAGE_SIZE))}
                disabled={offset === 0}
                className="text-sm px-3 py-2 rounded-lg border border-gray-200 text-gray-600 disabled:opacity-40"
              >
                Newer
              </button>
              <span className="text-xs text-gray-400">{showing} of {total}</span>
              <button
                onClick={() => setOffset(o => o + PAGE_SIZE)}
                disabled={offset + rows.length >= total}
                className="text-sm px-3 py-2 rounded-lg border border-gray-200 text-gray-600 disabled:opacity-40"
              >
                Older
              </button>
            </div>
          )}
        </>
      )}

      {open && (
        <Dialog
          title={open.summary}
          subtitle={[
            open.acting_user_name
              ? `${open.acting_user_name}, viewing as ${open.user_name || 'somebody'}`
              : (open.user_name || 'Somebody'),
            when(open.created_at),
            areaLabel(open.area),
          ].join(' · ')}
          onClose={() => setOpen(null)}
          width="max-w-lg"
        >
          <Changes details={open.details} />
        </Dialog>
      )}
    </div>
  );
}
