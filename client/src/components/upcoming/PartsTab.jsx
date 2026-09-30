import { useState, useEffect, useCallback } from 'react';
import { call } from './api';

// ─── Service Parts ────────────────────────────────────────────────────────────
//
// The worship organizer's list of what a service can be made of, and the
// usual order of them — one order for every service, and any service that
// runs differently (Wednesday, say) can have its own. A new submission starts
// from that order.

// The Serving Schedule's jobs, so a part can say which one already names who
// does it.
const SERVING_JOBS = ['Song Leader', 'Opening Prayer', 'Scripture Reading', 'Communion', 'Closing Prayer', 'Usher'];

const BLANK = { name: '', takesSong: false, takesPerson: true, detailLabel: '', servingJob: '' };

function PartForm({ part, onSave, saveLabel, onCancel }) {
  const [f, setF] = useState(part);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = patch => setF(v => ({ ...v, ...patch }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try { await onSave(f); if (!part.id) setF(BLANK); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  const changed = JSON.stringify(f) !== JSON.stringify(part);
  return (
    <form onSubmit={submit} className="grid gap-2 lg:grid-cols-[1fr_auto] items-center py-3 border-t border-gray-100 first:border-t-0">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,12rem)_auto_minmax(0,12rem)_minmax(0,13rem)] sm:justify-start items-center">
        <input value={f.name} onChange={e => set({ name: e.target.value })} placeholder="Name" aria-label="Part name"
          className={`border border-gray-300 rounded-lg px-2 py-1.5 text-sm ${part.id && !part.active ? 'text-gray-400' : ''}`} />
        <div className="flex gap-3 text-sm">
          <label className="flex items-center gap-1"><input type="checkbox" checked={f.takesSong} onChange={e => set({ takesSong: e.target.checked })} /> Song</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={f.takesPerson} onChange={e => set({ takesPerson: e.target.checked })} /> Person</label>
        </div>
        <input value={f.detailLabel} onChange={e => set({ detailLabel: e.target.value })} placeholder="Detail (e.g. Title)" aria-label="Detail label"
          className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
        <select value={f.servingJob} onChange={e => set({ servingJob: e.target.value })} aria-label="Filled from the Serving Schedule job"
          className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm">
          <option value="">No schedule job</option>
          {SERVING_JOBS.map(j => <option key={j} value={j}>{j}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <button type="submit" disabled={busy || !changed || !f.name.trim()} className="btn-primary text-xs py-1.5 px-3 disabled:opacity-40">{saveLabel}</button>
        {onCancel}
      </div>
      {error && <p className="text-xs text-red-600 lg:col-span-2">{error}</p>}
    </form>
  );
}

function OrderEditor({ parts, outlines, onSaved }) {
  const [target, setTarget] = useState('default');
  const service = outlines.services.find(s => String(s.id) === target);
  const current = target === 'default' ? outlines.default : service?.partIds || [];
  const [order, setOrder] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [add, setAdd] = useState('');

  useEffect(() => { setOrder(target === 'default' ? outlines.default : outlines.services.find(s => String(s.id) === target)?.partIds || []); }, [target, outlines]);

  const names = new Map(parts.map(p => [p.id, p]));
  const move = (i, by) => setOrder(o => { const n = [...o]; const [x] = n.splice(i, 1); n.splice(i + by, 0, x); return n; });

  async function save(partIds) {
    setBusy(true); setError('');
    try {
      await call(`/api/worship/outlines/${target}`, { method: 'PUT', body: JSON.stringify({ partIds }) });
      onSaved();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  const changed = JSON.stringify(order) !== JSON.stringify(current);
  return (
    <section className="card space-y-3 max-w-2xl" aria-label="Usual order">
      <div>
        <h3 className="font-semibold text-church-navy">The usual order</h3>
        <p className="text-xs text-gray-500 mt-0.5">What a new submission starts from. The song leader can still add, move or take out parts.</p>
      </div>
      <select value={target} onChange={e => setTarget(e.target.value)} aria-label="Which service's order"
        className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full sm:w-auto">
        <option value="default">Every service (unless it has its own)</option>
        {outlines.services.map(s => <option key={s.id} value={s.id}>{s.name}{s.own ? ' — its own order' : ''}</option>)}
      </select>
      {service && !service.own && (
        <p className="text-xs text-gray-500">{service.name} uses the order for every service. Change it below to give it its own.</p>
      )}
      <ol className="space-y-1">
        {order.map((id, i) => (
          <li key={`${id}-${i}`} className="flex items-center gap-2 text-sm">
            <span className="w-5 text-xs text-church-gold font-bold">{i + 1}.</span>
            <span className={`flex-1 ${names.get(id)?.active === false ? 'text-gray-400 line-through' : 'text-church-navy'}`}>{names.get(id)?.name || 'A removed part'}</span>
            <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${names.get(id)?.name} ${i + 1} up`} className="w-7 h-7 rounded text-gray-400 hover:text-church-navy disabled:opacity-30">↑</button>
            <button type="button" onClick={() => move(i, 1)} disabled={i === order.length - 1} aria-label={`Move ${names.get(id)?.name} ${i + 1} down`} className="w-7 h-7 rounded text-gray-400 hover:text-church-navy disabled:opacity-30">↓</button>
            <button type="button" onClick={() => setOrder(o => o.filter((_, j) => j !== i))} aria-label={`Remove ${names.get(id)?.name} ${i + 1}`} className="w-7 h-7 rounded text-gray-400 hover:text-red-600">×</button>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-gray-100">
        <select value={add} onChange={e => { if (e.target.value) setOrder(o => [...o, Number(e.target.value)]); setAdd(''); }} aria-label="Add a part to the order"
          className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm">
          <option value="">+ Add a part…</option>
          {parts.filter(p => p.active).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button onClick={() => save(order)} disabled={busy || !changed || !order.length} className="btn-primary text-sm py-1.5 disabled:opacity-40">Save order</button>
        {service?.own && (
          <button onClick={() => save(null)} disabled={busy} className="text-xs text-gray-500 underline">Use the order for every service instead</button>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  );
}

export default function PartsTab({ onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try { setData(await call('/api/worship/parts')); setError(''); }
    catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const changed = () => { load(); onChanged(); };

  async function savePart(part) {
    const body = JSON.stringify({ name: part.name, takesSong: part.takesSong, takesPerson: part.takesPerson, detailLabel: part.detailLabel, servingJob: part.servingJob });
    if (part.id) await call(`/api/worship/parts/${part.id}`, { method: 'PUT', body });
    else await call('/api/worship/parts', { method: 'POST', body });
    changed();
  }

  async function setActive(part, active) {
    try { await call(`/api/worship/parts/${part.id}`, { method: 'PUT', body: JSON.stringify({ active }) }); changed(); }
    catch (e) { setError(e.message); }
  }

  if (!data) return <div className="card text-sm text-gray-500">{error || 'Loading…'}</div>;

  return (
    <div className="space-y-4">
      <section className="card" aria-label="Service parts">
        <h3 className="font-semibold text-church-navy">Service parts</h3>
        <p className="text-xs text-gray-500 mt-0.5 mb-2">
          What each part asks for. “Schedule job” fills the person from the Serving Schedule. A retired part stays on past services but is not offered.
        </p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {data.parts.map(p => (
          <PartForm key={`${p.id}-${p.name}-${p.active}`} part={p} saveLabel="Save" onSave={savePart}
            onCancel={<button type="button" onClick={() => setActive(p, !p.active)} className="text-xs text-gray-500 underline whitespace-nowrap">{p.active ? 'Retire' : 'Bring back'}</button>} />
        ))}
        <div className="mt-2 pt-2 border-t-2 border-gray-100">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Add a part</p>
          <PartForm part={BLANK} saveLabel="Add" onSave={savePart} />
        </div>
      </section>
      <OrderEditor parts={data.parts} outlines={data.outlines} onSaved={changed} />
    </div>
  );
}
