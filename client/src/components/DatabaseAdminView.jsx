import { useState, useEffect, useCallback, useRef } from 'react';

const API = '/api/admin';

// ─── Table metadata (mirrors server TABLE_DEFS) ───────────────────────────────

const TABLE_DEFS = {
  attendance: {
    label: 'Attendance',
    group: 'Congregation',
    fields: [
      { key: 'date',    label: 'Date',    type: 'text',   placeholder: 'MM/DD/YY' },
      { key: 'service', label: 'Service', type: 'text',   placeholder: 'Sunday Worship' },
      { key: 'count',   label: 'Count',   type: 'number', placeholder: '0' },
    ],
  },
  sermons: {
    label: 'Sermons',
    group: 'Congregation',
    fields: [
      { key: 'date',    label: 'Date',    type: 'text', placeholder: 'MM/DD/YY' },
      { key: 'title',   label: 'Title',   type: 'text' },
      { key: 'speaker', label: 'Speaker', type: 'text' },
      { key: 'type',    label: 'Type',    type: 'text', placeholder: 'Sunday AM' },
      { key: 'series',  label: 'Series',  type: 'text' },
      { key: 'service', label: 'Service', type: 'text' },
    ],
  },
  job_assignments: {
    label: 'Job Assignments',
    group: 'Congregation',
    fields: [
      { key: 'month',   label: 'Month',   type: 'text', placeholder: 'April 2026' },
      { key: 'date',    label: 'Date',    type: 'text', placeholder: 'Apr 6' },
      { key: 'service', label: 'Service', type: 'text', placeholder: 'Sunday Worship' },
      { key: 'job',     label: 'Job',     type: 'text' },
      { key: 'name',    label: 'Name',    type: 'text' },
    ],
  },
  visitors: {
    label: 'Visitors',
    group: 'Congregation',
    fields: [
      { key: 'name', label: 'Name', type: 'text' },
    ],
  },
  visitor_visits: {
    label: 'Visitor Visits',
    group: 'Congregation',
    fields: [
      { key: 'visitor_id', label: 'Visitor ID', type: 'number' },
      { key: 'date',       label: 'Date',       type: 'text', placeholder: 'MM/DD/YY' },
      { key: 'service',    label: 'Service',    type: 'text' },
    ],
  },
  anniversaries: {
    label: 'Anniversaries',
    group: 'Congregation',
    fields: [
      { key: 'month',     label: 'Month',    type: 'text',   placeholder: 'April' },
      { key: 'date',      label: 'Date',     type: 'text',   placeholder: '4/6' },
      { key: 'names',     label: 'Names',    type: 'text' },
      { key: 'month_num', label: 'Month #',  type: 'number' },
      { key: 'day',       label: 'Day',      type: 'number' },
    ],
  },
  deacons: {
    label: 'Deacons',
    group: 'Congregation',
    fields: [
      { key: 'name', label: 'Name', type: 'text' },
    ],
  },
  deacon_duties: {
    label: 'Deacon Duties',
    group: 'Congregation',
    fields: [
      { key: 'deacon_id', label: 'Deacon ID', type: 'number' },
      { key: 'duty',      label: 'Duty',      type: 'text' },
      { key: 'position',  label: 'Position',  type: 'number' },
    ],
  },
  bulletins: {
    label: 'Bulletins',
    group: 'Congregation',
    fields: [
      { key: 'url',   label: 'URL',   type: 'text' },
      { key: 'label', label: 'Label', type: 'text' },
    ],
  },
  announcements: {
    label: 'Announcements',
    group: 'Worship',
    fields: [
      { key: 'type',       label: 'Type',       type: 'text',     placeholder: 'announcement' },
      { key: 'title',      label: 'Title',      type: 'text' },
      { key: 'body',       label: 'Body',       type: 'textarea' },
      { key: 'event_date', label: 'Event Date', type: 'text' },
      { key: 'event_time', label: 'Event Time', type: 'text' },
      { key: 'location',   label: 'Location',   type: 'text' },
      { key: 'priority',   label: 'Priority',   type: 'text',     placeholder: 'normal' },
      { key: 'active',     label: 'Active',     type: 'number',   placeholder: '1' },
    ],
  },
  songs: {
    label: 'Songs',
    group: 'Worship',
    fields: [
      { key: 'title',  label: 'Title',  type: 'text' },
      { key: 'hymnal', label: 'Hymnal', type: 'text' },
      { key: 'number', label: 'Number', type: 'text' },
    ],
  },
  song_services: {
    label: 'Song Services',
    group: 'Worship',
    fields: [
      { key: 'date',    label: 'Date',    type: 'text' },
      { key: 'service', label: 'Service', type: 'text' },
      { key: 'leader',  label: 'Leader',  type: 'text' },
    ],
  },
};

const GROUPS = ['Congregation', 'Worship'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cell(val) {
  if (val === null || val === undefined) return <span className="text-gray-300">—</span>;
  const s = String(val);
  if (s.length > 60) return <span title={s}>{s.slice(0, 58)}…</span>;
  return s;
}

// ─── Row edit modal ────────────────────────────────────────────────────────────

function RowModal({ tableKey, def, row, onSave, onClose }) {
  const isNew = !row;
  const [form, setForm] = useState(() => {
    const init = {};
    for (const f of def.fields) init[f.key] = row ? (row[f.key] ?? '') : '';
    return init;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const url    = isNew ? `${API}/${tableKey}` : `${API}/${tableKey}/${row.id}`;
      const method = isNew ? 'POST' : 'PATCH';
      const res    = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(form),
      });
      const j = await res.json();
      if (!j.success) throw new Error(j.error || 'Save failed');
      onSave(j.row);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-church-navy">{isNew ? `Add ${def.label}` : `Edit ${def.label}`}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {def.fields.map(f => (
            <label key={f.key} className="block">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{f.label}</span>
              {f.type === 'textarea' ? (
                <textarea
                  className="mt-1 block w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold resize-none"
                  rows={4}
                  value={form[f.key]}
                  placeholder={f.placeholder || ''}
                  onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                />
              ) : (
                <input
                  type={f.type}
                  className="mt-1 block w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold"
                  value={form[f.key]}
                  placeholder={f.placeholder || ''}
                  onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                />
              )}
            </label>
          ))}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>
        <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-50 border border-gray-200">Cancel</button>
          <button onClick={handleSubmit} disabled={saving} className="btn-primary text-sm">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Scrape status view ───────────────────────────────────────────────────────

const STATUS_META = {
  ok:      { dot: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',  label: 'OK' },
  warning: { dot: 'bg-amber-400',   badge: 'bg-amber-50 text-amber-700 border-amber-200',        label: 'Warning' },
  error:   { dot: 'bg-red-500',     badge: 'bg-red-50 text-red-700 border-red-200',              label: 'Error' },
  empty:   { dot: 'bg-gray-300',    badge: 'bg-gray-50 text-gray-500 border-gray-200',           label: 'No data' },
  unknown: { dot: 'bg-gray-300',    badge: 'bg-gray-50 text-gray-400 border-gray-200',           label: 'Unknown' },
};

function ScrapeStatus({ onScrape, scraping }) {
  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(true);
  const [expanded, setExpanded] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/scrape-status`, { credentials: 'include' });
      const j   = await res.json();
      if (j.success) setData(j);
    } catch { /* non-fatal */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleScrape() {
    await onScrape();
    load();
  }

  const toggle = key => setExpanded(p => ({ ...p, [key]: !p[key] }));

  const overallStatus = data
    ? data.sections.some(s => s.status === 'error')   ? 'error'
    : data.sections.some(s => s.status === 'warning') ? 'warning'
    : data.sections.every(s => s.status === 'ok')     ? 'ok'
    : 'empty'
    : 'unknown';

  const sm = STATUS_META[overallStatus];

  return (
    <div className="max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-lg font-semibold text-church-navy">Scrape Status</h2>
            {data && (
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${sm.badge}`}>
                {sm.label}
              </span>
            )}
          </div>
          {data?.lastScraped
            ? <p className="text-xs text-gray-400">Last scraped {new Date(data.lastScraped).toLocaleString()}</p>
            : <p className="text-xs text-gray-400">Never scraped</p>
          }
        </div>
        <button
          onClick={handleScrape}
          disabled={scraping}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
            scraping ? 'border-gray-300 text-gray-400 cursor-not-allowed' : 'border-church-gold text-church-gold hover:bg-church-gold hover:text-church-navy'
          }`}
        >
          {scraping
            ? <span className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full inline-block" />
            : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          }
          {scraping ? 'Scraping…' : 'Scrape Now'}
        </button>
      </div>

      {loading && <p className="text-sm text-gray-400">Loading…</p>}

      {/* Section rows */}
      {data && (
        <div className="space-y-2">
          {data.sections.map(s => {
            const m = STATUS_META[s.status] ?? STATUS_META.unknown;
            return (
              <div key={s.key} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="flex items-center gap-4 px-4 py-3">
                  {/* Status dot */}
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${m.dot}`} />

                  {/* Label + count */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="font-medium text-sm text-church-navy">{s.label}</span>
                      <span className="text-xs text-gray-400 tabular-nums">{s.count.toLocaleString()} rows</span>
                      {s.latestDate && (
                        <span className="text-xs text-gray-400">latest: {s.latestDate}</span>
                      )}
                    </div>
                    {s.warnings.length > 0 && !expanded[s.key] && (
                      <p className="text-xs text-amber-700 mt-0.5 truncate">{s.warnings[0]}</p>
                    )}
                  </div>

                  {/* Badge */}
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full border shrink-0 ${m.badge}`}>
                    {m.label}
                  </span>

                  {/* Expand toggle (only if warnings) */}
                  {s.warnings.length > 0 && (
                    <button
                      onClick={() => toggle(s.key)}
                      className="text-gray-400 hover:text-gray-600 shrink-0"
                    >
                      <svg className={`w-4 h-4 transition-transform ${expanded[s.key] ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  )}
                </div>

                {/* Expanded warnings */}
                {expanded[s.key] && s.warnings.length > 0 && (
                  <div className="border-t border-amber-100 bg-amber-50 px-4 py-3 space-y-1">
                    {s.warnings.map((w, i) => (
                      <p key={i} className="text-xs text-amber-800 font-mono">{w}</p>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* All warnings summary */}
      {data?.allWarnings?.length > 0 && (
        <div className="mt-6 bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-2">
            All warnings ({data.allWarnings.length})
          </p>
          <ul className="space-y-1">
            {data.allWarnings.map((w, i) => (
              <li key={i} className="text-xs text-amber-800 font-mono">{w}</li>
            ))}
          </ul>
        </div>
      )}

      {data?.allWarnings?.length === 0 && data?.lastScraped && (
        <div className="mt-6 flex items-center gap-2 text-sm text-emerald-600">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          No warnings from the last scrape.
        </div>
      )}
    </div>
  );
}

// ─── Sort icon ────────────────────────────────────────────────────────────────

function SortIcon({ col, sortCol, sortDir }) {
  if (sortCol !== col) return (
    <svg className="w-3 h-3 opacity-30 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
    </svg>
  );
  return sortDir === 'asc' ? (
    <svg className="w-3 h-3 text-church-gold shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" />
    </svg>
  ) : (
    <svg className="w-3 h-3 text-church-gold shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
    </svg>
  );
}

// ─── Table view ───────────────────────────────────────────────────────────────

function TableView({ tableKey }) {
  const def = TABLE_DEFS[tableKey];
  const [rows, setRows]       = useState([]);
  const [total, setTotal]     = useState(0);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset]   = useState(0);
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [filters, setFilters] = useState({});
  const [modal, setModal]     = useState(null);
  const [error, setError]     = useState('');
  const LIMIT      = 50;
  const filterTimer = useRef(null);
  const columns    = def.fields.map(f => f.key);

  const activeFilters = Object.values(filters).some(v => v?.trim());

  const load = useCallback(async (off, sc, sd, fi) => {
    setLoading(true);
    setError('');
    try {
      const p = new URLSearchParams({ limit: LIMIT, offset: off });
      if (sc) { p.set('sort', sc); p.set('dir', sd); }
      for (const [col, val] of Object.entries(fi || {})) {
        if (val?.trim()) p.set(`f_${col}`, val.trim());
      }
      const res = await fetch(`${API}/${tableKey}?${p}`, { credentials: 'include' });
      const j   = await res.json();
      if (!j.success) throw new Error(j.error);
      setRows(j.rows);
      setTotal(j.total);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [tableKey]);

  useEffect(() => {
    setSortCol(null); setSortDir('asc'); setFilters({}); setOffset(0);
    load(0, null, 'asc', {});
  }, [tableKey, load]);

  function handleSort(col) {
    const newDir = sortCol === col && sortDir === 'asc' ? 'desc' : 'asc';
    setSortCol(col); setSortDir(newDir); setOffset(0);
    load(0, col, newDir, filters);
  }

  function handleFilter(col, val) {
    const next = { ...filters, [col]: val };
    setFilters(next);
    clearTimeout(filterTimer.current);
    filterTimer.current = setTimeout(() => { setOffset(0); load(0, sortCol, sortDir, next); }, 300);
  }

  function clearFilters() {
    const cleared = {};
    setFilters(cleared);
    setOffset(0);
    load(0, sortCol, sortDir, cleared);
  }

  async function handleDelete(id) {
    if (!confirm('Delete this row?')) return;
    try {
      const res = await fetch(`${API}/${tableKey}/${id}`, { method: 'DELETE', credentials: 'include' });
      const j   = await res.json();
      if (!j.success) throw new Error(j.error);
      load(offset, sortCol, sortDir, filters);
    } catch (err) {
      setError(err.message);
    }
  }

  function handleSaved(row) {
    setModal(null);
    if (!modal || modal === 'new') {
      setRows(prev => [row, ...prev]);
      setTotal(t => t + 1);
    } else {
      setRows(prev => prev.map(r => r.id === row.id ? row : r));
    }
  }

  function paginate(off) { setOffset(off); load(off, sortCol, sortDir, filters); }

  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-church-navy">{def.label}</h2>
          <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">{total.toLocaleString()} rows</span>
          {activeFilters && (
            <button onClick={clearFilters} className="text-xs text-amber-600 hover:text-amber-800 flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Clear filters
            </button>
          )}
        </div>
        <button onClick={() => setModal('new')} className="btn-primary text-sm flex items-center gap-1.5">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add
        </button>
      </div>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      {/* Table */}
      <div className="flex-1 overflow-auto rounded-xl border border-gray-100">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10">
            {/* Sort row */}
            <tr className="bg-church-navy text-white">
              {columns.map(c => (
                <th key={c} className="px-3 py-2.5 text-left whitespace-nowrap">
                  <button
                    onClick={() => handleSort(c)}
                    className="flex items-center gap-1 font-medium text-xs uppercase tracking-wide hover:text-church-gold transition-colors w-full text-left"
                  >
                    <span>{c.replace(/_/g, ' ')}</span>
                    <SortIcon col={c} sortCol={sortCol} sortDir={sortDir} />
                  </button>
                </th>
              ))}
              <th className="px-3 py-2.5 w-16 bg-church-navy" />
            </tr>
            {/* Filter row */}
            <tr className="bg-[#152038] border-b border-white/10">
              {columns.map(c => (
                <th key={c} className="px-2 py-1.5">
                  <input
                    type="text"
                    value={filters[c] || ''}
                    onChange={e => handleFilter(c, e.target.value)}
                    placeholder="filter…"
                    className="w-full bg-white/10 text-white placeholder-white/30 text-xs rounded px-2 py-1 border border-white/10 focus:outline-none focus:border-church-gold focus:bg-white/15 transition-colors min-w-0"
                  />
                </th>
              ))}
              <th className="px-2 py-1.5 bg-[#152038]" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={columns.length + 1} className="px-3 py-8 text-center text-gray-400">Loading…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={columns.length + 1} className="px-3 py-8 text-center text-gray-400">No rows found.</td></tr>
            )}
            {rows.map((row, i) => (
              <tr key={row.id} className={`group ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-blue-50/40 transition-colors`}>
                {columns.map(c => (
                  <td key={c} className="px-3 py-2 text-gray-700 whitespace-nowrap max-w-xs overflow-hidden text-ellipsis">{cell(row[c])}</td>
                ))}
                <td className="px-2 py-2">
                  <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => setModal(row)} className="p-1 text-gray-400 hover:text-church-navy rounded" title="Edit">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button onClick={() => handleDelete(row.id)} className="p-1 text-gray-400 hover:text-red-500 rounded" title="Delete">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > LIMIT && (
        <div className="flex items-center justify-between mt-3 text-sm text-gray-500">
          <span>{offset + 1}–{Math.min(offset + LIMIT, total)} of {total.toLocaleString()}</span>
          <div className="flex gap-1">
            <button disabled={offset === 0} onClick={() => paginate(Math.max(0, offset - LIMIT))} className="px-3 py-1 rounded border border-gray-200 disabled:opacity-40 hover:border-church-gold">Prev</button>
            <button disabled={offset + LIMIT >= total} onClick={() => paginate(offset + LIMIT)} className="px-3 py-1 rounded border border-gray-200 disabled:opacity-40 hover:border-church-gold">Next</button>
          </div>
        </div>
      )}

      {/* Modal */}
      {modal !== null && (
        <RowModal
          tableKey={tableKey}
          def={def}
          row={modal === 'new' ? null : modal}
          onSave={handleSaved}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

// ─── Overview cards ───────────────────────────────────────────────────────────

function Overview({ counts, lastScraped, onScrape, onImportCache, scraping, importing }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-church-navy">Database Overview</h2>
          {lastScraped && (
            <p className="text-xs text-gray-400 mt-0.5">Last scraped: {new Date(lastScraped).toLocaleString()}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onImportCache}
            disabled={importing || scraping}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
              importing ? 'border-gray-300 text-gray-400 cursor-not-allowed' : 'border-gray-300 text-gray-600 hover:border-church-navy hover:text-church-navy'
            }`}
            title="Load existing cached data into the database without fetching from the church site"
          >
            {importing
              ? <span className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full inline-block" />
              : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
            }
            {importing ? 'Importing…' : 'Import Cache'}
          </button>
          <button
            onClick={onScrape}
            disabled={scraping || importing}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
              scraping ? 'border-gray-300 text-gray-400 cursor-not-allowed' : 'border-church-gold text-church-gold hover:bg-church-gold hover:text-church-navy'
            }`}
          >
            {scraping
              ? <span className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full inline-block" />
              : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            }
            {scraping ? 'Scraping…' : 'Scrape & Import'}
          </button>
        </div>
      </div>

      {GROUPS.map(group => (
        <div key={group} className="mb-6">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">{group}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {Object.entries(TABLE_DEFS)
              .filter(([, d]) => d.group === group)
              .map(([key, d]) => (
                <div key={key} className="card py-3 px-4">
                  <p className="text-2xl font-bold text-church-navy">{(counts[key] ?? 0).toLocaleString()}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{d.label}</p>
                </div>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export default function DatabaseAdminView() {
  const [activeTable, setActiveTable] = useState('overview');
  const [overview, setOverview]       = useState(null);
  const [scraping, setScraping]       = useState(false);
  const [importing, setImporting]     = useState(false);
  const [scrapeMsg, setScrapeMsg]     = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const loadOverview = useCallback(async () => {
    try {
      const res = await fetch(`${API}/overview`, { credentials: 'include' });
      const j   = await res.json();
      if (j.success) setOverview(j);
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => { loadOverview(); }, [loadOverview]);

  async function handleScrape() {
    setScraping(true);
    setScrapeMsg('');
    try {
      const res = await fetch('/api/members/update', { method: 'POST', credentials: 'include' });
      const j   = await res.json();
      if (!j.success) throw new Error(j.error || 'Scrape failed');
      setScrapeMsg(j.warnings?.length ? `Scrape complete · ${j.warnings.length} warning(s)` : 'Scrape complete');
      loadOverview();
    } catch (err) {
      setScrapeMsg('Scrape failed: ' + err.message);
    } finally {
      setScraping(false);
    }
  }

  async function handleImportCache() {
    setImporting(true);
    setScrapeMsg('');
    try {
      const res = await fetch(`${API}/import-cache`, { method: 'POST', credentials: 'include' });
      const j   = await res.json();
      if (!j.success) throw new Error(j.error || 'Import failed');
      const total = Object.values(j.counts).reduce((s, n) => s + n, 0);
      setScrapeMsg(`Cache imported — ${total.toLocaleString()} total rows`);
      loadOverview();
    } catch (err) {
      setScrapeMsg('Import failed: ' + err.message);
    } finally {
      setImporting(false);
    }
  }

  const tableKeys = Object.keys(TABLE_DEFS);

  return (
    <div className="flex gap-0 h-[calc(100vh-10rem)] min-h-[500px]">

      {/* Sidebar */}
      <aside className={`shrink-0 bg-white border-r border-gray-100 rounded-l-xl flex flex-col transition-all ${sidebarOpen ? 'w-52' : 'w-52'} hidden lg:flex`}>
        <div className="px-3 py-3 border-b border-gray-100">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Database Admin</p>
        </div>
        <nav className="flex-1 overflow-y-auto py-2">
          {['overview', 'scrape-status'].map(id => (
            <button
              key={id}
              onClick={() => setActiveTable(id)}
              className={`w-full text-left px-4 py-2 text-sm rounded-lg mx-1 mb-0.5 transition-colors ${
                activeTable === id
                  ? 'bg-church-navy text-white font-medium'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-church-navy'
              }`}
            >
              {id === 'overview' ? 'Overview' : 'Scrape Status'}
            </button>
          ))}

          {GROUPS.map(group => (
            <div key={group} className="mt-3 mb-1">
              <p className="px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">{group}</p>
              {tableKeys
                .filter(k => TABLE_DEFS[k].group === group)
                .map(k => (
                  <button
                    key={k}
                    onClick={() => setActiveTable(k)}
                    className={`w-full text-left px-4 py-2 text-sm rounded-lg mx-1 mb-0.5 transition-colors flex items-center justify-between ${
                      activeTable === k
                        ? 'bg-church-navy text-white font-medium'
                        : 'text-gray-600 hover:bg-gray-50 hover:text-church-navy'
                    }`}
                  >
                    <span>{TABLE_DEFS[k].label}</span>
                    {overview?.counts?.[k] !== undefined && (
                      <span className={`text-xs tabular-nums ${activeTable === k ? 'text-church-gold' : 'text-gray-400'}`}>
                        {overview.counts[k].toLocaleString()}
                      </span>
                    )}
                  </button>
                ))}
            </div>
          ))}
        </nav>
      </aside>

      {/* Mobile table select */}
      <div className="lg:hidden w-full mb-4 absolute">
        <select
          value={activeTable}
          onChange={e => setActiveTable(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold"
        >
          <option value="overview">Overview</option>
          <option value="scrape-status">Scrape Status</option>
          {tableKeys.map(k => <option key={k} value={k}>{TABLE_DEFS[k].label}</option>)}
        </select>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-hidden bg-white rounded-r-xl lg:rounded-l-none border border-gray-100 flex flex-col p-5">
        {scrapeMsg && (
          <div className="mb-4 px-4 py-2.5 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800 flex items-center justify-between">
            <span>{scrapeMsg}</span>
            <button onClick={() => setScrapeMsg('')} className="ml-3 text-amber-600 hover:text-amber-800">✕</button>
          </div>
        )}

        {activeTable === 'overview' ? (
          <div className="overflow-y-auto flex-1">
            <Overview
              counts={overview?.counts || {}}
              lastScraped={overview?.lastScraped}
              onScrape={handleScrape}
              onImportCache={handleImportCache}
              scraping={scraping}
              importing={importing}
            />
          </div>
        ) : activeTable === 'scrape-status' ? (
          <div className="overflow-y-auto flex-1">
            <ScrapeStatus onScrape={handleScrape} scraping={scraping} />
          </div>
        ) : (
          <TableView key={activeTable} tableKey={activeTable} />
        )}
      </div>
    </div>
  );
}
