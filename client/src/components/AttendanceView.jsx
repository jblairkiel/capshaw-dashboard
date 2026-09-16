import { useState, useEffect, useCallback } from 'react';
import { toCsv, downloadCsv } from '../lib/csv';
import { hasArea } from '../lib/roles';
import Dialog from './Dialog';

// Attendance counts come off the church site with the rest of the scrape, but
// whoever looks after Attendance can also record one here and correct an
// earlier one. Those go through /api/records, which gates on the area and
// records every change in the action history.
const API = '/api/records/attendance';

const BLANK = { date: '', service: '', count: '' };

async function send(url, options = {}) {
  const res  = await fetch(url, { credentials: 'include', ...options });
  const json = await res.json().catch(() => ({}));
  if (!json.success) throw new Error(json.error || 'Something went wrong');
  return json;
}

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

// ─── Adding or correcting a count ─────────────────────────────────────────────

function AttendanceForm({ record, services, onClose, onSaved }) {
  const isNew = !record?.id;
  const [form, setForm]   = useState(() => ({ ...BLANK, ...(record || {}) }));
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');

  const set = (key, value) => setForm(p => ({ ...p, [key]: value }));

  async function submit(e) {
    e.preventDefault();
    if (!String(form.date).trim())    return setError('A date is needed');
    if (!String(form.service).trim()) return setError('A service is needed');
    setBusy(true); setError('');
    try {
      await send(isNew ? API : `${API}/${record.id}`, {
        method:  isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ date: form.date, service: form.service, count: Number(form.count) || 0 }),
      });
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm('Delete this attendance record?')) return;
    setBusy(true);
    try {
      await send(`${API}/${record.id}`, { method: 'DELETE' });
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const field = 'mt-1 block w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold';
  const label = 'text-xs font-medium text-gray-500 uppercase tracking-wide';

  return (
    <Dialog title={isNew ? 'Record attendance' : 'Correct this record'} onClose={onClose} width="max-w-sm">
      <form onSubmit={submit} className="space-y-3">
        <label className="block">
          <span className={label}>Date</span>
          <input autoFocus required value={form.date} placeholder="2026-06-07"
            onChange={e => set('date', e.target.value)} className={field} />
        </label>
        <label className="block">
          <span className={label}>Service</span>
          <input required list="attendance-services" value={form.service} placeholder="Sun AM"
            onChange={e => set('service', e.target.value)} className={field} />
          <datalist id="attendance-services">
            {services.filter(s => s !== 'All').map(s => <option key={s} value={s} />)}
          </datalist>
        </label>
        <label className="block">
          <span className={label}>Count</span>
          <input required type="number" min="0" value={form.count}
            onChange={e => set('count', e.target.value)} className={field} />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex items-center justify-between gap-2 pt-1">
          {!isNew ? (
            <button type="button" onClick={remove} disabled={busy}
              className="text-sm px-3 py-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50">
              Delete
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="text-sm px-3 py-2 rounded-lg border border-gray-200 text-gray-600">Cancel</button>
            <button type="submit" disabled={busy} className="btn-primary text-sm disabled:opacity-50">
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}

export default function AttendanceView({ data, user }) {
  const [serviceFilter, setServiceFilter] = useState('All');
  const [editing, setEditing] = useState(null);   // a record, or {} for a new one
  // The scraped rows the page is handed carry no ids, so our own records are
  // fetched alongside them: they are what an edit can actually point at.
  const [records, setRecords] = useState([]);

  const canWrite = hasArea(user, 'attendance');

  const loadRecords = useCallback(() => {
    fetch(`${API}?limit=1000&sort=date&dir=desc`, { credentials: 'include' })
      .then(r => r.json())
      .then(j => { if (j.success) setRecords(j.rows); })
      .catch(() => {});
  }, []);

  useEffect(() => { loadRecords(); }, [loadRecords]);

  // Our own records are the same rows, but with the ids an edit needs, so they
  // are preferred when they have arrived. The scraped payload is the fallback
  // for the moment before that, and if the fetch fails.
  const rows = records.length ? records : (data || []);

  if (!data && !records.length) {
    return (
      <div className="card flex items-center justify-center h-48 text-gray-400">
        No data — click Update Site to load.
      </div>
    );
  }

  const services = ['All', ...new Set(rows.map(r => r.service))];
  const filtered = serviceFilter === 'All' ? rows : rows.filter(r => r.service === serviceFilter);

  const avg = filtered.length ? Math.round(filtered.reduce((s, r) => s + r.count, 0) / filtered.length) : 0;
  const max = filtered.length ? Math.max(...filtered.map(r => r.count)) : 0;
  const min = filtered.length ? Math.min(...filtered.map(r => r.count)) : 0;

  function handleExport() {
    const suffix = serviceFilter === 'All' ? 'all-services' : serviceFilter.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    downloadCsv(
      `attendance-${suffix}.csv`,
      toCsv(['Date', 'Service', 'Count'], filtered.map(r => [r.date, r.service, r.count])),
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <h2 className="section-heading mb-0">Attendance</h2>
        <div className="flex items-center gap-2">
        {canWrite && (
          <button onClick={() => setEditing({})} className="btn-primary text-sm">
            Record attendance
          </button>
        )}
        <button
          onClick={handleExport}
          disabled={filtered.length === 0}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-church-navy text-church-navy hover:bg-church-navy hover:text-white transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-church-navy"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Export CSV
        </button>
        </div>
      </div>

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
              {canWrite && <th className="px-4 py-3 w-16" />}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={r.id ?? i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
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
                {canWrite && (
                  <td className="px-4 py-2 text-right">
                    {r.id && (
                      <button
                        onClick={() => setEditing(r)}
                        aria-label={`Edit ${r.service} on ${r.date}`}
                        className="text-xs px-2 py-1 rounded-lg border border-gray-200 text-gray-600 hover:border-church-gold hover:text-church-navy transition-colors"
                      >
                        Edit
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <AttendanceForm
          record={editing.id ? editing : null}
          services={services}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); loadRecords(); }}
        />
      )}
    </div>
  );
}
