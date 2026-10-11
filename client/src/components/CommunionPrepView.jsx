import { useState, useEffect, useCallback } from 'react';

// ─── Communion preparation ────────────────────────────────────────────────────
//
// The sign-up list for preparing the Lord's Supper: one name a month for the
// year. Any member signs up for an open month (and can take their name off);
// whoever holds Communion Preparation starts each year's list and can write
// anybody in or clear a month. The person down for a month is emailed a week
// before it begins. The server decides all of it; `canManage` only says which
// buttons to draw.

const API = '/api/communion-prep';

async function send(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'include',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  });
  const json = await res.json().catch(() => ({}));
  if (!json.success) throw new Error(json.error || 'Something went wrong');
  return json;
}

// The keeper's control for one month: a name from the directory (or typed),
// put down or cleared.
function KeeperEdit({ month, year, people, onSaved, onCancel }) {
  const [name, setName]   = useState(month.signup?.name || '');
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');

  async function save(value) {
    setBusy(true); setError('');
    try {
      const json = await send(`${API}/${year}/${month.month}`, { method: 'PUT', body: JSON.stringify({ name: value }) });
      onSaved(json.months);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={e => { e.preventDefault(); save(name); }} className="mt-2 space-y-2">
      <input value={name} onChange={e => setName(e.target.value)} list="communion-prep-people" autoFocus
        aria-label={`Who prepares communion in ${month.label}`} placeholder="A name from the directory, or any name"
        className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-church-gold" />
      <datalist id="communion-prep-people">{people.map(p => <option key={p} value={p} />)}</datalist>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex items-center gap-2 flex-wrap">
        <button type="submit" disabled={busy || !name.trim()} className="btn-primary text-xs py-1.5 px-3 disabled:opacity-50">Save</button>
        {month.signup && <button type="button" disabled={busy} onClick={() => save('')} className="text-xs text-gray-500 hover:text-red-600 underline">Clear the month</button>}
        <button type="button" onClick={onCancel} className="text-xs text-gray-500 underline">Cancel</button>
      </div>
    </form>
  );
}

function MonthCard({ month, year, canManage, people, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState('');
  const { signup } = month;

  async function act(method) {
    if (method === 'DELETE' && !window.confirm(`Take your name off ${month.label} ${year}?`)) return;
    setBusy(true); setError('');
    try {
      onChanged((await send(`${API}/${year}/${month.month}/signup`, { method })).months);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={`card p-4 ${month.started ? 'opacity-70' : ''} ${signup?.mine ? 'ring-2 ring-church-gold' : ''}`} aria-label={`${month.label} ${year}`}>
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="font-semibold text-church-navy">{month.label}</h4>
        {month.started && <span className="text-xs text-gray-400">begun</span>}
      </div>
      <div className="mt-1 min-h-[1.5rem]">
        {signup ? (
          <p className="text-sm">
            <span className="text-church-navy font-medium">{signup.name}</span>
            {signup.mine && <span className="ml-1.5 text-xs text-church-gold">(you)</span>}
          </p>
        ) : (
          <p className="text-sm text-gray-400">{month.started ? 'Nobody signed up' : 'Open'}</p>
        )}
        {canManage && signup && !signup.hasEmail && !month.started && (
          <p className="text-xs text-amber-700 mt-0.5">No email on file — they will not get a reminder.</p>
        )}
      </div>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
      {!editing && (
        <div className="mt-2 flex items-center gap-3 flex-wrap">
          {!signup && !month.started && (
            <button type="button" disabled={busy} onClick={() => act('POST')} className="btn-primary text-xs py-1.5 px-3 disabled:opacity-50"
              aria-label={`Sign up for ${month.label}`}>Sign up</button>
          )}
          {signup?.mine && !month.started && (
            <button type="button" disabled={busy} onClick={() => act('DELETE')} className="text-xs text-gray-500 hover:text-red-600 underline">Take my name off</button>
          )}
          {canManage && (
            <button type="button" onClick={() => setEditing(true)} className="text-xs text-church-gold hover:text-church-navy underline"
              aria-label={`Change who prepares ${month.label}`}>{signup ? 'Change' : 'Put someone down'}</button>
          )}
        </div>
      )}
      {editing && (
        <KeeperEdit month={month} year={year} people={people}
          onCancel={() => setEditing(false)}
          onSaved={months => { setEditing(false); onChanged(months); }} />
      )}
    </li>
  );
}

export default function CommunionPrepView({ initialYear = null }) {
  const [data, setData]       = useState(null);
  const [error, setError]     = useState('');
  const [starting, setStarting] = useState(false);

  const load = useCallback(async year => {
    try {
      setData(await send(`${API}${year ? `?year=${year}` : ''}`));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { load(initialYear); }, [load, initialYear]);

  async function startYear(year) {
    if (!window.confirm(`Start the ${year} communion preparation list? Members can sign up for its months straight away.`)) return;
    setStarting(true);
    try {
      await send(`${API}/years`, { method: 'POST', body: JSON.stringify({ year }) });
      await load(year);
    } catch (err) {
      setError(err.message);
    } finally {
      setStarting(false);
    }
  }

  if (error && !data) return <div className="card text-sm text-red-600">{error}</div>;
  if (!data) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-church-gold" />
      </div>
    );
  }

  const { year, years, startable, canManage, people, months } = data;
  const open = (months || []).filter(m => !m.signup && !m.started).length;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="section-heading mb-1">Communion Preparation</h2>
          <p className="text-sm text-gray-500">
            Who prepares the Lord&apos;s Supper each month. Sign up for an open month; you will be emailed a reminder a week before it begins.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {years.length > 1 && (
            <select value={year} onChange={e => load(Number(e.target.value))} aria-label="Year"
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-church-navy font-semibold">
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          )}
          {canManage && startable.map(y => (
            <button key={y} type="button" disabled={starting} onClick={() => startYear(y)}
              className="text-sm px-3 py-2 rounded-lg border border-church-navy text-church-navy hover:bg-church-navy hover:text-white disabled:opacity-50">
              Start the {y} list
            </button>
          ))}
        </div>
      </div>

      {error && <div className="card border border-red-200 bg-red-50 text-sm text-red-700">{error}</div>}

      {!months ? (
        <div className="card text-center py-12 text-sm text-gray-500">
          {canManage
            ? `There is no list for ${year} yet. Choose Start the ${year} list to open its twelve months for sign-up.`
            : `The ${year} list has not been started yet. Whoever keeps it will open it for sign-up.`}
        </div>
      ) : (
        <>
          <p className="text-sm text-gray-600">
            <span className="font-semibold text-church-navy">{year}</span>
            {' · '}{open ? `${open} month${open === 1 ? '' : 's'} still open` : 'Every month ahead is taken'}
          </p>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label={`Communion preparation ${year}`}>
            {months.map(m => (
              <MonthCard key={`${year}-${m.month}`} month={m} year={year} canManage={canManage} people={people}
                onChanged={next => setData(d => ({ ...d, months: next }))} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
