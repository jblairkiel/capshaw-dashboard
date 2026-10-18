import { useState, useEffect, useMemo } from 'react';
import Dialog from './Dialog';
import { MonthInput } from './DateInput';
import { isoFromMonthDay } from '../lib/dates';

// "Build a month", as a wizard for the schedule keeper:
//
//   1. Dates    — the month, its services, and which of their dates to leave
//                 out; whether to fill in names, and the special services
//                 already planned that month.
//   2. Jobs     — each service's jobs for this month only, starting from the
//                 usual ones, with the choice to keep them as the usual ones.
//   3. Preview  — the month as it would be, before anything is saved.
//                 "Shuffle again" draws a fresh fill; saving keeps the draw
//                 that is on screen (its seed goes back to the server).
//
// The server does the building, preview included (server/lib/rosterBuild.js);
// this only gathers the choices and shows the result. The services, fill and
// specials choices come back remembered from the last month built.
const API = '/api/serving';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// The month after this one: what a keeper usually builds.
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

const STEPS = ['Dates', 'Jobs', 'Preview'];
const MAX_OF_ONE_JOB = 8;
const countsOf = list => list.reduce((m, j) => ({ ...m, [j]: (m[j] || 0) + 1 }), {});
const shortDate = iso => (iso
  ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
  : '');

function Steps({ step }) {
  return (
    <ol className="flex items-center gap-2 mb-4 text-xs" aria-label="Steps">
      {STEPS.map((label, i) => (
        <li key={label} aria-current={i === step ? 'step' : undefined}
          className={`flex items-center gap-1.5 ${i === step ? 'text-church-navy font-semibold' : i < step ? 'text-church-gold' : 'text-gray-400'}`}>
          <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] ${i === step ? 'bg-church-navy text-white' : i < step ? 'bg-church-gold text-white' : 'bg-gray-100'}`}>{i + 1}</span>
          {label}
          {i < STEPS.length - 1 && <span className="w-6 h-px bg-gray-200 ml-1" aria-hidden="true" />}
        </li>
      ))}
    </ol>
  );
}

// ─── Step one ─────────────────────────────────────────────────────────────────

function DatesStep({ plan, chosen, toggleService, skip, toggleDate, fill, setFill, fillSpecials, setFillSpecials }) {
  return (
    <div className="space-y-4">
      <fieldset className="border-0 p-0 m-0 space-y-3">
        <legend className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Services and dates</legend>
        {plan.services.map(({ service, dates }) => (
          <div key={service}>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <input type="checkbox" checked={chosen.has(service)} onChange={() => toggleService(service)} className="accent-church-gold" />
              {service}
            </label>
            {chosen.has(service) && (
              <div className="mt-1.5 ml-6 flex flex-wrap gap-1.5" role="group" aria-label={`${service} dates`}>
                {dates.map(d => {
                  const key = `${d.date}|${service}`;
                  const on = !skip.has(key);
                  return (
                    <button key={key} type="button" aria-pressed={on} onClick={() => toggleDate(key)}
                      aria-label={`${service}, ${d.date}`}
                      title={on ? 'Click to leave this date out' : 'Left out — click to put it back'}
                      className={`text-xs rounded-full border px-2.5 py-1 ${on ? 'border-church-gold bg-church-cream text-church-navy' : 'border-gray-200 text-gray-400 line-through'}`}>
                      {shortDate(d.iso) || d.date}
                      {d.slots > 0 && <span className="ml-1 text-[10px] text-gray-500 no-underline">· {d.filled}/{d.slots} built</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
        <p className="text-xs text-gray-500 ml-6">Click a date to leave it out, for a combined service or a holiday.</p>
      </fieldset>

      <label className="flex items-start gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={fill} onChange={e => setFill(e.target.checked)} className="accent-church-gold mt-0.5" />
        <span>
          Fill in names
          <span className="block text-xs text-gray-500">
            From the men who said they are glad or willing to do each job — never one who is away that day,
            and the turns spread out. You will see every name before anything is saved.
          </span>
        </span>
      </label>

      {plan.specials.length > 0 && (
        <label className="flex items-start gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={fillSpecials} disabled={!fill} onChange={e => setFillSpecials(e.target.checked)} className="accent-church-gold mt-0.5" />
          <span>
            Fill names for the special services this month too
            <span className="block text-xs text-gray-500">
              {plan.specials.map(sp => `${sp.service} (${sp.dates.join(', ')}; ${sp.open} open)`).join(' · ')}
            </span>
          </span>
        </label>
      )}
    </div>
  );
}

// ─── Step two ─────────────────────────────────────────────────────────────────

function JobsRow({ service, usual, counts, setCounts, jobs, keep, setKeep }) {
  const expand = c => jobs.flatMap(j => Array(c[j] || 0).fill(j));
  const changed = expand(counts).join('|') !== expand(countsOf(usual)).join('|');
  const setCount = (job, n) => setCounts({ ...counts, [job]: n });
  return (
    <section className="py-3 border-t border-gray-100 first:border-t-0" aria-label={`${service} jobs this month`}>
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <h4 className="text-sm font-semibold text-church-navy">{service}</h4>
        <span className="text-xs text-gray-400">
          {changed ? 'Changed for this month' : 'The usual jobs'}
          {changed && (
            <button type="button" onClick={() => setCounts(countsOf(usual))} className="ml-2 underline text-gray-500">Back to the usual</button>
          )}
        </span>
      </div>
      <div className="mt-1.5 grid grid-cols-2 sm:grid-cols-3 gap-1">
        {jobs.map(job => (
          <div key={job} className="flex items-center gap-2 text-sm text-gray-700">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={(counts[job] || 0) > 0} className="accent-church-gold"
                aria-label={`${service}: ${job}`}
                onChange={e => setCount(job, e.target.checked ? 1 : 0)} />
              {job}
            </label>
            {(counts[job] || 0) > 0 && (
              <select value={counts[job]} onChange={e => setCount(job, Number(e.target.value))}
                aria-label={`${service}: how many ${job}`} title="How many"
                className="border border-gray-200 rounded px-1 py-0.5 text-xs bg-white">
                {Array.from({ length: MAX_OF_ONE_JOB }, (_, i) => i + 1).map(n => <option key={n} value={n}>×{n}</option>)}
              </select>
            )}
          </div>
        ))}
      </div>
      {changed && (
        <label className="mt-2 flex items-center gap-2 text-xs text-gray-600">
          <input type="checkbox" checked={keep} onChange={e => setKeep(e.target.checked)} className="accent-church-gold" />
          Make these the usual jobs for {service} from now on
        </label>
      )}
    </section>
  );
}

// ─── Step three ───────────────────────────────────────────────────────────────

// The previewed month as a roster per service: dates across, jobs down, as
// the PDF lays it out.
function rosterOf(assignments, services, isoOf) {
  const tables = [];
  for (const service of services) {
    const mine = assignments.filter(a => a.service === service && a.date);
    if (!mine.length) continue;
    const dates = [...new Set(mine.map(a => a.date))].sort((a, b) => (isoOf(a) || '').localeCompare(isoOf(b) || ''));
    const rows = [];
    const cells = new Map();
    for (const date of dates) {
      const seen = {};
      for (const a of mine.filter(x => x.date === date)) {
        seen[a.job] = (seen[a.job] || 0) + 1;
        const key = `${a.job}#${seen[a.job]}`;
        if (!rows.some(r => r.key === key)) rows.push({ key, job: a.job });
        cells.set(`${key}|${date}`, a);
      }
    }
    tables.push({ service, dates, rows, cells });
  }
  return tables;
}

function PreviewStep({ result, services, isoOf }) {
  const tables = rosterOf(result.assignments, services, isoOf);
  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-700">
        {result.created} new slot{result.created === 1 ? '' : 's'}, {result.filled} filled in
        {result.open ? <>, <span className="text-amber-700">{result.open} still open</span></> : ''}.
        <span className="block text-xs text-gray-500">
          Nothing is saved yet. <span className="text-church-gold">●</span> marks a name just put in; names already on the
          schedule stay where they are.
        </span>
      </p>
      {tables.map(t => (
        <section key={t.service} aria-label={`Preview: ${t.service}`}>
          <h4 className="font-serif text-church-navy font-semibold mb-1">{t.service}</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-church-navy text-white">
                  <th className="text-left font-medium px-2 py-1.5 w-32"><span className="sr-only">Job</span></th>
                  {t.dates.map(d => <th key={d} className="text-left font-semibold px-2 py-1.5 whitespace-nowrap">{shortDate(isoOf(d)) || d}</th>)}
                </tr>
              </thead>
              <tbody>
                {t.rows.map((r, i) => (
                  <tr key={r.key} className={i % 2 ? 'bg-white' : 'bg-church-cream'}>
                    <th scope="row" className="text-left font-normal text-gray-600 px-2 py-1 border-l-4 border-church-gold whitespace-nowrap">{r.job}</th>
                    {t.dates.map(d => {
                      const a = t.cells.get(`${r.key}|${d}`);
                      if (!a) return <td key={d} className="px-2 py-1" />;
                      return (
                        <td key={d} className="px-2 py-1 whitespace-nowrap">
                          {a.name
                            ? <span className="font-semibold text-church-navy">{a.name}{a.justFilled && <span className="text-church-gold ml-1" title="Just put in">●</span>}</span>
                            : <span className="italic text-amber-700">Needs someone</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

// ─── The wizard ───────────────────────────────────────────────────────────────

export default function BuildMonthWizard({ jobs, initialMonth, onClose, onBuilt }) {
  const [step, setStep]         = useState(0);
  const [month, setMonth]       = useState(initialMonth || nextMonthLabel);
  const [plan, setPlan]         = useState(null);
  const [chosen, setChosen]     = useState(null);     // from the remembered choices, once known
  const [fill, setFill]         = useState(true);
  const [fillSpecials, setFillSpecials] = useState(true);
  const [skip, setSkip]         = useState(() => new Set());
  const [counts, setCounts]     = useState({});
  const [keep, setKeep]         = useState(() => new Set());
  const [result, setResult]     = useState(null);
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState('');

  // Each month's dates, and on the first, the choices last built with.
  useEffect(() => {
    if (!/^[A-Za-z]+ \d{4}$/.test(month || '')) return undefined;
    let live = true;
    setError('');
    send(`${API}/months/plan?month=${encodeURIComponent(month)}`)
      .then(json => {
        if (!live) return;
        setPlan(json);
        setSkip(new Set());
        setCounts(Object.fromEntries(json.services.map(s => [s.service, countsOf(s.jobs)])));
        setKeep(new Set());
        setChosen(prev => prev ?? new Set(json.settings.services));
        if (!chosen) { setFill(json.settings.fill); setFillSpecials(json.settings.fillSpecials); }
      })
      .catch(err => live && setError(err.message));
    return () => { live = false; };
    // `chosen` is read only to tell the first plan from later ones.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const services = useMemo(() => (plan ? plan.services.map(s => s.service).filter(s => chosen?.has(s)) : []), [plan, chosen]);
  const isoOf = useMemo(() => {
    const map = new Map();
    for (const s of plan?.services || []) for (const d of s.dates) map.set(d.date, d.iso);
    return date => map.get(date) || isoFromMonthDay(month, date) || '';
  }, [plan, month]);

  const toggleIn = setter => key => setter(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const usualOf = service => plan.services.find(s => s.service === service).jobs;
  const expand = c => jobs.flatMap(j => Array(c[j] || 0).fill(j));
  const datesLeft = plan ? services.some(s => plan.services.find(x => x.service === s).dates.some(d => !skip.has(`${d.date}|${s}`))) : false;

  function body(extra = {}) {
    const monthJobs = {};
    for (const s of services) {
      const mine = expand(counts[s] || {});
      if (mine.join('|') !== expand(countsOf(usualOf(s))).join('|')) monthJobs[s] = mine;
    }
    return {
      month,
      services,
      skip: [...skip].filter(k => services.includes(k.split('|')[1])),
      jobs: monthJobs,
      saveJobs: [...keep].filter(s => monthJobs[s]),
      fill,
      fillSpecials: fill && fillSpecials && (plan?.specials.length ?? 0) > 0,
      ...extra,
    };
  }

  async function preview(seed) {
    setBusy(true); setError('');
    try {
      const json = await send(`${API}/months`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body({ preview: true, ...(seed === undefined ? {} : { seed }) })) });
      setResult(json);
      setStep(2);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true); setError('');
    try {
      const json = await send(`${API}/months`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body({ seed: result.seed })) });
      onBuilt(json);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const previewServices = result ? [...services, ...(body().fillSpecials ? plan.specials.map(s => s.service) : [])] : [];

  return (
    <Dialog title="Build a month" subtitle="Choose the dates and jobs, then see the whole month before it is saved" onClose={onClose} width="max-w-3xl">
      <Steps step={step} />

      {step === 0 && (
        <div className="mb-4">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Month</span>
          <MonthInput required value={month} onChange={m => { setMonth(m); setResult(null); }} />
        </div>
      )}

      {!plan && !error && <p className="text-sm text-gray-400">Loading the month…</p>}

      {plan && step === 0 && (
        <DatesStep plan={plan} chosen={chosen} toggleService={toggleIn(setChosen)} skip={skip} toggleDate={toggleIn(setSkip)}
          fill={fill} setFill={setFill} fillSpecials={fillSpecials} setFillSpecials={setFillSpecials} />
      )}

      {plan && step === 1 && (
        <div>
          <p className="text-xs text-gray-500 mb-1">
            Each service&apos;s jobs for {plan.month}. A change here is for this month only, unless you tick the box under it.
          </p>
          {services.map(s => (
            <JobsRow key={s} service={s} usual={usualOf(s)} jobs={jobs}
              counts={counts[s] || {}} setCounts={c => setCounts(prev => ({ ...prev, [s]: c }))}
              keep={keep.has(s)} setKeep={on => setKeep(prev => { const n = new Set(prev); if (on) n.add(s); else n.delete(s); return n; })} />
          ))}
        </div>
      )}

      {plan && step === 2 && result && <PreviewStep result={result} services={previewServices} isoOf={isoOf} />}

      {error && <p className="text-sm text-red-600 mt-3">{error}</p>}

      <div className="flex flex-wrap justify-between items-center gap-2 mt-5 pt-4 border-t border-gray-100">
        <button type="button" onClick={step === 0 ? onClose : () => setStep(step - 1)}
          className="text-sm px-3 py-2 rounded-lg border border-gray-200 text-gray-600">
          {step === 0 ? 'Cancel' : 'Back'}
        </button>
        <div className="flex gap-2">
          {step === 0 && (
            <button type="button" onClick={() => setStep(1)} disabled={!plan || !services.length || !datesLeft} className="btn-primary text-sm disabled:opacity-50">
              Next: jobs
            </button>
          )}
          {step === 1 && (
            <button type="button" onClick={() => preview()} disabled={busy || services.some(s => !expand(counts[s] || {}).length)} className="btn-primary text-sm disabled:opacity-50">
              {busy ? 'Working it out…' : 'Next: preview'}
            </button>
          )}
          {step === 2 && (
            <>
              {fill && (
                <button type="button" onClick={() => preview()} disabled={busy}
                  className="text-sm px-3 py-2 rounded-lg border border-church-gold text-church-navy disabled:opacity-50">
                  Shuffle again
                </button>
              )}
              <button type="button" onClick={save} disabled={busy} className="btn-primary text-sm disabled:opacity-50">
                {busy ? 'Saving…' : `Save ${plan.month}`}
              </button>
            </>
          )}
        </div>
      </div>
      <p className="text-xs text-gray-400 mt-2">
        Building again only adds what is missing and fills what is still open; a name already there is never moved.
        Nobody is emailed until you choose Email everyone (PDF).
      </p>
    </Dialog>
  );
}

