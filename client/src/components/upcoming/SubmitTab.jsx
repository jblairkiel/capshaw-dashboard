import { useState, useEffect, useCallback, useRef } from 'react';
import { SongPicker, StatusBadge } from './shared';
import { call, dayLabel } from './api';
import DateInput from '../DateInput';

// ─── Submit a Service ─────────────────────────────────────────────────────────
//
// The song leader lays out the whole service, part by part, in the usual order
// for it (the worship organizer keeps that on the Service Parts tab), with the
// Serving Schedule's names already against the parts it knows about. Songs
// somebody has asked for sit alongside, one click from going in.
//
// Submitting emails the worship organizer, who confirms it — here, or from
// the Order of Worship tab. Until then the leader can keep changing it; after,
// only the organizer can.

let nextKey = 1;
const withKey = item => ({ ...item, key: nextKey++ });

function fromServer(items) {
  return items.map(i => withKey({
    partId: i.partId, partName: i.partName,
    takesSong: i.takesSong, takesPerson: i.takesPerson, detailLabel: i.detailLabel,
    song: i.song, person: i.person || '', detail: i.detail || '', note: i.note || '',
  }));
}

function ItemRow({ item, index, count, editable, onChange, onMove, onRemove }) {
  return (
    <li className="py-2.5 border-t border-gray-100 first:border-t-0">
      <div className="flex items-start gap-2">
        <span className="text-church-gold text-xs font-bold w-5 pt-2 shrink-0">{index + 1}.</span>
        <div className="flex-1 min-w-0 grid gap-2 sm:grid-cols-[9rem_minmax(0,1fr)] md:grid-cols-[8rem_minmax(0,3fr)_minmax(0,2fr)] items-start">
          <span className="text-sm font-medium text-gray-700 sm:pt-1.5">{item.partName}</span>
          <div className="space-y-1.5 min-w-0">
            {item.takesSong && (editable
              ? <SongPicker value={item.song} onChange={song => onChange({ song })} label={`Song for ${item.partName} ${index + 1}`} />
              : <span className="text-sm text-church-navy">{item.song?.title}</span>)}
            {item.takesPerson && (editable
              ? <input value={item.person} onChange={e => onChange({ person: e.target.value })} placeholder="Who"
                  aria-label={`Who for ${item.partName} ${index + 1}`}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-church-navy" />
              : item.person && <span className="block text-sm text-gray-700">{item.person}</span>)}
            {item.detailLabel && (editable
              ? <input value={item.detail} onChange={e => onChange({ detail: e.target.value })} placeholder={item.detailLabel}
                  aria-label={`${item.detailLabel} for ${item.partName} ${index + 1}`}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-church-navy" />
              : item.detail && <span className="block text-sm text-gray-500 italic">{item.detail}</span>)}
          </div>
          {/* Beside the part (under it on a narrow screen): the leader's own
              word on it, whatever the part collects. */}
          {editable
            ? <input value={item.note} onChange={e => onChange({ note: e.target.value })} placeholder="specific vs. or comments"
                aria-label={`Note for ${item.partName} ${index + 1}`} maxLength={200}
                className="sm:col-start-2 md:col-start-auto w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-church-navy" />
            : item.note && <span className="sm:col-start-2 md:col-start-auto text-sm text-gray-500 italic md:pt-1.5">{item.note}</span>}
        </div>
        {editable && (
          <div className="flex flex-col sm:flex-row gap-0.5 shrink-0">
            <button type="button" onClick={() => onMove(-1)} disabled={index === 0} aria-label={`Move ${item.partName} ${index + 1} up`}
              className="w-7 h-7 rounded text-gray-400 hover:text-church-navy hover:bg-gray-100 disabled:opacity-30">↑</button>
            <button type="button" onClick={() => onMove(1)} disabled={index === count - 1} aria-label={`Move ${item.partName} ${index + 1} down`}
              className="w-7 h-7 rounded text-gray-400 hover:text-church-navy hover:bg-gray-100 disabled:opacity-30">↓</button>
            <button type="button" onClick={onRemove} aria-label={`Remove ${item.partName} ${index + 1}`}
              className="w-7 h-7 rounded text-gray-400 hover:text-red-600 hover:bg-red-50">×</button>
          </div>
        )}
      </div>
    </li>
  );
}

function OccasionPicker({ overview, selection, onSelect }) {
  const known = overview.upcoming.some(u => u.date === selection?.date && u.service === selection?.service);
  const [other, setOther] = useState(!!selection && !known);
  const value = other ? 'other' : selection ? `${selection.date}|${selection.service}` : '';

  return (
    <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto] items-end">
      <label className="block text-sm">
        <span className="text-gray-700">Which service</span>
        <select
          value={value}
          onChange={e => {
            if (e.target.value === 'other') { setOther(true); return; }
            setOther(false);
            const [date, service] = e.target.value.split('|');
            onSelect(date ? { date, service } : null);
          }}
          className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-church-navy"
        >
          <option value="">Choose a service…</option>
          {overview.upcoming.map(u => (
            <option key={`${u.date}|${u.service}`} value={`${u.date}|${u.service}`}>
              {dayLabel(u.date, { weekday: 'short', month: 'short', day: 'numeric' })} — {u.service}
              {u.plan ? (u.plan.status === 'confirmed' ? ' (confirmed)' : ' (submitted)') : ''}
            </option>
          ))}
          <option value="other">Another date or service…</option>
        </select>
      </label>
      {other && (
        <>
          <label className="block text-sm">
            <span className="text-gray-700">Date</span>
            <DateInput value={selection?.date || ''} onChange={v => onSelect({ date: v, service: selection?.service || overview.services[0]?.name || '' })}
              className="mt-1 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </label>
          <label className="block text-sm">
            <span className="text-gray-700">Service</span>
            <select value={selection?.service || ''} onChange={e => onSelect({ date: selection?.date || '', service: e.target.value })}
              className="mt-1 border border-gray-300 rounded-lg px-3 py-2 text-sm">
              <option value="">Choose…</option>
              {overview.services.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
          </label>
        </>
      )}
    </div>
  );
}

export default function SubmitTab({ overview, selection, onSelect, onChanged }) {
  const [loaded, setLoaded]   = useState(null);
  const [leader, setLeader]   = useState('');
  const [notes, setNotes]     = useState('');
  const [items, setItems]     = useState([]);
  const [dirty, setDirty]     = useState(false);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState('');
  const [message, setMessage] = useState('');
  const [addPart, setAddPart] = useState('');
  const top = useRef(null);

  const ready = selection?.date && selection?.service;

  const load = useCallback(async () => {
    if (!ready) { setLoaded(null); return; }
    setError('');
    try {
      const data = await call(`/api/worship/plans/for?date=${encodeURIComponent(selection.date)}&service=${encodeURIComponent(selection.service)}`);
      setLoaded(data);
      const source = data.plan || data.template;
      setLeader(source.leader || data.template.leader || '');
      setNotes(data.plan?.notes || '');
      setItems(fromServer(source.items));
      setDirty(false);
    } catch (e) { setError(e.message); setLoaded(null); }
  }, [ready, selection?.date, selection?.service]);

  useEffect(() => { setMessage(''); load(); }, [load]);

  const plan = loaded?.plan;
  const editable = !!loaded && (plan ? plan.canEdit : loaded.canSubmit);
  const change = fn => { setItems(fn); setDirty(true); setMessage(''); };

  const update = (key, patch) => change(list => list.map(i => (i.key === key ? { ...i, ...patch } : i)));
  const move = (index, by) => change(list => {
    const next = [...list];
    const [it] = next.splice(index, 1);
    next.splice(index + by, 0, it);
    return next;
  });
  const remove = key => change(list => list.filter(i => i.key !== key));

  function appendPart(partId) {
    const part = overview.parts.find(p => p.id === Number(partId));
    if (!part) return;
    change(list => [...list, withKey({ partId: part.id, partName: part.name, takesSong: part.takesSong, takesPerson: part.takesPerson, detailLabel: part.detailLabel, song: null, person: '', detail: '', note: '' })]);
    setAddPart('');
  }

  // A requested song goes in the first song slot still empty, or on the end.
  function addRequested(song) {
    const empty = items.find(i => i.takesSong && !i.song);
    if (empty) { update(empty.key, { song }); return; }
    const part = overview.parts.find(p => p.name === 'Song') || overview.parts.find(p => p.takesSong);
    if (part) change(list => [...list, withKey({ partId: part.id, partName: part.name, takesSong: true, takesPerson: part.takesPerson, detailLabel: part.detailLabel, song, person: '', detail: '', note: '' })]);
  }

  async function save() {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await call('/api/worship/plans', {
        method: 'POST',
        body: JSON.stringify({
          date: selection.date, service: selection.service, leader, notes,
          items: items.map(i => ({ partId: i.partId, songId: i.song?.id ?? null, person: i.person, detail: i.detail, note: i.note })),
        }),
      });
      setMessage(result.created
        ? `Submitted. ${result.emailed ? 'The worship organizer has been emailed to confirm it.' : 'It is waiting for the worship organizer to confirm it.'}`
        : result.plan.status === 'confirmed' ? 'Saved. The song tracker has been updated.' : 'Your changes are saved.');
      await load();
      onChanged();
      return result.plan;
    } catch (e) { setError(e.message); top.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }); return null; }
    finally { setBusy(false); }
  }

  async function confirm() {
    let target = plan;
    if (dirty) target = await save();
    if (!target) return;
    setBusy(true); setError('');
    try {
      await call(`/api/worship/plans/${target.id}/confirm`, { method: 'POST' });
      setMessage('Confirmed. Its songs are now in the song tracker.');
      await load();
      onChanged();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function withdraw() {
    if (!window.confirm('Withdraw this service? It will need submitting again.')) return;
    setBusy(true); setError('');
    try {
      await call(`/api/worship/plans/${plan.id}`, { method: 'DELETE' });
      setMessage('Withdrawn.');
      await load();
      onChanged();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  const openRequests = overview.requests.filter(r => r.status === 'open' || (plan && r.plan?.id === plan.id));
  const inService = new Set(items.map(i => i.song?.id).filter(Boolean));

  return (
    <div className="space-y-4" ref={top}>
      <div className="card space-y-3">
        <OccasionPicker overview={overview} selection={selection} onSelect={onSelect} />
        {loaded && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <StatusBadge status={plan?.status} />
            {plan && <span className="text-gray-500">Submitted by {plan.submittedByName || 'the song leader'}{plan.confirmedByName ? ` · confirmed by ${plan.confirmedByName}` : ''}</span>}
          </div>
        )}
        {loaded && !editable && (
          <p className="text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2">
            {plan?.status === 'confirmed'
              ? 'This service has been confirmed. Only the worship organizer can change it now.'
              : 'Only the song leader on the Serving Schedule for this service, or whoever keeps the songs, can submit it. You can still see it here.'}
          </p>
        )}
        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        {message && <p className="text-sm text-emerald-700" role="status">{message}</p>}
      </div>

      {!ready && <div className="card text-sm text-gray-500">Choose a service to submit or look at.</div>}

      {loaded && (
        <div className="grid gap-4 lg:grid-cols-[1fr_18rem] items-start">
          <div className="card space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="text-gray-700">Song leader</span>
                <input value={leader} disabled={!editable} onChange={e => { setLeader(e.target.value); setDirty(true); }}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm disabled:bg-gray-50" />
              </label>
              <div className="text-xs text-gray-500 sm:pt-6">
                {Object.keys(loaded.template.serving || {}).length
                  ? 'Names from the Serving Schedule are filled in; change any that are wrong.'
                  : 'Nothing on the Serving Schedule for this service yet.'}
              </div>
            </div>

            <ol aria-label="Order of the service">
              {items.map((item, i) => (
                <ItemRow key={item.key} item={item} index={i} count={items.length} editable={editable}
                  onChange={patch => update(item.key, patch)} onMove={by => move(i, by)} onRemove={() => remove(item.key)} />
              ))}
            </ol>
            {items.length === 0 && <p className="text-sm text-gray-400">No parts yet. Add one below.</p>}

            {editable && (
              <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-gray-100">
                <select value={addPart} onChange={e => appendPart(e.target.value)} aria-label="Add a part"
                  className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm">
                  <option value="">+ Add a part…</option>
                  {overview.parts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <button type="button" onClick={() => { change(() => fromServer(loaded.template.items)); setLeader(loaded.template.leader || leader); }}
                  className="text-xs text-gray-500 hover:text-church-navy underline">Start again from the usual order</button>
              </div>
            )}

            <label className="block text-sm">
              <span className="text-gray-700">Notes for the worship organizer <span className="text-gray-400">(optional)</span></span>
              <textarea value={notes} disabled={!editable} onChange={e => { setNotes(e.target.value); setDirty(true); }} rows={2}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50" />
            </label>

            <div className="flex flex-wrap gap-2 pt-1">
              {editable && (
                <button onClick={save} disabled={busy || (!!plan && !dirty)} className="btn-primary text-sm disabled:opacity-50">
                  {busy ? 'Saving…' : plan ? 'Save changes' : 'Submit service'}
                </button>
              )}
              {plan && overview.canOrganize && plan.status === 'submitted' && (
                <button onClick={confirm} disabled={busy} className="btn-gold text-sm disabled:opacity-50">
                  {dirty ? 'Save and confirm' : 'Confirm'}
                </button>
              )}
              {plan && plan.status === 'submitted' && plan.canEdit && (
                <button onClick={withdraw} disabled={busy} className="px-3 py-1.5 text-sm rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50">Withdraw</button>
              )}
            </div>
          </div>

          <aside className="card space-y-2" aria-label="Requested songs">
            <h3 className="font-semibold text-church-navy text-sm">Requested songs</h3>
            {openRequests.length === 0 ? (
              <p className="text-xs text-gray-500">Nobody has asked for a song. Requests from the Song Requests tab show here.</p>
            ) : (
              <ul className="space-y-2">
                {openRequests.map(r => (
                  <li key={r.id} className="text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="font-medium text-church-navy">{r.song.title}</span>
                        <span className="block text-xs text-gray-500">
                          {r.requesterName}{r.forDate ? ` · for ${dayLabel(r.forDate, { month: 'short', day: 'numeric' })}` : ''}
                        </span>
                        {r.note && <span className="block text-xs text-gray-400 italic">{r.note}</span>}
                      </span>
                      {editable && (inService.has(r.song.id)
                        ? <span className="text-xs text-emerald-700 shrink-0">In it</span>
                        : <button type="button" onClick={() => addRequested(r.song)} className="text-xs text-church-navy underline shrink-0">Use</button>)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
