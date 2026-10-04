import { useState, useEffect, useCallback, useMemo } from 'react';
import { toCsv, downloadCsv } from '../lib/csv';
import { hasArea } from '../lib/roles';
import Dialog from './Dialog';
import DateInput from './DateInput';

// The counter's weekly total — one number a week, never a per-giver ledger.
// A single week goes through /api/records/contributions, which gates writes on
// the contributions area and records every change in the action history,
// exactly like Attendance. Years of them at once come from a CSV export
// through /api/contributions/import (server/routes/contributions.js).
const API        = '/api/records/contributions';
const IMPORT_API = '/api/contributions/import';

const BLANK = { date: '', amount: '' };

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const moneyPrecise = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

async function send(url, options = {}) {
  const res  = await fetch(url, { credentials: 'include', ...options });
  const json = await res.json().catch(() => ({}));
  if (!json.success) throw new Error(json.error || 'Something went wrong');
  return json;
}

// The site has recorded a week's date as ISO (what the form asks for) and as
// M/D/YYYY (what the old site's own pages read as), sometimes both. Analytics
// needs a real Date to bucket by month and year, so this tries both rather
// than assuming one.
function parseRecordDate(value) {
  const s = String(value || '').trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (mdy) {
    const year = mdy[3].length === 2 ? 2000 + Number(mdy[3]) : Number(mdy[3]);
    return new Date(year, Number(mdy[1]) - 1, Number(mdy[2]));
  }
  return null;
}

const longDate = iso => {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const MONTH_LABEL = d => d.toLocaleDateString('en-US', { month: 'short' });

// ─── Trend chart — one series, so no legend is needed; the title names it ────
// Thin bars, 4px rounded tops anchored to the baseline, a recessive gridline,
// and a per-bar hover tooltip rather than a label on every value.
function roundedTopPath(x, y, w, h, r) {
  if (h <= 0) return '';
  const radius = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h} L${x},${y + radius} Q${x},${y} ${x + radius},${y} ` +
         `L${x + w - radius},${y} Q${x + w},${y} ${x + w},${y + radius} L${x + w},${y + h} Z`;
}

function TrendChart({ months }) {
  const [hover, setHover] = useState(null);
  const width  = 720;
  const height = 220;
  const padL   = 8, padR = 8, padT = 12, padB = 28;
  const plotW  = width - padL - padR;
  const plotH  = height - padT - padB;

  const max     = Math.max(1, ...months.map(m => m.total));
  const gap     = 10;
  const barW    = months.length ? (plotW - gap * (months.length - 1)) / months.length : 0;

  if (!months.length) {
    return <div className="h-48 flex items-center justify-center text-sm text-gray-400">Not enough data yet for a trend.</div>;
  }

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-56" role="img" aria-label="Monthly contribution totals">
        {/* Baseline */}
        <line x1={padL} y1={padT + plotH} x2={width - padR} y2={padT + plotH} stroke="#e5e7eb" strokeWidth="1" />
        {months.map((m, i) => {
          const x = padL + i * (barW + gap);
          const h = (m.total / max) * plotH;
          const y = padT + (plotH - h);
          const isHover = hover === i;
          return (
            <g key={m.key}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(h => (h === i ? null : h))}
            >
              {/* Wider invisible hit target than the thin bar itself */}
              <rect x={x} y={padT} width={barW} height={plotH} fill="transparent" />
              <path d={roundedTopPath(x, y, barW, h, 4)} fill={isHover ? '#c9a84c' : '#1a2744'} />
              <text x={x + barW / 2} y={height - 8} textAnchor="middle" className="fill-gray-400" style={{ fontSize: 10 }}>
                {m.label}
              </text>
            </g>
          );
        })}
      </svg>
      {hover != null && (
        <div
          className="absolute bg-church-navy text-white text-xs rounded-md px-2 py-1 pointer-events-none shadow-lg -translate-x-1/2 -translate-y-full"
          style={{
            left:  `${((padL + hover * (barW + gap) + barW / 2) / width) * 100}%`,
            top:   `${((padT + (plotH - (months[hover].total / max) * plotH)) / height) * 100}%`,
          }}
        >
          <div className="font-semibold">{moneyPrecise.format(months[hover].total)}</div>
          <div className="opacity-75">{months[hover].fullLabel}</div>
        </div>
      )}
    </div>
  );
}

// ─── Importing a CSV ──────────────────────────────────────────────────────────
//
// The file is read by the server twice: first to say what it holds, then — once
// somebody has looked at that — to save it. Nothing is written until Import is
// pressed, and a week already on file is never overwritten.

function ImportCsvDialog({ file, csv, preview, onClose, onImported }) {
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');
  const toAdd = preview.found - preview.alreadyOnFile;
  const matchesTotal = preview.statedTotal != null && Math.abs(preview.statedTotal - preview.total) < 0.01;

  async function confirm() {
    setBusy(true); setError('');
    try {
      const json = await send(IMPORT_API, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ csv, filename: file.name }),
      });
      onImported(json);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Dialog title="Import contributions" subtitle={file.name} onClose={onClose} width="max-w-md">
      <div className="space-y-3 text-sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-gray-500">Weeks in the file</dt>
          <dd className="font-semibold text-church-navy">{preview.found}</dd>
          <dt className="text-gray-500">From</dt>
          <dd>{longDate(preview.first)} to {longDate(preview.last)}</dd>
          <dt className="text-gray-500">Total</dt>
          <dd>
            {moneyPrecise.format(preview.total)}
            {matchesTotal && <span className="text-green-700"> — matches the file&rsquo;s own total</span>}
          </dd>
          <dt className="text-gray-500">Read from</dt>
          <dd>the &ldquo;{preview.amountColumn}&rdquo; column</dd>
        </dl>

        {preview.alreadyOnFile > 0 && (
          <p className="text-gray-600">
            {preview.alreadyOnFile === 1
              ? '1 of these weeks is already on file and will be left as it is.'
              : `${preview.alreadyOnFile} of these weeks are already on file and will be left as they are.`}
          </p>
        )}
        {preview.warnings?.length > 0 && (
          <ul className="list-disc pl-5 text-xs text-amber-800 space-y-0.5">
            {preview.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        )}
        {error && <p className="text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg border border-gray-200 text-gray-600">Cancel</button>
          <button type="button" onClick={confirm} disabled={busy || toAdd === 0} className="btn-primary text-sm disabled:opacity-50">
            {busy ? 'Importing…' : toAdd === 0 ? 'Nothing new to import' : `Import ${toAdd} week${toAdd === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

// ─── Adding or correcting a week's total ──────────────────────────────────────

function ContributionForm({ record, onClose, onSaved }) {
  const isNew = !record?.id;
  const [form, setForm]   = useState(() => ({ ...BLANK, ...(record || {}) }));
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');

  const set = (key, value) => setForm(p => ({ ...p, [key]: value }));

  async function submit(e) {
    e.preventDefault();
    if (!String(form.date).trim()) return setError('A date is needed');
    if (form.amount === '' || Number.isNaN(Number(form.amount))) return setError('An amount is needed');
    setBusy(true); setError('');
    try {
      await send(isNew ? API : `${API}/${record.id}`, {
        method:  isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ date: form.date, amount: Number(form.amount) }),
      });
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm('Delete this contribution record?')) return;
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
    <Dialog title={isNew ? 'Record a week’s contribution' : 'Correct this record'} onClose={onClose} width="max-w-sm">
      <form onSubmit={submit} className="space-y-3">
        <label className="block">
          <span className={label}>Week of</span>
          <DateInput autoFocus required value={form.date} onChange={v => set('date', v)} className={field} />
        </label>
        <label className="block">
          <span className={label}>Total contribution</span>
          <input required type="number" min="0" step="0.01" value={form.amount}
            onChange={e => set('amount', e.target.value)} className={field} placeholder="0.00" />
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

export default function ContributionsView({ user }) {
  const [records, setRecords]   = useState([]);
  const [loaded, setLoaded]     = useState(false);
  const [editing, setEditing]   = useState(null);
  const [reading, setReading]   = useState(false);
  const [pending, setPending]   = useState(null);   // { file, csv, preview } awaiting confirmation
  const [importResult, setImportResult] = useState(null);
  const [importError, setImportError]   = useState('');

  const canWrite = hasArea(user, 'contributions');

  const loadRecords = useCallback(() => {
    fetch(`${API}?limit=2000&sort=date&dir=desc`, { credentials: 'include' })
      .then(r => r.json())
      .then(j => { if (j.success) setRecords(j.rows); })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => { loadRecords(); }, [loadRecords]);

  // Every record with a date we can actually read, newest first, carrying the
  // parsed Date alongside so analytics never has to re-parse it.
  const rows = useMemo(() => (
    records
      .map(r => ({ ...r, parsedDate: parseRecordDate(r.date) }))
      .filter(r => r.parsedDate)
      .sort((a, b) => b.parsedDate - a.parsedDate)
  ), [records]);

  const now = new Date();
  const thisYear = now.getFullYear();

  const totalFor = useCallback(year => rows
    .filter(r => r.parsedDate.getFullYear() === year)
    .reduce((s, r) => s + Number(r.amount || 0), 0), [rows]);

  const yearTotal = totalFor(thisYear);

  // Last year over the same stretch — up to the latest week entered this year,
  // not to today, since entries lag the calendar. Setting a year still under
  // way against a whole one would read as a fall every year until December.
  const latestThisYear = rows.find(r => r.parsedDate.getFullYear() === thisYear)?.parsedDate;
  const cutoff = latestThisYear
    && new Date(thisYear - 1, latestThisYear.getMonth(), latestThisYear.getDate());
  const lastYearToDate = cutoff ? rows
    .filter(r => r.parsedDate.getFullYear() === thisYear - 1 && r.parsedDate <= cutoff)
    .reduce((s, r) => s + Number(r.amount || 0), 0) : 0;
  const yoyChange = lastYearToDate > 0 ? ((yearTotal - lastYearToDate) / lastYearToDate) * 100 : null;

  const monthTotal = rows
    .filter(r => r.parsedDate.getFullYear() === thisYear && r.parsedDate.getMonth() === now.getMonth())
    .reduce((s, r) => s + Number(r.amount || 0), 0);

  const weeksThisYear = rows.filter(r => r.parsedDate.getFullYear() === thisYear).length;
  const avgPerWeek     = weeksThisYear ? yearTotal / weeksThisYear : 0;

  // The last 12 calendar months, oldest to newest, so the chart reads left to
  // right the way a calendar does.
  const months = useMemo(() => {
    const buckets = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.push({
        key:       `${d.getFullYear()}-${d.getMonth()}`,
        year:      d.getFullYear(),
        month:     d.getMonth(),
        label:     MONTH_LABEL(d),
        fullLabel: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
        total:     0,
      });
    }
    const byKey = new Map(buckets.map(b => [b.key, b]));
    for (const r of rows) {
      const key = `${r.parsedDate.getFullYear()}-${r.parsedDate.getMonth()}`;
      const bucket = byKey.get(key);
      if (bucket) bucket.total += Number(r.amount || 0);
    }
    return buckets;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  // Picking a file only asks what it holds; the dialog is where it is saved.
  async function chooseFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setReading(true);
    setImportError('');
    setImportResult(null);
    try {
      const csv = await file.text();
      const preview = await send(IMPORT_API, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ csv, filename: file.name, dryRun: true }),
      });
      setPending({ file, csv, preview });
    } catch (err) {
      setImportError(err.message);
    } finally {
      setReading(false);
    }
  }

  function handleExport() {
    downloadCsv('contributions.csv', toCsv(['Date', 'Amount'], rows.map(r => [r.date, r.amount])));
  }

  if (!loaded) {
    return <div className="card flex items-center justify-center h-48 text-gray-400">Loading…</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <h2 className="section-heading mb-0">Contributions</h2>
        <div className="flex items-center gap-2">
          {canWrite && (
            <label className={`text-sm px-3 py-2 rounded-lg border border-gray-300 text-gray-600 hover:border-church-gold hover:text-church-navy transition-colors cursor-pointer ${reading ? 'opacity-50 pointer-events-none' : ''}`}>
              {reading ? 'Reading…' : 'Import CSV'}
              <input type="file" accept=".csv,text/csv" onChange={chooseFile} className="sr-only" aria-label="Import CSV" />
            </label>
          )}
          {canWrite && (
            <button onClick={() => setEditing({})} className="btn-primary text-sm">
              Record this week
            </button>
          )}
          <button
            onClick={handleExport}
            disabled={rows.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-church-navy text-church-navy hover:bg-church-navy hover:text-white transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-church-navy"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export CSV
          </button>
        </div>
      </div>

      {importResult && (
        <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
          Imported {importResult.added} week{importResult.added === 1 ? '' : 's'} of contributions
          {importResult.alreadyOnFile === 1 && ' — 1 already on file was left as it was'}
          {importResult.alreadyOnFile > 1 && ` — ${importResult.alreadyOnFile} already on file were left as they were`}.
        </p>
      )}
      {importError && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{importError}</p>
      )}

      {rows.length === 0 ? (
        <div className="card flex items-center justify-center h-32 text-gray-400 text-sm">
          No contributions recorded yet{canWrite ? ' — record this week, or import a CSV.' : '.'}
        </div>
      ) : (
        <>
          {/* Analytics — the main view of this page */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="card text-center py-4">
              <p className="text-2xl font-bold text-church-navy">{money.format(yearTotal)}</p>
              <p className="text-xs text-gray-500 mt-1">{thisYear} so far</p>
            </div>
            <div className="card text-center py-4">
              <p className="text-2xl font-bold text-church-navy">{money.format(monthTotal)}</p>
              <p className="text-xs text-gray-500 mt-1">This month</p>
            </div>
            <div className="card text-center py-4">
              <p className="text-2xl font-bold text-church-navy">{money.format(avgPerWeek)}</p>
              <p className="text-xs text-gray-500 mt-1">Average per week</p>
            </div>
            <div className="card text-center py-4">
              <p className={`text-2xl font-bold ${yoyChange == null ? 'text-gray-400' : yoyChange >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                {yoyChange == null ? '—' : `${yoyChange >= 0 ? '+' : ''}${yoyChange.toFixed(1)}%`}
              </p>
              <p className="text-xs text-gray-500 mt-1">Vs. {thisYear - 1} to date</p>
            </div>
          </div>

          <div className="card">
            <h3 className="text-sm font-semibold text-church-navy mb-3">Monthly totals, last 12 months</h3>
            <TrendChart months={months} />
          </div>

          {/* Weekly entries */}
          <div>
            <h3 className="text-sm font-semibold text-church-navy mb-2">Weekly entries</h3>
            <div className="card p-0 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-church-navy text-left text-xs text-gray-300 uppercase tracking-wide">
                    <th className="px-4 py-3">Week of</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    {canWrite && <th className="px-4 py-3 w-16" />}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.id ?? i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{r.date}</td>
                      <td className="px-4 py-2 text-right font-semibold text-church-navy">{moneyPrecise.format(Number(r.amount || 0))}</td>
                      {canWrite && (
                        <td className="px-4 py-2 text-right">
                          {r.id && (
                            <button
                              onClick={() => setEditing(r)}
                              aria-label={`Edit the week of ${r.date}`}
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
          </div>
        </>
      )}

      {pending && (
        <ImportCsvDialog
          {...pending}
          onClose={() => setPending(null)}
          onImported={json => { setPending(null); setImportResult(json); loadRecords(); }}
        />
      )}

      {editing && (
        <ContributionForm
          record={editing.id ? editing : null}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); loadRecords(); }}
        />
      )}
    </div>
  );
}
