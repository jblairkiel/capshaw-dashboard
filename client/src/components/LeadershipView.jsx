import { useState, useEffect, useCallback, useMemo } from 'react';
import Dialog from './Dialog';

// Our elders and deacons, and what each of them looks after.
//
// The deacons come off the church website with the rest of the scrape; the
// eldership is kept here, because the site does not list it. Both are editable
// by whoever holds the Elders & Deacons area — everybody else reads.
const API = '/api/leadership';

async function send(url, options = {}) {
  const res  = await fetch(url, { credentials: 'include', ...options });
  const json = await res.json().catch(() => ({}));
  if (!json.success) throw new Error(json.error || 'Something went wrong');
  return json;
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

function SortHeader({ col, label, sort, onSort, className = '' }) {
  return (
    <th className={`px-4 py-3 ${className}`}>
      <button
        onClick={() => onSort(col)}
        aria-label={`Sort by ${label}`}
        className="flex items-center gap-1 font-medium text-xs uppercase tracking-wide hover:text-church-gold transition-colors"
      >
        <span>{label}</span>
        <SortIcon active={sort.col === col} dir={sort.dir} />
      </button>
    </th>
  );
}

// ─── Adding or editing one person ─────────────────────────────────────────────

function PersonForm({ group, person, onClose, onSaved }) {
  const isNew   = !person?.id;
  const isElder = group === 'elders';
  const [form, setForm] = useState(() => ({
    name:  person?.name  ?? '',
    phone: person?.phone ?? '',
    email: person?.email ?? '',
    notes: person?.notes ?? '',
    // Responsibilities are edited as one per line, which is how they read on
    // the page and how somebody would write them down.
    duties: (person?.duties ?? []).join('\n'),
  }));
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');

  const set = (key, value) => setForm(p => ({ ...p, [key]: value }));
  const label = isElder ? 'elder' : 'deacon';

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim()) return setError(`An ${label} needs a name`);
    setBusy(true); setError('');
    try {
      const body = {
        name:   form.name,
        duties: form.duties.split('\n').map(d => d.trim()).filter(Boolean),
      };
      if (isElder) Object.assign(body, { phone: form.phone, email: form.email, notes: form.notes });

      await send(isNew ? `${API}/${group}` : `${API}/${group}/${person.id}`, {
        method:  isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Remove ${person.name} from the ${isElder ? 'elders' : 'deacons'}?`)) return;
    setBusy(true);
    try {
      await send(`${API}/${group}/${person.id}`, { method: 'DELETE' });
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const field = 'mt-1 block w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold';
  const head  = 'text-xs font-medium text-gray-500 uppercase tracking-wide';

  return (
    <Dialog title={isNew ? `Add an ${label}` : `Edit ${person.name}`} onClose={onClose} width="max-w-md">
      <form onSubmit={submit} className="space-y-3">
        <label className="block">
          <span className={head}>Name <span className="text-red-400" aria-hidden="true">*</span></span>
          <input autoFocus required value={form.name} onChange={e => set('name', e.target.value)} className={field} />
        </label>

        {isElder && (
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={head}>Phone</span>
              <input value={form.phone} onChange={e => set('phone', e.target.value)} className={field} />
            </label>
            <label className="block">
              <span className={head}>Email</span>
              <input value={form.email} onChange={e => set('email', e.target.value)} className={field} />
            </label>
          </div>
        )}

        <label className="block">
          <span className={head}>Responsibilities</span>
          <textarea
            rows={4}
            value={form.duties}
            placeholder={'One per line\nShepherding group 1\nBenevolence'}
            onChange={e => set('duties', e.target.value)}
            className={field}
          />
          <span className="block text-xs text-gray-400 mt-1">One per line. Saving replaces the whole list.</span>
        </label>

        {isElder && (
          <label className="block">
            <span className={head}>Notes</span>
            <textarea rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} className={field} />
          </label>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex items-center justify-between gap-2 pt-1">
          {!isNew ? (
            <button type="button" onClick={remove} disabled={busy}
              className="text-sm px-3 py-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50">
              Remove
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="text-sm px-3 py-2 rounded-lg border border-gray-200 text-gray-600">Cancel</button>
            <button type="submit" disabled={busy} className="btn-primary text-sm disabled:opacity-50">
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}

// ─── One group, as a table ────────────────────────────────────────────────────
//
// Sorting and filtering are done here rather than on the server: the eldership
// and diaconate are a few dozen rows, and they arrive with the page.

function PeopleGrid({ title, people, group, canManage, onEdit, onAdd, extraColumn }) {
  const [filter, setFilter] = useState('');
  const [sort,   setSort]   = useState({ col: 'name', dir: 'asc' });

  function toggleSort(col) {
    setSort(s => (s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' }));
  }

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const matched = people.filter(d =>
      !q ||
      d.name.toLowerCase().includes(q) ||
      (d.duties || []).some(duty => duty.toLowerCase().includes(q))
    );

    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...matched].sort((a, b) => (
      sort.col === 'duties'
        ? ((a.duties?.length || 0) - (b.duties?.length || 0)) * dir
        : a.name.localeCompare(b.name) * dir
    ));
  }, [people, filter, sort]);

  const singular = group === 'elders' ? 'elder' : 'deacon';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="section-heading mb-0">{title}</h2>
        <div className="flex items-center gap-3 flex-wrap">
          <input
            type="text"
            placeholder="Filter by name or responsibility…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-church-navy w-72 max-w-full"
          />
          <span className="text-sm text-gray-400 whitespace-nowrap">
            {rows.length} {singular}{rows.length !== 1 ? 's' : ''}
          </span>
          {canManage && (
            <button onClick={onAdd} className="btn-primary text-sm">Add {singular === 'elder' ? 'an elder' : 'a deacon'}</button>
          )}
        </div>
      </div>

      <div className="card p-0 overflow-hidden overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="bg-church-navy text-left text-gray-300">
              <SortHeader col="name"   label={singular === 'elder' ? 'Elder' : 'Deacon'} sort={sort} onSort={toggleSort} className="w-56 align-top" />
              {extraColumn && <th className="px-4 py-3 align-top text-xs uppercase tracking-wide font-medium w-56">Contact</th>}
              <SortHeader col="duties" label="Responsibilities" sort={sort} onSort={toggleSort} className="align-top" />
              {canManage && <th className="px-4 py-3 w-20" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((d, i) => (
              <tr key={d.id ?? i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                <td className="px-4 py-3 font-medium text-church-navy align-top whitespace-nowrap">{d.name}</td>
                {extraColumn && (
                  <td className="px-4 py-3 align-top text-gray-500">
                    {[d.phone, d.email].filter(Boolean).join(' · ') || <span className="text-gray-300">—</span>}
                  </td>
                )}
                <td className="px-4 py-3 align-top">
                  {d.duties?.length ? (
                    <ul className="space-y-1">
                      {d.duties.map((duty, j) => (
                        <li key={j} className="flex gap-2 text-gray-600">
                          <span className="text-church-gold shrink-0">•</span>
                          <span>{duty}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                  {d.notes && <p className="text-xs text-gray-400 mt-1">{d.notes}</p>}
                </td>
                {canManage && (
                  <td className="px-4 py-3 align-top text-right">
                    <button
                      onClick={() => onEdit(d)}
                      aria-label={`Edit ${d.name}`}
                      className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 text-gray-600 hover:border-church-gold hover:text-church-navy transition-colors"
                    >
                      Edit
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={2 + (extraColumn ? 1 : 0) + (canManage ? 1 : 0)} className="px-4 py-12 text-center text-gray-400">
                  {people.length ? `No ${singular}s match your filter.` : `No ${singular}s recorded yet.`}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── The page ─────────────────────────────────────────────────────────────────

export default function LeadershipView({ bulletins }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [editing, setEditing] = useState(null);   // { group, person }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await send(API));
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

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

  const canManage    = !!data?.canManage;
  // Bulletins come with the rest of the scraped data the app already holds;
  // the leadership endpoint returns them too, for a page loaded on its own.
  const bulletinList = bulletins || data?.bulletins || [];

  return (
    <div className="space-y-8">
      <PeopleGrid
        title="Elders"
        group="elders"
        people={data?.elders || []}
        canManage={canManage}
        extraColumn
        onAdd={() => setEditing({ group: 'elders', person: null })}
        onEdit={person => setEditing({ group: 'elders', person })}
      />

      <PeopleGrid
        title="Deacons"
        group="deacons"
        people={data?.deacons || []}
        canManage={canManage}
        onAdd={() => setEditing({ group: 'deacons', person: null })}
        onEdit={person => setEditing({ group: 'deacons', person })}
      />

      {/* Bulletins */}
      <section className="space-y-4">
        <h2 className="section-heading">Recent Bulletins</h2>

        {bulletinList.length > 0 ? (
          <div className="card p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wide">
                  <th className="px-4 py-2">Bulletin</th>
                  <th className="px-4 py-2 text-right">Download</th>
                </tr>
              </thead>
              <tbody>
                {bulletinList.map((b, i) => (
                  <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-4 py-2 text-church-navy">{b.label}</td>
                    <td className="px-4 py-2 text-right">
                      <a
                        href={b.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-church-navy hover:text-church-gold transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        PDF
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="card text-center text-gray-400 py-12">No bulletins found.</div>
        )}
      </section>

      {editing && (
        <PersonForm
          group={editing.group}
          person={editing.person}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}
