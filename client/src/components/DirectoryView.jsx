import { useState, useEffect, useCallback, useRef } from 'react';

const API = '/api/admin';
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

// Initials shown when a family has no scraped photo.
function familyInitials(name) {
  return (name || '?')
    .split(',')[0]
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0])
    .join('')
    .toUpperCase();
}

// ─── Member modal (add / edit individual) ────────────────────────────────────

function MemberModal({ member, onSave, onClose }) {
  const isNew = !member?.id;
  const FIELDS = [
    { key: 'name',    label: 'Name',         placeholder: 'First Last' },
    { key: 'address', label: 'Address',       placeholder: '123 Main St' },
    { key: 'city',    label: 'City',          placeholder: 'Harvest' },
    { key: 'state',   label: 'State',         placeholder: 'AL' },
    { key: 'zip',     label: 'Zip',           placeholder: '35749' },
    { key: 'phone',   label: 'Home Phone',    placeholder: '(256) 555-0100' },
    { key: 'cell',    label: 'Cell Phone',    placeholder: '(256) 555-0101' },
    { key: 'email',   label: 'Email',         placeholder: 'name@example.com' },
    { key: 'notes',   label: 'Notes',         placeholder: '' },
  ];
  const [form, setForm] = useState(() => {
    const init = {};
    for (const f of FIELDS) init[f.key] = member?.[f.key] ?? '';
    return init;
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const url    = isNew ? `${API}/directory` : `${API}/directory/${member.id}`;
      const method = isNew ? 'POST' : 'PATCH';
      const res    = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(form) });
      const j      = await res.json();
      if (!j.success) throw new Error(j.error || 'Save failed');
      onSave(j.row);
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-church-navy">{isNew ? 'Add Member' : 'Edit Member'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {FIELDS.map(f => (
            <label key={f.key} className="block">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{f.label}</span>
              <input
                type="text"
                className="mt-1 block w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold"
                value={form[f.key]}
                placeholder={f.placeholder}
                onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
              />
            </label>
          ))}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>
        <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-50 border border-gray-200">Cancel</button>
          <button onClick={handleSubmit} disabled={saving} className="btn-primary text-sm">{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Family card ──────────────────────────────────────────────────────────────

function FamilyCard({ family, onEdit, onDelete }) {
  const { name, address, city, state, zip, photoUrl, members } = family;
  const location = [address, city, state, zip].filter(Boolean).join(', ');
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md hover:border-church-gold/30 transition-all flex flex-col">
      {/* Card header */}
      <div className="px-4 py-3 border-b border-gray-50 flex items-center gap-3">
        {photoUrl && !imgFailed ? (
          <img
            src={photoUrl}
            alt=""
            loading="lazy"
            onError={() => setImgFailed(true)}
            className="w-14 h-14 rounded-lg object-cover bg-gray-100 shrink-0"
          />
        ) : (
          <div className="w-14 h-14 rounded-lg bg-church-navy/5 text-church-navy/40 flex items-center justify-center text-sm font-semibold shrink-0">
            {familyInitials(name)}
          </div>
        )}
        <div className="min-w-0">
          <h3 className="font-semibold text-church-navy text-sm leading-snug">{name}</h3>
          {location && <p className="text-xs text-gray-400 mt-0.5 leading-tight">{location}</p>}
        </div>
      </div>

      {/* Member rows */}
      <div className="divide-y divide-gray-50 flex-1">
        {members.map(m => (
          <div key={m.id} className="group px-4 py-2.5 flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-800 leading-snug">{m.name}</p>
              <div className="mt-0.5 space-y-0.5">
                {m.cell  && <p className="text-xs text-gray-500">📱 {m.cell}</p>}
                {m.phone && <p className="text-xs text-gray-500">📞 {m.phone}</p>}
                {m.email && (
                  <a href={`mailto:${m.email}`} className="text-xs text-church-navy hover:underline block truncate">
                    ✉ {m.email}
                  </a>
                )}
                {m.notes && <p className="text-xs text-gray-400 italic">{m.notes}</p>}
              </div>
            </div>
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5">
              <button onClick={() => onEdit(m)} className="p-1 text-gray-400 hover:text-church-navy rounded" title="Edit">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
              </button>
              <button onClick={() => onDelete(m.id)} className="p-1 text-gray-400 hover:text-red-500 rounded" title="Remove">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

export default function DirectoryView() {
  const [allFamilies, setAllFamilies] = useState([]);
  const [families,    setFamilies]    = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [search,     setSearch]     = useState('');
  const [letter,     setLetter]     = useState('');
  const [modal,      setModal]      = useState(null);
  const [error,      setError]      = useState('');
  const [syncing,    setSyncing]    = useState(false);
  const [syncMsg,    setSyncMsg]    = useState('');

  // Families come pre-grouped from the server, matching how the church site
  // groups them, with each family's scraped photo.
  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/directory-families`, { credentials: 'include' });
      const j   = await res.json();
      if (!j.success) throw new Error(j.error);
      setAllFamilies(j.families);
    } catch (err) { setError(err.message); }
    finally { if (!quiet) setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Re-filter whenever data, search, or letter changes. A family matches if its
  // own name/address matches, or any of its members do — but only the matching
  // members are shown when the search hit a person.
  useEffect(() => {
    let result = allFamilies;

    if (search) {
      const q = search.toLowerCase();
      const memberHit = m =>
        m.name.toLowerCase().includes(q) ||
        (m.address || '').toLowerCase().includes(q) ||
        (m.city    || '').toLowerCase().includes(q) ||
        (m.phone   || '').includes(q) ||
        (m.cell    || '').includes(q) ||
        (m.email   || '').toLowerCase().includes(q);

      result = result.reduce((acc, f) => {
        const familyHit = f.name.toLowerCase().includes(q) ||
                          [f.address, f.city, f.zip].some(v => (v || '').toLowerCase().includes(q));
        if (familyHit) { acc.push(f); return acc; }
        const hits = f.members.filter(memberHit);
        if (hits.length) acc.push({ ...f, members: hits });
        return acc;
      }, []);
    }

    // Family names are stored surname-first ("Allen, Josh & Tylan"), so the
    // first character is the surname initial.
    if (letter) result = result.filter(f => f.name.toUpperCase().startsWith(letter));

    setFamilies(result);
  }, [allFamilies, search, letter]);

  function handleSearch(val) { setSearch(val); setLetter(''); }
  function handleLetter(l)   { setLetter(prev => prev === l ? '' : l); setSearch(''); }

  async function handleDelete(id) {
    if (!confirm('Remove this person from the directory?')) return;
    try {
      const res = await fetch(`${API}/directory/${id}`, { method: 'DELETE', credentials: 'include' });
      const j   = await res.json();
      if (!j.success) throw new Error(j.error);
      setAllFamilies(prev => prev.map(f => ({ ...f, members: f.members.filter(m => m.id !== id) })));
    } catch (err) { setError(err.message); }
  }

  function handleSaved(row) {
    setModal(null);
    const known = allFamilies.some(f => f.members.some(m => m.id === row.id));
    // A new member has no family yet, so refetch to place it in the right bucket.
    if (!known) return void load({ quiet: true });
    setAllFamilies(prev => prev.map(f => ({
      ...f,
      members: f.members.map(m => (m.id === row.id ? { ...m, ...row } : m)),
    })));
  }

  async function handleSync() {
    setSyncing(true); setSyncMsg('');
    try {
      const res = await fetch('/api/members/update', { method: 'POST', credentials: 'include' });
      const j   = await res.json();
      if (!j.success) throw new Error(j.error || 'Sync failed');
      setSyncMsg('Sync complete');
      await load();
      setSearch(''); setLetter('');
    } catch (err) { setSyncMsg('Sync failed: ' + err.message); }
    finally { setSyncing(false); }
  }

  const visible     = families.filter(f => f.members.length > 0);
  const familyCount = visible.length;
  const memberCount = visible.reduce((n, f) => n + f.members.length, 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="section-heading mb-0">Congregation Directory</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {familyCount} {familyCount === 1 ? 'family' : 'families'} · {memberCount} members
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSync}
            disabled={syncing}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${syncing ? 'border-gray-300 text-gray-400 cursor-not-allowed' : 'border-church-gold text-church-gold hover:bg-church-gold hover:text-church-navy'}`}
          >
            {syncing
              ? <span className="animate-spin w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full inline-block" />
              : <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            }
            {syncing ? 'Syncing…' : 'Sync from Site'}
          </button>
          <button onClick={() => setModal('new')} className="btn-primary text-sm flex items-center gap-1.5">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            Add Member
          </button>
        </div>
      </div>

      {syncMsg && (
        <p className={`text-sm ${syncMsg.includes('failed') ? 'text-red-600' : 'text-emerald-600'}`}>{syncMsg}</p>
      )}

      {/* Search + Alphabet */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <input
          type="text"
          placeholder="Search name, address, phone, or email…"
          value={search}
          onChange={e => handleSearch(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-church-navy w-full sm:w-72"
        />
        <div className="flex flex-wrap gap-0.5">
          {ALPHABET.map(l => (
            <button
              key={l}
              onClick={() => handleLetter(l)}
              className={`w-7 h-7 text-xs rounded font-medium transition-colors ${letter === l ? 'bg-church-navy text-church-gold' : 'text-gray-500 hover:bg-gray-100'}`}
            >
              {l}
            </button>
          ))}
          {(search || letter) && (
            <button
              onClick={() => { setSearch(''); setLetter(''); }}
              className="px-2 h-7 text-xs text-amber-600 hover:text-amber-800 ml-1"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* Family grid */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-church-gold" />
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-sm">
            {search || letter
              ? 'No families match your search.'
              : 'No directory entries yet — click "Sync from Site" to import.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {visible.map(fam => (
            <FamilyCard
              key={fam.id ?? 'unassigned'}
              family={fam}
              onEdit={setModal}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {modal !== null && (
        <MemberModal
          member={modal === 'new' ? null : modal}
          onSave={handleSaved}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
