import { useState, useEffect, useRef } from 'react';
import { call, songLabel, STATUS, serviceLink } from './api';

// ─── What every tab of the Upcoming Service page shares ───────────────────────
//
// One way to call the server, one way to write a date and a song, one song
// picker and one "add a song" dialog — so a song added from the request form
// is the same song the submission form offers a minute later.

export function StatusBadge({ status }) {
  const s = STATUS[status || 'none'];
  return <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${s.tone}`}>{s.label}</span>;
}

// ─── A service's direct link ──────────────────────────────────────────────────
//
// Copies the link that opens this one service on Submit a Service, to text or
// email to a song leader. Where the browser will not let the page write to the
// clipboard (an older phone, a page not served over https), the link is shown
// instead, ready to be selected and copied by hand.

export function CopyLinkButton({ date, service, url: given = '', className = '' }) {
  const [state, setState] = useState('');   // '' | 'copied' | 'shown'
  const url = given || serviceLink(date, service);

  useEffect(() => {
    if (state !== 'copied') return undefined;
    const t = setTimeout(() => setState(''), 2500);
    return () => clearTimeout(t);
  }, [state]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setState('copied');
    } catch {
      setState('shown');
    }
  }

  return (
    <span className={`inline-flex flex-wrap items-center gap-2 ${className}`}>
      <button type="button" onClick={copy} aria-label={`Copy the link to ${service}, ${date}`}
        className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 text-gray-700 hover:border-church-navy hover:text-church-navy">
        {state === 'copied' ? 'Link copied' : 'Copy link'}
      </button>
      {state === 'shown' && (
        <input readOnly value={url} aria-label="Link to this service" onFocus={e => e.target.select()} autoFocus
          className="min-w-0 w-72 max-w-full border border-gray-300 rounded-lg px-2 py-1 text-xs text-gray-700" />
      )}
    </span>
  );
}

// ─── Adding a song ────────────────────────────────────────────────────────────

export function AddSongDialog({ initialTitle = '', onClose, onAdded }) {
  const [title, setTitle]   = useState(initialTitle);
  const [hymnal, setHymnal] = useState('');
  const [number, setNumber] = useState('');
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState('');

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function save(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const { song, existing } = await call('/api/songs/library', { method: 'POST', body: JSON.stringify({ title, hymnal, number }) });
      onAdded(song, { existing });
    } catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <form
        role="dialog"
        aria-label="Add a song"
        onSubmit={save}
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-3"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-church-navy">Add a song</h3>
            <p className="text-xs text-gray-500 mt-0.5">It can be chosen everywhere on this page straight away.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-church-navy text-xl leading-none">×</button>
        </div>
        <label className="block text-sm">
          <span className="text-gray-700">Title</span>
          <input autoFocus value={title} onChange={e => setTitle(e.target.value)} required
            className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-church-navy" />
        </label>
        <div className="grid grid-cols-[1fr_7rem] gap-2">
          <label className="block text-sm">
            <span className="text-gray-700">Hymnal <span className="text-gray-400">(optional)</span></span>
            <input value={hymnal} onChange={e => setHymnal(e.target.value)} placeholder="Songs of Faith and Praise"
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-church-navy" />
          </label>
          <label className="block text-sm">
            <span className="text-gray-700">Number</span>
            <input value={number} onChange={e => setNumber(e.target.value)} inputMode="numeric"
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-church-navy" />
          </label>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 text-gray-600">Cancel</button>
          <button type="submit" disabled={busy || !title.trim()} className="btn-primary text-sm py-1.5 disabled:opacity-50">
            {busy ? 'Adding…' : 'Add song'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Choosing a song ──────────────────────────────────────────────────────────
//
// Type to search the library. The last choice is always "Add … as a new song",
// so a song nobody has entered yet is one step away, not a dead end.

export function SongPicker({ value, onChange, label = 'Song', placeholder = 'Search by title or number…' }) {
  const [query, setQuery]     = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen]       = useState(false);
  const [adding, setAdding]   = useState(null);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  function search(q) {
    setQuery(q);
    clearTimeout(timer.current);
    if (!q.trim()) { setResults([]); setOpen(false); return; }
    timer.current = setTimeout(async () => {
      try {
        const { results: found } = await call(`/api/songs/search?q=${encodeURIComponent(q.trim())}`);
        setResults(found); setOpen(true);
      } catch { setResults([]); setOpen(true); }
    }, 200);
  }

  function pick(song) {
    onChange(song);
    setQuery(''); setResults([]); setOpen(false);
  }

  if (value) {
    return (
      <div className="flex items-center gap-2 min-w-0">
        <span className="flex-1 min-w-0 truncate text-sm text-church-navy font-medium" title={songLabel(value)}>
          {value.title}
          {value.number && <span className="ml-1.5 text-xs text-gray-400 font-normal">{[value.hymnal, value.number].filter(Boolean).join(' ')}</span>}
        </span>
        <button type="button" onClick={() => onChange(null)} className="text-xs text-gray-400 hover:text-church-navy underline shrink-0">change</button>
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        aria-label={label}
        onChange={e => search(e.target.value)}
        onFocus={() => query.trim() && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-church-navy"
      />
      {open && (
        <ul role="listbox" className="absolute z-30 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {results.map(s => (
            <li key={s.id}>
              <button type="button" role="option" aria-selected="false" onMouseDown={() => pick(s)} className="w-full text-left px-3 py-2 text-sm hover:bg-church-cream">
                <span className="font-medium text-church-navy">{s.title}</span>
                {(s.number || s.hymnal) && <span className="ml-2 text-gray-400 text-xs">{[s.hymnal, s.number].filter(Boolean).join(' ')}</span>}
                {s.timesSung > 0 && <span className="ml-2 text-gray-300 text-xs">sung {s.timesSung}×</span>}
              </button>
            </li>
          ))}
          <li className="border-t border-gray-100">
            <button type="button" onMouseDown={() => setAdding(query.trim())} className="w-full text-left px-3 py-2 text-sm text-church-navy hover:bg-church-cream">
              + Add “{query.trim()}” as a new song
            </button>
          </li>
        </ul>
      )}
      {adding !== null && (
        <AddSongDialog
          initialTitle={adding}
          onClose={() => setAdding(null)}
          onAdded={song => { setAdding(null); pick(song); }}
        />
      )}
    </div>
  );
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <div role="tablist" aria-label="Upcoming Service" className="flex gap-1 overflow-x-auto scrollbar-hide border-b border-gray-200 -mx-3 px-3 sm:mx-0 sm:px-0">
      {tabs.map(t => (
        <button
          key={t.id}
          role="tab"
          aria-selected={active === t.id}
          onClick={() => onChange(t.id)}
          className={`shrink-0 px-3 sm:px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
            active === t.id ? 'border-church-gold text-church-navy' : 'border-transparent text-gray-500 hover:text-church-navy'
          }`}
        >
          {t.label}
          {t.count > 0 && <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full bg-church-cream text-church-navy">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
