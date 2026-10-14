import { useState, useEffect, useCallback } from 'react';

// ─── Rotations ────────────────────────────────────────────────────────────────
//
// Anything the church takes in turns — teaching a class, hosting a baby shower.
// Each rotation is a line of people from the directory; the first one not
// sitting out is next up. A coordinator gives the turn (usually to whoever is
// next) and that person goes to the back; whoever is next up then is emailed.
// Whoever holds the Rotations area starts and retires rotations and says who
// coordinates each. The server decides all of it; canRun and canManage only
// say which buttons to draw.

const API = '/api/rotations';

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

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// What happened when the rotation moved on, said plainly.
function toldMessage(told) {
  if (!told) return '';
  if (told.emailed) return `${told.name} is next up and has been emailed to say so.`;
  if (told.notified) return `${told.name} is next up and has been told in the portal (there is no email address on file).`;
  return `${told.name} is next up, but has no email address or account here — please let them know in person.`;
}

const Pill = ({ tone, children }) => (
  <span className={`inline-block text-xs px-2 py-0.5 rounded-full ${tone}`}>{children}</span>
);

// ─── Choosing people from the directory ───────────────────────────────────────

function PersonPicker({ people, exclude = [], label, buttonLabel = 'Add', onPick, busy }) {
  const [choice, setChoice] = useState('');
  const skip = new Set(exclude);
  const options = people.filter(p => !skip.has(p.id));
  return (
    <form
      className="flex gap-2 flex-wrap items-center"
      onSubmit={e => { e.preventDefault(); if (choice) { onPick(Number(choice)); setChoice(''); } }}
    >
      <select value={choice} onChange={e => setChoice(e.target.value)} aria-label={label}
        className="flex-1 min-w-[12rem] border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-church-gold">
        <option value="">{options.length ? `${label}…` : 'Everybody in the directory is already here'}</option>
        {options.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <button type="submit" disabled={busy || !choice} className="btn-primary text-xs py-1.5 px-3 disabled:opacity-50">{buttonLabel}</button>
    </form>
  );
}

// ─── Starting a rotation (the area) ───────────────────────────────────────────

function NewRotation({ people, onCreated, onCancel }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [coordinators, setCoordinators] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const nameOf = id => people.find(p => p.id === id)?.name || '';

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const json = await send(API, { method: 'POST', body: JSON.stringify({ name, description, coordinatorIds: coordinators }) });
      onCreated(json.rotation);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-3" role="region" aria-label="Start a rotation">
      <h3 className="font-semibold text-church-navy">Start a rotation</h3>
      <form onSubmit={submit} className="space-y-3" id="new-rotation">
        <div>
          <label htmlFor="rotation-name" className="block text-xs font-medium text-gray-600 mb-1">Name</label>
          <input id="rotation-name" value={name} onChange={e => setName(e.target.value)} autoFocus
            placeholder="Ladies' class teachers, Baby shower hosts…"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold" />
        </div>
        <div>
          <label htmlFor="rotation-description" className="block text-xs font-medium text-gray-600 mb-1">What a turn is (optional)</label>
          <textarea id="rotation-description" value={description} onChange={e => setDescription(e.target.value)} rows={2}
            placeholder="Teaching the Wednesday evening ladies' class for a quarter."
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold" />
        </div>
      </form>
      <div>
        <p className="text-xs font-medium text-gray-600 mb-1">Coordinators — they run it: the line, its order and the turns</p>
        {coordinators.length > 0 && (
          <ul className="flex flex-wrap gap-2 mb-2">
            {coordinators.map(id => (
              <li key={id} className="text-xs bg-gray-100 rounded-full pl-3 pr-1 py-0.5 flex items-center gap-1">
                {nameOf(id)}
                <button type="button" onClick={() => setCoordinators(c => c.filter(x => x !== id))} aria-label={`Remove ${nameOf(id)}`}
                  className="w-5 h-5 rounded-full hover:bg-gray-200 text-gray-500">×</button>
              </li>
            ))}
          </ul>
        )}
        <PersonPicker people={people} exclude={coordinators} label="Choose a coordinator" onPick={id => setCoordinators(c => [...c, id])} />
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-3 items-center">
        <button type="submit" form="new-rotation" disabled={busy || !name.trim()} className="btn-primary text-sm disabled:opacity-50">
          {busy ? 'Starting…' : 'Start it'}
        </button>
        <button type="button" onClick={onCancel} className="text-sm text-gray-500 underline">Cancel</button>
      </div>
    </div>
  );
}

// ─── The index ────────────────────────────────────────────────────────────────

function RotationCard({ rotation, onOpen }) {
  return (
    <li>
      <button type="button" onClick={() => onOpen(rotation.id)}
        className={`card w-full text-left p-4 hover:shadow-md transition-shadow ${rotation.youAreNext ? 'ring-2 ring-church-gold' : ''} ${rotation.active ? '' : 'opacity-60'}`}
        aria-label={`Open ${rotation.name}`}>
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-church-navy">{rotation.name}</h3>
          {!rotation.active && <Pill tone="bg-gray-100 text-gray-600">Retired</Pill>}
        </div>
        {rotation.description && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{rotation.description}</p>}
        <p className="text-sm mt-3">
          <span className="text-gray-500">Next up: </span>
          {rotation.nextUp
            ? <span className="font-medium text-church-navy">{rotation.nextUp.name}</span>
            : <span className="text-gray-400">nobody yet</span>}
          {rotation.youAreNext && <span className="ml-1.5 text-xs font-semibold text-church-gold">That&apos;s you</span>}
        </p>
        {rotation.nextTurn && (
          <p className="text-xs text-gray-500 mt-1">Coming up: {rotation.nextTurn.name}, {formatDate(rotation.nextTurn.date)}</p>
        )}
        <p className="text-xs text-gray-400 mt-2">
          {rotation.memberCount} {rotation.memberCount === 1 ? 'person' : 'people'}
          {rotation.canRun && ' · you coordinate this'}
        </p>
      </button>
    </li>
  );
}

// ─── One rotation ─────────────────────────────────────────────────────────────

function GiveTurn({ rotation, onDone, busy, setBusy, setError }) {
  const [who, setWho] = useState('');
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');
  const available = rotation.members;
  const chosen = who ? available.find(m => m.directoryId === Number(who)) : null;
  const name = chosen?.name || rotation.nextUp?.name;

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const json = await send(`${API}/${rotation.id}/turns`, {
        method: 'POST',
        body: JSON.stringify({ directoryId: who ? Number(who) : undefined, date: date || undefined, note }),
      });
      setWho(''); setNote(''); setDate(today());
      onDone(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!rotation.nextUp && !available.length) return null;
  return (
    <form onSubmit={submit} className="rounded-lg border border-gray-100 bg-gray-50 p-3 space-y-2" aria-label="Give a turn">
      <p className="text-sm font-medium text-church-navy">Give a turn</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="text-xs text-gray-600">
          To
          <select value={who} onChange={e => setWho(e.target.value)}
            className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white">
            <option value="">{rotation.nextUp ? `${rotation.nextUp.name} (next up)` : 'Choose…'}</option>
            {available.filter(m => m.directoryId !== rotation.nextUp?.directoryId).map(m => (
              <option key={m.directoryId} value={m.directoryId}>{m.name}{m.sittingOut ? ' (sitting out)' : ''}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-gray-600">
          On
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white" />
        </label>
        <label className="text-xs text-gray-600">
          Note (optional)
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Where, which class…"
            className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white" />
        </label>
      </div>
      <p className="text-xs text-gray-500">
        {name ? `${name} goes to the back of the line` : 'They go to the back of the line'}
        {who && rotation.nextUp && Number(who) !== rotation.nextUp.directoryId ? `, and ${rotation.nextUp.name} stays next up` : ''}.
        {' '}A date still to come shows the turn as upcoming.
      </p>
      <button type="submit" disabled={busy || (!who && !rotation.nextUp)} className="btn-primary text-sm disabled:opacity-50">
        {name ? `Give the turn to ${name}` : 'Give the turn'}
      </button>
    </form>
  );
}

function Line({ rotation, people, act, busy }) {
  const { members, canRun } = rotation;

  function move(index, by) {
    const order = members.map(m => m.directoryId);
    const [moved] = order.splice(index, 1);
    order.splice(index + by, 0, moved);
    act(`${API}/${rotation.id}/order`, { method: 'PUT', body: JSON.stringify({ order }) });
  }

  return (
    <section aria-labelledby="line-heading" className="card space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 id="line-heading" className="font-semibold text-church-navy">The line</h3>
        <span className="text-xs text-gray-400">first in line is next up</span>
      </div>
      {members.length === 0 ? (
        <p className="text-sm text-gray-500">Nobody is in this rotation yet.{canRun ? ' Add people below.' : ''}</p>
      ) : (
        <ol className="divide-y divide-gray-100" aria-label={`${rotation.name} in order`}>
          {members.map((m, i) => (
            <li key={m.directoryId} className={`py-2 flex items-center gap-3 flex-wrap ${m.sittingOut ? 'opacity-60' : ''}`}>
              <span className="w-6 text-right text-xs text-gray-400 shrink-0">{m.place}</span>
              <span className="flex-1 min-w-[8rem]">
                <span className={`text-sm ${m.next ? 'font-semibold text-church-navy' : 'text-gray-700'}`}>{m.name}</span>
                <span className="ml-2 inline-flex gap-1 flex-wrap align-middle">
                  {m.next && <Pill tone="bg-church-gold/20 text-church-navy">Next up</Pill>}
                  {m.mine && <Pill tone="bg-blue-50 text-blue-700">You</Pill>}
                  {m.sittingOut && <Pill tone="bg-gray-100 text-gray-600">Sitting out</Pill>}
                  {canRun && m.hasEmail === false && <Pill tone="bg-amber-50 text-amber-800">No email</Pill>}
                </span>
              </span>
              {canRun && (
                <span className="flex items-center gap-1 flex-wrap">
                  <button type="button" disabled={busy || i === 0} onClick={() => move(i, -1)} aria-label={`Move ${m.name} up`}
                    className="w-7 h-7 rounded border border-gray-200 text-gray-500 hover:text-church-navy disabled:opacity-30">↑</button>
                  <button type="button" disabled={busy || i === members.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${m.name} down`}
                    className="w-7 h-7 rounded border border-gray-200 text-gray-500 hover:text-church-navy disabled:opacity-30">↓</button>
                  <button type="button" disabled={busy || i === members.length - 1} onClick={() => act(`${API}/${rotation.id}/members/${m.directoryId}/back`, { method: 'POST' })}
                    className="text-xs text-gray-500 hover:text-church-navy underline px-1">Send to the back</button>
                  <button type="button" disabled={busy} onClick={() => act(`${API}/${rotation.id}/members/${m.directoryId}`, { method: 'PATCH', body: JSON.stringify({ sittingOut: !m.sittingOut }) })}
                    className="text-xs text-gray-500 hover:text-church-navy underline px-1">{m.sittingOut ? 'Back in' : 'Sit out'}</button>
                  <button type="button" disabled={busy}
                    onClick={() => window.confirm(`Take ${m.name} out of ${rotation.name}?`) && act(`${API}/${rotation.id}/members/${m.directoryId}`, { method: 'DELETE' })}
                    className="text-xs text-gray-400 hover:text-red-600 underline px-1">Remove</button>
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
      {canRun && people && (
        <PersonPicker people={people} exclude={members.map(m => m.directoryId)} label="Add somebody to the back"
          busy={busy} onPick={id => act(`${API}/${rotation.id}/members`, { method: 'POST', body: JSON.stringify({ directoryIds: [id] }) })} />
      )}
    </section>
  );
}

function Turns({ title, turns, rotation, act, busy, empty, upcoming }) {
  return (
    <section className="card space-y-2" aria-label={title}>
      <h3 className="font-semibold text-church-navy">{title}</h3>
      {turns.length === 0 ? <p className="text-sm text-gray-500">{empty}</p> : (
        <ul className="divide-y divide-gray-100">
          {turns.map(t => (
            <li key={t.id} className="py-2 flex items-start gap-3 flex-wrap">
              <span className="text-xs text-gray-500 w-32 shrink-0 pt-0.5">{t.date ? formatDate(t.date) : 'No date'}</span>
              <span className="flex-1 min-w-[8rem] text-sm">
                <span className="text-church-navy font-medium">{t.name}</span>
                {t.mine && <span className="ml-1.5 text-xs text-church-gold">(you)</span>}
                {t.note && <span className="block text-xs text-gray-500">{t.note}</span>}
              </span>
              {rotation.canRun && (
                <button type="button" disabled={busy}
                  onClick={() => window.confirm(upcoming
                    ? `Cancel ${t.name}'s turn? They go back to the front of the line.`
                    : `Take ${t.name}'s turn out of the history? Nobody moves in the line.`)
                    && act(`${API}/${rotation.id}/turns/${t.id}${upcoming ? '?requeue=1' : ''}`, { method: 'DELETE' })}
                  className="text-xs text-gray-400 hover:text-red-600 underline">{upcoming ? 'Cancel' : 'Remove'}</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// The area's own controls: details, coordinators, retiring and deleting.
function Manage({ rotation, people, act, busy, onDeleted, setError }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(rotation.name);
  const [description, setDescription] = useState(rotation.description);
  const coordinatorIds = rotation.coordinators.map(c => c.directoryId);

  async function save(e) {
    e.preventDefault();
    if (await act(`${API}/${rotation.id}`, { method: 'PATCH', body: JSON.stringify({ name, description }) })) setEditing(false);
  }

  async function remove() {
    if (!window.confirm(`Delete ${rotation.name}, with its line and every turn in its history? This cannot be undone. Retiring it keeps it instead.`)) return;
    try {
      await send(`${API}/${rotation.id}`, { method: 'DELETE' });
      onDeleted();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section className="card space-y-3" aria-label="Look after this rotation">
      <h3 className="font-semibold text-church-navy">Look after this rotation</h3>
      {editing ? (
        <form onSubmit={save} className="space-y-2">
          <input value={name} onChange={e => setName(e.target.value)} aria-label="Name"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} aria-label="What a turn is"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          <div className="flex gap-3">
            <button type="submit" disabled={busy || !name.trim()} className="btn-primary text-xs py-1.5 px-3 disabled:opacity-50">Save</button>
            <button type="button" onClick={() => setEditing(false)} className="text-xs text-gray-500 underline">Cancel</button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => { setName(rotation.name); setDescription(rotation.description); setEditing(true); }}
          className="text-sm text-church-gold hover:text-church-navy underline">Change the name or description</button>
      )}

      {rotation.canManage && (
        <>
          <div>
            <p className="text-xs font-medium text-gray-600 mb-1">Coordinators</p>
            {rotation.coordinators.length === 0
              ? <p className="text-xs text-gray-500 mb-2">Nobody yet — only whoever holds Rotations can run it.</p>
              : (
                <ul className="flex flex-wrap gap-2 mb-2">
                  {rotation.coordinators.map(c => (
                    <li key={c.directoryId} className="text-xs bg-gray-100 rounded-full pl-3 pr-1 py-0.5 flex items-center gap-1">
                      {c.name}
                      <button type="button" disabled={busy} aria-label={`Remove ${c.name} as coordinator`}
                        onClick={() => act(`${API}/${rotation.id}/coordinators`, { method: 'PUT', body: JSON.stringify({ directoryIds: coordinatorIds.filter(x => x !== c.directoryId) }) })}
                        className="w-5 h-5 rounded-full hover:bg-gray-200 text-gray-500">×</button>
                    </li>
                  ))}
                </ul>
              )}
            {people && (
              <PersonPicker people={people} exclude={coordinatorIds} label="Add a coordinator" busy={busy}
                onPick={id => act(`${API}/${rotation.id}/coordinators`, { method: 'PUT', body: JSON.stringify({ directoryIds: [...coordinatorIds, id] }) })} />
            )}
          </div>
          <div className="flex gap-3 flex-wrap pt-1">
            <button type="button" disabled={busy}
              onClick={() => act(`${API}/${rotation.id}`, { method: 'PATCH', body: JSON.stringify({ active: !rotation.active }) })}
              className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">
              {rotation.active ? 'Retire it' : 'Bring it back'}
            </button>
            <button type="button" disabled={busy} onClick={remove}
              className="text-sm px-3 py-1.5 rounded-lg border border-red-200 text-red-700 hover:bg-red-50">Delete it</button>
          </div>
        </>
      )}
    </section>
  );
}

function RotationDetail({ id, people, onBack, onChanged }) {
  const [rotation, setRotation] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    send(`${API}/${id}`).then(j => setRotation(j.rotation)).catch(err => setError(err.message));
  }, [id]);

  // Every change answers with the whole rotation, and says who was told.
  const apply = useCallback(json => {
    setRotation(json.rotation);
    setNotice(toldMessage(json.told));
    onChanged();
  }, [onChanged]);

  const act = useCallback(async (url, options) => {
    setBusy(true); setError(''); setNotice('');
    try {
      apply(await send(url, options));
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  }, [apply]);

  if (!rotation) {
    return error
      ? <div className="card text-sm text-red-600">{error}</div>
      : <div className="flex items-center justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-church-gold" /></div>;
  }

  const next = rotation.members.find(m => m.next);

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="text-sm text-church-gold hover:text-church-navy">← All rotations</button>

      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="section-heading mb-0">{rotation.name}</h2>
          {!rotation.active && <Pill tone="bg-gray-100 text-gray-600">Retired</Pill>}
        </div>
        {rotation.description && <p className="text-sm text-gray-600 mt-1 whitespace-pre-line">{rotation.description}</p>}
        <p className="text-xs text-gray-500 mt-1">
          {rotation.coordinators.length
            ? <>Coordinated by {rotation.coordinators.map(c => c.name).join(', ')}</>
            : 'No coordinator yet'}
        </p>
      </div>

      {error && <div role="alert" className="card border border-red-200 bg-red-50 text-sm text-red-700">{error}</div>}
      {notice && <div role="status" className="card border border-green-200 bg-green-50 text-sm text-green-800">{notice}</div>}

      <section className={`card ${next?.mine ? 'ring-2 ring-church-gold' : ''}`} aria-label="Next up">
        <p className="text-xs uppercase tracking-wide text-gray-500">Next up</p>
        {next ? (
          <p className="text-xl font-semibold text-church-navy mt-1">
            {next.name}{next.mine && <span className="ml-2 text-sm font-semibold text-church-gold">That&apos;s you</span>}
          </p>
        ) : <p className="text-sm text-gray-500 mt-1">Nobody yet</p>}
        {rotation.canRun && rotation.active && (
          <div className="mt-3 space-y-3">
            <GiveTurn rotation={rotation} onDone={apply} busy={busy} setBusy={setBusy} setError={setError} />
            {next && (
              <button type="button" disabled={busy} onClick={() => act(`${API}/${rotation.id}/remind`, { method: 'POST' })}
                className="text-sm text-church-gold hover:text-church-navy underline">Let {next.name} know they are next</button>
            )}
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Line rotation={rotation} people={people} act={act} busy={busy} />
        <div className="space-y-4">
          <Turns title="Upcoming" turns={rotation.upcoming} rotation={rotation} act={act} busy={busy} upcoming
            empty="Nothing booked yet." />
          <Turns title="History" turns={rotation.history} rotation={rotation} act={act} busy={busy}
            empty="No turns written down yet." />
          {rotation.canRun && (
            <Manage rotation={rotation} people={people} act={act} busy={busy} setError={setError} onDeleted={onBack} />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── The page ─────────────────────────────────────────────────────────────────

export default function RotationsView({ initialRotationId = null }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(initialRotationId);
  const [starting, setStarting] = useState(false);
  const [showRetired, setShowRetired] = useState(false);
  const [people, setPeople] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await send(`${API}${showRetired ? '?retired=1' : ''}`));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [showRetired]);

  useEffect(() => { load(); }, [load]);

  // The directory, for choosing people — only fetched for somebody who can
  // choose them.
  const canChoose = !!data && (data.canManage || data.rotations.some(r => r.canRun));
  useEffect(() => {
    if (!canChoose || people) return;
    send(`${API}/people`).then(j => setPeople(j.people)).catch(() => setPeople([]));
  }, [canChoose, people]);

  if (openId) {
    return (
      <RotationDetail key={openId} id={openId} people={people}
        onBack={() => { setOpenId(null); load(); }}
        onChanged={load} />
    );
  }

  if (error && !data) return <div className="card text-sm text-red-600">{error}</div>;
  if (!data) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-church-gold" />
      </div>
    );
  }

  const { rotations, canManage } = data;
  const mine = rotations.filter(r => r.youAreNext);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="section-heading mb-1">Rotations</h2>
          <p className="text-sm text-gray-500">
            Who is next for the things we take in turns. Whoever is next up is emailed when their turn comes round.
          </p>
        </div>
        {canManage && !starting && (
          <div className="flex items-center gap-3 flex-wrap">
            <label className="text-xs text-gray-500 flex items-center gap-1.5">
              <input type="checkbox" checked={showRetired} onChange={e => setShowRetired(e.target.checked)} />
              Show retired
            </label>
            <button type="button" onClick={() => setStarting(true)} className="btn-primary text-sm">Start a rotation</button>
          </div>
        )}
      </div>

      {error && <div className="card border border-red-200 bg-red-50 text-sm text-red-700">{error}</div>}

      {mine.length > 0 && (
        <div role="status" className="card border border-church-gold/40 bg-church-gold/10 text-sm text-church-navy">
          You are next up on {mine.map(r => r.name).join(' and ')}.
        </div>
      )}

      {starting && people && (
        <NewRotation people={people} onCancel={() => setStarting(false)}
          onCreated={rotation => { setStarting(false); load(); setOpenId(rotation.id); }} />
      )}

      {rotations.length === 0 ? (
        <div className="card text-center py-12 text-sm text-gray-500">
          {canManage
            ? 'There are no rotations yet. Choose Start a rotation for anything the church takes in turns — teaching a class, hosting a baby shower.'
            : 'There are no rotations yet.'}
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Rotations">
          {rotations.map(r => <RotationCard key={r.id} rotation={r} onOpen={setOpenId} />)}
        </ul>
      )}
    </div>
  );
}
