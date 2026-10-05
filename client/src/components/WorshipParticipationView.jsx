import { useState, useEffect, useMemo } from 'react';
import { levelInfo } from '../lib/worship';

// Worship participation: who has served in the worship jobs, and what each man
// has said he will do — the Analysis and Preferences tabs of the Service Roster
// page (ServiceRosterView.jsx). For whoever keeps the serving schedule, and
// admins; the server checks the same (server/routes/participation.js).
//
// Nothing is confirmed after a service: the serving schedule, as it was last
// left, is taken to be what happened. The page only reads — the schedule is
// changed on the Serving Schedule, and preferences on the Service Roster or by
// each man on My Household & Preferences.
//
// Analysis: over a window of weeks, who has served and in what, how many
// different men have done each job, and the men who said they would do a job
// and have not been used for it. A dropdown opens one man's record.
//
// Preferences: every man against every job — glad to, willing, rather not, or
// nothing said — with how each job is covered and who has not said anything.

const API = '/api/participation';

async function call(url) {
  const res = await fetch(url, { credentials: 'include' });
  const json = await res.json().catch(() => ({}));
  if (!json.success) throw new Error(json.error || 'Something went wrong');
  return json;
}

const day = (iso, opts = { weekday: 'short', month: 'short', day: 'numeric' }) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, opts);

const BAR = '#2a78d6';

// The four answers, in the order a schedule keeper reads them. Colour marks
// each one; its name is always written beside it.
const ANSWERS = [
  { id: 'preferred',   label: 'Glad to',    short: 'Glad',    colour: '#1baf7a' },
  { id: 'willing',     label: 'Willing',    short: 'Willing', colour: '#2a78d6' },
  { id: 'unavailable', label: 'Rather not', short: 'No',      colour: '#9ca3af' },
  { id: '',            label: 'Not said',   short: '',        colour: '#e5e7eb' },
];

function Tile({ value, label, hint }) {
  return (
    <div className="card text-center py-4 px-2">
      <p className="text-2xl font-bold text-church-navy">{value}</p>
      <p className="text-xs text-gray-500 mt-1">{label}</p>
      {hint && <p className="text-[11px] text-gray-400 mt-0.5">{hint}</p>}
    </div>
  );
}

function Filters({ who, setWho, role, setRole, weeks, setWeeks, names, roles, showWho = true }) {
  const control = 'border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white';
  return (
    <div className="flex flex-wrap gap-2 items-center">
      {showWho && (
        <select value={who} onChange={e => setWho(e.target.value)} aria-label="Man" className={`${control} flex-1 min-w-[12rem]`}>
          <option value="">Everyone</option>
          {who && !names.includes(who) && <option value={who}>{who}</option>}
          {names.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      )}
      {setRole && (
        <select value={role} onChange={e => setRole(e.target.value)} aria-label="Job" className={control}>
          <option value="">Every job</option>
          {roles.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      )}
      <select value={weeks} onChange={e => setWeeks(Number(e.target.value))} aria-label="Weeks" className={control}>
        {[8, 13, 26, 52].map(n => <option key={n} value={n}>Last {n} weeks</option>)}
      </select>
    </div>
  );
}

// ─── Analysis ─────────────────────────────────────────────────────────────────

// Times each man served, longest bar first, with the number written beside it.
function LoadChart({ people, onPick }) {
  const shown = people.filter(p => p.served);
  const max = Math.max(1, ...shown.map(p => p.served));
  if (!shown.length) return <p className="text-sm text-gray-400">Nobody was on the schedule in this window.</p>;
  return (
    <ul className="space-y-1.5" aria-label="Times served, by man">
      {shown.map(p => (
        <li key={p.key} className="grid grid-cols-[minmax(7rem,11rem)_1fr_auto] items-center gap-2 text-sm">
          <button type="button" onClick={() => onPick(p.name)} className="text-left text-church-navy hover:underline truncate">{p.name}</button>
          <span className="h-3.5 flex">
            <span className="h-full rounded" title={`${p.name}: ${p.served}`} style={{ width: `${(p.served / max) * 100}%`, background: BAR, minWidth: 3 }} />
          </span>
          <span className="text-gray-700 tabular-nums w-8 text-right">{p.served}</span>
        </li>
      ))}
    </ul>
  );
}

function EveryoneView({ data, onPick }) {
  const s = data.summary;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile value={s.services} label="Services" />
        <Tile value={`${s.served} of ${s.slots}`} label="Jobs filled" />
        <Tile value={s.people} label="Men who served" />
        <Tile value={s.unfilled} label="Never filled" />
      </div>

      <div className="card space-y-3">
        <h3 className="font-semibold text-church-navy">Who is carrying it</h3>
        <LoadChart people={data.people} onPick={onPick} />
      </div>

      <div className="card overflow-x-auto">
        <h3 className="font-semibold text-church-navy mb-2">By job</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-400 uppercase tracking-wide">
              <th className="py-1 font-medium">Job</th>
              <th className="py-1 font-medium text-right">Filled</th>
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
        <p className="text-xs text-gray-400 mt-2">&ldquo;Most by one man&rdquo; is highlighted where one man has done half or more of a job filled four or more times.</p>
      </div>

      {data.unused.length > 0 && (
        <div className="card space-y-2">
          <h3 className="font-semibold text-church-navy">Willing, but not used for it</h3>
          <p className="text-xs text-gray-500">Men who said they would do a job and have not done that job in this window, those who have served least first.</p>
          <ul className="divide-y divide-gray-100">
            {data.unused.map(u => (
              <li key={u.personId} className="py-2 flex items-center gap-3 flex-wrap">
                <button type="button" onClick={() => onPick(u.name)} className="text-church-navy font-medium hover:underline">{u.name}</button>
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

      {data.people.length > 0 && (
        <div className="card overflow-x-auto">
          <h3 className="font-semibold text-church-navy mb-2">Every man, by job</h3>
          <table className="text-sm min-w-full">
            <thead>
              <tr className="text-left text-xs text-gray-400 uppercase tracking-wide">
                <th className="py-1 pr-3 font-medium sticky left-0 bg-white">Man</th>
                {data.roles.map(r => <th key={r} className="py-1 px-2 font-medium text-right whitespace-nowrap">{r}</th>)}
                <th className="py-1 pl-2 font-medium text-right">Last</th>
                <th className="py-1 pl-2 font-medium text-right">Next</th>
              </tr>
            </thead>
            <tbody>
              {data.people.map(p => (
                <tr key={p.key} className="border-t border-gray-100">
                  <td className="py-1.5 pr-3 sticky left-0 bg-white">
                    <button type="button" onClick={() => onPick(p.name)} className="text-church-navy hover:underline text-left whitespace-nowrap">{p.name}</button>
                  </td>
                  {data.roles.map(r => <td key={r} className="py-1.5 px-2 text-right tabular-nums text-gray-700">{p.byRole[r] || <span className="text-gray-300">·</span>}</td>)}
                  <td className="py-1.5 pl-2 text-right text-gray-500 whitespace-nowrap">{p.lastServed ? day(p.lastServed, { month: 'short', day: 'numeric' }) : '—'}</td>
                  <td className="py-1.5 pl-2 text-right text-gray-500 whitespace-nowrap">{p.nextScheduled ? day(p.nextScheduled, { month: 'short', day: 'numeric' }) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PersonView({ data }) {
  const p = data.person;
  const roles = [...new Set([...data.roles, ...Object.keys(data.preferences)])];
  const past = data.history.filter(h => !h.upcoming);
  const upcoming = data.history.filter(h => h.upcoming).reverse();
  return (
    <div className="space-y-4">
      <div className="card">
        <h3 className="text-2xl font-semibold text-church-navy">{p.name}</h3>
        <p className="text-sm text-gray-500">
          {p.lastServed ? `Last served ${day(p.lastServed, { weekday: 'long', month: 'long', day: 'numeric' })}` : 'Not on the schedule in this window'}
          {p.nextScheduled && ` · next ${day(p.nextScheduled, { weekday: 'long', month: 'long', day: 'numeric' })}`}
        </p>
        {data.notes && <p className="text-sm text-gray-600 mt-2 italic">&ldquo;{data.notes}&rdquo;</p>}
      </div>
      <div className="card overflow-x-auto">
        <h3 className="font-semibold text-church-navy mb-2">What he said, and what he has done</h3>
        {roles.filter(r => p.byRole[r] || data.preferences[r]).length === 0 ? (
          <p className="text-sm text-gray-400">He has not said what he will do, and has not served in this window.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 uppercase tracking-wide">
                <th className="py-1 font-medium">Job</th>
                <th className="py-1 font-medium">He said</th>
                <th className="py-1 font-medium text-right">Served</th>
              </tr>
            </thead>
            <tbody>
              {roles.filter(r => p.byRole[r] || data.preferences[r]).map(r => {
                const info = levelInfo(data.preferences[r]);
                return (
                  <tr key={r} className="border-t border-gray-100">
                    <td className="py-1.5 text-gray-700">{r}</td>
                    <td className="py-1.5">{info ? <span className={`text-xs px-2 py-0.5 rounded-full border ${info.tone}`}>{info.label}</span> : <span className="text-xs text-gray-400">Not said</span>}</td>
                    <td className="py-1.5 text-right tabular-nums">{p.byRole[r] || 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {upcoming.length > 0 && (
        <div className="card">
          <h3 className="font-semibold text-church-navy mb-2">Coming up</h3>
          <ul className="divide-y divide-gray-100">
            {upcoming.map((h, i) => (
              <li key={`${h.date}|${h.service}|${h.job}|${i}`} className="py-1.5 flex gap-3 text-sm">
                <span className="w-28 shrink-0 text-gray-500">{day(h.date)}</span>
                <span className="text-gray-700">{h.job} <span className="text-gray-400">· {h.service}</span></span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="card">
        <h3 className="font-semibold text-church-navy mb-2">Every service he served</h3>
        {past.length === 0 ? <p className="text-sm text-gray-400">None in this window.</p> : (
          <ul className="divide-y divide-gray-100">
            {past.map((h, i) => (
              <li key={`${h.date}|${h.service}|${h.job}|${i}`} className="py-1.5 flex gap-3 text-sm">
                <span className="w-28 shrink-0 text-gray-500">{day(h.date)}</span>
                <span className="text-gray-700">{h.job} <span className="text-gray-400">· {h.service}</span></span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function AnalysisTab({ who, setWho }) {
  const [weeks, setWeeks] = useState(26);
  const [role, setRole] = useState('');
  const [servers, setServers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const q = `weeks=${weeks}&role=${encodeURIComponent(role)}`;
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
  const names = useMemo(() => servers.map(s => s.name), [servers]);

  return (
    <div className="space-y-4">
      <Filters who={who} setWho={setWho} role={role} setRole={setRole} weeks={weeks} setWeeks={setWeeks} names={names} roles={roles} />
      <p className="text-xs text-gray-500">Read from the serving schedule as it stands: whoever is down for a job that has happened is counted as having done it.</p>
      {error && <div className="card text-sm text-red-600">{error}</div>}
      {!current && !error && <div className="card text-sm text-gray-400">Loading…</div>}
      {current && (who ? <PersonView data={current} /> : <EveryoneView data={current} onPick={setWho} />)}
    </div>
  );
}

// ─── Preferences ──────────────────────────────────────────────────────────────

// How one job is covered: glad, willing, rather not and not said, as one bar
// with the counts written out beneath it.
function CoverageRow({ c, total }) {
  const counts = { preferred: c.glad, willing: c.willing, unavailable: c.unavailable, '': c.unsaid };
  const thin = c.glad + c.willing < 3;
  return (
    <li className="grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-x-3 gap-y-1 items-center py-1.5">
      <span className={`text-sm ${thin ? 'text-amber-800 font-semibold' : 'text-gray-700'}`}>
        {c.role}{thin && <span className="text-xs font-normal"> · thin</span>}
      </span>
      <span>
        <span className="flex h-3.5 gap-[2px]" role="img" aria-label={`${c.role}: ${c.glad} glad, ${c.willing} willing, ${c.unavailable} rather not, ${c.unsaid} not said`}>
          {ANSWERS.map(a => counts[a.id] > 0 && (
            <span key={a.id} className="h-full first:rounded-l last:rounded-r" title={`${a.label}: ${counts[a.id]}`}
              style={{ width: `${(counts[a.id] / Math.max(1, total)) * 100}%`, background: a.colour }} />
          ))}
        </span>
        <span className="block text-xs text-gray-500 mt-0.5">
          {c.glad} glad · {c.willing} willing · {c.unavailable} rather not · {c.unsaid} not said
        </span>
      </span>
    </li>
  );
}

function Answer({ level, served }) {
  const a = ANSWERS.find(x => x.id === (level || ''));
  const info = levelInfo(level);
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      {info
        ? <span className={`text-xs px-1.5 py-0.5 rounded border ${info.tone}`}>{a.short}</span>
        : <span className="text-gray-300">·</span>}
      {served > 0 && <span className="text-[11px] text-gray-500 tabular-nums" title={`Served ${served} in this window`}>{served}×</span>}
    </span>
  );
}

export function PreferencesTab({ onPick }) {
  const [weeks, setWeeks] = useState(26);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [show, setShow] = useState('all');

  useEffect(() => {
    let live = true;
    setData(null);
    call(`${API}/preferences?weeks=${weeks}`).then(d => live && (setData(d), setError(''))).catch(e => live && setError(e.message));
    return () => { live = false; };
  }, [weeks]);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.men.filter(m => (!q || m.name.toLowerCase().includes(q))
      && (show === 'all' || (show === 'said' ? m.said > 0 : m.said === 0)));
  }, [data, query, show]);

  if (error) return <div className="card text-sm text-red-600">{error}</div>;
  if (!data) return <div className="card text-sm text-gray-400">Loading…</div>;

  const s = data.summary;
  const control = 'border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Tile value={s.men} label="Men" />
        <Tile value={s.said} label="Have said" />
        <Tile value={s.unsaid} label="Not said yet" />
      </div>

      <div className="card space-y-2">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <h3 className="font-semibold text-church-navy">How each job is covered</h3>
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600" aria-label="Legend">
            {ANSWERS.map(a => (
              <li key={a.id} className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="w-2.5 h-2.5 rounded-sm border border-gray-300" style={{ background: a.colour }} />{a.label}
              </li>
            ))}
          </ul>
        </div>
        <ul className="divide-y divide-gray-50">
          {data.coverage.map(c => <CoverageRow key={c.role} c={c} total={s.men} />)}
        </ul>
        <p className="text-xs text-gray-400">A job with fewer than three men glad or willing to do it is marked thin.</p>
      </div>

      <div className="card space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="font-semibold text-church-navy">Every man</h3>
          <div className="flex flex-wrap gap-2 items-center">
            <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a name" aria-label="Find a name" className={`${control} w-44`} />
            <select value={show} onChange={e => setShow(e.target.value)} aria-label="Show" className={control}>
              <option value="all">Everyone</option>
              <option value="said">Have said</option>
              <option value="unsaid">Not said yet</option>
            </select>
            <select value={weeks} onChange={e => setWeeks(Number(e.target.value))} aria-label="Weeks served over" className={control}>
              {[8, 13, 26, 52].map(n => <option key={n} value={n}>Served: last {n} weeks</option>)}
            </select>
          </div>
        </div>
        <p className="text-xs text-gray-500">
          What each man has said he will do, set by him on My Household &amp; Preferences or recorded for him on the Service Roster.
          The small number is how many times he has served that job in the weeks chosen.
        </p>
        {rows.length === 0 ? <p className="text-sm text-gray-400">Nobody matches.</p> : (
          <div className="overflow-x-auto">
            <table className="text-sm min-w-full">
              <thead>
                <tr className="text-left text-xs text-gray-400 uppercase tracking-wide">
                  <th className="py-1 pr-3 font-medium sticky left-0 bg-white">Man</th>
                  {data.roles.map(r => <th key={r} className="py-1 px-2 font-medium whitespace-nowrap">{r}</th>)}
                  <th className="py-1 pl-2 font-medium whitespace-nowrap">Last changed</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(m => (
                  <tr key={m.personId} className="border-t border-gray-100 align-top">
                    <td className="py-1.5 pr-3 sticky left-0 bg-white">
                      <button type="button" onClick={() => onPick(m.name)} className="text-church-navy hover:underline text-left whitespace-nowrap">{m.name}</button>
                      {m.notes && <span className="block text-[11px] text-gray-500 max-w-[14rem] truncate" title={m.notes}>&ldquo;{m.notes}&rdquo;</span>}
                    </td>
                    {data.roles.map(r => <td key={r} className="py-1.5 px-2"><Answer level={m.preferences[r]} served={m.served[r]} /></td>)}
                    <td className="py-1.5 pl-2 text-gray-500 whitespace-nowrap">
                      {m.updatedAt ? day(m.updatedAt.slice(0, 10), { month: 'short', day: 'numeric', year: 'numeric' }) : <span className="text-amber-800">Not said</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
