import { useState, useEffect, useMemo } from 'react';
import PersonPhoto from './PersonPhoto';
import { API, toneHex, call, photoUrl, dayLabel, percent } from '../lib/memberAttendance';

// The Analytics tab of Member Attendance: the whole congregation over a
// window of weeks, or — picked from the dropdown — one member. The numbers are
// worked out on the server (server/lib/memberAttendance.js): "present" is any
// status marked "counts as present", and a rate is out of the rolls somebody
// was actually marked on.

const WEEKS = [4, 8, 13, 26, 52];

function Tile({ value, label, hint }) {
  return (
    <div className="card text-center py-4 px-2">
      <p className="text-2xl font-bold text-church-navy">{value}</p>
      <p className="text-xs text-gray-500 mt-1">{label}</p>
      {hint && <p className="text-[11px] text-gray-400 mt-0.5">{hint}</p>}
    </div>
  );
}

function Legend({ statuses }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600" aria-label="Legend">
      {statuses.map(s => (
        <li key={s.id} className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: toneHex(s.tone) }} />
          {s.label}{!s.active && ' (retired)'}
        </li>
      ))}
    </ul>
  );
}

// One horizontal bar split by status, a 2px gap between the pieces. Hovering
// (or focusing) a piece names it; the numbers are also written out beside it.
function SplitBar({ counts, statuses, total, height = 14 }) {
  const pieces = statuses.filter(s => counts[s.id]);
  if (!total) return <div className="h-3.5 rounded bg-gray-100" />;
  return (
    <div className="flex gap-[2px] w-full" style={{ height }}>
      {pieces.map(s => (
        <span key={s.id} tabIndex={0} title={`${s.label}: ${counts[s.id]}`}
          aria-label={`${s.label}: ${counts[s.id]}`}
          className="first:rounded-l last:rounded-r h-full outline-none focus:ring-2 focus:ring-church-gold"
          style={{ width: `${(counts[s.id] / total) * 100}%`, background: toneHex(s.tone), minWidth: 3 }} />
      ))}
    </div>
  );
}

// ─── Each roll, as columns ────────────────────────────────────────────────────
// How many were marked each status at every roll in the window, oldest on the
// left. Stacked bars share one baseline and one scale.

function RollsChart({ rolls, statuses }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...rolls.map(r => r.marked));
  const order = [...statuses].reverse(); // the first status sits on the baseline

  if (!rolls.length) return <p className="text-sm text-gray-400">No roll has been taken in this window.</p>;

  return (
    <div className="relative">
      <div className="flex items-end gap-1 h-48 border-b border-gray-200 overflow-x-auto" role="img"
        aria-label={`Marks at each of ${rolls.length} rolls, by status`}>
        {rolls.map((r, i) => (
          <button key={`${r.date}|${r.service}`} type="button"
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(i)} onBlur={() => setHover(null)}
            aria-label={`${dayLabel(r.date)} ${r.service}: ${r.present} present of ${r.marked} marked`}
            className="flex-1 min-w-[10px] max-w-[36px] h-full flex flex-col justify-end gap-[2px] group">
            {order.filter(s => r.counts[s.id]).map((s, k) => (
              <span key={s.id}
                className={`block w-full ${k === 0 ? 'rounded-t' : ''} ${hover === i ? 'opacity-100' : 'opacity-90 group-hover:opacity-100'}`}
                style={{ height: `${(r.counts[s.id] / max) * 100}%`, background: toneHex(s.tone) }} />
            ))}
          </button>
        ))}
      </div>
      <div className="flex justify-between text-[11px] text-gray-400 mt-1">
        <span>{dayLabel(rolls[0].date)}</span>
        {rolls.length > 1 && <span>{dayLabel(rolls[rolls.length - 1].date)}</span>}
      </div>
      {hover !== null && rolls[hover] && (
        <div role="tooltip" className="absolute top-0 left-1/2 -translate-x-1/2 bg-white border border-gray-200 shadow-lg rounded-lg px-3 py-2 text-xs text-gray-700 pointer-events-none">
          <p className="font-semibold text-church-navy">{dayLabel(rolls[hover].date)} · {rolls[hover].service}</p>
          {statuses.filter(s => rolls[hover].counts[s.id]).map(s => (
            <p key={s.id} className="flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-block w-2 h-2 rounded-sm" style={{ background: toneHex(s.tone) }} />
              {s.label}: {rolls[hover].counts[s.id]}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── The whole congregation ───────────────────────────────────────────────────

function GroupView({ data, onPick }) {
  const [sort, setSort] = useState('rate');
  const statuses = data.statuses;
  const totalMarks = Object.values(data.totals).reduce((a, b) => a + b, 0);

  const lately = data.members.filter(m => m.missedInARow >= 2).sort((a, b) => b.missedInARow - a.missedInARow || a.name.localeCompare(b.name));
  const members = useMemo(() => {
    const list = data.members.filter(m => m.marked);
    if (sort === 'name') return list; // already in roll order
    return [...list].sort((a, b) => (a.rate ?? 101) - (b.rate ?? 101) || a.name.localeCompare(b.name));
  }, [data.members, sort]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile value={data.summary.rolls} label="Rolls taken" />
        <Tile value={data.summary.averagePresent ?? '—'} label="Present per service" hint="on average" />
        <Tile value={percent(data.summary.rate)} label="Attendance rate" hint="of everyone marked" />
        <Tile value={data.summary.people} label="On the roll" />
      </div>

      <div className="card space-y-3">
        <h3 className="font-semibold text-church-navy">Every mark in the window</h3>
        <SplitBar counts={data.totals} statuses={statuses} total={totalMarks} height={18} />
        <ul className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
          {statuses.filter(s => s.active || data.totals[s.id]).map(s => (
            <li key={s.id} className="flex items-center gap-2">
              <span aria-hidden="true" className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: toneHex(s.tone) }} />
              <span className="text-gray-700">{s.label}</span>
              <span className="font-semibold text-church-navy">{data.totals[s.id] || 0}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="card space-y-3">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <h3 className="font-semibold text-church-navy">Each roll</h3>
          <Legend statuses={statuses.filter(s => data.totals[s.id])} />
        </div>
        <RollsChart rolls={data.rolls} statuses={statuses} />
      </div>

      {lately.length > 0 && (
        <div className="card space-y-2">
          <h3 className="font-semibold text-church-navy">Not here lately</h3>
          <p className="text-xs text-gray-500">Marked anything but present at their last two services or more.</p>
          <ul className="divide-y divide-gray-100">
            {lately.map(m => (
              <li key={m.id}>
                <button type="button" onClick={() => onPick(m.id)} className="w-full flex items-center gap-3 py-2 text-left hover:bg-gray-50">
                  <PersonPhoto person={m} size={36} src={photoUrl(m.id)} />
                  <span className="flex-1 text-church-navy font-medium">{m.name}</span>
                  <span className="text-sm text-gray-600">{m.missedInARow} in a row</span>
                  <span className="text-xs text-gray-400 w-32 text-right whitespace-nowrap hidden sm:inline">{m.lastPresent ? `here ${dayLabel(m.lastPresent)}` : 'not here yet'}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card space-y-2 overflow-x-auto">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="font-semibold text-church-navy">By member</h3>
          <label className="text-xs text-gray-500 flex items-center gap-1.5">
            Sort
            <select value={sort} onChange={e => setSort(e.target.value)} className="border border-gray-200 rounded px-2 py-1 text-xs">
              <option value="rate">Lowest rate first</option>
              <option value="name">By name</option>
            </select>
          </label>
        </div>
        {members.length === 0 ? (
          <p className="text-sm text-gray-400">Nobody has been marked in this window.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 uppercase tracking-wide">
                <th className="py-1 font-medium">Member</th>
                <th className="py-1 font-medium text-right">Present</th>
                <th className="py-1 font-medium text-right">Rate</th>
                <th className="py-1 font-medium text-right hidden sm:table-cell">Last here</th>
              </tr>
            </thead>
            <tbody>
              {members.map(m => (
                <tr key={m.id} className="border-t border-gray-100">
                  <td className="py-1.5">
                    <button type="button" onClick={() => onPick(m.id)} className="text-church-navy hover:underline text-left">{m.name}</button>
                  </td>
                  <td className="py-1.5 text-right text-gray-600">{m.present} of {m.marked}</td>
                  <td className="py-1.5 text-right font-semibold text-church-navy">{percent(m.rate)}</td>
                  <td className="py-1.5 text-right text-gray-500 hidden sm:table-cell">{m.lastPresent ? dayLabel(m.lastPresent) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── One member ───────────────────────────────────────────────────────────────

function PersonView({ data }) {
  const statuses = data.statuses;
  const byId = Object.fromEntries(statuses.map(s => [s.id, s]));
  const s = data.summary;

  return (
    <div className="space-y-4">
      <div className="card flex items-center gap-4">
        <PersonPhoto person={data.person} size={80} src={photoUrl(data.person.id)} />
        <div className="min-w-0">
          <h3 className="text-2xl font-semibold text-church-navy truncate">{data.person.name}</h3>
          <p className="text-sm text-gray-500">
            {s.lastPresent ? `Last here ${dayLabel(s.lastPresent, { weekday: 'long', month: 'long', day: 'numeric' })}` : 'Not marked present in this window'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile value={percent(s.rate)} label="Attendance rate" />
        <Tile value={`${s.present} of ${s.marked}`} label="Present" hint="of the rolls marked" />
        <Tile value={s.missedInARow} label="Missed in a row" hint="most recent first" />
        <Tile value={s.notMarked} label="Rolls not marked on" />
      </div>

      <div className="card space-y-3">
        <h3 className="font-semibold text-church-navy">How they were marked</h3>
        <SplitBar counts={data.counts} statuses={statuses} total={s.marked} height={18} />
        <ul className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
          {statuses.filter(st => st.active || data.counts[st.id]).map(st => (
            <li key={st.id} className="flex items-center gap-2">
              <span aria-hidden="true" className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: toneHex(st.tone) }} />
              <span className="text-gray-700">{st.label}</span>
              <span className="font-semibold text-church-navy">{data.counts[st.id] || 0}</span>
            </li>
          ))}
        </ul>
      </div>

      {data.byService.length > 0 && (
        <div className="card">
          <h3 className="font-semibold text-church-navy mb-2">By service</h3>
          <table className="w-full text-sm">
            <tbody>
              {data.byService.map(b => (
                <tr key={b.service} className="border-t border-gray-100 first:border-t-0">
                  <td className="py-1.5 text-gray-700">{b.service}</td>
                  <td className="py-1.5 text-right text-gray-600">{b.present} of {b.marked}</td>
                  <td className="py-1.5 text-right font-semibold text-church-navy w-16">{percent(b.rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <h3 className="font-semibold text-church-navy mb-2">Every service</h3>
        {data.history.length === 0 ? (
          <p className="text-sm text-gray-400">Not marked on any roll in this window.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {data.history.map(h => {
              const st = byId[h.statusId];
              return (
                <li key={`${h.date}|${h.service}`} className="flex items-center gap-3 py-1.5 text-sm">
                  <span className="w-28 shrink-0 text-gray-500">{dayLabel(h.date)}</span>
                  <span className="flex-1 text-gray-700 truncate">{h.service}</span>
                  <span className="inline-flex items-center gap-1.5 text-gray-900">
                    <span aria-hidden="true" className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: toneHex(st?.tone) }} />
                    {st?.label ?? 'Unknown'}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── The tab ──────────────────────────────────────────────────────────────────

export default function MemberAttendanceAnalytics({ services }) {
  const [weeks, setWeeks] = useState(13);
  const [service, setService] = useState('');
  const [personId, setPersonId] = useState('');
  const [people, setPeople] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  // The dropdown lists everybody on the roll, whether or not they have marks.
  useEffect(() => {
    call(`${API}/roll`).then(d => setPeople(d.people)).catch(() => {});
  }, []);

  const q = `weeks=${weeks}&service=${encodeURIComponent(service)}`;
  const url = personId ? `${API}/analytics/person/${personId}?${q}` : `${API}/analytics?${q}`;

  useEffect(() => {
    let live = true;
    // Tagged with the URL it answers, so the render before it arrives never
    // hands the congregation's numbers to the one-member view or back.
    call(url).then(d => { if (live) { setData({ ...d, url }); setError(''); } }).catch(e => live && setError(e.message));
    return () => { live = false; };
  }, [url]);

  const current = data?.url === url ? data : null;
  const control = 'border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <select value={personId} onChange={e => setPersonId(e.target.value)} aria-label="Member" className={`${control} flex-1 min-w-[12rem]`}>
          <option value="">Whole congregation</option>
          {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={service} onChange={e => setService(e.target.value)} aria-label="Service" className={control}>
          <option value="">Every service</option>
          {services.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
        </select>
        <select value={weeks} onChange={e => setWeeks(Number(e.target.value))} aria-label="Weeks" className={control}>
          {WEEKS.map(n => <option key={n} value={n}>Last {n} weeks</option>)}
        </select>
      </div>

      {error && <div className="card text-sm text-red-600">{error}</div>}
      {!current && !error && <div className="card text-sm text-gray-400">Loading…</div>}
      {current && (personId
        ? <PersonView data={current} />
        : <GroupView data={current} onPick={id => setPersonId(String(id))} />)}
    </div>
  );
}
