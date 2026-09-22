import { useState, useEffect, useCallback } from 'react';
import { call, timeAgo } from '../lib/groups';
import { STATUSES, severityInfo, statusInfo } from '../lib/bugReports';

// ─── Bug Reports ────────────────────────────────────────────────────────────
//
// Everything filed from the "Report a problem" link at the bottom of every
// page. Admin-only: it is not one part of the site to look after, it is the
// whole site, so it stays with whoever already holds everything else.
const API = '/api/bug-reports';

const STATUS_FILTERS = [{ id: '', label: 'Everything' }, ...STATUSES];

function Badge({ tone, children }) {
  return <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${tone}`}>{children}</span>;
}

// ─── One report, open ─────────────────────────────────────────────────────────

function ReportDetail({ report, onSaved }) {
  const [status, setStatus] = useState(report.status);
  const [note, setNote]     = useState(report.adminNote);
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState('');

  const dirty = status !== report.status || note !== report.adminNote;

  async function save() {
    setBusy(true); setError('');
    try {
      const json = await call(`${API}/${report.id}`, { method: 'PATCH', body: JSON.stringify({ status, adminNote: note }) });
      onSaved(json.report);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-4 pb-4 space-y-3 bg-gray-50/60">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2 text-sm">
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">What happened</p>
            <p className="text-gray-700 whitespace-pre-wrap">{report.description}</p>
          </div>
          {report.steps && (
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Steps</p>
              <p className="text-gray-700 whitespace-pre-wrap">{report.steps}</p>
            </div>
          )}
          <div className="text-xs text-gray-500 space-y-0.5">
            <p>Filed by {report.reporterName || 'somebody no longer here'}</p>
            {(report.pageLabel || report.page) && <p>Page: {report.pageLabel || report.page}</p>}
            {report.url && <p className="break-all">URL: {report.url}</p>}
            {report.userAgent && <p className="break-all">Browser: {report.userAgent}</p>}
          </div>
        </div>

        {report.screenshot && (
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Screenshot</p>
            <a href={`${API}/${report.id}/screenshot`} target="_blank" rel="noreferrer">
              <img
                src={`${API}/${report.id}/screenshot`}
                alt={`Screenshot attached to "${report.title}"`}
                className="rounded-lg border border-gray-200 max-h-64 object-contain"
              />
            </a>
          </div>
        )}
      </div>

      <div className="border-t border-gray-200 pt-3 space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-gray-600 flex items-center gap-2">
            Status
            <select
              value={status}
              onChange={e => setStatus(e.target.value)}
              className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm text-church-navy font-medium"
            >
              {STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
        </div>

        <label className="block">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Note (the reporter sees this)</span>
          <textarea
            rows={2}
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="What was done about it"
            className="mt-1 block w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold"
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex items-center gap-3">
          <button onClick={save} disabled={busy || !dirty} className="btn-primary text-sm disabled:opacity-50">
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── One report, closed ────────────────────────────────────────────────────────

function ReportRow({ report, open, onToggle, onSaved }) {
  const severity = severityInfo(report.severity);
  const status   = statusInfo(report.status);

  return (
    <div className="border-b border-gray-100 last:border-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={`Bug report: ${report.title}`}
        className="w-full text-left px-4 py-3 flex items-start justify-between gap-3 hover:bg-gray-50 transition-colors"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-church-navy truncate">{report.title}</span>
            <Badge tone={severity.tone}>{severity.label}</Badge>
            <Badge tone={status.tone}>{status.label}</Badge>
            {report.screenshot && <span className="text-xs text-gray-400">📷</span>}
          </div>
          <p className="text-xs text-gray-400 mt-0.5">
            {report.reporterName || 'Somebody'} &middot; {report.pageLabel || report.page || 'somewhere'} &middot; {timeAgo(report.createdAt)}
          </p>
        </div>
        <svg
          className={`w-4 h-4 shrink-0 text-gray-400 mt-1 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && <ReportDetail report={report} onSaved={onSaved} />}
    </div>
  );
}

// ─── The page ─────────────────────────────────────────────────────────────────

export default function BugReportsView() {
  const [reports, setReports] = useState([]);
  const [counts, setCounts]   = useState({});
  const [status, setStatus]   = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [openId, setOpenId]   = useState(null);

  const load = useCallback(async (wanted = status) => {
    setLoading(true);
    try {
      const json = await call(`${API}${wanted ? `?status=${encodeURIComponent(wanted)}` : ''}`);
      setReports(json.reports);
      setCounts(json.counts || {});
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(status); }, [status, load]);

  function replace(updated) {
    setReports(list => list.map(r => (r.id === updated.id ? updated : r)));
    setCounts(c => {
      const before = reports.find(r => r.id === updated.id)?.status;
      if (!before || before === updated.status) return c;
      return { ...c, [before]: Math.max(0, (c[before] || 0) - 1), [updated.status]: (c[updated.status] || 0) + 1 };
    });
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  if (loading && !reports.length) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-church-gold" />
      </div>
    );
  }

  if (error) {
    return <div className="card text-center py-10 text-red-600 text-sm">{error}</div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="section-heading mb-1">Bug Reports</h2>
        <p className="text-sm text-gray-500">
          {total} filed from the &ldquo;Report a problem&rdquo; link across the portal.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map(f => (
          <button
            key={f.id}
            onClick={() => setStatus(f.id)}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
              status === f.id ? 'bg-church-navy text-white border-church-navy' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}
          >
            {f.label}{f.id && counts[f.id] ? ` (${counts[f.id]})` : ''}
          </button>
        ))}
      </div>

      <div className="card p-0 overflow-hidden">
        {reports.map(report => (
          <ReportRow
            key={report.id}
            report={report}
            open={openId === report.id}
            onToggle={() => setOpenId(id => (id === report.id ? null : report.id))}
            onSaved={updated => replace(updated)}
          />
        ))}
        {reports.length === 0 && (
          <p className="px-4 py-12 text-center text-gray-400 text-sm">
            {status ? `Nothing ${statusInfo(status).label.toLowerCase()}.` : 'Nothing filed yet.'}
          </p>
        )}
      </div>
    </div>
  );
}
