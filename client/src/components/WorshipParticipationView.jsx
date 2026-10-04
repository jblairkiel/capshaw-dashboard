import { useState, useEffect, useCallback, useMemo } from 'react';
import { levelInfo } from '../lib/worship';

// Worship Participation: who actually served in the worship jobs, and how the
// load is spread. For whoever keeps the serving schedule, and admins; the
// server checks the same (server/routes/participation.js).
//
// Record: after a service, say what happened to each job — the man down for it
// served, somebody else did, or nobody did. "It went as scheduled" does the
// usual week in one press.
//
// Analysis: over a window of weeks, who has served and in what, who stepped in
// and who missed, and the men who said they would do a job and have not been
// asked. A week nobody checked counts as served as scheduled, and is shown so.

const API = '/api/participation';

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

const day = (iso, opts = { weekday: 'short', month: 'short', day: 'numeric' }) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, opts);

// Checked and not-checked are one measure in two states, so one hue: solid for
// what somebody confirmed, a lighter step of the same for what is assumed.
const CONFIRMED = '#2a78d6';
const ASSUMED = '#9ec5f0';

const OUTCOME_STYLE = {
  served:     { label: 'Served',       tone: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  substitute: { label: 'Someone else', tone: 'bg-amber-100 text-amber-900 border-amber-300' },
  missed:     { label: 'Nobody',       tone: 'bg-red-100 text-red-800 border-red-300' },
};

// ─── Record ───────────────────────────────────────────────────────────────────

function SlotRow({ slot, onCheck, busy }) {
  const [subbing, setSubbing] = useState(false);
  const [name, setName] = useState('');
  const c = slot.check;

  const saveSub = e => {
    e.preventDefault();
    if (!name.trim()) return;
    onCheck(slot, 'substitute', name.trim()).then(ok => { if (ok) { setSubbing(false); setName(''); } });
  };

  return (
    <li className="py-3 border-t border-gray-100 first:border-t-0">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-[10rem]">
          <p className="text-xs uppercase tracking-wide text-gray-400">{slot.job}</p>
          <p className="text-base text-church-navy font-medium">
            {slot.scheduled || <span className="text-gray-400 font-normal">Nobody scheduled</span>}
          </p>
          {c && (
            <p className="text-xs text-gray-500 mt-0.5">
              {c.outcome === 'served' && 'Served as scheduled'}
              {c.outcome === 'substitute' && <>Served by <strong className="text-gray-700">{c.servedName}</strong> instead</>}
              {c.outcome === 'missed' && 'Nobody did it'}
              {c.by && ` · checked by ${c.by}`}
            </p>
          )}
        </div>
        <div role="group" aria-label={`What happened: ${slot.job}`} className="flex flex-wrap gap-1.5">
          {slot.scheduled && (
            <button type="button" disabled={busy} aria-pressed={c?.outcome === 'served'}
              onClick={() => onCheck(slot, c?.outcome === 'served' ? null : 'served')}
              className={`min-h-[36px] px-3 rounded-full text-sm border ${c?.outcome === 'served' ? OUTCOME_STYLE.served.tone + ' font-semibold' : 'border-gray-200 text-gray-600 hover:border-gray-400'}`}>
              Served
            </button>
          )}
          <button type="button" disabled={busy} aria-pressed={c?.outcome === 'substitute'}
            onClick={() => (c?.outcome === 'substitute' ? onCheck(slot, null) : setSubbing(s => !s))}
            className={`min-h-[36px] px-3 rounded-full text-sm border ${c?.outcome === 'substitute' ? OUTCOME_STYLE.substitute.tone + ' font-semibold' : 'border-gray-200 text-gray-600 hover:border-gray-400'}`}>
            {slot.scheduled ? 'Someone else' : 'Someone did it'}
          </button>
          <button type="button" disabled={busy} aria-pressed={c?.outcome === 'missed'}
            onClick={() => onCheck(slot, c?.outcome === 'missed' ? null : 'missed')}
            className={`min-h-[36px] px-3 rounded-full text-sm border ${c?.outcome === 'missed' ? OUTCOME_STYLE.missed.tone + ' font-semibold' : 'border-gray-200 text-gray-600 hover:border-gray-400'}`}>
            Nobody
          </button>
        </div>
      </div>
      {subbing && (
        <form onSubmit={saveSub} className="flex items-center gap-2 mt-2 flex-wrap">
          <input autoFocus list="participation-servers" value={name} onChange={e => setName(e.target.value)}
            placeholder="Who served?" aria-label={`Who served ${slot.job} instead`}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-60 focus:outline-none focus:border-church-gold" />
          <button type="submit" disabled={busy || !name.trim()} className="btn-primary text-sm disabled:opacity-50">Save</button>
          <button type="button" onClick={() => setSubbing(false)} className="text-sm text-gray-500 hover:underline">Cancel</button>
        </form>
      )}
    </li>
  );
}

function RecordTab() {
  const [list, setList] = useState(null);
  const [servers, setServers] = useState([]);
  const [chosen, setChosen] = useState(null);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadList = useCallback(() => call(`${API}/services?weeks=13`)
    .then(d => { setList(d.services); setServers(d.servers); setChosen(c => c || d.services[0] || null); })
    .catch(e => setError(e.message)), []);
  useEffect(() => { loadList(); }, [loadList]);

  const loadDetail = useCallback(() => {
    if (!chosen) return;
    call(`${API}/service?date=${chosen.date}&service=${encodeURIComponent(chosen.service)}`)
      .then(d => { setDetail(d); setError(''); }).catch(e => setError(e.message));
  }, [chosen]);
  useEffect(() => { loadDetail(); }, [loadDetail]);

  async function check(slot, outcome, servedName = '') {
    setBusy(true); setError('');
    try {
      await call(`${API}/check`, { method: 'PUT', body: JSON.stringify({ date: slot.date, service: slot.service, job: slot.job, position: slot.position, outcome, servedName }) });
      loadDetail(); loadList();
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function allServed() {
    setBusy(true); setError('');
    try {
      await call(`${API}/served`, { method: 'POST', body: JSON.stringify({ date: chosen.date, service: chosen.service }) });
      loadDetail(); loadList();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!list) return <div className="card text-sm text-gray-400">{error || 'Loading…'}</div>;
  if (!list.length) {
    return <div className="card text-sm text-gray-500">No service on the serving schedule has happened in the last 13 weeks.</div>;
  }

  const open = detail?.slots.filter(s => !s.check && s.scheduled).length ?? 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-[18rem_1fr] gap-4 items-start">
      <datalist id="participation-servers">{servers.map(s => <option key={s.name} value={s.name} />)}</datalist>
      {/* A phone gets a dropdown: thirteen weeks of services would push the
          one being checked off the bottom of the screen. */}
      <label className="md:hidden block">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Service</span>
        <select value={chosen ? `${chosen.date}|${chosen.service}` : ''} aria-label="Service"
          onChange={e => setChosen(list.find(s => `${s.date}|${s.service}` === e.target.value) || null)}
          className="mt-1 block w-full border border-gray-200 rounded-lg px-3 py-2 text-base bg-white">
          {list.map(s => (
            <option key={`${s.date}|${s.service}`} value={`${s.date}|${s.service}`}>
              {day(s.date)} · {s.service} — {s.checked === s.slots ? 'checked' : s.checked ? `${s.checked} of ${s.slots} checked` : 'not checked'}
            </option>
          ))}
        </select>
      </label>
      <nav aria-label="Services" className="hidden md:block card p-0 overflow-hidden md:max-h-[70vh] md:overflow-y-auto">
        <ul>
          {list.map(s => {
            const active = chosen && s.date === chosen.date && s.service === chosen.service;
            const done = s.checked === s.slots;
            return (
              <li key={`${s.date}|${s.service}`}>
                <button type="button" onClick={() => setChosen(s)} aria-current={active ? 'true' : undefined}
                  className={`w-full text-left px-4 py-2.5 border-b border-gray-100 flex items-center gap-2 ${active ? 'bg-church-cream' : 'hover:bg-gray-50'}`}>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-church-navy font-medium truncate">{s.service}</span>
                    <span className="block text-xs text-gray-500">{day(s.date)}</span>
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${done ? 'bg-emerald-100 text-emerald-800' : s.checked ? 'bg-amber-100 text-amber-900' : 'bg-gray-100 text-gray-600'}`}>
                    {done ? '✓ Checked' : s.checked ? `${s.checked} of ${s.slots}` : 'Not checked'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <section className="card" aria-label="What happened">
        {!detail ? <p className="text-sm text-gray-400">Loading…</p> : (
          <>
            <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
              <div>
                <h3 className="font-semibold text-church-navy">{detail.service}</h3>
                <p className="text-sm text-gray-500">{day(detail.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
              </div>
              {open > 0 && (
                <button type="button" onClick={allServed} disabled={busy} className="btn-primary text-sm disabled:opacity-50">
                  It went as scheduled
                </button>
              )}
            </div>
            {open > 0 && (
              <p className="text-xs text-gray-500 mb-1">
                Change anything that did not go to plan first; &ldquo;It went as scheduled&rdquo; marks the {open} {open === 1 ? 'job' : 'jobs'} still unchecked as served.
              </p>
            )}
            <ul>
              {detail.slots.map(s => <SlotRow key={`${s.job}|${s.position}`} slot={s} onCheck={check} busy={busy} />)}
            </ul>
          </>
        )}
        {error && <p className="text-sm text-red-600 mt-2" role="alert">{error}</p>}
      </section>
    </div>
  );
}

// ─── Analysis ─────────────────────────────────────────────────────────────────

function Tile({ value, label, hint }) {
  return (
    <div className="card text-center py-4 px-2">
      <p className="text-2xl font-bold text-church-navy">{value}</p>
      <p className="text-xs text-gray-500 mt-1">{label}</p>
      {hint && <p className="text-[11px] text-gray-400 mt-0.5">{hint}</p>}
    </div>
  );
}

function Legend({ showAssumed }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600" aria-label="Legend">
      <li className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="w-2.5 h-2.5 rounded-sm" style={{ background: CONFIRMED }} />Checked</li>
      {showAssumed && <li className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="w-2.5 h-2.5 rounded-sm" style={{ background: ASSUMED }} />As scheduled, not checked</li>}
    </ul>
  );
}

// Times each man served, longest bar first. Labels and numbers are written
// beside each bar, so nothing depends on reading the colours.
function LoadChart({ people, onPick }) {
  const max = Math.max(1, ...people.map(p => p.served));
  const shown = people.filter(p => p.served);
  if (!shown.length) return <p className="text-sm text-gray-400">Nobody has served in this window.</p>;
  return (
    <ul className="space-y-1.5">
      {shown.map(p => (
        <li key={p.key} className="grid grid-cols-[minmax(7rem,11rem)_1fr_auto] items-center gap-2 text-sm">
          <button type="button" onClick={() => onPick(p)} className="text-left text-church-navy hover:underline truncate">{p.name}</button>
          <span className="flex h-3.5 gap-[2px]" title={`${p.name}: ${p.confirmed} checked, ${p.assumed} not checked`}>
            {p.confirmed > 0 && <span className="h-full rounded-l last:rounded-r" style={{ width: `${(p.confirmed / max) * 100}%`, background: CONFIRMED }} />}
            {p.assumed > 0 && <span className="h-full rounded-r first:rounded-l" style={{ width: `${(p.assumed / max) * 100}%`, background: ASSUMED }} />}
          </span>
          <span className="text-gray-700 tabular-nums w-8 text-right">{p.served}</span>
        </li>
      ))}
    </ul>
  );
}

function EveryoneView({ data, onPick }) {
  const s = data.summary;
  const roles = data.roles;
  const servedPeople = data.people.filter(p => p.served);
  const trouble = data.people.filter(p => p.missed || p.replaced).sort((a, b) => (b.missed + b.replaced) - (a.missed + a.replaced));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Tile value={s.services} label="Services" hint={`${s.checkedServices} checked`} />
        <Tile value={`${s.served} of ${s.slots}`} label="Jobs done" hint={s.assumed ? `${s.assumed} not checked` : 'all checked'} />
        <Tile value={s.people} label="Men who served" />
        <Tile value={s.substitutes} label="Stepped in" hint="somebody else did it" />
        <Tile value={s.missed + s.unfilled} label="Not done" hint={`${s.missed} missed · ${s.unfilled} never filled`} />
      </div>

      <div className="card space-y-3">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <h3 className="font-semibold text-church-navy">Who is carrying it</h3>
          <Legend showAssumed={s.assumed > 0} />
        </div>
        <LoadChart people={data.people} onPick={onPick} />
      </div>

      <div className="card overflow-x-auto">
        <h3 className="font-semibold text-church-navy mb-2">By job</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-400 uppercase tracking-wide">
              <th className="py-1 font-medium">Job</th>
              <th className="py-1 font-medium text-right">Done</th>
              <th className="py-1 font-medium text-right">Different men</th>
              <th className="py-1 font-medium text-right">Most by one man</th>
            </tr>
          </thead>
          <tbody>
            {data.byRole.map(r => (
              <tr key={r.role} className="border-t border-gray-100">
                <td className="py-1.5 text-gray-700">{r.role}</td>
                <td className="py-1.5 text-right text-gray-600 tabular-nums">{r.served} of {r.slots}</td>
                <td className="py-1.5 text-right text-gray-600 tabular-nums">{r.people}</td>
                <td className={`py-1.5 text-right tabular-nums ${r.topShare >= 50 && r.served >= 4 ? 'text-amber-800 font-semibold' : 'text-gray-600'}`}>
                  {r.topShare === null ? '—' : `${r.topShare}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-gray-400 mt-2">&ldquo;Most by one man&rdquo; is highlighted where one man has done half or more of a job done four or more times.</p>
      </div>

      {data.unused.length > 0 && (
        <div className="card space-y-2">
          <h3 className="font-semibold text-church-navy">Willing, but not used for it</h3>
          <p className="text-xs text-gray-500">Men who said they would do a job and have not done that job in this window, those who have served least first.</p>
          <ul className="divide-y divide-gray-100">
            {data.unused.map(u => (
              <li key={u.personId} className="py-2 flex items-center gap-3 flex-wrap">
                <button type="button" onClick={() => onPick({ name: u.name, personId: u.personId })} className="text-church-navy font-medium hover:underline">{u.name}</button>
                <span className="flex flex-wrap gap-1">
                  {u.roles.map(r => {
                    const info = levelInfo(r.level);
                    return <span key={r.role} className={`text-xs px-2 py-0.5 rounded-full border ${info?.tone || ''}`}>{r.role} · {info?.label}</span>;
                  })}
                </span>
                <span className="ml-auto text-xs text-gray-400">{u.servedAtAll ? `served ${u.servedAtAll} other ${u.servedAtAll === 1 ? 'time' : 'times'}` : 'has not served'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {trouble.length > 0 && (
        <div className="card space-y-2">
          <h3 className="font-semibold text-church-navy">Did not serve when scheduled</h3>
          <ul className="divide-y divide-gray-100 text-sm">
            {trouble.map(p => (
              <li key={p.key} className="py-2 flex items-center gap-3">
                <button type="button" onClick={() => onPick(p)} className="text-church-navy hover:underline">{p.name}</button>
                <span className="ml-auto text-gray-600">
                  {p.replaced > 0 && `somebody stood in ${p.replaced}×`}{p.replaced > 0 && p.missed > 0 && ' · '}{p.missed > 0 && `missed ${p.missed}×`}
                  <span className="text-gray-400"> of {p.scheduled} scheduled</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {servedPeople.length > 0 && (
        <div className="card overflow-x-auto">
          <h3 className="font-semibold text-church-navy mb-2">Every man, by job</h3>
          <table className="text-sm min-w-full">
            <thead>
              <tr className="text-left text-xs text-gray-400 uppercase tracking-wide">
                <th className="py-1 pr-3 font-medium sticky left-0 bg-white">Man</th>
                {roles.map(r => <th key={r} className="py-1 px-2 font-medium text-right whitespace-nowrap">{r}</th>)}
                <th className="py-1 pl-2 font-medium text-right">Last</th>
              </tr>
            </thead>
            <tbody>
              {servedPeople.map(p => (
                <tr key={p.key} className="border-t border-gray-100">
                  <td className="py-1.5 pr-3 sticky left-0 bg-white">
                    <button type="button" onClick={() => onPick(p)} className="text-church-navy hover:underline text-left whitespace-nowrap">{p.name}</button>
                  </td>
                  {roles.map(r => <td key={r} className="py-1.5 px-2 text-right tabular-nums text-gray-700">{p.byRole[r] || <span className="text-gray-300">·</span>}</td>)}
                  <td className="py-1.5 pl-2 text-right text-gray-500 whitespace-nowrap">{p.lastServed ? day(p.lastServed, { month: 'short', day: 'numeric' }) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const KIND = {
  served:      { label: 'Served',                    tone: 'text-emerald-800' },
  assumed:     { label: 'Scheduled · not checked',   tone: 'text-gray-600' },
  'stepped-in': { label: 'Stepped in',               tone: 'text-blue-800' },
  replaced:    { label: 'Replaced',                  tone: 'text-amber-800' },
  missed:      { label: 'Missed',                    tone: 'text-red-700' },
};

function PersonView({ data }) {
  const p = data.person;
  const roles = [...new Set([...data.roles, ...Object.keys(data.preferences)])];
  return (
    <div className="space-y-4">
      <div className="card">
        <h3 className="text-2xl font-semibold text-church-navy">{p.name}</h3>
        <p className="text-sm text-gray-500">{p.lastServed ? `Last served ${day(p.lastServed, { weekday: 'long', month: 'long', day: 'numeric' })}` : 'Has not served in this window'}</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile value={p.served} label="Times served" hint={p.assumed ? `${p.assumed} not checked` : undefined} />
        <Tile value={p.steppedIn} label="Stepped in" hint="for somebody else" />
        <Tile value={p.replaced} label="Replaced" hint="somebody else did his job" />
        <Tile value={p.missed} label="Missed" />
      </div>
      <div className="card overflow-x-auto">
        <h3 className="font-semibold text-church-navy mb-2">Jobs, and what he has said</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-400 uppercase tracking-wide">
              <th className="py-1 font-medium">Job</th>
              <th className="py-1 font-medium text-right">Served</th>
              <th className="py-1 font-medium text-right">He said</th>
            </tr>
          </thead>
          <tbody>
            {roles.filter(r => p.byRole[r] || data.preferences[r]).map(r => {
              const info = levelInfo(data.preferences[r]);
              return (
                <tr key={r} className="border-t border-gray-100">
                  <td className="py-1.5 text-gray-700">{r}</td>
                  <td className="py-1.5 text-right tabular-nums">{p.byRole[r] || 0}</td>
                  <td className="py-1.5 text-right">{info ? <span className={`text-xs px-2 py-0.5 rounded-full border ${info.tone}`}>{info.label}</span> : <span className="text-gray-300">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="card">
        <h3 className="font-semibold text-church-navy mb-2">Every service</h3>
        {data.history.length === 0 ? <p className="text-sm text-gray-400">Nothing in this window.</p> : (
          <ul className="divide-y divide-gray-100">
            {data.history.map((h, i) => (
              <li key={`${h.date}|${h.service}|${h.job}|${i}`} className="py-1.5 flex items-center gap-3 text-sm flex-wrap">
                <span className="w-28 shrink-0 text-gray-500">{day(h.date)}</span>
                <span className="flex-1 min-w-[8rem] text-gray-700">{h.job} <span className="text-gray-400">· {h.service}</span></span>
                <span className={KIND[h.kind]?.tone}>{KIND[h.kind]?.label}{h.other && ` · ${h.other}`}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function AnalysisTab() {
  const [weeks, setWeeks] = useState(26);
  const [role, setRole] = useState('');
  const [checkedOnly, setCheckedOnly] = useState(false);
  const [who, setWho] = useState('');
  const [servers, setServers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const q = `weeks=${weeks}&role=${encodeURIComponent(role)}&checkedOnly=${checkedOnly}`;
  const url = who ? `${API}/person?name=${encodeURIComponent(who)}&${q}` : `${API}/analysis?${q}`;

  useEffect(() => {
    let live = true;
    call(url).then(d => {
      if (!live) return;
      setData({ ...d, url });
      if (d.servers) setServers(d.servers);
      if (!who && !role && d.roles) setRoles(d.roles);
      setError('');
    }).catch(e => live && setError(e.message));
    return () => { live = false; };
  }, [url, who, role]);

  const current = data?.url === url ? data : null;
  const pick = useCallback(p => setWho(p.name), []);
  const control = 'border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white';
  const names = useMemo(() => servers.map(s => s.name), [servers]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <select value={who} onChange={e => setWho(e.target.value)} aria-label="Man" className={`${control} flex-1 min-w-[12rem]`}>
          <option value="">Everyone</option>
          {who && !names.includes(who) && <option value={who}>{who}</option>}
          {names.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <select value={role} onChange={e => setRole(e.target.value)} aria-label="Job" className={control}>
          <option value="">Every job</option>
          {roles.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={weeks} onChange={e => setWeeks(Number(e.target.value))} aria-label="Weeks" className={control}>
          {[8, 13, 26, 52].map(n => <option key={n} value={n}>Last {n} weeks</option>)}
        </select>
        <label className="inline-flex items-center gap-1.5 text-sm text-gray-600">
          <input type="checkbox" checked={checkedOnly} onChange={e => setCheckedOnly(e.target.checked)} />
          Checked services only
        </label>
      </div>
      {!checkedOnly && current?.summary?.assumed > 0 && (
        <p className="text-xs text-gray-500">
          Services nobody has checked are counted as served by whoever was scheduled. Tick &ldquo;Checked services only&rdquo; to leave them out.
        </p>
      )}
      {error && <div className="card text-sm text-red-600">{error}</div>}
      {!current && !error && <div className="card text-sm text-gray-400">Loading…</div>}
      {current && (who ? <PersonView data={current} /> : <EveryoneView data={current} onPick={pick} />)}
    </div>
  );
}

// ─── The page ─────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'record',   label: 'Record' },
  { id: 'analysis', label: 'Analysis' },
];

export default function WorshipParticipationView() {
  const [tab, setTab] = useState('record');
  return (
    <div className="space-y-4">
      <div>
        <h2 className="section-heading mb-1">Worship Participation</h2>
        <p className="text-sm text-gray-500">Who actually served in each worship job, and how the load is spread.</p>
      </div>
      <div role="tablist" aria-label="Worship participation" className="flex gap-1 border-b border-gray-200">
        {TABS.map(t => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${tab === t.id ? 'border-church-gold text-church-navy' : 'border-transparent text-gray-500 hover:text-church-navy'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'record' ? <RecordTab /> : <AnalysisTab />}
    </div>
  );
}
