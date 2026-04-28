import { useState, useEffect, useCallback, useRef } from 'react';

const API = '/api/admin';
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

function MemberModal({ member, onSave, onClose }) {
  const isNew = !member?.id;
  const FIELDS = [
    { key: 'name',    label: 'Name',         placeholder: 'Last, First' },
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
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
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

function MemberCard({ member, onEdit, onDelete }) {
  return (
    <div className="group bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md hover:border-church-gold/30 transition-all p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-church-navy text-sm leading-snug">{member.name}</h3>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button onClick={() => onEdit(member)} className="p-1 text-gray-400 hover:text-church-navy rounded" title="Edit">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
          </button>
          <button onClick={() => onDelete(member.id)} className="p-1 text-gray-400 hover:text-red-500 rounded" title="Delete">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
          </button>
        </div>
      </div>
      <div className="space-y-1 text-xs text-gray-600">
        {(member.address || member.city) && (
          <p className="text-gray-500">
            {[member.address, member.city, member.state, member.zip].filter(Boolean).join(', ')}
          </p>
        )}
        {member.phone && <p>📞 {member.phone}</p>}
        {member.cell  && <p>📱 {member.cell}</p>}
        {member.email && <a href={`mailto:${member.email}`} className="text-church-navy hover:underline block truncate">✉ {member.email}</a>}
        {member.notes && <p className="text-gray-400 italic">{member.notes}</p>}
      </div>
    </div>
  );
}

export default function DirectoryView() {
  const [members,  setMembers]  = useState([]);
  const [total,    setTotal]    = useState(0);
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState('');
  const [letter,   setLetter]   = useState('');
  const [modal,    setModal]    = useState(null);
  const [error,    setError]    = useState('');
  const [syncing,  setSyncing]  = useState(false);
  const [syncMsg,  setSyncMsg]  = useState('');
  const [offset,   setOffset]   = useState(0);
  const LIMIT = 60;
  const searchTimer = useRef(null);

  const load = useCallback(async (off, q, l) => {
    setLoading(true); setError('');
    try {
      const p = new URLSearchParams({ limit: LIMIT, offset: off, sort: 'name', dir: 'asc' });
      if (q) p.set('f_name', q);
      if (l) p.set('f_name', l);
      const res = await fetch(`${API}/directory?${p}`, { credentials: 'include' });
      const j   = await res.json();
      if (!j.success) throw new Error(j.error);
      setMembers(j.rows);
      setTotal(j.total);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(0, '', ''); }, [load]);

  function handleSearch(val) {
    setSearch(val); setLetter(''); setOffset(0);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => load(0, val, ''), 300);
  }

  function handleLetter(l) {
    const next = letter === l ? '' : l;
    setLetter(next); setSearch(''); setOffset(0);
    load(0, next ? next : '', '');
  }

  async function handleDelete(id) {
    if (!confirm('Remove this member from the directory?')) return;
    try {
      const res = await fetch(`${API}/directory/${id}`, { method: 'DELETE', credentials: 'include' });
      const j   = await res.json();
      if (!j.success) throw new Error(j.error);
      load(offset, search, letter);
    } catch (err) { setError(err.message); }
  }

  function handleSaved(row) {
    setModal(null);
    load(offset, search, letter);
  }

  async function handleSync() {
    setSyncing(true); setSyncMsg('');
    try {
      const res = await fetch('/api/members/update', { method: 'POST', credentials: 'include' });
      const j   = await res.json();
      if (!j.success) throw new Error(j.error || 'Scrape failed');
      setSyncMsg('Scrape complete — reloading directory…');
      load(0, '', '');
      setSearch(''); setLetter(''); setOffset(0);
    } catch (err) { setSyncMsg('Scrape failed: ' + err.message); }
    finally { setSyncing(false); }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="section-heading mb-0">Congregation Directory</h2>
          <p className="text-xs text-gray-400 mt-0.5">{total.toLocaleString()} members</p>
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
            {syncing ? 'Scraping…' : 'Sync from Site'}
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

      {/* Search */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <input
          type="text"
          placeholder="Search by name, phone, or email…"
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
            <button onClick={() => { setSearch(''); setLetter(''); setOffset(0); load(0,'',''); }} className="px-2 h-7 text-xs text-amber-600 hover:text-amber-800 ml-1">Clear</button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-church-gold" />
        </div>
      ) : members.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-sm">{search || letter ? 'No members match your search.' : 'No directory entries yet — click “Sync from Site” to import.'}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {members.map(m => (
            <MemberCard key={m.id} member={m} onEdit={setModal} onDelete={handleDelete} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {total > LIMIT && (
        <div className="flex items-center justify-between text-sm text-gray-500 pt-2">
          <span>{offset + 1}–{Math.min(offset + LIMIT, total)} of {total.toLocaleString()}</span>
          <div className="flex gap-1">
            <button disabled={offset === 0} onClick={() => { const o = Math.max(0, offset - LIMIT); setOffset(o); load(o, search, letter); }} className="px-3 py-1 rounded border border-gray-200 disabled:opacity-40 hover:border-church-gold">Prev</button>
            <button disabled={offset + LIMIT >= total} onClick={() => { const o = offset + LIMIT; setOffset(o); load(o, search, letter); }} className="px-3 py-1 rounded border border-gray-200 disabled:opacity-40 hover:border-church-gold">Next</button>
          </div>
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
