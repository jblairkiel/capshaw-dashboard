import { useState, useEffect, useCallback, useMemo } from 'react';
import Dialog from './Dialog';
import PersonPhoto from './PersonPhoto';
import MemberAttendanceAnalytics from './MemberAttendanceAnalytics';
import MemberAttendanceImport from './MemberAttendanceImport';
import { API, TONES, TONE_NAMES, toneHex, call, photoUrl, localToday } from '../lib/memberAttendance';
import DateInput from './DateInput';

// Member Attendance: who was at each service, one tap per person, and what it
// adds up to. For whoever holds the Member Attendance area, and admins — the
// server gates every request on the same thing (server/routes/memberAttendance.js).
//
// The roll is the directory in surname order, a photo and a large name per
// person. Tapping the photo or the name steps through the statuses (Present,
// Sick, Out of town, Absent, then back to not marked); the buttons under the
// name pick one directly. Each tap is saved as it is made.

const LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#'];

// The site's navigation bar is sticky at the top of the page; letter headings
// stick just under it, and a jump lands just under them.
const UNDER_NAV = 'top-11';

function Dot({ tone, size = 10 }) {
  return <span aria-hidden="true" className="inline-block rounded-full shrink-0" style={{ width: size, height: size, background: toneHex(tone) }} />;
}

// ─── The letter rail ──────────────────────────────────────────────────────────
// Fixed to the edge of the screen, so it is there however far down the roll
// somebody has scrolled.

function LetterRail({ letters, onJump }) {
  return (
    <nav aria-label="Jump to letter"
      className="fixed right-0.5 sm:right-2 top-1/2 -translate-y-1/2 z-20 flex flex-col items-center max-h-[80vh] bg-white/90 border border-gray-200 rounded-full py-1.5 shadow-sm">
      {LETTERS.map(l => {
        const has = letters.has(l);
        return (
          <button key={l} type="button" onClick={() => onJump(l)} disabled={!has}
            aria-label={`Jump to ${l === '#' ? 'other names' : l}`}
            className={`w-7 flex-1 min-h-0 text-[11px] sm:text-xs leading-none font-semibold flex items-center justify-center px-1 py-[1px] ${
              has ? 'text-church-navy hover:text-church-gold' : 'text-gray-300'
            }`}>
            {l}
          </button>
        );
      })}
    </nav>
  );
}

// ─── One person on the roll ───────────────────────────────────────────────────

function RollRow({ person, mark, statuses, onSet, onCycle }) {
  const current = statuses.find(s => s.id === mark?.statusId);
  const ring = current ? { boxShadow: `0 0 0 3px #fff, 0 0 0 6px ${toneHex(current.tone)}` } : undefined;

  return (
    <li className="flex items-center gap-3 sm:gap-4 px-3 sm:px-4 py-3 border-t border-gray-100">
      <button type="button" onClick={onCycle} className="rounded-lg shrink-0" style={ring}
        aria-label={`${person.name}: ${current ? current.label : 'not marked'}. Tap to change.`}>
        <PersonPhoto person={person} size={64} src={photoUrl(person.id)} />
      </button>
      <div className="flex-1 min-w-0">
        <button type="button" onClick={onCycle} tabIndex={-1}
          className="block text-left text-xl sm:text-2xl font-semibold text-church-navy leading-tight truncate max-w-full">
          {person.name}
        </button>
        <div role="group" aria-label={`Mark ${person.name}`} className="flex flex-wrap gap-1.5 mt-1.5">
          {statuses.map(s => {
            const on = s.id === mark?.statusId;
            return (
              <button key={s.id} type="button" aria-pressed={on} onClick={() => onSet(on ? null : s.id)}
                className={`inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-full text-sm border transition-colors ${
                  on ? 'font-semibold text-gray-900' : 'text-gray-600 border-gray-200 hover:border-gray-400 bg-white'
                }`}
                style={on ? { borderColor: toneHex(s.tone), background: `${toneHex(s.tone)}22` } : undefined}>
                <Dot tone={s.tone} />
                {s.label}
                {on && <span aria-hidden="true">✓</span>}
              </button>
            );
          })}
        </div>
      </div>
    </li>
  );
}

// ─── Taking the roll ──────────────────────────────────────────────────────────

function defaultService(services, date) {
  const weekday = new Date(`${date}T12:00:00`).getDay();
  return (services.find(s => s.weekday === weekday) || services[0])?.name || '';
}

function RollTab({ services, statuses }) {
  const active = statuses.filter(s => s.active);
  const [date, setDate] = useState(localToday);
  const [service, setService] = useState(() => defaultService(services, localToday()));
  const [people, setPeople] = useState(null);
  const [marks, setMarks] = useState({});
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [restStatus, setRestStatus] = useState('');

  const load = useCallback(() => {
    if (!date || !service) return;
    call(`${API}/roll?date=${encodeURIComponent(date)}&service=${encodeURIComponent(service)}`)
      .then(d => { setPeople(d.people); setMarks(d.marks); setError(''); })
      .catch(e => setError(e.message));
  }, [date, service]);
  useEffect(() => { load(); }, [load]);

  // Saved as it is tapped; put back if the server says no.
  async function set(person, statusId) {
    const before = marks[person.id];
    setMarks(m => {
      const next = { ...m };
      if (statusId === null) delete next[person.id]; else next[person.id] = { statusId };
      return next;
    });
    try {
      await call(`${API}/roll/mark`, { method: 'PUT', body: JSON.stringify({ date, service, personId: person.id, statusId }) });
      setError('');
    } catch (e) {
      setMarks(m => {
        const next = { ...m };
        if (before) next[person.id] = before; else delete next[person.id];
        return next;
      });
      setError(`${person.name} was not saved: ${e.message}`);
    }
  }

  // Not marked → the first status → the next … → not marked again.
  function cycle(person) {
    const at = active.findIndex(s => s.id === marks[person.id]?.statusId);
    const next = at === -1 ? active[0]?.id : active[at + 1]?.id ?? null;
    if (next === undefined) return;
    set(person, next);
  }

  async function markRest() {
    const status = active.find(s => String(s.id) === String(restStatus));
    if (!status) return;
    const left = (people || []).filter(p => !marks[p.id]).length;
    if (!window.confirm(`Mark the ${left} ${left === 1 ? 'person' : 'people'} not yet marked as ${status.label}?`)) return;
    try {
      await call(`${API}/roll/mark-rest`, { method: 'POST', body: JSON.stringify({ date, service, statusId: status.id }) });
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (people || []).filter(p => !q || p.name.toLowerCase().includes(q));
  }, [people, query]);
  const byLetter = useMemo(() => {
    const groups = new Map();
    for (const p of shown) {
      if (!groups.has(p.letter)) groups.set(p.letter, []);
      groups.get(p.letter).push(p);
    }
    return groups;
  }, [shown]);

  const counts = {};
  for (const m of Object.values(marks)) counts[m.statusId] = (counts[m.statusId] || 0) + 1;
  const markedCount = Object.keys(marks).length;
  const total = people?.length ?? 0;

  const jump = letter => document.getElementById(`roll-letter-${letter}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });

  if (!services.length) {
    return <div className="card text-sm text-gray-500">There are no services to take the roll for yet. An admin adds them under Attendance → Service types.</div>;
  }

  const field = 'mt-1 block w-full border border-gray-200 rounded-lg px-3 py-2 text-base focus:outline-none focus:border-church-gold';
  const label = 'text-xs font-medium text-gray-500 uppercase tracking-wide';

  return (
    <div className="space-y-4 pr-8 sm:pr-10">
      <div className="card space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="block">
            <span className={label}>Date</span>
            <DateInput value={date} onChange={setDate} className={field} />
          </label>
          <label className="block">
            <span className={label}>Service</span>
            <select value={service} onChange={e => setService(e.target.value)} className={field}>
              {services.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className={label}>Find a name</span>
            <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Type to filter" className={field} />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm" aria-live="polite">
          <span className="font-semibold text-church-navy">{markedCount} of {total} marked</span>
          {active.map(s => (
            <span key={s.id} className="inline-flex items-center gap-1.5 text-gray-700"><Dot tone={s.tone} />{s.label} {counts[s.id] || 0}</span>
          ))}
        </div>

        {markedCount > 0 && markedCount < total && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-gray-500">Mark everyone left as</span>
            <select value={restStatus} onChange={e => setRestStatus(e.target.value)} aria-label="Status for everyone left"
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm">
              <option value="">Choose…</option>
              {active.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <button type="button" onClick={markRest} disabled={!restStatus}
              className="px-3 py-1.5 rounded-lg border border-church-navy text-church-navy hover:bg-church-cream disabled:opacity-40">
              Mark
            </button>
          </div>
        )}
      </div>

      {error && <div className="card text-sm text-red-600" role="alert">{error}</div>}

      {people === null ? (
        <div className="card text-sm text-gray-400">Loading the roll…</div>
      ) : shown.length === 0 ? (
        <div className="card text-sm text-gray-400">{query ? 'Nobody by that name.' : 'Nobody is in the directory yet.'}</div>
      ) : (
        <div className="bg-white rounded-xl shadow-md border border-gray-100">
          {[...byLetter.entries()].map(([letter, group]) => (
            <section key={letter} id={`roll-letter-${letter}`} aria-label={letter} className="scroll-mt-12">
              <h3 className={`sticky ${UNDER_NAV} z-[5] bg-church-cream/95 backdrop-blur px-4 py-1 text-lg font-serif font-bold text-church-navy border-t border-gray-200 first:rounded-t-xl`}>
                {letter}
              </h3>
              <ul>
                {group.map(p => (
                  <RollRow key={p.id} person={p} mark={marks[p.id]} statuses={active}
                    onSet={statusId => set(p, statusId)} onCycle={() => cycle(p)} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <LetterRail letters={new Set(byLetter.keys())} onJump={jump} />
    </div>
  );
}

// ─── The status list ──────────────────────────────────────────────────────────
// What a mark can say. A status that has been used is retired rather than
// deleted, so the marks made with it still read right.

function StatusesDialog({ statuses, onClose, onChanged }) {
  const [adding, setAdding] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ordered = [...statuses].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);

  async function act(request) {
    setBusy(true); setError('');
    try { await request(); await onChanged(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  const patch = (s, changes) => act(() => call(`${API}/statuses/${s.id}`, { method: 'PATCH', body: JSON.stringify(changes) }));

  function move(s, by) {
    const swap = ordered[ordered.findIndex(x => x.id === s.id) + by];
    if (!swap) return;
    act(async () => {
      // Positions are renumbered so two statuses sharing one still move.
      const order = ordered.map(x => x.id);
      const i = order.indexOf(s.id), j = order.indexOf(swap.id);
      [order[i], order[j]] = [order[j], order[i]];
      for (const [pos, id] of order.entries()) {
        await call(`${API}/statuses/${id}`, { method: 'PATCH', body: JSON.stringify({ sortOrder: pos }) });
      }
    });
  }

  function rename(s) {
    const next = window.prompt('What should this status be called?', s.label);
    if (next === null || !next.trim() || next.trim() === s.label) return;
    patch(s, { label: next.trim() });
  }

  function remove(s) {
    if (!window.confirm(`Remove "${s.label}"?`)) return;
    act(() => call(`${API}/statuses/${s.id}`, { method: 'DELETE' }));
  }

  function add(e) {
    e.preventDefault();
    const label = adding.trim();
    if (!label) return;
    act(async () => {
      await call(`${API}/statuses`, { method: 'POST', body: JSON.stringify({ label }) });
      setAdding('');
    });
  }

  const small = 'text-xs px-2.5 py-1 rounded-lg border border-gray-200 text-gray-600 hover:border-church-gold disabled:opacity-40';

  return (
    <Dialog title="Attendance statuses" subtitle="What each person can be marked on the roll." onClose={onClose} width="max-w-xl">
      <div className="space-y-4">
        <ul className="divide-y divide-gray-100">
          {ordered.map((s, i) => (
            <li key={s.id} className="py-2.5 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Dot tone={s.tone} size={12} />
                <span className={`flex-1 min-w-[8rem] text-sm font-medium ${s.active ? 'text-church-navy' : 'text-gray-400 line-through'}`}>
                  {s.label}
                  {!s.active && <span className="ml-2 text-xs text-gray-400">retired</span>}
                </span>
                <button type="button" onClick={() => move(s, -1)} disabled={busy || i === 0} aria-label={`Move ${s.label} up`} className={small}>↑</button>
                <button type="button" onClick={() => move(s, 1)} disabled={busy || i === ordered.length - 1} aria-label={`Move ${s.label} down`} className={small}>↓</button>
                <button type="button" onClick={() => rename(s)} disabled={busy} aria-label={`Rename ${s.label}`} className={small}>Rename</button>
                <button type="button" onClick={() => patch(s, { active: !s.active })} disabled={busy}
                  aria-label={`${s.active ? 'Retire' : 'Bring back'} ${s.label}`} className={small}>
                  {s.active ? 'Retire' : 'Bring back'}
                </button>
                {!s.uses && (
                  <button type="button" onClick={() => remove(s)} disabled={busy} aria-label={`Remove ${s.label}`}
                    className="text-xs px-2.5 py-1 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40">Remove</button>
                )}
              </div>
              <div className="flex items-center gap-3 flex-wrap pl-5">
                <div role="radiogroup" aria-label={`Colour for ${s.label}`} className="flex gap-1">
                  {TONE_NAMES.map(t => (
                    <button key={t} type="button" role="radio" aria-checked={s.tone === t} aria-label={t}
                      onClick={() => s.tone !== t && patch(s, { tone: t })} disabled={busy}
                      className={`w-6 h-6 rounded-full border-2 ${s.tone === t ? 'border-gray-900' : 'border-white'}`}
                      style={{ background: TONES[t] }} />
                  ))}
                </div>
                <label className="inline-flex items-center gap-1.5 text-xs text-gray-600">
                  <input type="checkbox" checked={!!s.counts_present} disabled={busy}
                    onChange={e => patch(s, { countsPresent: e.target.checked })} />
                  Counts as present
                </label>
                <span className="text-xs text-gray-400">{s.uses} {s.uses === 1 ? 'mark' : 'marks'}</span>
              </div>
            </li>
          ))}
        </ul>

        <form onSubmit={add} className="flex items-end gap-2">
          <label className="block flex-1">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Add a status</span>
            <input value={adding} onChange={e => setAdding(e.target.value)} placeholder="Homebound"
              className="mt-1 block w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold" />
          </label>
          <button type="submit" disabled={busy || !adding.trim()} className="btn-primary text-sm disabled:opacity-50">Add</button>
        </form>

        <p className="text-xs text-gray-500">
          <strong>Counts as present</strong> decides what the analytics count as being there. A status somebody has
          already been marked with can be retired, which takes it off the roll without changing those marks.
        </p>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </Dialog>
  );
}

// ─── The page ─────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'roll',      label: 'Take the Roll' },
  { id: 'analytics', label: 'Analytics' },
];

export default function MemberAttendanceView() {
  const [tab, setTab] = useState('roll');
  const [setup, setSetup] = useState(null);
  const [error, setError] = useState('');
  const [editingStatuses, setEditingStatuses] = useState(false);
  const [importing, setImporting] = useState(false);
  // Bumped after an import, so the roll and analytics read the new marks.
  const [version, setVersion] = useState(0);

  const load = useCallback(() => (
    call(`${API}/roll`).then(d => { setSetup({ services: d.services, statuses: d.statuses }); setError(''); })
      .catch(e => setError(e.message))
  ), []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="section-heading mb-1">Member Attendance</h2>
          <p className="text-sm text-gray-500">Tap each person at a service. Every tap is saved as you go.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setImporting(true)} disabled={!setup?.services.length}
            className="text-sm px-3 py-2 rounded-lg border border-gray-300 text-gray-600 hover:border-church-gold hover:text-church-navy disabled:opacity-40">
            Import from Excel
          </button>
          <button type="button" onClick={() => setEditingStatuses(true)} disabled={!setup}
            className="text-sm px-3 py-2 rounded-lg border border-gray-300 text-gray-600 hover:border-church-gold hover:text-church-navy disabled:opacity-40">
            Statuses
          </button>
        </div>
      </div>

      <div role="tablist" aria-label="Member attendance" className="flex gap-1 border-b border-gray-200">
        {TABS.map(t => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${
              tab === t.id ? 'border-church-gold text-church-navy' : 'border-transparent text-gray-500 hover:text-church-navy'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {error && !setup && <div className="card text-sm text-red-600">{error}</div>}
      {!setup && !error && <div className="card text-sm text-gray-400">Loading…</div>}

      {setup && tab === 'roll' && <RollTab key={version} services={setup.services} statuses={setup.statuses} />}
      {setup && tab === 'analytics' && <MemberAttendanceAnalytics key={version} services={setup.services} />}

      {importing && setup && (
        <MemberAttendanceImport services={setup.services} statuses={setup.statuses}
          onClose={() => setImporting(false)} onImported={() => { setVersion(v => v + 1); load(); }} onStatusesChanged={load} />
      )}
      {editingStatuses && setup && (
        <StatusesDialog statuses={setup.statuses} onClose={() => setEditingStatuses(false)} onChanged={load} />
      )}
    </div>
  );
}
