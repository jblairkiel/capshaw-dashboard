import { useState, useEffect, useCallback } from 'react';
import RecordKeepingView from '../RecordKeepingView';
import { SummaryWeek, SummaryYear } from './SummaryReport';
import { AnalyticalWeek, AnalyticalYear } from './AnalyticalReport';

// Reports & Record Keeping: the Record Keeping check, the two weekly reports
// and, for admins, when the reports are emailed. Each tab is shown to whoever
// holds its area; the server checks the same on every request.

const API = '/api/reports';
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

async function call(url, options = {}) {
  const res = await fetch(url, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...options });
  const json = await res.json().catch(() => ({}));
  if (!json.success) throw new Error(json.error || 'Something went wrong');
  return json;
}

const d = iso => new Date(`${iso}T12:00:00Z`);
const addDays = (iso, n) => { const t = d(iso); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const weekLabel = (start, end) => {
  const a = d(start); const b = d(end);
  return a.getUTCMonth() === b.getUTCMonth()
    ? `${MONTHS[a.getUTCMonth()]} ${a.getUTCDate()}–${b.getUTCDate()}, ${b.getUTCFullYear()}`
    : `${MONTHS[a.getUTCMonth()].slice(0, 3)} ${a.getUTCDate()} – ${MONTHS[b.getUTCMonth()].slice(0, 3)} ${b.getUTCDate()}, ${b.getUTCFullYear()}`;
};
const clock = time => {
  const [h, m] = String(time || '').split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

// ─── One report ───────────────────────────────────────────────────────────────

function Report({ kind, title }) {
  const [week, setWeek] = useState('');            // a date in the week shown; '' for the week just ended
  const [period, setPeriod] = useState('week');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    call(`${API}/${kind}${week ? `?week=${week}` : ''}`)
      .then(json => { if (live) { setData(json.report); setError(''); } })
      .catch(err => live && setError(err.message))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [kind, week]);

  if (error) return <div className="card text-sm text-red-600">{error}</div>;
  if (!data) return <div className="card text-sm text-gray-400">Loading the report…</div>;
  const { start, end } = data.week;
  const isLatest = addDays(start, 7) > new Date().toISOString().slice(0, 10);

  return (
    <div className={`space-y-4 ${loading ? 'opacity-60' : ''}`}>
      <div className="card flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" onClick={() => setWeek(addDays(start, -7))} aria-label="The week before"
            className="px-2.5 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:border-church-navy">‹</button>
          <div className="text-center min-w-[11rem]">
            <p className="font-semibold text-church-navy">{weekLabel(start, end)}</p>
            <p className="text-xs text-gray-400">Sunday to Saturday</p>
          </div>
          <button type="button" onClick={() => setWeek(addDays(start, 7))} disabled={isLatest} aria-label="The week after"
            className="px-2.5 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:border-church-navy disabled:opacity-30">›</button>
          <label className="text-xs text-gray-500 flex items-center gap-1 ml-1">
            Go to
            <input type="date" value={week} max={new Date().toISOString().slice(0, 10)} onChange={e => setWeek(e.target.value)}
              aria-label="Show the week holding this date" className="border border-gray-300 rounded-lg px-2 py-1 text-sm" />
          </label>
        </div>
        <a href={`${API}/${kind}/pdf?week=${start}`} className="btn-primary text-sm">Download PDF</a>
      </div>

      <div role="tablist" aria-label={`${title}: which period`} className="inline-flex rounded-lg border border-gray-200 bg-white p-1">
        {[['week', 'This week'], ['year', `${data.year.year} so far`]].map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={period === id} onClick={() => setPeriod(id)}
            className={`px-4 py-1.5 text-sm rounded-md ${period === id ? 'bg-church-navy text-white font-medium' : 'text-gray-600 hover:text-church-navy'}`}>
            {label}
          </button>
        ))}
      </div>

      {kind === 'summary'
        ? (period === 'week' ? <SummaryWeek week={data.week} year={data.year} /> : <SummaryYear year={data.year} />)
        : (period === 'week' ? <AnalyticalWeek week={data.week} /> : <AnalyticalYear year={data.year} />)}
    </div>
  );
}

// ─── When the reports are emailed ─────────────────────────────────────────────

function ScheduleCard({ setting, onSaved }) {
  const [form, setForm] = useState({ weekday: setting.weekday, time: setting.time, enabled: setting.enabled });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const dirty = form.weekday !== setting.weekday || form.time !== setting.time || form.enabled !== setting.enabled;

  async function save() {
    setBusy(true); setNotice('');
    try {
      const json = await call(`${API}/settings/${setting.kind}`, { method: 'PUT', body: JSON.stringify(form) });
      onSaved(json.setting); setNotice('Saved.');
    } catch (err) { setNotice(err.message); } finally { setBusy(false); }
  }
  async function sendNow() {
    if (!window.confirm(`Send the ${setting.title} for the week just ended to everybody who receives it, now?`)) return;
    setBusy(true); setNotice('');
    try {
      const json = await call(`${API}/${setting.kind}/send`, { method: 'POST', body: '{}' });
      setNotice(`Sent to ${json.sent} ${json.sent === 1 ? 'person' : 'people'}.`);
    } catch (err) { setNotice(err.message); } finally { setBusy(false); }
  }

  const covers = form.weekday === 6 ? 'that week, Sunday to Saturday' : 'the week that ended the Saturday before';
  return (
    <section className="card space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold text-church-navy">{setting.title}</h3>
          <p className="text-xs text-gray-500">Emailed to whoever holds the <b>{setting.kind === 'summary' ? 'Weekly Summary Report' : 'Weekly Analytical Report'}</b> area — the admins, if nobody does.</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.enabled} onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))} className="accent-church-gold" />
          Send each week
        </label>
      </div>
      <div className="flex items-end gap-3 flex-wrap">
        <label className="block">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Day</span>
          <select value={form.weekday} disabled={!form.enabled} onChange={e => setForm(f => ({ ...f, weekday: Number(e.target.value) }))}
            className="mt-1 block border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
            {WEEKDAYS.map((w, i) => <option key={w} value={i}>{w}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Time</span>
          <input type="time" step="900" value={form.time} disabled={!form.enabled} onChange={e => setForm(f => ({ ...f, time: e.target.value }))}
            className="mt-1 block border border-gray-200 rounded-lg px-3 py-2 text-sm" />
        </label>
        <button type="button" onClick={save} disabled={busy || !dirty} className="btn-primary text-sm disabled:opacity-40">Save</button>
        <button type="button" onClick={sendNow} disabled={busy} className="text-sm px-3 py-2 rounded-lg border border-gray-300 text-gray-700 hover:border-church-navy">Send now</button>
      </div>
      <p className="text-xs text-gray-500">
        {form.enabled
          ? `Sent every ${WEEKDAYS[form.weekday]} at ${clock(form.time)} church time, covering ${covers}.`
          : 'Not being sent. It can still be seen and downloaded here.'}
        {setting.lastSent ? ` Last sent ${new Date(`${setting.lastSent.replace(' ', 'T')}Z`).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.` : ''}
      </p>
      {notice && <p className="text-sm text-church-navy" role="status">{notice}</p>}
    </section>
  );
}

function Settings({ settings, onSaved }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        When each weekly report is emailed. Choosing who receives them is done on <b>Admin → Members &amp; Access</b>,
        by giving people the Weekly Summary Report or Weekly Analytical Report area.
      </p>
      {settings.map(s => <ScheduleCard key={s.kind} setting={s} onSaved={onSaved} />)}
    </div>
  );
}

// ─── The page ─────────────────────────────────────────────────────────────────

export default function ReportsPage({ user, onGoToPage, initialTab = null }) {
  const holds = area => user?.role === 'admin' || (user?.areas || []).includes(area);
  const [meta, setMeta] = useState(null);
  const load = useCallback(() => call(API).then(setMeta).catch(() => setMeta({ reports: [], canManage: false })), []);
  useEffect(() => { load(); }, [load]);

  const tabs = [
    ...(holds('records') ? [{ id: 'records', label: 'Record Keeping' }] : []),
    ...(meta?.reports || []).map(r => ({ id: r.kind, label: r.kind === 'summary' ? 'Weekly Summary' : 'Analytical Report', title: r.title })),
    ...(meta?.canManage ? [{ id: 'settings', label: 'Settings' }] : []),
  ];
  const [tab, setTab] = useState(initialTab);
  const active = tabs.find(t => t.id === tab) ? tab : tabs[0]?.id;

  return (
    <div className="space-y-4">
      <h2 className="section-heading mb-0">Reports &amp; Record Keeping</h2>
      {tabs.length > 1 && (
        <div role="tablist" aria-label="Reports" className="flex gap-1 border-b border-gray-200 overflow-x-auto">
          {tabs.map(t => (
            <button key={t.id} type="button" role="tab" aria-selected={active === t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm -mb-px border-b-2 whitespace-nowrap ${active === t.id ? 'border-church-gold text-church-navy font-medium' : 'border-transparent text-gray-500 hover:text-church-navy'}`}>
              {t.label}
            </button>
          ))}
        </div>
      )}
      {!meta && !holds('records') && <div className="card text-sm text-gray-400">Loading…</div>}
      {active === 'records' && <RecordKeepingView onGoToPage={onGoToPage} />}
      {(active === 'summary' || active === 'analytical') && <Report key={active} kind={active} title={tabs.find(t => t.id === active).title} />}
      {active === 'settings' && meta?.settings && (
        <Settings settings={meta.settings} onSaved={s => setMeta(m => ({ ...m, settings: m.settings.map(x => (x.kind === s.kind ? s : x)) }))} />
      )}
    </div>
  );
}
