import { Fragment, useState, useEffect, useCallback, useMemo } from 'react';
import Dialog from './Dialog';
import TimeAway from './TimeAway';
import BlackoutCalendar from './BlackoutCalendar';
import { describeRange, parseMonthLabel } from '../lib/timeAway';
import DateInput, { MonthInput } from './DateInput';
import { isoFromMonthDay, monthDayOf, monthLabelOf } from '../lib/dates';

// The serving schedule, from both sides of it:
//
//   · Everybody sees the month, week by week. Nobody can put their own name
//     against an empty slot — a slot is only ever filled by the Monthly
//     Worship Schedule workflow or by whoever looks after the schedule — but
//     a member may still take their own name back off one they are down for.
//   · Whoever looks after the schedule can lay out next month in one go, fill
//     or clear any slot by hand, and add a one-off job.
//   · Anybody linked to the directory blocks out the days they will be away,
//     and the schedule leaves those days alone.
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
        <div>
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Month</span>
          <MonthInput required value={month} onChange={setMonth} />
        </div>

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

// ─── A special service ────────────────────────────────────────────────────────
//
// A service that does not come round every week — a gospel meeting, a monthly
// singing — on one day or each night of a run of days, with the jobs it needs.
// Upcoming Service picks it up from here: its parts are filled from these
// slots, and its song leader is reminded like any other.

// What a special service needs each night starts from the jobs set for it
// under Jobs for each service, and can be changed for this one meeting.
function SpecialServiceDialog({ choices, jobs, serviceJobs = [], onClose, onAdded }) {
  const usual = name => serviceJobs.find(s => s.service === name)?.jobs || ['Song Leader', 'Opening Prayer', 'Closing Prayer'];
  const [service, setService] = useState(choices[0] || '');
  const [from, setFrom]       = useState('');
  const [through, setThrough] = useState('');
  const [chosen, setChosen]   = useState(() => new Set(usual(choices[0] || '').filter(j => jobs.includes(j))));
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState('');

  function toggle(job) {
    setChosen(prev => {
      const next = new Set(prev);
      if (next.has(job)) next.delete(job); else next.add(job);
      return next;
    });
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const json = await send(`${API}/special`, { method: 'POST', ...jsonBody({ service, from, through: through || from, jobs: jobs.filter(j => chosen.has(j)) }) });
      onAdded(json);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const label = 'text-xs font-medium text-gray-500 uppercase tracking-wide';

  return (
    <Dialog title="Add a special service" subtitle="A gospel meeting, a singing — anything that is not every week" onClose={onClose} width="max-w-md">
      {choices.length === 0 ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            There are no special services on the church&apos;s list yet. An admin adds them (a Gospel Meeting, say)
            under <strong>Church Records → Service Types</strong>.
          </p>
          <div className="flex justify-end">
            <button type="button" onClick={onClose} className="text-sm px-3 py-2 rounded-lg border border-gray-200 text-gray-600">Close</button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className={label}>Service</span>
            <select value={service} onChange={e => { setService(e.target.value); setChosen(new Set(usual(e.target.value))); }} className="mt-1 block w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
              {choices.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={label}>First night</span>
              <DateInput required value={from} onChange={v => { setFrom(v); if (through && v > through) setThrough(''); }} />
            </label>
            <label className="block">
              <span className={label}>Last night</span>
              <DateInput value={through} min={from || undefined} onChange={setThrough} />
              <span className="block text-xs text-gray-400 mt-1">Leave blank for one night</span>
            </label>
          </div>

          <fieldset className="border-0 p-0 m-0">
            <legend className={`${label} mb-1`}>Jobs it needs, each night</legend>
            <div className="grid grid-cols-2 gap-1">
              {jobs.map(job => (
                <label key={job} className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={chosen.has(job)} onChange={() => toggle(job)} className="accent-church-gold" />
                  {job}
                </label>
              ))}
            </div>
          </fieldset>

          <p className="text-xs text-gray-500">
            Each night gets an empty slot for every job ticked. It shows on Upcoming Service with these names
            filled in, and its song leader is reminded like any other service.
          </p>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="text-sm px-3 py-2 rounded-lg border border-gray-200 text-gray-600">Cancel</button>
            <button type="submit" disabled={busy || !from || !chosen.size} className="btn-primary text-sm disabled:opacity-50">
              {busy ? 'Adding…' : 'Add it'}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

// ─── The jobs each service needs ──────────────────────────────────────────────
//
// What building a month lays out for each service, what the Monthly Worship
// Schedule fills, and what a special service starts with. A month already
// built keeps its slots; Add a job covers a one-off.

function ServiceJobsRow({ entry, jobs, onSaved }) {
  const [chosen, setChosen] = useState(() => new Set(entry.jobs));
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState('');
  const picked  = jobs.filter(j => chosen.has(j));
  const changed = picked.join('|') !== jobs.filter(j => entry.jobs.includes(j)).join('|');

  async function save(list) {
    setBusy(true); setError('');
    try {
      const json = await send(`${API}/service-jobs`, { method: 'PUT', ...jsonBody({ service: entry.service, jobs: list }) });
      onSaved(json.serviceJobs);
      if (list === null) setChosen(new Set(entry.defaults));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="py-3 border-t border-gray-100 first:border-t-0" aria-label={`Jobs for ${entry.service}`}>
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <h4 className="text-sm font-semibold text-church-navy">
          {entry.service}
          {entry.special && <span className="ml-2 text-xs font-normal text-gray-400">special service</span>}
        </h4>
        <span className="text-xs text-gray-400">{entry.custom ? `Set${entry.updatedBy ? ` by ${entry.updatedBy}` : ''}` : 'The usual jobs'}</span>
      </div>
      <div className="mt-1.5 grid grid-cols-2 sm:grid-cols-3 gap-1">
        {jobs.map(job => (
          <label key={job} className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={chosen.has(job)} className="accent-church-gold"
              aria-label={`${entry.service}: ${job}`}
              onChange={() => setChosen(prev => { const next = new Set(prev); if (next.has(job)) next.delete(job); else next.add(job); return next; })} />
            {job}
          </label>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-3">
        <button type="button" onClick={() => save(picked)} disabled={busy || !changed || !picked.length}
          className="btn-primary text-xs py-1.5 px-3 disabled:opacity-40">Save</button>
        {entry.custom && (
          <button type="button" onClick={() => save(null)} disabled={busy} className="text-xs text-gray-500 underline">Back to the usual jobs</button>
        )}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </section>
  );
}

function ServiceJobsDialog({ serviceJobs, jobs, onClose, onSaved }) {
  return (
    <Dialog title="Jobs for each service" subtitle="What a month is built with, for each service" onClose={onClose} width="max-w-2xl">
      <p className="text-xs text-gray-500 mb-1">
        Building a month, and the Monthly Worship Schedule, lay out these jobs for every service. A month already
        built keeps the slots it has — use Add a job for a one-off.
      </p>
      {serviceJobs.map(entry => (
        <ServiceJobsRow key={`${entry.service}:${entry.jobs.join('|')}`} entry={entry} jobs={jobs} onSaved={onSaved} />
      ))}
      <div className="flex justify-end pt-2">
        <button type="button" onClick={onClose} className="text-sm px-3 py-2 rounded-lg border border-gray-200 text-gray-600">Done</button>
      </div>
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
      // Writing somebody into a day they are away for is allowed — the keeper
      // may know something the range does not — but it is never silent.
      onSaved(json.assignment, json.warning);
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
          <div>
            <span className={label}>Month</span>
            <MonthInput required value={form.month} onChange={v => set('month', v)} />
          </div>
          <label className="block">
            <span className={label}>Date</span>
            {/* Stored as "June 2026" and "June 7", as the roster has always
                been; picking a day sets the month to match. Blank means the
                job covers the whole month. */}
            <DateInput
              value={isoFromMonthDay(form.month, form.date) || form.date}
              onChange={iso => setForm(p => (iso ? { ...p, date: monthDayOf(iso), month: monthLabelOf(iso) } : { ...p, date: '' }))}
              className={field}
            />
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
  const [addingSpecial, setAddingSpecial] = useState(false);
  const [editingJobs, setEditingJobs] = useState(false);
  const [editing, setEditing] = useState(null);   // a slot, or {} for a new one
  const [awayView, setAwayView] = useState('list');   // 'list' or 'calendar', for the keeper's view of who is away
  const [blockingOut, setBlockingOut] = useState(false);   // the member's own time-away dialog

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
    // In the order they happen: a special service added later still falls
    // between the Sundays either side of it.
    const when = d => isoFromMonthDay(month, d) || d;
    return seen.sort((a, b) => when(a).localeCompare(when(b)));
  }, [all, month]);

  const selected = weeks.includes(week) ? week : (weeks[0] || '');
  // A day can have more than one service — Sunday morning and evening, or a
  // gospel meeting — so its rows are kept together under each service's name.
  const regular  = data?.services ?? [];
  const rank     = svc => (regular.includes(svc) ? regular.indexOf(svc) : regular.length);
  const rows     = all.filter(a => a.date === selected && !MONTHLY_JOBS.has(a.job))
    .map((a, i) => ({ a, i }))
    .sort((x, y) => rank(x.a.service) - rank(y.a.service) || String(x.a.service).localeCompare(String(y.a.service)) || x.i - y.i)
    .map(({ a }) => a);
  const headed   = new Set(rows.map(r => r.service)).size > 1 || rows.some(r => r.service && !regular.includes(r.service));
  const monthly  = all.filter(a => MONTHLY_JOBS.has(a.job));

  const canManage = !!data?.canManage;
  const me        = data?.me ?? {};

  // The one thing left that is a member's own to change: stepping down from a
  // slot they are down for. Nobody can put their own name against one — that
  // is the Monthly Worship Schedule workflow's to generate, or the schedule
  // keeper's to fill by hand.
  function mineAlready(row) {
    return !!me.name && row.name.trim().toLowerCase() === me.name.trim().toLowerCase();
  }

  async function stepDown(row) {
    setBusyId(row.id); setNotice('');
    try {
      await send(`${API}/assignments/${row.id}/signup`, { method: 'DELETE' });
      await load(month);
    } catch (err) {
      setNotice(err.message);
    } finally {
      setBusyId(null);
    }
  }

  // Blocking out days, and taking a block back off. Both reload the month,
  // because a range that has just been cleared may free a slot on the table.
  async function addTimeAway(range) {
    await send(`${API}/blackouts`, { method: 'POST', ...jsonBody(range) });
    await load(month);
  }

  async function clearTimeAway(id) {
    await send(`${API}/blackouts/${id}`, { method: 'DELETE' });
    await load(month);
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

          {me.directoryId && (
            <button
              onClick={() => setBlockingOut(true)}
              className="text-sm px-3 py-2 rounded-lg border border-gray-200 text-gray-600 hover:border-church-gold hover:text-church-navy transition-colors"
            >
              Time away{(me.blackouts?.length ?? 0) > 0 ? ` (${me.blackouts.length})` : ''}
            </button>
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
              <button
                onClick={() => setAddingSpecial(true)}
                className="text-sm px-3 py-2 rounded-lg border border-church-navy text-church-navy hover:bg-church-navy hover:text-white transition-colors"
              >
                Add a special service
              </button>
              <button
                onClick={() => setEditingJobs(true)}
                className="text-sm px-3 py-2 rounded-lg border border-gray-200 text-gray-600 hover:border-church-gold hover:text-church-navy transition-colors"
              >
                Jobs for each service
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
      {!canManage && (
        <p className="text-xs text-gray-500">
          Slots here are filled by the Monthly Worship Schedule workflow or by whoever looks after
          the serving schedule. If you are down for one and cannot make it, you can take yourself
          off below.
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
              <th className="px-4 py-3 text-right">{canManage ? 'Manage' : ''}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <Fragment key={r.id}>
              {headed && r.service !== rows[i - 1]?.service && (
                <tr className="bg-gray-50">
                  <th colSpan={3} scope="colgroup" className="px-4 py-1.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {r.service || 'Any service'}
                  </th>
                </tr>
              )}
              <tr className={r.name ? 'bg-white' : 'bg-amber-50/40'}>
                <td className="px-4 py-2 font-medium text-church-navy">{r.job}</td>
                <td className="px-4 py-2">
                  {r.name || <span className="text-gray-400">Nobody yet</span>}
                  {r.away && (
                    <span
                      title={`Away ${describeRange(r.away)}${r.away.reason ? ` · ${r.away.reason}` : ''}`}
                      className="ml-2 text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 align-middle"
                    >
                      away
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  <div className="flex items-center gap-1.5 justify-end flex-wrap">
                    {mineAlready(r) && (
                      <button
                        onClick={() => stepDown(r)}
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
              </Fragment>
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

      {canManage && (
        <div className="card p-4 space-y-3">
          <div className="flex items-start justify-between flex-wrap gap-2">
            <div>
              <h4 className="text-sm font-semibold text-church-navy">Who is away</h4>
              <p className="text-xs text-gray-500 mt-0.5">
                Blocked out across the congregation. Change one of them from
                <strong> Church Office → Service Roster</strong>.
              </p>
            </div>
            {(data?.blackouts?.length ?? 0) > 0 && (
              <div className="flex rounded-lg border border-gray-200 overflow-hidden shrink-0" role="group" aria-label="How to show who is away">
                {[['list', 'List'], ['calendar', 'Calendar']].map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setAwayView(id)}
                    aria-pressed={awayView === id}
                    className={`text-xs px-3 py-1.5 transition-colors ${
                      awayView === id ? 'bg-church-navy text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {(data?.blackouts?.length ?? 0) === 0 ? (
            <p className="text-xs text-gray-400">Nobody has blocked out any days right now.</p>
          ) : awayView === 'calendar' ? (
            <BlackoutCalendar blackouts={data.blackouts} initialMonth={parseMonthLabel(month)} />
          ) : (
            <ul className="text-sm text-gray-700 space-y-1">
              {data.blackouts.map(range => (
                <li key={range.id} className="flex flex-wrap gap-x-2">
                  <span className="font-medium text-church-navy">{range.name}</span>
                  <span className="text-gray-500">{describeRange(range)}</span>
                  {range.reason && <span className="text-xs text-gray-400 self-center">{range.reason}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {building && (
        <BuildMonthDialog
          services={data?.services ?? []}
          onClose={() => setBuilding(false)}
          onBuilt={json => { setBuilding(false); setWeek(''); load(json.month); }}
        />
      )}

      {editingJobs && (
        <ServiceJobsDialog
          serviceJobs={Array.isArray(data?.serviceJobs) ? data.serviceJobs : []}
          jobs={data?.jobs ?? []}
          onClose={() => setEditingJobs(false)}
          onSaved={list => setData(d => ({ ...d, serviceJobs: list }))}
        />
      )}

      {addingSpecial && (
        <SpecialServiceDialog
          choices={data?.specialServices ?? []}
          jobs={data?.jobs ?? []}
          serviceJobs={Array.isArray(data?.serviceJobs) ? data.serviceJobs : []}
          onClose={() => setAddingSpecial(false)}
          onAdded={json => { setAddingSpecial(false); setWeek(''); load(json.month); }}
        />
      )}

      {editing && (
        <SlotDialog
          slot={editing.id ? editing : null}
          month={month}
          jobs={data?.jobs ?? []}
          services={[...(data?.services ?? []), ...(data?.specialServices ?? [])]}
          onClose={() => setEditing(null)}
          onSaved={(saved, warning) => { setEditing(null); setNotice(warning || ''); load(saved?.month || month); }}
          onDeleted={() => { setEditing(null); load(month); }}
        />
      )}

      {blockingOut && (
        <Dialog title="Time away" onClose={() => setBlockingOut(false)} width="max-w-md">
          <TimeAway
            blackouts={me.blackouts ?? []}
            onAdd={addTimeAway}
            onRemove={clearTimeAway}
          />
        </Dialog>
      )}
    </div>
  );
}
