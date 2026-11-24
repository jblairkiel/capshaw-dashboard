import { useState, useEffect, useCallback } from 'react';
import WorshipPreferences from './WorshipPreferences';
import PersonPhoto from './PersonPhoto';
import { OwnPhotoEditor, FamilyPhoto, FamilyPhotoEditor } from './PhotoEditor';
import { telHref } from '../lib/phone';

// Adding somebody to the directory and removing them go through /api/records,
// which is gated on the Member Directory area rather than on being an admin.
// Editing an existing entry goes through the profile API, so the fields are
// marked as hand-edited and survive the next sync.
const API = '/api/records';
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

function PhoneLink({ number, icon, label }) {
  const href = telHref(number);
  if (!href) return <p className="text-xs text-gray-500">{icon} {number}</p>;
  return (
    <a href={href} className="text-xs text-church-navy hover:underline block" aria-label={`Call ${label} ${number}`}>
      {icon} {number}
    </a>
  );
}

function getLastName(fullName) {
  const parts = fullName.trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : parts[0];
}

// A directory row carries its photo filenames (`photo` is the family's,
// `own_photo` the person's); the photo components want the profile API's
// shape, which says only whether there is one of each. A row that already
// came back from the profile API is in that shape already.
const version = file => (file ? file.slice(0, 12) : '');
function asPerson(m) {
  if (!('photo' in m) && !('own_photo' in m)) return m;
  const { photo = '', own_photo = '', ...rest } = m;
  const face = own_photo || photo;
  return {
    ...rest,
    has_photo:        !!face,
    has_own_photo:    !!own_photo,
    has_family_photo: !!photo,
    photo_version:        version(face),
    own_photo_version:    version(own_photo),
    family_photo_version: version(photo),
  };
}

// Group flat member list into families by shared address
function groupByFamily(members) {
  const map = new Map();
  for (const m of members) {
    const addrKey = [m.address?.trim().toLowerCase(), m.zip?.trim()].filter(Boolean).join('|') || `_${m.id}`;
    if (!map.has(addrKey)) map.set(addrKey, []);
    map.get(addrKey).push(m);
  }

  const families = [];
  for (const mems of map.values()) {
    const counts = {};
    for (const m of mems) {
      const ln = getLastName(m.name);
      counts[ln] = (counts[ln] || 0) + 1;
    }
    const familyName = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || '';
    const first = mems[0];
    families.push({ familyName, address: first.address, city: first.city, state: first.state, zip: first.zip, members: mems });
  }

  return families.sort((a, b) => a.familyName.localeCompare(b.familyName));
}

// ─── Member modal (add / edit individual) ────────────────────────────────────

const PROFILE_API = '/api/profile';

function MemberModal({ member, onSave, onPhotoSaved, onClose }) {
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
  // Worship preferences live behind the profile API, so an existing member's
  // are fetched when the modal opens.
  const [person, setPerson] = useState(null);

  useEffect(() => {
    if (isNew) return;
    let cancelled = false;
    fetch(`${PROFILE_API}/person/${member.id}`, { credentials: 'include' })
      .then(r => r.json())
      .then(j => { if (!cancelled && j.success) setPerson(j.person); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isNew, member?.id]);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      // Editing goes through the profile API so the fields are marked as
      // hand-edited and the next scrape leaves them alone. Creating a brand
      // new person is still a directory-table insert.
      const url    = isNew ? `${API}/directory` : `${PROFILE_API}/person/${member.id}`;
      const method = isNew ? 'POST' : 'PATCH';
      const res    = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(form) });
      const j      = await res.json();
      if (!j.success) throw new Error(j.error || 'Save failed');
      onSave(j.row ?? j.person);
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }

  async function saveWorship(body) {
    const res = await fetch(`${PROFILE_API}/person/${member.id}/worship`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      credentials: 'include', body: JSON.stringify(body),
    });
    const j = await res.json();
    if (!j.success) throw new Error(j.error || 'Save failed');
    setPerson(j.person);
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
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {person && (
            <div className="pb-4 border-b border-gray-100">
              <OwnPhotoEditor person={person} canEdit onSaved={p => { setPerson(p); onPhotoSaved?.(p); }} />
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
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

          {person && (
            <div className="pt-4 border-t border-gray-100">
              <WorshipPreferences person={person} onSave={saveWorship} />
            </div>
          )}
        </div>
        <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-50 border border-gray-200">Cancel</button>
          <button onClick={handleSubmit} disabled={saving} className="btn-primary text-sm">{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Family card ──────────────────────────────────────────────────────────────

// ─── Family photo modal ───────────────────────────────────────────────────────

function FamilyPhotoModal({ family, onSaved, onClose }) {
  // Anybody in the household will do: the server finds the rest by address.
  const person = family.members.find(m => m.has_family_photo) ?? family.members[0];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-church-navy">{family.familyName} Family photo</h3>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="overflow-y-auto p-4">
          <FamilyPhotoEditor person={person} householdSize={family.members.length} canEdit onSaved={onSaved} />
        </div>
      </div>
    </div>
  );
}

// ─── Family card ──────────────────────────────────────────────────────────────

const CameraIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

// Without canEdit the card is for looking people up: names, photos, address,
// tap-to-call numbers and email, with no edit, remove or photo buttons.
function FamilyCard({ family, canEdit = false, onEdit, onDelete, onFamilyPhoto }) {
  const { familyName, address, city, state, zip, members } = family;
  const location = [address, city, state, zip].filter(Boolean).join(', ');
  // Everybody at an address shares the family photo, so any one of them shows it.
  const withFamilyPhoto = members.find(m => m.has_family_photo);

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md hover:border-church-gold/30 transition-all flex flex-col overflow-hidden">
      {withFamilyPhoto && (
        <FamilyPhoto person={withFamilyPhoto} className="w-full aspect-[16/9]" />
      )}

      {/* Card header */}
      <div className="px-4 py-3 border-b border-gray-50 flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-church-navy text-sm leading-snug">{familyName} Family</h3>
          {location && <p className="text-xs text-gray-400 mt-0.5 leading-tight">{location}</p>}
        </div>
        {canEdit && (
          <button
            onClick={() => onFamilyPhoto(family)}
            className="shrink-0 flex items-center gap-1 text-xs text-gray-400 hover:text-church-navy px-1.5 py-1 rounded"
            title={withFamilyPhoto ? 'Change the family photo' : 'Add a family photo'}
          >
            <CameraIcon />
            <span className="sr-only sm:not-sr-only">{withFamilyPhoto ? 'Change' : 'Add photo'}</span>
          </button>
        )}
      </div>

      {/* Member rows */}
      <div className="divide-y divide-gray-50 flex-1">
        {members.map(m => (
          <div key={m.id} className="group px-4 py-2.5 flex items-start gap-2.5">
            {/* Their own photo, or the family's when they have none. */}
            <PersonPhoto person={m} size={40} className={m.has_own_photo ? '' : 'opacity-90'} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-800 leading-snug">{m.name}</p>
              <div className="mt-0.5 space-y-0.5">
                {m.cell  && <PhoneLink number={m.cell}  icon="📱" label={`${m.name}'s cell`} />}
                {m.phone && <PhoneLink number={m.phone} icon="📞" label={`${m.name}'s home phone`} />}
                {m.email && (
                  <a href={`mailto:${m.email}`} className="text-xs text-church-navy hover:underline block truncate">
                    ✉ {m.email}
                  </a>
                )}
                {canEdit && m.notes && <p className="text-xs text-gray-400 italic">{m.notes}</p>}
              </div>
            </div>
            {canEdit && (
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5">
              <button onClick={() => onEdit(m)} className="p-1 text-gray-400 hover:text-church-navy rounded" title="Edit">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
              </button>
              <button onClick={() => onDelete(m.id)} className="p-1 text-gray-400 hover:text-red-500 rounded" title="Remove">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </button>
            </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

// Every approved member may look the directory up. Adding, editing and removing
// people, and family photos, are for whoever holds the Member Directory area
// (canEdit); the server refuses those writes to anybody else either way.
// Sync from Site runs the same capshawchurch.org refresh as the header's
// Refresh button, which only admins may start, so only admins see it.
export default function DirectoryView({ canEdit = false, canSync = false }) {
  const [allMembers, setAllMembers] = useState([]);
  const [families,   setFamilies]   = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [search,     setSearch]     = useState('');
  const [letter,     setLetter]     = useState('');
  const [modal,      setModal]      = useState(null);
  const [familyPhoto, setFamilyPhoto] = useState(null);
  const [error,      setError]      = useState('');
  const [syncing,    setSyncing]    = useState(false);
  const [syncMsg,    setSyncMsg]    = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch(`${API}/directory?limit=2000&sort=name&dir=asc`, { credentials: 'include' });
      const j   = await res.json();
      if (!j.success) throw new Error(j.error);
      setAllMembers(j.rows);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Re-group whenever data, search, or letter changes
  useEffect(() => {
    let filtered = allMembers;
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(m =>
        m.name.toLowerCase().includes(q) ||
        (m.address || '').toLowerCase().includes(q) ||
        (m.city    || '').toLowerCase().includes(q) ||
        (m.phone   || '').includes(q) ||
        (m.cell    || '').includes(q) ||
        (m.email   || '').toLowerCase().includes(q)
      );
    }
    let grouped = groupByFamily(filtered.map(asPerson));
    if (letter) grouped = grouped.filter(f => f.familyName.toUpperCase().startsWith(letter));
    setFamilies(grouped);
  }, [allMembers, search, letter]);

  function handleSearch(val) { setSearch(val); setLetter(''); }
  function handleLetter(l)   { setLetter(prev => prev === l ? '' : l); setSearch(''); }

  async function handleDelete(id) {
    if (!confirm('Remove this person from the directory?')) return;
    try {
      const res = await fetch(`${API}/directory/${id}`, { method: 'DELETE', credentials: 'include' });
      const j   = await res.json();
      if (!j.success) throw new Error(j.error);
      setAllMembers(prev => prev.filter(m => m.id !== id));
    } catch (err) { setError(err.message); }
  }

  function handleSaved(row) {
    setModal(null);
    setAllMembers(prev => {
      const idx = prev.findIndex(m => m.id === row.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = row; return next; }
      return [...prev, row];
    });
  }

  // A photo saved from the profile API comes back in its shape; merge it over
  // the directory row so the card shows it at once.
  function mergePeople(updated) {
    setAllMembers(prev => prev.map(m => {
      const u = updated.find(p => p.id === m.id);
      return u ? { ...asPerson(m), ...u } : m;
    }));
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

  const familyCount = families.length;
  const memberCount = families.reduce((n, f) => n + f.members.length, 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="section-heading mb-0">Member Directory</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {familyCount} {familyCount === 1 ? 'family' : 'families'} · {memberCount} members
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canSync && (
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
          )}
          {canEdit && (
            <button onClick={() => setModal('new')} className="btn-primary text-sm flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              Add Member
            </button>
          )}
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
      ) : families.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-sm">
            {search || letter
              ? 'No families match your search.'
              : (canSync ? 'No directory entries yet — click "Sync from Site" to import.' : 'No directory entries yet.')}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {families.map(fam => (
            <FamilyCard
              key={`${fam.familyName}|${fam.address || fam.members[0]?.id}`}
              family={fam}
              canEdit={canEdit}
              onEdit={setModal}
              onDelete={handleDelete}
              onFamilyPhoto={setFamilyPhoto}
            />
          ))}
        </div>
      )}

      {canEdit && modal !== null && (
        <MemberModal
          member={modal === 'new' ? null : modal}
          onSave={handleSaved}
          onPhotoSaved={p => mergePeople([p])}
          onClose={() => setModal(null)}
        />
      )}

      {canEdit && familyPhoto && (
        <FamilyPhotoModal
          family={familyPhoto}
          onSaved={json => {
            mergePeople(json.household);
            setFamilyPhoto(prev => prev && { ...prev, members: prev.members.map(m => ({ ...m, ...(json.household.find(p => p.id === m.id) || {}) })) });
          }}
          onClose={() => setFamilyPhoto(null)}
        />
      )}
    </div>
  );
}
