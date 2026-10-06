import { useState, useEffect, useCallback, useMemo } from 'react';
import Dialog from './Dialog';
import TimeAway from './TimeAway';
import BlackoutCalendar from './BlackoutCalendar';
import { describeRange, parseMonthLabel } from '../lib/timeAway';
import DateInput, { MonthInput } from './DateInput';
import { isoFromMonthDay, monthDayOf, monthLabelOf } from '../lib/dates';
import { CopyLinkButton } from './upcoming/shared';

// The serving schedule, from both sides of it:
//
//   · Everybody sees the month, a card per service, each with its own link.
//     Nobody can put their own name against a slot; a member down for one
//     who cannot make it asks to be replaced.
//   · Whoever looks after the schedule builds a month in one go — laid out and
//     filled from what the men have said they will do — then clicks any name
//     to change it, the best fits listed first. Setup holds the rest: the jobs
//     each service needs, special services, and a one-off job.
//   · Each man blocks out the days he will be away (or the keeper does it for
//     him from the Preferences tab), and filling leaves those days alone.
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

function BuildMonthDialog({ services, initialMonth, onClose, onBuilt }) {
  const [month, setMonth]       = useState(initialMonth || nextMonthLabel);
  const [chosen, setChosen]     = useState(() => new Set(services));
  const [fill, setFill]         = useState(true);
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
      const json = await send(`${API}/months`, { method: 'POST', ...jsonBody({ month, services: [...chosen], fill }) });
      onBuilt(json);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Dialog title="Build a month" subtitle="Every service's jobs, filled from what the men have said they will do" onClose={onClose} width="max-w-md">
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

        <label className="flex items-start gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={fill} onChange={e => setFill(e.target.checked)} className="accent-church-gold mt-0.5" />
          <span>
            Fill in names
            <span className="block text-xs text-gray-500">
              From the men who said they are glad or willing to do each job — never one who is away that day,
              and the turns spread out. Change any name afterwards by clicking it.
            </span>
          </span>
        </label>

        <p className="text-xs text-gray-500">
          Every service in the month gets a slot for each job it needs. Building again only adds what is
          missing and fills what is still open; a name already there is never moved. Nobody is emailed
          until you choose Email everyone their jobs.
        </p>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="text-sm px-3 py-2 rounded-lg border border-gray-200 text-gray-600">Cancel</button>
          <button type="submit" disabled={busy || !chosen.size} className="btn-primary text-sm disabled:opacity-50">
            {busy ? 'Building…' : `Build ${month || 'the month'}`}
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
// A kind of service not on the list yet — a youth rally, a lectureship — added
// by the schedule keeper right here; it joins the church's list of services.
function NewKindOfService({ onAdded, onCancel }) {
  const [name, setName]   = useState('');
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');

  async function add() {
    setBusy(true); setError('');
    try {
      onAdded(await send(`${API}/service-kinds`, { method: 'POST', ...jsonBody({ name }) }));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
      <label className="block">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">New kind of service</span>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Youth Rally"
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (name.trim()) add(); } }}
          className="mt-1 block w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white" />
      </label>
      <p className="text-xs text-gray-500">It goes on the church&apos;s list of services, held when it is held. Bible classes are not rostered, so they are not offered.</p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        {onCancel && <button type="button" onClick={onCancel} className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600">Cancel</button>}
        <button type="button" onClick={add} disabled={busy || !name.trim()} className="btn-primary text-sm disabled:opacity-50">
          {busy ? 'Adding…' : 'Add to the list'}
        </button>
      </div>
    </div>
  );
}

function SpecialServiceDialog({ choices: given, jobs, serviceJobs: givenJobs = [], onClose, onAdded, onKindAdded }) {
  const [choices, setChoices] = useState(given);
  const [serviceJobs, setServiceJobs] = useState(givenJobs);
  const [addingKind, setAddingKind] = useState(false);
  const usual = name => serviceJobs.find(s => s.service === name)?.jobs || ['Song Leader', 'Opening Prayer', 'Closing Prayer'];
  const [service, setService] = useState(given[0] || '');
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

  function kindAdded(json) {
    setChoices(json.specialServices);
    setServiceJobs(json.serviceJobs);
    setService(json.service);
    const jobsFor = json.serviceJobs.find(s => s.service === json.service)?.jobs || ['Song Leader', 'Opening Prayer', 'Closing Prayer'];
    setChosen(new Set(jobsFor.filter(j => jobs.includes(j))));
    setAddingKind(false);
    onKindAdded?.(json);
  }

  const label = 'text-xs font-medium text-gray-500 uppercase tracking-wide';

  return (
    <Dialog title="Add a special service" subtitle="A gospel meeting, a singing — anything that is not every week" onClose={onClose} width="max-w-md">
      {choices.length === 0 ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            There are no special services on the church&apos;s list yet. Add the first kind — a Gospel Meeting, say.
          </p>
          <NewKindOfService onAdded={kindAdded} />
          <div className="flex justify-end">
            <button type="button" onClick={onClose} className="text-sm px-3 py-2 rounded-lg border border-gray-200 text-gray-600">Close</button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block">
              <span className={label}>Service</span>
              <select value={service} onChange={e => { setService(e.target.value); setChosen(new Set(usual(e.target.value))); }} className="mt-1 block w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                {choices.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            {!addingKind && (
              <button type="button" onClick={() => setAddingKind(true)} className="mt-1 text-xs text-church-gold hover:text-church-navy">
                + A kind of service not on the list
              </button>
            )}
          </div>
          {addingKind && <NewKindOfService onAdded={kindAdded} onCancel={() => setAddingKind(false)} />}
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

// ─── Asking to be replaced ────────────────────────────────────────────────────

function ReplacementDialog({ slot, onClose, onAsked }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await send(`${API}/assignments/${slot.id}/replacement`, { method: 'POST', ...jsonBody({ reason }) });
      onAsked();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Dialog title="Ask to be replaced" subtitle={`${slot.job} · ${[slot.date || slot.month, slot.service].filter(Boolean).join(', ')}`} onClose={onClose} width="max-w-md">
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-gray-600">
          Whoever keeps the serving schedule is emailed and finds this in their inbox. Your name stays on
          until they have found someone, and you will hear when they have.
        </p>
        <label className="block">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Why (optional)</span>
          <textarea rows={2} value={reason} onChange={e => setReason(e.target.value)} maxLength={500} autoFocus
            placeholder="Out of town that weekend"
            className="mt-1 block w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold" />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="text-sm px-3 py-2 rounded-lg border border-gray-200 text-gray-600">Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary text-sm disabled:opacity-50">{busy ? 'Asking…' : 'Ask to be replaced'}</button>
        </div>
      </form>
    </Dialog>
  );
}

// ─── The jobs each service needs ──────────────────────────────────────────────
//
// What building a month lays out and fills for each service, and what a
// special service starts with. A month already
// built keeps its slots; Add a single job covers a one-off.

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
        Building a month lays out these jobs for every service. A month already built keeps the slots it
        has — use Add a single job for a one-off.
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

// ─── Who takes a slot ─────────────────────────────────────────────────────────
//
// Clicking a name on the schedule: the men who could take it, best fit first —
// free that day and glad to, then willing, then the rest — each saying why he
// is or is not a fit, and how many turns he already has this month.

const LEVEL_LABEL = { preferred: 'Glad to', willing: 'Willing', unavailable: 'Rather not', '': 'Not said' };

function SlotPicker({ slot, onClose, onSaved, onMore }) {
  const [list, setList]   = useState(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');
  const [all, setAll]     = useState(false);

  useEffect(() => {
    send(`${API}/assignments/${slot.id}/candidates`).then(j => setList(j.candidates)).catch(e => setError(e.message));
  }, [slot.id]);

  async function put(name) {
    setBusy(true); setError('');
    try {
      const json = await send(`${API}/assignments/${slot.id}`, { method: 'PATCH', ...jsonBody({ name }) });
      onSaved(json.assignment, json.warning);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const why = c => (c.away ? `Away ${describeRange(c.away)}` : c.busy ? 'Already serving at this service' : c.level === 'unavailable' ? 'Would rather not' : '');
  const fits = (list || []).filter(c => c.free && (c.level === 'preferred' || c.level === 'willing'));
  const shown = all ? (list || []) : fits;

  return (
    <Dialog title={`${slot.job}`} subtitle={[slot.date || slot.month, slot.service].filter(Boolean).join(' · ')} onClose={onClose} width="max-w-md">
      <div className="space-y-3">
        <p className="text-sm text-gray-600">
          Now: <span className="font-medium text-church-navy">{slot.name || 'nobody'}</span>
        </p>
        {!list && !error && <p className="text-sm text-gray-400">Finding who could take it…</p>}
        {list && (
          <>
            <ul className="divide-y divide-gray-100 max-h-80 overflow-y-auto -mx-1" aria-label="Who could take it">
              {shown.length === 0 && <li className="px-1 py-2 text-sm text-gray-500">Nobody free has said they will do this. Show everyone, or type a name.</li>}
              {shown.map(c => (
                <li key={c.id}>
                  <button type="button" disabled={busy || c.current} onClick={() => put(c.name)}
                    className="w-full text-left px-2 py-2 rounded-lg hover:bg-church-cream disabled:opacity-60 flex items-baseline gap-2 flex-wrap">
                    <span className={`font-medium ${c.free ? 'text-church-navy' : 'text-gray-400'}`}>{c.name}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${c.level === 'preferred' ? 'bg-emerald-50 text-emerald-700' : c.level === 'willing' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>{LEVEL_LABEL[c.level]}</span>
                    <span className="text-xs text-gray-400">{c.turns} turn{c.turns === 1 ? '' : 's'} this month</span>
                    {c.current && <span className="text-xs text-gray-400">· down for it now</span>}
                    {why(c) && <span className="text-xs text-amber-700 w-full">{why(c)}</span>}
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => setAll(v => !v)} className="text-xs text-church-gold hover:text-church-navy">
              {all ? 'Only the best fits' : `Show everyone (${list.length})`}
            </button>
          </>
        )}
        <form onSubmit={e => { e.preventDefault(); if (typed.trim()) put(typed.trim()); }} className="flex gap-2">
          <input value={typed} onChange={e => setTyped(e.target.value)} placeholder="Or type a name" aria-label="Or type a name"
            className="flex-1 min-w-0 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold" />
          <button type="submit" disabled={busy || !typed.trim()} className="btn-primary text-sm disabled:opacity-50">Put in</button>
        </form>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex items-center justify-between gap-2 pt-1 border-t border-gray-100">
          <button type="button" onClick={onMore} className="text-xs text-gray-500 underline">Change the date or job, or remove the slot</button>
          {slot.name && <button type="button" disabled={busy} onClick={() => put('')} className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600">Leave it open</button>}
        </div>
      </div>
    </Dialog>
  );
}

// ─── One service on the schedule ──────────────────────────────────────────────
//
// Its jobs, who is down for each, and its own link — the same idea as a
// service's link on Submit a Service — so a keeper can send somebody straight
// to it.

const serviceId = (iso, service) => `service-${iso}-${String(service).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

function rosterLink(iso, service, origin = window.location.origin) {
  return `${origin}/?${new URLSearchParams({ page: 'service-roster', tab: 'scheduled', date: iso, service })}`;
}

const longDayOf = (iso, fallback = '') => (iso
  ? new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  : fallback);

function ServiceCard({ occasion, canManage, isMine, focused, onPick, onAsk }) {
  const longDay = longDayOf(occasion.iso, occasion.date);
  const open = occasion.slots.filter(s => !s.name.trim()).length;
  return (
    <section id={serviceId(occasion.iso, occasion.service)} aria-label={`${occasion.service}, ${longDay}`}
      className={`card p-0 overflow-hidden scroll-mt-24 ${focused ? 'ring-2 ring-church-gold' : ''}`}>
      <header className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <h4 className="font-semibold text-church-navy text-sm">{occasion.service}</h4>
          <p className="text-xs text-gray-500">{longDay}{open > 0 && <span className="ml-2 text-amber-700 font-medium">{open} open</span>}</p>
        </div>
        {occasion.iso && <CopyLinkButton url={rosterLink(occasion.iso, occasion.service)} service={occasion.service} date={occasion.iso} />}
      </header>
      <ul className="divide-y divide-gray-50">
        {occasion.slots.map(r => (
          <li key={r.id} className={`px-4 py-2 flex items-center gap-2 text-sm ${r.name ? '' : 'bg-amber-50/60'}`}>
            <span className="w-32 shrink-0 text-gray-500">{r.job}</span>
            <span className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
              {canManage ? (
                <button type="button" onClick={() => onPick(r)} aria-label={`${r.job}: ${r.name || 'open'} — change`}
                  className={`text-left hover:underline ${r.name ? 'text-church-navy' : 'text-amber-700 font-medium'}`}>
                  {r.name || 'Open — choose someone'}
                </button>
              ) : (
                <span className={r.name ? 'text-church-navy' : 'text-gray-400'}>{r.name || 'Nobody yet'}</span>
              )}
              {r.away && (
                <span title={`Away ${describeRange(r.away)}${r.away.reason ? ` · ${r.away.reason}` : ''}`}
                  className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">away</span>
              )}
              {r.replacement && (
                <span title={`${r.replacement.askedBy ? `Asked by ${r.replacement.askedBy}` : 'Asked'}${r.replacement.reason ? ` · ${r.replacement.reason}` : ''}`}
                  className="text-xs px-2 py-0.5 rounded-full bg-rose-100 text-rose-800">
                  {canManage ? 'needs replacing — in My Inbox' : 'replacement asked for'}
                </span>
              )}
            </span>
            {isMine(r) && !r.replacement && (
              <button onClick={() => onAsk(r)}
                className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 text-gray-600 hover:border-church-gold transition-colors shrink-0">
                Ask to be replaced
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── Your jobs ────────────────────────────────────────────────────────────────
//
// What the signed-in member is down for this month — and next month, once it
// is built — whichever month the schedule below is showing.

function YourJobs({ jobs, onAsk, onGo }) {
  const groups = [
    { key: 'this', heading: 'Your jobs this month', ...jobs.thisMonth },
    { key: 'next', heading: 'Next month', ...jobs.nextMonth },
  ].filter(g => g.key === 'this' || g.jobs.length);

  return (
    <section aria-label="Your jobs" className="card p-4 space-y-3">
      {groups.map(g => (
        <div key={g.key}>
          <h4 className="text-sm font-semibold text-church-navy">{g.heading} <span className="font-normal text-gray-400">· {g.month}</span></h4>
          {g.jobs.length === 0 ? (
            <p className="text-sm text-gray-500 mt-1">You are not down for anything in {g.month}.</p>
          ) : (
            <ul className="mt-1 divide-y divide-gray-50" aria-label={g.heading}>
              {g.jobs.map(j => (
                <li key={j.id} className={`py-1.5 flex items-center gap-2 flex-wrap text-sm ${j.past ? 'text-gray-400' : ''}`}>
                  <span className="font-medium text-church-navy w-36 shrink-0">{j.job}</span>
                  <span className="flex-1 min-w-0">{longDayOf(j.iso, j.date || j.month)}{j.service ? ` · ${j.service}` : ''}</span>
                  {j.past ? <span className="text-xs">done</span>
                    : j.replacement ? <span className="text-xs px-2 py-0.5 rounded-full bg-rose-100 text-rose-800">replacement asked for</span>
                    : <button type="button" onClick={() => onAsk(j)} className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 text-gray-600 hover:border-church-gold">Ask to be replaced</button>}
                  {j.iso && j.service && (
                    <button type="button" onClick={() => onGo(j)} aria-label={`Show ${j.service}, ${longDayOf(j.iso)}`}
                      className="text-xs text-church-gold hover:text-church-navy">Show →</button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </section>
  );
}

// ─── Replacement requests ─────────────────────────────────────────────────────
//
// For whoever keeps the schedule: the requests still waiting, each one a click
// from choosing someone, and every request there has been and how it ended.

const OUTCOME = {
  replaced:  r => `Replaced by ${r.replacedBy || 'someone else'}`,
  opened:    () => 'Left open',
  kept:      r => `Kept on${r.note ? ` — ${r.note}` : ''}`,
  cancelled: () => 'Withdrawn',
};

const shortDate = ts => (ts ? new Date(`${ts.replace(' ', 'T')}Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');

function ReplacementRequests({ requests, onChoose, onGo }) {
  const [showHistory, setShowHistory] = useState(false);
  const open = requests.filter(r => r.open);
  const past = requests.filter(r => !r.open);
  if (!requests.length) return null;
  const what = r => `${r.job}, ${longDayOf(r.iso, r.date || r.month)}${r.service ? ` · ${r.service}` : ''}`;

  return (
    <section aria-label="Replacement requests" className={`card p-4 space-y-3 ${open.length ? 'border border-rose-200' : ''}`}>
      {open.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-church-navy">Waiting on a replacement ({open.length})</h4>
          <ul className="mt-1 divide-y divide-gray-50">
            {open.map(r => (
              <li key={r.id} className="py-2 flex items-start gap-2 flex-wrap text-sm">
                <div className="flex-1 min-w-0">
                  <p><span className="font-medium text-church-navy">{r.name}</span> <span className="text-gray-600">— {what(r)}</span></p>
                  <p className="text-xs text-gray-500">
                    {r.reason ? <>&ldquo;{r.reason}&rdquo; · </> : null}asked by {r.askedBy || 'someone'} {shortDate(r.askedAt)}
                  </p>
                </div>
                {r.slotId && <button type="button" onClick={() => onChoose(r)} className="btn-primary text-xs">Choose someone</button>}
                {r.iso && r.service && <button type="button" onClick={() => onGo(r)} className="text-xs text-church-gold hover:text-church-navy self-center">Show →</button>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {past.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowHistory(v => !v)} aria-expanded={showHistory} className="text-xs text-church-gold hover:text-church-navy">
            {showHistory ? 'Hide' : 'Show'} replacement history ({past.length})
          </button>
          {showHistory && (
            <ul className="mt-2 divide-y divide-gray-50" aria-label="Replacement history">
              {past.map(r => (
                <li key={r.id} className="py-1.5 text-sm">
                  <p><span className="text-church-navy">{r.name}</span> <span className="text-gray-600">— {what(r)}</span></p>
                  <p className="text-xs text-gray-500">
                    {(OUTCOME[r.outcome] || (() => r.outcome))(r)}
                    {r.settledBy ? ` by ${r.settledBy}` : ''}{r.settledAt ? `, ${shortDate(r.settledAt)}` : ''}
                    {' · '}asked by {r.askedBy || 'someone'} {shortDate(r.askedAt)}{r.reason ? ` — “${r.reason}”` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
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

export default function ServingSchedule({ focus = null }) {
  const [data, setData]       = useState(null);
  const [month, setMonth]     = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [notice, setNotice]   = useState('');
  const [building, setBuilding] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [addingSpecial, setAddingSpecial] = useState(false);
  const [editingJobs, setEditingJobs] = useState(false);
  const [asking, setAsking] = useState(null);   // the slot somebody is asking to be replaced on
  const [picking, setPicking] = useState(null); // the slot the keeper is choosing someone for
  const [editing, setEditing] = useState(null);   // a slot, or {} for a new one
  const [awayView, setAwayView] = useState('list');   // 'list' or 'calendar', for the keeper's view of who is away
  const [blockingOut, setBlockingOut] = useState(false);   // the member's own time-away dialog
  const [requests, setRequests] = useState([]);   // replacement requests, for the keeper
  // A link to one service (?date=&service=) opens its month and brings it into view.
  const [focused, setFocused] = useState(focus);

  const load = useCallback(async (wanted = '') => {
    setLoading(true);
    try {
      const json = await send(`${API}${wanted ? `?month=${encodeURIComponent(wanted)}` : ''}`);
      setData(json);
      setMonth(json.month);
      setError('');
      if (json.canManage) send(`${API}/replacements`).then(r => setRequests(r.replacements || [])).catch(() => {});
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(focus?.date ? monthLabelOf(focus.date) : ''); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps -- once; a link's month first

  const all = useMemo(() => data?.assignments ?? [], [data]);
  const regular = useMemo(() => data?.services ?? [], [data]);

  // Every service in the month, in the order they happen, each with its jobs.
  const occasions = useMemo(() => {
    const rank = svc => (regular.includes(svc) ? regular.indexOf(svc) : regular.length);
    const byKey = new Map();
    for (const a of all) {
      if (!a.date || MONTHLY_JOBS.has(a.job)) continue;
      const key = `${a.date}|${a.service}`;
      if (!byKey.has(key)) byKey.set(key, { date: a.date, service: a.service, iso: isoFromMonthDay(month, a.date), slots: [] });
      byKey.get(key).slots.push(a);
    }
    return [...byKey.values()].sort((x, y) =>
      String(x.iso || x.date).localeCompare(String(y.iso || y.date)) || rank(x.service) - rank(y.service) || x.service.localeCompare(y.service));
  }, [all, month, regular]);
  const monthly  = all.filter(a => MONTHLY_JOBS.has(a.job));
  const openCount = all.filter(a => !a.name.trim()).length;
  const askedCount = all.filter(a => a.replacement).length;

  // Brings one service into view, loading its month first if need be.
  function goTo(item) {
    setFocused({ date: item.iso, service: item.service });
    if (item.month && item.month !== month) load(item.month);
  }

  // Once the linked service is on screen, bring it into view.
  useEffect(() => {
    if (!focused?.date || loading) return;
    const el = document.getElementById(serviceId(focused.date, focused.service));
    el?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [focused, loading, occasions]);

  const canManage = !!data?.canManage;
  const me        = data?.me ?? {};

  // A member who cannot do a job they are down for asks to be replaced; their
  // name stays on until whoever keeps the schedule has sorted it out, so a
  // gap is never left that nobody knows about. Nobody can put their own name
  // against a slot either — that is the month builder's, or the schedule
  // keeper's to change by hand.
  function mineAlready(row) {
    return !!me.name && row.name.trim().toLowerCase() === me.name.trim().toLowerCase();
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

  async function emailEveryone() {
    if (!window.confirm(`Email everyone down for a job in ${month} their jobs, and send the whole month to the congregation?`)) return;
    setEmailing(true); setNotice('');
    try {
      const json = await send(`${API}/months/notify`, { method: 'POST', ...jsonBody({ month }) });
      setNotice(`Emailed ${json.emailed} ${json.emailed === 1 ? 'man' : 'men'} their jobs for ${month}.${json.unreachable.length ? ` No email address on file for ${json.unreachable.join(', ')}.` : ''}`);
    } catch (err) {
      setNotice(err.message);
    } finally {
      setEmailing(false);
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

  const setupItem = 'block w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-church-cream';

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          {(data?.months?.length ?? 0) > 1 ? (
            <select
              value={month}
              aria-label="Month"
              onChange={e => { setMonth(e.target.value); setFocused(null); load(e.target.value); }}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-church-navy font-semibold focus:outline-none focus:ring-2 focus:ring-church-navy"
            >
              {data.months.map(m => <option key={m.month} value={m.month}>{m.month}</option>)}
            </select>
          ) : (
            <p className="font-semibold text-church-navy">{month || 'Serving Schedule'}</p>
          )}
          {all.length > 0 && (
            <span className={`text-sm ${openCount ? 'text-amber-700 font-medium' : 'text-emerald-700'}`}>
              {openCount ? `${openCount} slot${openCount === 1 ? '' : 's'} still open` : 'Every slot is filled'}
            </span>
          )}
          {askedCount > 0 && (
            <span className="text-sm text-rose-700 font-medium">
              {askedCount} waiting on a replacement
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {me.directoryId && (
            <button
              onClick={() => setBlockingOut(true)}
              className="text-sm px-3 py-2 rounded-lg border border-gray-200 text-gray-600 hover:border-church-gold hover:text-church-navy transition-colors"
            >
              My time away{(me.blackouts?.length ?? 0) > 0 ? ` (${me.blackouts.length})` : ''}
            </button>
          )}

          {canManage && (
            <>
              <button onClick={() => setBuilding(true)} className="btn-primary text-sm">Build a month</button>
              {all.some(a => a.name.trim()) && (
                <button onClick={emailEveryone} disabled={emailing}
                  className="text-sm px-3 py-2 rounded-lg border border-church-navy text-church-navy hover:bg-church-navy hover:text-white transition-colors disabled:opacity-50">
                  {emailing ? 'Emailing…' : 'Email everyone their jobs'}
                </button>
              )}
              <details className="relative">
                <summary className="list-none cursor-pointer text-sm px-3 py-2 rounded-lg border border-gray-200 text-gray-600 hover:border-church-gold hover:text-church-navy select-none">
                  Setup ▾
                </summary>
                <div className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-gray-200 bg-white shadow-lg py-1">
                  <button type="button" className={setupItem} onClick={e => { e.currentTarget.closest('details').open = false; setEditingJobs(true); }}>Jobs for each service</button>
                  <button type="button" className={setupItem} onClick={e => { e.currentTarget.closest('details').open = false; setAddingSpecial(true); }}>Add a special service</button>
                  <button type="button" className={setupItem} onClick={e => { e.currentTarget.closest('details').open = false; setEditing({}); }}>Add a single job</button>
                </div>
              </details>
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
      {canManage ? (
        all.length > 0 && <p className="text-xs text-gray-500">Click any name to change it — the best fits for that slot are listed first. Each service has its own link to send to anyone.</p>
      ) : (
        <p className="text-xs text-gray-500">
          Slots here are filled by whoever looks after the serving schedule. If you are down for one and cannot
          make it, choose Ask to be replaced — they are told straight away, and your name stays on until they
          have found someone.
        </p>
      )}

      {me.jobs && <YourJobs jobs={me.jobs} onAsk={setAsking} onGo={goTo} />}

      {canManage && (
        <ReplacementRequests
          requests={requests}
          onGo={goTo}
          onChoose={r => setPicking({ id: r.slotId, job: r.job, date: r.date, month: r.month, service: r.service, name: r.name })}
        />
      )}

      {monthly.length > 0 && (
        <p className="text-xs text-gray-500">
          {monthly.map(m => `${m.job}: ${m.name || 'nobody yet'}`).join(' · ')} <span className="text-gray-400">(all month)</span>
        </p>
      )}

      {occasions.length === 0 ? (
        <div className="card text-center py-12 text-sm text-gray-400">
          {canManage ? 'Nothing here yet — choose Build a month to lay one out and fill it.' : 'Nobody is rostered yet.'}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 items-start">
          {occasions.map(o => (
            <ServiceCard key={`${o.date}|${o.service}`} occasion={o} canManage={canManage} isMine={mineAlready}
              focused={!!focused && focused.date === o.iso && focused.service.toLowerCase() === o.service.toLowerCase()}
              onPick={setPicking} onAsk={setAsking} />
          ))}
        </div>
      )}

      {canManage && (
        <div className="card p-4 space-y-3">
          <div className="flex items-start justify-between flex-wrap gap-2">
            <div>
              <h4 className="text-sm font-semibold text-church-navy">Who is away</h4>
              <p className="text-xs text-gray-500 mt-0.5">
                Each man blocks out his own days with My time away. To do it for him, open his name on
                the <strong>Preferences</strong> tab.
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
          onBuilt={json => {
            setBuilding(false); setFocused(null);
            setNotice(`Built ${json.month}: ${json.created} new slot${json.created === 1 ? '' : 's'}, ${json.filled} filled in${json.open ? `, ${json.open} still open` : ''}. Click any name to change it; nobody has been emailed yet.`);
            load(json.month);
          }}
        />
      )}

      {asking && (
        <ReplacementDialog
          slot={asking}
          onClose={() => setAsking(null)}
          onAsked={() => { setAsking(null); setNotice('Asked. Whoever keeps the schedule has been told, and you will hear when someone is found.'); load(month); }}
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
          onAdded={json => { setAddingSpecial(false); load(json.month); }}
          onKindAdded={json => setData(d => ({ ...d, specialServices: json.specialServices, serviceJobs: json.serviceJobs }))}
        />
      )}

      {picking && (
        <SlotPicker
          slot={picking}
          onClose={() => setPicking(null)}
          onSaved={(saved, warning) => { setPicking(null); setNotice(warning || ''); load(month); }}
          onMore={() => { setEditing(picking); setPicking(null); }}
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
