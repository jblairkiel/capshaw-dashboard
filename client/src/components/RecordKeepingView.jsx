import { useState, useEffect, useCallback } from 'react';

// Which recent services are missing their songs or guests, and which Sundays
// their contribution. The server works it out (server/lib/recordKeeping.js)
// from the pages that own each record; this page shows it, sends you to the
// page to fix a gap, or lets you say there was nothing to record.

const API = '/api/record-keeping';

async function call(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'include',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  });
  const json = await res.json().catch(() => ({}));
  if (!json.success) throw new Error(json.error || 'Something went wrong');
  return json;
}

// Dates arrive as YYYY-MM-DD; read at midday so no timezone moves the day.
const day = (iso, opts = { weekday: 'short', month: 'short', day: 'numeric' }) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, opts);

const TRACKING_LABEL = { weekly: 'Every week', 'when-held': 'When held', '': 'Not tracked' };

// ─── One check for one service ───────────────────────────────────────────────

function Cell({ cell, check, onAdd, onNone, onUndo, busy }) {
  if (cell.status === 'recorded') {
    return <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">✓ Recorded</span>;
  }
  if (cell.status === 'none') {
    return (
      <span className="inline-flex items-center gap-2 text-xs">
        <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600" title={cell.note || undefined}>
          {check.noneLabel}{cell.by ? ` · ${cell.by}` : ''}
        </span>
        <button onClick={onUndo} disabled={busy} className="text-gray-400 hover:text-red-600 underline disabled:opacity-50">undo</button>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 flex-wrap text-xs">
      <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">Missing</span>
      <button onClick={onAdd} className="text-church-navy hover:underline">Add</button>
      <button onClick={onNone} disabled={busy} className="text-gray-500 hover:text-church-navy hover:underline disabled:opacity-50">{check.noneLabel}</button>
    </span>
  );
}

// ─── One week ─────────────────────────────────────────────────────────────────

function Week({ week, checks, busy, onGoToPage, onCheckoff, onUndo }) {
  const serviceChecks = checks.filter(c => c.scope === 'service');
  const contribution = checks.find(c => c.id === 'contribution');
  const gaps = week.rows.reduce((n, r) => n + Object.values(r.cells).filter(c => c.status === 'missing').length, 0)
    + (week.contribution?.status === 'missing' ? 1 : 0);

  return (
    <section className="card p-0 overflow-hidden" aria-label={`Week of ${day(week.start, { month: 'long', day: 'numeric' })}`}>
      <header className="flex items-center justify-between gap-3 flex-wrap px-4 py-3 border-b border-gray-100 bg-gray-50">
        <div>
          <h3 className="font-semibold text-church-navy text-sm">
            Week of {day(week.start, { month: 'long', day: 'numeric' })} – {day(week.end, { month: 'long', day: 'numeric' })}
          </h3>
          <p className={`text-xs ${gaps ? 'text-red-700' : 'text-emerald-700'}`}>{gaps ? `${gaps} missing` : 'All recorded'}</p>
        </div>
        {week.contribution && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-500">Contribution:</span>
            <Cell
              cell={week.contribution}
              check={contribution}
              busy={busy}
              onAdd={() => onGoToPage?.(contribution.page)}
              onNone={() => onCheckoff({ date: week.contribution.date, check: 'contribution' })}
              onUndo={() => onUndo(week.contribution.checkoffId)}
            />
          </div>
        )}
      </header>

      {week.rows.length === 0 ? (
        <p className="px-4 py-3 text-sm text-gray-400">No tracked services this week.</p>
      ) : (
        <div>
          {/* Column headings on wider screens; on a phone each row labels its own checks. */}
          <div className="hidden sm:grid grid-cols-[1.3fr_1fr_1fr_auto] gap-3 px-4 pt-2 pb-1 text-xs text-gray-400 uppercase tracking-wide">
            <span>Service</span>
            {serviceChecks.map(c => <span key={c.id}>{c.label}</span>)}
            <span />
          </div>
          {week.rows.map(row => (
            <div key={`${row.date}-${row.service}`} className="grid grid-cols-1 sm:grid-cols-[1.3fr_1fr_1fr_auto] gap-x-3 gap-y-1.5 px-4 py-2.5 border-t border-gray-50 items-start">
              <div>
                <span className="block text-church-navy text-sm">{row.service}</span>
                <span className="block text-xs text-gray-400">{day(row.date)}</span>
              </div>
              {row.notHeld ? (
                <div className="sm:col-span-2 text-xs text-gray-500 self-center">
                  Did not happen{row.notHeld.by ? ` · ${row.notHeld.by}` : ''}{row.notHeld.note ? ` — ${row.notHeld.note}` : ''}
                </div>
              ) : serviceChecks.map(c => (
                <div key={c.id} className="flex items-center gap-2 sm:block">
                  <span className="sm:hidden text-xs text-gray-400 w-14 shrink-0">{c.label}</span>
                  <Cell
                    cell={row.cells[c.id]}
                    check={c}
                    busy={busy}
                    onAdd={() => onGoToPage?.(c.page)}
                    onNone={() => onCheckoff({ date: row.date, service: row.service, check: c.id })}
                    onUndo={() => onUndo(row.cells[c.id].checkoffId)}
                  />
                </div>
              ))}
              <div className="sm:text-right">
                {row.notHeld ? (
                  <button onClick={() => onUndo(row.notHeld.checkoffId)} disabled={busy} className="text-xs text-gray-400 hover:text-red-600 underline disabled:opacity-50">undo</button>
                ) : (
                  <button
                    onClick={() => onCheckoff({ date: row.date, service: row.service, check: 'not-held' })}
                    disabled={busy}
                    className="text-xs text-gray-400 hover:text-church-navy hover:underline whitespace-nowrap disabled:opacity-50"
                  >
                    Didn&apos;t happen
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Which services are tracked ──────────────────────────────────────────────

function ServiceRow({ service, weekdays, songNames, onSaved }) {
  const [tracking, setTracking] = useState(service.tracking);
  const [weekday, setWeekday]   = useState(service.weekday ?? '');
  const [names, setNames]       = useState(service.song_names);
  const [state, setState]       = useState('');

  const changed = tracking !== service.tracking || String(weekday) !== String(service.weekday ?? '') || names !== service.song_names;

  async function save() {
    setState('saving');
    try {
      await call(`${API}/services/${service.id}`, {
        method: 'PUT',
        body: JSON.stringify({ tracking, weekday: weekday === '' ? null : Number(weekday), songNames: names }),
      });
      setState('saved');
      onSaved();
    } catch (e) {
      setState(e.message);
    }
  }

  return (
    <tr className="border-t border-gray-100 align-top">
      <td className="py-2 pr-3 text-church-navy">
        {service.name}
        {!service.active && <span className="ml-1 text-xs text-gray-400">(retired)</span>}
      </td>
      <td className="py-2 pr-3">
        <select value={tracking} onChange={e => setTracking(e.target.value)} aria-label={`How ${service.name} is tracked`} className="border border-gray-300 rounded px-2 py-1 text-sm">
          {Object.entries(TRACKING_LABEL).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
      </td>
      <td className="py-2 pr-3">
        <select value={weekday} onChange={e => setWeekday(e.target.value)} aria-label={`Day of ${service.name}`} className="border border-gray-300 rounded px-2 py-1 text-sm" disabled={tracking === ''}>
          <option value="">Any day</option>
          {weekdays.map((w, i) => <option key={w} value={i}>{w}</option>)}
        </select>
      </td>
      <td className="py-2 pr-3">
        <input
          value={names}
          onChange={e => setNames(e.target.value)}
          list="song-tracker-names"
          placeholder={songNames.join(', ')}
          aria-label={`Song tracker name for ${service.name}`}
          className="border border-gray-300 rounded px-2 py-1 text-sm w-32"
          disabled={tracking === ''}
        />
      </td>
      <td className="py-2 text-right whitespace-nowrap">
        {changed && <button onClick={save} disabled={state === 'saving'} className="btn-primary text-xs px-3 py-1">Save</button>}
        {!changed && state === 'saved' && <span className="text-xs text-emerald-700">Saved</span>}
        {state && !['saving', 'saved'].includes(state) && <span className="block text-xs text-red-600 mt-1">{state}</span>}
      </td>
    </tr>
  );
}

function Settings({ onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => { call(`${API}/services`).then(setData).catch(e => setError(e.message)); }, []);
  useEffect(() => { load(); }, [load]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return <p className="text-sm text-gray-400">Loading…</p>;

  return (
    <div className="overflow-x-auto">
      <p className="text-xs text-gray-500 mb-2">
        <strong>Every week</strong> services are expected on their day whatever is on file. <strong>When held</strong> ones
        only in a week where attendance, guests or songs show they happened. The song tracker names services its own way —
        say what it calls each one so its songs are counted.
      </p>
      <datalist id="song-tracker-names">{data.songNames.map(n => <option key={n} value={n} />)}</datalist>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-400 uppercase tracking-wide">
            <th className="pb-1 font-medium">Service</th>
            <th className="pb-1 font-medium">Tracked</th>
            <th className="pb-1 font-medium">Day</th>
            <th className="pb-1 font-medium">Song tracker calls it</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data.services.map(s => (
            <ServiceRow key={s.id} service={s} weekdays={data.weekdays} songNames={data.songNames} onSaved={() => { load(); onChanged(); }} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── The page ─────────────────────────────────────────────────────────────────

export default function RecordKeepingView({ onGoToPage }) {
  const [weeks, setWeeks]   = useState(8);
  const [data, setData]     = useState(null);
  const [error, setError]   = useState('');
  const [busy, setBusy]     = useState(false);
  const [notice, setNotice] = useState('');
  const [showSettings, setShowSettings] = useState(false);

  const load = useCallback(() => {
    call(`${API}?weeks=${weeks}`).then(d => { setData(d); setError(''); }).catch(e => setError(e.message));
  }, [weeks]);
  useEffect(() => { load(); }, [load]);

  async function act(fn) {
    setBusy(true); setNotice('');
    try { await fn(); load(); } catch (e) { setNotice(e.message); } finally { setBusy(false); }
  }
  const checkoff = body => act(() => call(`${API}/checkoffs`, { method: 'POST', body: JSON.stringify(body) }));
  const undo = id => act(() => call(`${API}/checkoffs/${id}`, { method: 'DELETE' }));

  if (error && !data) return <div className="card text-sm text-red-600">{error}</div>;
  if (!data) return <div className="card text-sm text-gray-500">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="section-heading mb-1">Record Keeping</h2>
          <p className="text-sm text-gray-500">Songs and guests for every service, and each Sunday&apos;s contribution.</p>
        </div>
        <label className="text-sm text-gray-500 flex items-center gap-2">
          Show
          <select value={weeks} onChange={e => setWeeks(Number(e.target.value))} aria-label="Weeks to show" className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm">
            {[4, 8, 13, 26].map(n => <option key={n} value={n}>{n} weeks</option>)}
          </select>
        </label>
      </div>

      <div className={`card ${data.totalMissing ? 'border border-red-200 bg-red-50' : 'border border-emerald-200 bg-emerald-50'}`}>
        {data.totalMissing ? (
          <p className="text-sm text-red-800">
            <strong>{data.totalMissing} missing</strong> in the last {weeks} weeks —{' '}
            {data.checks.filter(c => data.missing[c.id]).map(c => `${c.label.toLowerCase()} ${data.missing[c.id]}`).join(', ')}.
          </p>
        ) : (
          <p className="text-sm text-emerald-800">Everything is recorded for the last {weeks} weeks.</p>
        )}
      </div>

      {notice && <div className="card text-sm text-red-600">{notice}</div>}

      {data.weeks.map(week => (
        <Week key={week.start} week={week} checks={data.checks} busy={busy} onGoToPage={onGoToPage} onCheckoff={checkoff} onUndo={undo} />
      ))}

      <div className="card">
        <button onClick={() => setShowSettings(s => !s)} className="text-sm font-semibold text-church-navy" aria-expanded={showSettings}>
          {showSettings ? '▾' : '▸'} Which services are tracked
        </button>
        {showSettings && <div className="mt-3"><Settings onChanged={load} /></div>}
      </div>
    </div>
  );
}
