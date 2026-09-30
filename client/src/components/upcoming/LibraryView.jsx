import { useState, useEffect, useCallback } from 'react';
import { call } from './api';

// ─── The song library ─────────────────────────────────────────────────────────
//
// Every song anybody can pick, with how often it has been sung. Whoever keeps
// the songs can correct one, or merge a duplicate into the song it repeats.

function LibraryRow({ song, canManage, songs, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState(song);
  const [mergeInto, setMergeInto] = useState('');
  const [error, setError] = useState('');

  async function send(url, method, body) {
    setError('');
    try { await call(url, { method, body: JSON.stringify(body) }); onChanged(); return true; }
    catch (e) { setError(e.message); return false; }
  }

  async function save(e) {
    e.preventDefault();
    if (await send(`/api/songs/library/${song.id}`, 'PUT', { title: f.title, hymnal: f.hymnal, number: f.number })) setEditing(false);
  }

  async function merge() {
    const into = songs.find(s => String(s.id) === mergeInto);
    if (!into || !window.confirm(`Merge "${song.title}" into "${into.title}"? Every service and request with it will have "${into.title}" instead.`)) return;
    await send(`/api/songs/library/${song.id}/merge`, 'POST', { into: into.id });
  }

  if (editing) {
    return (
      <li className="py-2 border-t border-gray-100 first:border-t-0">
        <form onSubmit={save} className="grid gap-2 sm:grid-cols-[1fr_10rem_5rem_auto] items-center">
          <input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} aria-label="Title" className="border border-gray-300 rounded-lg px-2 py-1 text-sm" />
          <input value={f.hymnal} onChange={e => setF({ ...f, hymnal: e.target.value })} aria-label="Hymnal" placeholder="Hymnal" className="border border-gray-300 rounded-lg px-2 py-1 text-sm" />
          <input value={f.number} onChange={e => setF({ ...f, number: e.target.value })} aria-label="Number" placeholder="No." className="border border-gray-300 rounded-lg px-2 py-1 text-sm" />
          <div className="flex gap-2">
            <button type="submit" className="btn-primary text-xs py-1 px-2.5">Save</button>
            <button type="button" onClick={() => { setEditing(false); setF(song); }} className="text-xs text-gray-500 underline">Cancel</button>
          </div>
        </form>
        <div className="flex flex-wrap items-center gap-2 mt-2 text-xs">
          <span className="text-gray-500">A duplicate of</span>
          <select value={mergeInto} onChange={e => setMergeInto(e.target.value)} aria-label="Merge into" className="border border-gray-300 rounded px-1.5 py-1 text-xs max-w-[14rem]">
            <option value="">choose the song it repeats…</option>
            {songs.filter(s => s.id !== song.id).map(s => <option key={s.id} value={s.id}>{s.title}{s.number ? ` (${s.number})` : ''}</option>)}
          </select>
          <button type="button" onClick={merge} disabled={!mergeInto} className="text-xs text-red-600 underline disabled:opacity-40">Merge</button>
        </div>
        {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
      </li>
    );
  }

  return (
    <li className="py-2 border-t border-gray-100 first:border-t-0 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-church-navy">{song.title}</span>
        {(song.number || song.hymnal) && <span className="ml-2 text-xs text-gray-400">{[song.hymnal, song.number].filter(Boolean).join(' ')}</span>}
        {song.source === 'portal' && <span className="ml-2 text-[10px] uppercase tracking-wide text-church-gold">added here</span>}
      </div>
      <span className="text-xs text-gray-400 shrink-0">{song.timesSung ? `sung ${song.timesSung}×` : 'not sung yet'}</span>
      {canManage && <button onClick={() => setEditing(true)} className="text-xs text-gray-500 underline shrink-0">Edit</button>}
    </li>
  );
}

export default function LibraryView({ version = 0 }) {
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    try { setData(await call(`/api/songs/library?q=${encodeURIComponent(q.trim())}&limit=200`)); }
    catch { /* the list stays as it was */ }
  }, [q]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load, version]);

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
        <p className="text-sm text-gray-500">{data ? `${data.songs.length}${data.songs.length === 200 ? '+' : ''} songs` : 'Loading…'}</p>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search the library…" aria-label="Search the library"
          className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg w-44 sm:w-56 focus:outline-none focus:ring-2 focus:ring-church-navy" />
      </div>
      {data && (
        <ul>
          {data.songs.map(s => <LibraryRow key={`${s.id}-${s.title}-${s.hymnal}-${s.number}`} song={s} canManage={data.canManage} songs={data.songs} onChanged={load} />)}
        </ul>
      )}
    </div>
  );
}
