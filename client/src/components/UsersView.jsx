import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { ROLES, roleInfo } from '../lib/roles';
import { useCookieState } from '../lib/cookies';

// Remembers which columns the admin chose to see, so the grid comes back the
// way they left it on their next visit.
const COLUMN_COOKIE = 'capshaw.users.columns';

const PROVIDERS = [
  { value: 'google',   label: 'Google'   },
  { value: 'facebook', label: 'Facebook' },
];

function formatDate(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString();
}

function formatDateTime(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
}

function Dash() {
  return <span className="text-gray-300">—</span>;
}

// ─── Small presentational pieces ──────────────────────────────────────────────

function ProviderBadge({ provider }) {
  if (provider === 'google') {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
        <svg className="w-3 h-3" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        Google
      </span>
    );
  }
  if (provider === 'facebook') {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="#1877F2">
          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
        </svg>
        Facebook
      </span>
    );
  }
  return <Dash />;
}

function Avatar({ user, size = 36 }) {
  const [imgError, setImgError] = useState(false);

  if (user.photo && !imgError) {
    return (
      <img
        src={user.photo}
        alt=""
        style={{ width: size, height: size }}
        className="rounded-full object-cover shrink-0"
        onError={() => setImgError(true)}
      />
    );
  }
  return (
    <div
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      className="rounded-full bg-church-navy text-church-gold font-semibold flex items-center justify-center shrink-0"
    >
      {user.name?.[0]?.toUpperCase() || '?'}
    </div>
  );
}

function RoleBadge({ role }) {
  const info = roleInfo(role);
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${info.tone}`}>
      {info.badge}
    </span>
  );
}

function SortIcon({ active, dir }) {
  if (!active) return (
    <svg className="w-3 h-3 opacity-30 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
    </svg>
  );
  return (
    <svg className="w-3 h-3 text-church-gold shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d={dir === 'asc' ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7'} />
    </svg>
  );
}

// ─── Column definitions ───────────────────────────────────────────────────────
//
// `text` is what a column is filtered and sorted on; `render` is what it looks
// like. Keeping the two apart means a badge or an avatar still filters on the
// plain words behind it.

const COLUMNS = [
  {
    key:      'name',
    label:    'Name',
    required: true,                       // always on — it is how a row is identified
    filter:   { type: 'text' },
    text:     u => u.name || '',
    render:   (u, { currentUserId }) => (
      <div className="flex items-center gap-2 min-w-0">
        <Avatar user={u} size={32} />
        <span className="font-medium text-church-navy truncate">{u.name}</span>
        {u.is_owner && <span className="text-xs text-gray-400 shrink-0">(owner)</span>}
        {u.id === currentUserId && <span className="text-xs text-gray-400 shrink-0">(you)</span>}
      </div>
    ),
  },
  {
    key:    'email',
    label:  'Email',
    filter: { type: 'text' },
    text:   u => u.email || '',
    render: u => u.email ? <span className="text-gray-600">{u.email}</span> : <Dash />,
  },
  {
    key:    'role',
    label:  'Role',
    filter: { type: 'select', options: ROLES.map(r => ({ value: r.id, label: r.label })) },
    text:   u => u.role || '',
    match:  'exact',
    sort:   u => ROLES.findIndex(r => r.id === u.role),
    render: u => <RoleBadge role={u.role} />,
  },
  {
    key:    'provider',
    label:  'Sign-in',
    filter: { type: 'select', options: PROVIDERS },
    text:   u => u.provider || '',
    match:  'exact',
    render: u => <ProviderBadge provider={u.provider} />,
  },
  {
    key:    'directory',
    label:  'Directory',
    filter: { type: 'text' },
    text:   u => u.directory_name || '',
    render: u => u.directory_name
      ? <span className="text-gray-600">{u.directory_name}</span>
      : <span className="text-gray-400 text-xs">Not linked</span>,
  },
  {
    key:    'created_at',
    label:  'Joined',
    filter: { type: 'text' },
    text:   u => formatDate(u.created_at),
    sort:   u => u.created_at || '',
    render: u => u.created_at ? <span className="text-gray-500 whitespace-nowrap">{formatDate(u.created_at)}</span> : <Dash />,
  },
  {
    key:           'last_login',
    label:         'Last seen',
    defaultHidden: true,
    filter:        { type: 'text' },
    text:          u => formatDate(u.last_login),
    sort:          u => u.last_login || '',
    render:        u => u.last_login ? <span className="text-gray-500 whitespace-nowrap">{formatDate(u.last_login)}</span> : <Dash />,
  },
];

const COLUMN_KEYS   = COLUMNS.map(c => c.key);
const REQUIRED_KEYS = COLUMNS.filter(c => c.required).map(c => c.key);
const DEFAULT_KEYS  = COLUMNS.filter(c => !c.defaultHidden).map(c => c.key);

// Stored column choices are only a hint: drop anything this build no longer
// has, and never let the identifying columns be switched off.
function reviveColumns(stored) {
  const list  = Array.isArray(stored) ? stored : DEFAULT_KEYS;
  const known = list.filter(k => COLUMN_KEYS.includes(k));
  const keys  = new Set([...REQUIRED_KEYS, ...known]);
  return COLUMN_KEYS.filter(k => keys.has(k));
}

// ─── Column selector ──────────────────────────────────────────────────────────

function ColumnPicker({ visible, onChange }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onDocClick(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function toggle(key) {
    const next = visible.includes(key)
      ? visible.filter(k => k !== key)
      : COLUMN_KEYS.filter(k => k === key || visible.includes(k));
    onChange(reviveColumns(next));
  }

  const hiddenCount = COLUMN_KEYS.length - visible.length;

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-600 hover:border-church-gold hover:text-church-navy transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
        Columns
        {hiddenCount > 0 && (
          <span className="bg-gray-100 text-gray-500 rounded-full px-1.5">{hiddenCount} hidden</span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-1 z-30 w-56 bg-white border border-gray-200 rounded-xl shadow-lg p-2">
          <p className="text-xs text-gray-400 px-2 pb-1">Shown columns are remembered on this device.</p>
          {COLUMNS.map(c => (
            <label
              key={c.key}
              className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm ${c.required ? 'text-gray-400' : 'text-gray-700 hover:bg-gray-50 cursor-pointer'}`}
            >
              <input
                type="checkbox"
                checked={visible.includes(c.key)}
                disabled={c.required}
                onChange={() => toggle(c.key)}
                className="accent-church-gold"
              />
              <span>{c.label}</span>
              {c.required && <span className="text-xs ml-auto">always</span>}
            </label>
          ))}
          <button
            type="button"
            onClick={() => onChange(reviveColumns(DEFAULT_KEYS))}
            className="w-full text-xs text-church-gold hover:text-church-navy px-2 py-1.5 text-left"
          >
            Reset to defaults
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Detail panel: everything you can do to one account ───────────────────────

function UserDetail({ user, currentUserId, people, busy, onSetRole, onLink, onRemove, onClose }) {
  const isSelf  = user.id === currentUserId;
  const locked  = isSelf || !!user.is_owner;
  const lockReason = isSelf
    ? 'You cannot change your own role.'
    : user.is_owner
      ? 'The owner account is always an admin.'
      : '';

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/30"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Details for ${user.name}`}
        className="bg-white w-full max-w-md h-full shadow-2xl flex flex-col"
      >
        {/* Header */}
        <div className="flex items-start gap-3 px-5 py-4 border-b border-gray-100">
          <Avatar user={user} size={44} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-church-navy truncate">{user.name}</h3>
              <RoleBadge role={user.role} />
            </div>
            <p className="text-xs text-gray-500 truncate">{user.email || 'No email on file'}</p>
          </div>
          <button onClick={onClose} aria-label="Close details" className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          {/* At a glance */}
          <dl className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <dt className="text-gray-400 uppercase tracking-wide">Signed in with</dt>
              <dd className="mt-1"><ProviderBadge provider={user.provider} /></dd>
            </div>
            <div>
              <dt className="text-gray-400 uppercase tracking-wide">Joined</dt>
              <dd className="mt-1 text-gray-600">{formatDate(user.created_at) || '—'}</dd>
            </div>
            <div>
              <dt className="text-gray-400 uppercase tracking-wide">Last seen</dt>
              <dd className="mt-1 text-gray-600">{formatDateTime(user.last_login) || 'Never'}</dd>
            </div>
            <div>
              <dt className="text-gray-400 uppercase tracking-wide">Directory</dt>
              <dd className="mt-1 text-gray-600">{user.directory_name || 'Not linked'}</dd>
            </div>
          </dl>

          {/* Role assignment */}
          <fieldset disabled={locked || busy} className="border-0 p-0 m-0">
            <legend className="text-sm font-semibold text-church-navy mb-1">
              Role for {user.name}
            </legend>
            {lockReason
              ? <p className="text-xs text-amber-700 mb-2">{lockReason}</p>
              : <p className="text-xs text-gray-500 mb-2">Pick what this person is allowed to do. Saved as soon as you choose.</p>
            }
            <div className="space-y-1.5">
              {ROLES.map(r => (
                <label
                  key={r.id}
                  className={`flex gap-3 items-start p-2.5 rounded-lg border transition-colors ${
                    user.role === r.id ? 'border-church-gold bg-church-gold/5' : 'border-gray-200'
                  } ${locked ? 'opacity-60' : 'cursor-pointer hover:border-church-gold'}`}
                >
                  <input
                    type="radio"
                    name={`role-${user.id}`}
                    value={r.id}
                    aria-label={`${r.label} role`}
                    checked={user.role === r.id}
                    disabled={locked || busy}
                    onChange={() => onSetRole(user.id, r.id)}
                    className="mt-1 accent-church-gold"
                  />
                  <span className="min-w-0">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${r.tone}`}>{r.badge}</span>
                    <span className="block text-xs text-gray-600 mt-1">{r.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {/* Directory link */}
          <div>
            <label htmlFor={`person-${user.id}`} className="block text-sm font-semibold text-church-navy mb-1">
              Directory entry for {user.name}
            </label>
            <p className="text-xs text-gray-500 mb-2">
              Linking an account to its directory entry lets that person edit their own and their
              household&apos;s details and worship preferences. Accounts link automatically when the
              sign-in email matches the directory.
            </p>
            <select
              id={`person-${user.id}`}
              value={user.directory_id ?? ''}
              disabled={busy}
              onChange={e => onLink(user.id, e.target.value === '' ? null : Number(e.target.value))}
              className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-church-gold disabled:opacity-50"
            >
              <option value="">Not linked to the directory</option>
              {people.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Footer actions */}
        <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-between gap-2">
          {!locked ? (
            <button
              onClick={() => onRemove(user.id, user.name)}
              disabled={busy}
              className="text-sm px-3 py-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
            >
              Remove from the portal
            </button>
          ) : <span className="text-xs text-gray-400">This account cannot be removed.</span>}
          <button onClick={onClose} className="btn-primary text-sm">Done</button>
        </div>
      </div>
    </div>
  );
}

// ─── The grid ─────────────────────────────────────────────────────────────────

function UsersGrid({ users, columns, sort, onSort, filters, onFilter, currentUserId, onOpen, onApprove }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-100">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-church-navy text-white">
            {columns.map(c => {
              const active = sort.key === c.key;
              return (
                <th key={c.key} scope="col" className="px-3 py-2.5 text-left whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => onSort(c.key)}
                    aria-label={`Sort by ${c.label}`}
                    className="flex items-center gap-1 font-medium text-xs uppercase tracking-wide hover:text-church-gold transition-colors"
                  >
                    <span>{c.label}</span>
                    <SortIcon active={active} dir={sort.dir} />
                  </button>
                </th>
              );
            })}
            <th scope="col" className="px-3 py-2.5 text-right text-xs uppercase tracking-wide font-medium">Actions</th>
          </tr>
          <tr className="bg-[#152038] border-b border-white/10">
            {columns.map(c => (
              <th key={c.key} className="px-2 py-1.5">
                <label className="sr-only" htmlFor={`filter-${c.key}`}>Filter by {c.label}</label>
                {c.filter.type === 'select' ? (
                  <select
                    id={`filter-${c.key}`}
                    value={filters[c.key] || ''}
                    onChange={e => onFilter(c.key, e.target.value)}
                    className="w-full bg-white/10 text-white text-xs rounded px-2 py-1 border border-white/10 focus:outline-none focus:border-church-gold"
                  >
                    <option value="" className="text-gray-700">All</option>
                    {c.filter.options.map(o => (
                      <option key={o.value} value={o.value} className="text-gray-700">{o.label}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={`filter-${c.key}`}
                    type="text"
                    value={filters[c.key] || ''}
                    onChange={e => onFilter(c.key, e.target.value)}
                    placeholder="filter…"
                    className="w-full bg-white/10 text-white placeholder-white/30 text-xs rounded px-2 py-1 border border-white/10 focus:outline-none focus:border-church-gold focus:bg-white/15 transition-colors min-w-0"
                  />
                )}
              </th>
            ))}
            <th className="px-2 py-1.5" />
          </tr>
        </thead>
        <tbody>
          {users.length === 0 && (
            <tr>
              <td colSpan={columns.length + 1} className="px-3 py-10 text-center text-gray-400">
                No users match these filters.
              </td>
            </tr>
          )}
          {users.map((u, i) => (
            <tr
              key={u.id}
              onClick={() => onOpen(u.id)}
              className={`cursor-pointer ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-church-gold/10 transition-colors`}
            >
              {columns.map(c => (
                <td key={c.key} className="px-3 py-2 align-middle max-w-xs">
                  {c.render(u, { currentUserId })}
                </td>
              ))}
              <td className="px-3 py-2">
                <div className="flex items-center gap-1.5 justify-end">
                  {u.role === 'pending' && u.id !== currentUserId && !u.is_owner && (
                    <button
                      onClick={e => { e.stopPropagation(); onApprove(u.id); }}
                      className="text-xs px-2.5 py-1 rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors font-medium"
                    >
                      Approve
                    </button>
                  )}
                  <button
                    onClick={e => { e.stopPropagation(); onOpen(u.id); }}
                    aria-label={`Manage ${u.name}`}
                    className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 text-gray-600 hover:border-church-gold hover:text-church-navy transition-colors whitespace-nowrap"
                  >
                    Manage
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── View ─────────────────────────────────────────────────────────────────────

export default function UsersView({ currentUser }) {
  const [users, setUsers]       = useState([]);
  const [people, setPeople]     = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [notice, setNotice]     = useState('');
  const [busy, setBusy]         = useState(false);
  const [openId, setOpenId]     = useState(null);
  const [filters, setFilters]   = useState({});
  const [sort, setSort]         = useState({ key: 'role', dir: 'asc' });

  const [visibleKeys, setVisibleKeys] = useCookieState(COLUMN_COOKIE, DEFAULT_KEYS, { revive: reviveColumns });

  const columns = useMemo(
    () => COLUMNS.filter(c => visibleKeys.includes(c.key)),
    [visibleKeys],
  );

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch('/api/auth/users').then(r => r.json()),
      fetch('/api/admin/directory?limit=2000&sort=name&dir=asc').then(r => r.json()).catch(() => ({ rows: [] })),
    ])
      .then(([usersJson, dirJson]) => {
        if (!usersJson.success) throw new Error(usersJson.error);
        setUsers(usersJson.users);
        setPeople(dirJson.rows ?? []);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function setRole(id, role) {
    setNotice('');
    setBusy(true);
    const res  = await fetch(`/api/auth/users/${id}/role`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ role }),
    });
    const json = await res.json().catch(() => ({}));
    if (!json.success) setNotice(json.error || 'Could not change that role');
    setBusy(false);
    load();
  }

  async function remove(id, name) {
    if (!window.confirm(`Remove ${name} from the member portal? They will need to sign in again and be confirmed.`)) return;
    setNotice('');
    setBusy(true);
    const res  = await fetch(`/api/auth/users/${id}`, { method: 'DELETE' });
    const json = await res.json().catch(() => ({}));
    if (!json.success) setNotice(json.error || 'Could not remove that user');
    else setOpenId(null);
    setBusy(false);
    load();
  }

  async function link(id, directoryId) {
    setNotice('');
    setBusy(true);
    const res  = await fetch(`/api/auth/users/${id}/directory`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ directory_id: directoryId }),
    });
    const json = await res.json().catch(() => ({}));
    if (!json.success) setNotice(json.error || 'Could not link that account');
    setBusy(false);
    load();
  }

  function handleSort(key) {
    setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  }

  function handleFilter(key, value) {
    setFilters(f => ({ ...f, [key]: value }));
  }

  const activeFilters = Object.entries(filters).filter(([, v]) => v?.trim?.() || v);

  const rows = useMemo(() => {
    const matched = users.filter(u =>
      columns.every(c => {
        const raw = filters[c.key];
        if (!raw) return true;
        const value = c.text(u);
        return c.match === 'exact'
          ? value === raw
          : value.toLowerCase().includes(raw.trim().toLowerCase());
      })
    );

    const col = COLUMNS.find(c => c.key === sort.key);
    if (!col) return matched;

    const key = col.sort ?? col.text;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...matched].sort((a, b) => {
      const av = key(a);
      const bv = key(b);
      if (av === bv) return (a.name || '').localeCompare(b.name || '');
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' }) * dir;
    });
  }, [users, columns, filters, sort]);

  const openUser    = users.find(u => u.id === openId) || null;
  const pendingCount = users.filter(u => u.role === 'pending').length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-church-gold" />
      </div>
    );
  }

  if (error) {
    return <div className="card text-center py-10 text-red-600 text-sm">{error}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="section-heading mb-0">Members &amp; Access</h2>
        <div className="flex items-center gap-2">
          <ColumnPicker visible={visibleKeys} onChange={setVisibleKeys} />
          <button onClick={load} className="text-sm text-church-gold hover:text-church-navy transition-colors px-2">
            Refresh
          </button>
        </div>
      </div>

      {notice && (
        <div className="card border border-red-200 bg-red-50 text-sm text-red-700 flex items-center justify-between">
          <span>{notice}</span>
          <button onClick={() => setNotice('')} className="underline text-xs ml-3">dismiss</button>
        </div>
      )}

      {pendingCount > 0 && (
        <button
          onClick={() => setFilters(f => ({ ...f, role: 'pending' }))}
          className="w-full text-left card border border-orange-200 bg-orange-50 text-sm text-orange-800 hover:bg-orange-100 transition-colors"
        >
          <strong>{pendingCount}</strong> {pendingCount === 1 ? 'person is' : 'people are'} waiting to be
          confirmed. They can look around the portal but cannot change anything — click to show just them.
        </button>
      )}

      <div className="card p-0 sm:p-0 overflow-visible">
        <div className="flex items-center justify-between gap-3 px-4 py-3 flex-wrap">
          <p className="text-xs text-gray-500">
            Showing <strong className="text-church-navy">{rows.length}</strong> of {users.length} account{users.length === 1 ? '' : 's'}.
            {' '}Click a row to open its details and assign a role.
          </p>
          {activeFilters.length > 0 && (
            <button
              onClick={() => setFilters({})}
              className="text-xs text-amber-600 hover:text-amber-800 flex items-center gap-1"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Clear filters
            </button>
          )}
        </div>

        <UsersGrid
          users={rows}
          columns={columns}
          sort={sort}
          onSort={handleSort}
          filters={filters}
          onFilter={handleFilter}
          currentUserId={currentUser.id}
          onOpen={setOpenId}
          onApprove={id => setRole(id, 'approved')}
        />
      </div>

      {/* What each role can do */}
      <div className="card">
        <h3 className="font-semibold text-church-navy mb-3">What each role can do</h3>
        <dl className="space-y-2">
          {ROLES.map(r => (
            <div key={r.id} className="flex items-start gap-3">
              <dt className="shrink-0 w-24">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${r.tone}`}>{r.badge}</span>
              </dt>
              <dd className="text-xs text-gray-600 flex-1">{r.description}</dd>
            </div>
          ))}
        </dl>
      </div>

      {openUser && (
        <UserDetail
          user={openUser}
          currentUserId={currentUser.id}
          people={people}
          busy={busy}
          onSetRole={setRole}
          onLink={link}
          onRemove={remove}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}
