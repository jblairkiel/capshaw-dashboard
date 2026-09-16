import { useState, useEffect, useCallback, useMemo } from 'react';
import Dialog from './Dialog';

// The serving schedule, from both sides of it:
//
//   · Everybody sees the month, week by week, and the men of the congregation
//     can sign themselves up for an empty job they have been signed off for —
//     or take their own name back off one.
//   · Whoever looks after the schedule can lay out next month in one go, fill
//     or clear any slot by hand, and add a one-off job.
//
// The server decides all of that; `canManage` and `me` come back from it and
// only say which buttons to draw.
const API = '/api/serving';

// Assignments with no date of their own are not part of any week — the monthly
// visual preparation is the one that behaves this way — so they are called out
// above the table rather than being dropped into an arbitrary Sunday.
const MONTHLY_JOBS = new Set(['Visual Preparation']);

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// The month after this one, as the page's suggestion for "build next month".
function nextMonthLabel() {
  const now = new Date();
  const month = (now.getMonth() + 1) % 12;
  const year  = now.getFullYear() + (now.getMonth() === 11 ? 1 : 0);
  return `${MONTH_NAMES[month]} ${year}`;
}

async function send(url, options = {}) {
  const res  = await fetch(url, { credentials: 'include', ...options });
  const json = await res.json().catch(() => ({}));
  if (!json.success) throw new Error(json.error || 'Something went wrong');
  return json;
}

function jsonBody(body) {
  return { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

// ─── Laying out a month ───────────────────────────────────────────────────────

function BuildMonthDialog({ services, onClose, onBuilt }) {
  const [month, setMonth]       = useState(nextMonthLabel);
  const [chosen, setChosen]     = useState(() => new Set(services));
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState('');

  function toggle(service) {
    setChosen(prev => {
      const next = new Set(prev);
      if (next.has(service)) next.delete(service); else next.add(service);
      return next;
    });
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const json = await send(`${API}/months`, { method: 'POST', ...jsonBody({ month, services: [...chosen] }) });
      onBuilt(json);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Dialog title="Build a month of serving jobs" subtitle="Empty slots, ready for people to be put against them" onClose={onClose} width="max-w-md">
      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Month</span>
          <input
            autoFocus
            required
            value={month}
            onChange={e => setMonth(e.target.value)}
            placeholder="June 2026"
            className="mt-1 block w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold"
          />
        </label>

        <fieldset className="border-0 p-0 m-0">
          <legend className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Services to lay out</legend>
          <div className="space-y-1">
            {services.map(service => (
              <label key={service} className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={chosen.has(service)}
                  onChange={() => toggle(service)}
                  className="accent-church-gold"
                />
                {service}
              </label>
            ))}
          </div>
        </fieldset>

        <p className="text-xs text-gray-500">
          Every service in the month gets a slot for each job it needs, with nobody against it yet.
          Running this twice never doubles a month up.
        </p>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="text-sm px-3 py-2 rounded-lg border border-gray-200 text-gray-600">Cancel</button>
          <button type="submit" disabled={busy || !chosen.size} className="btn-primary text-sm disabled:opacity-50">
            {busy ? 'Building…' : 'Build the month'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ─── Adding or editing one slot ───────────────────────────────────────────────

function SlotDialog({ slot, month, jobs, services, onClose, onSaved, onDeleted }) {
  const isNew = !slot?.id;
  const [form, setForm] = useState(() => ({
    month:   slot?.month   ?? month,
    date:    slot?.date    ?? '',
    service: slot?.service ?? services[0] ?? '',
    job:     slot?.job     ?? jobs[0] ?? '',
    name:    slot?.name    ?? '',
  }));
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');

  const set = (key, value) => setForm(p => ({ ...p, [key]: value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const json = await send(
        isNew ? `${API}/assignments` : `${API}/assignments/${slot.id}`,
        { method: isNew ? 'POST' : 'PATCH', ...jsonBody(form) },
      );
      onSaved(json.assignment);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm('Remove this slot from the roster?')) return;
    setBusy(true);
    try {
      await send(`${API}/assignments/${slot.id}`, { method: 'DELETE' });
      onDeleted(slot.id);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const field = 'mt-1 block w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold';
  const label = 'text-xs font-medium text-gray-500 uppercase tracking-wide';

  return (
    <Dialog title={isNew ? 'Add a serving job' : 'Edit this serving job'} onClose={onClose} width="max-w-md">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={label}>Month</span>
            <input required value={form.month} onChange={e => set('month', e.target.value)} className={field} />
          </label>
          <label className="block">
            <span className={label}>Date</span>
            <input value={form.date} placeholder="June 7" onChange={e => set('date', e.target.value)} className={field} />
          </label>
        </div>

        <label className="block">
          <span className={label}>Service</span>
          <select value={form.service} onChange={e => set('service', e.target.value)} className={field}>
            <option value="">All month</option>
            {services.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>

        <label className="block">
          <span className={label}>Job</span>
          <select value={form.job} onChange={e => set('job', e.target.value)} className={field}>
            {jobs.map(j => <option key={j} value={j}>{j}</option>)}
          </select>
        </label>

        <label className="block">
          <span className={label}>Who is serving</span>
          <input
            value={form.name}
            placeholder="Leave blank for somebody to sign up"
            onChange={e => set('name', e.target.value)}
            className={field}
          />
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

// ─── The page ─────────────────────────────────────────────────────────────────

export default function ServingSchedule() {
  const [data, setData]       = useState(null);
  const [month, setMonth]     = useState('');
  const [week, setWeek]       = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [notice, setNotice]   = useState('');
  const [busyId, setBusyId]   = useState(null);
  const [building, setBuilding] = useState(false);
  const [editing, setEditing] = useState(null);   // a slot, or {} for a new one

  const load = useCallback(async (wanted = '') => {
    setLoading(true);
    try {
      const json = await send(`${API}${wanted ? `?month=${encodeURIComponent(wanted)}` : ''}`);
      setData(json);
      setMonth(json.month);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const all = useMemo(() => data?.assignments ?? [], [data]);

  const weeks = useMemo(() => {
    const seen = [];
    for (const a of all) {
      if (a.date && !MONTHLY_JOBS.has(a.job) && !seen.includes(a.date)) seen.push(a.date);
    }
    return seen;
  }, [all]);

  const selected = weeks.includes(week) ? week : (weeks[0] || '');
  const rows     = all.filter(a => a.date === selected && !MONTHLY_JOBS.has(a.job));
  const monthly  = all.filter(a => MONTHLY_JOBS.has(a.job));

  const canManage = !!data?.canManage;
  const me        = data?.me ?? {};

  // What this person may do with one row: sign up for it, or step down from it.
  function mineAlready(row) {
    return !!me.name && row.name.trim().toLowerCase() === me.name.trim().toLowerCase();
  }
  function canSignUpFor(row) {
    return !row.name.trim() && me.canSignUp && (me.jobs || []).includes(row.job);
  }

  async function act(row, method) {
    setBusyId(row.id); setNotice('');
    try {
      await send(`${API}/assignments/${row.id}/signup`, { method });
      await load(month);
    } catch (err) {
      setNotice(err.message);
    } finally {
      setBusyId(null);
    }
  }

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-church-gold" />
      </div>
    );
  }

  if (error && !data) {
    return <div className="card text-center py-10 text-red-600 text-sm">{error}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h2 className="section-heading mb-1">Serving Schedule</h2>
          {month && <p className="text-sm text-gray-500">{month}</p>}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {(data?.months?.length ?? 0) > 1 && (
            <label className="text-sm text-gray-500 flex items-center gap-2">
              <span className="whitespace-nowrap">Month</span>
              <select
                value={month}
                aria-label="Month"
                onChange={e => { setMonth(e.target.value); setWeek(''); load(e.target.value); }}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-church-navy font-medium focus:outline-none focus:ring-2 focus:ring-church-navy"
              >
                {data.months.map(m => <option key={m.month} value={m.month}>{m.month}</option>)}
              </select>
            </label>
          )}

          {weeks.length > 0 && (
            <label className="text-sm text-gray-500 flex items-center gap-2">
              <span className="whitespace-nowrap">Week of</span>
              <select
                value={selected}
                onChange={e => setWeek(e.target.value)}
                aria-label="Week"
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-church-navy font-medium focus:outline-none focus:ring-2 focus:ring-church-navy"
              >
                {weeks.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
          )}

          {canManage && (
            <>
              <button onClick={() => setBuilding(true)} className="btn-primary text-sm">
                Build next month
              </button>
              <button
                onClick={() => setEditing({})}
                className="text-sm px-3 py-2 rounded-lg border border-church-navy text-church-navy hover:bg-church-navy hover:text-white transition-colors"
              >
                Add a job
              </button>
            </>
          )}
        </div>
      </div>

      {notice && (
        <div className="card border border-amber-200 bg-amber-50 text-sm text-amber-800 flex items-center justify-between">
          <span>{notice}</span>
          <button onClick={() => setNotice('')} className="underline text-xs ml-3">dismiss</button>
        </div>
      )}

      {/* What this person can do about it, said once rather than on every row. */}
      {!canManage && !me.canSignUp && (
        <p className="text-xs text-gray-500">
          The men of the congregation can sign up for the jobs nobody has taken yet. If that is
          you, set it on <strong>My Household &amp; Preferences</strong>.
        </p>
      )}
      {!canManage && me.canSignUp && (me.jobs || []).length === 0 && (
        <p className="text-xs text-gray-500">
          You have not been signed off for any jobs yet — ask whoever looks after the serving schedule.
        </p>
      )}

      {monthly.length > 0 && (
        <p className="text-xs text-gray-500">
          {monthly.map(m => `${m.job}: ${m.name || 'nobody yet'}`).join(' · ')} <span className="text-gray-400">(all month)</span>
        </p>
      )}

      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-church-navy text-left text-xs text-gray-300 uppercase tracking-wide">
              <th className="px-4 py-3 w-1/3">Job</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3 text-right">{canManage ? 'Manage' : 'Sign up'}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className={r.name ? 'bg-white' : 'bg-amber-50/40'}>
                <td className="px-4 py-2 font-medium text-church-navy">{r.job}</td>
                <td className="px-4 py-2">
                  {r.name || <span className="text-gray-400">Nobody yet</span>}
                </td>
                <td className="px-4 py-2 text-right">
                  <div className="flex items-center gap-1.5 justify-end flex-wrap">
                    {canSignUpFor(r) && (
                      <button
                        onClick={() => act(r, 'POST')}
                        disabled={busyId === r.id}
                        className="text-xs px-2.5 py-1 rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors font-medium disabled:opacity-50"
                      >
                        Sign me up
                      </button>
                    )}
                    {mineAlready(r) && (
                      <button
                        onClick={() => act(r, 'DELETE')}
                        disabled={busyId === r.id}
                        className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 text-gray-600 hover:border-church-gold transition-colors disabled:opacity-50"
                      >
                        Take me off
                      </button>
                    )}
                    {canManage && (
                      <button
                        onClick={() => setEditing(r)}
                        aria-label={`Edit ${r.job}`}
                        className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 text-gray-600 hover:border-church-gold hover:text-church-navy transition-colors"
                      >
                        Edit
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-12 text-center text-gray-400">
                  {canManage
                    ? 'Nothing here yet — choose Build next month to lay one out.'
                    : 'Nobody is rostered yet.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {building && (
        <BuildMonthDialog
          services={data?.services ?? []}
          onClose={() => setBuilding(false)}
          onBuilt={json => { setBuilding(false); setWeek(''); load(json.month); }}
        />
      )}

      {editing && (
        <SlotDialog
          slot={editing.id ? editing : null}
          month={month}
          jobs={data?.jobs ?? []}
          services={data?.services ?? []}
          onClose={() => setEditing(null)}
          onSaved={saved => { setEditing(null); load(saved?.month || month); }}
          onDeleted={() => { setEditing(null); load(month); }}
        />
      )}
    </div>
  );
}
