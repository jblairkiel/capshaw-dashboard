import { useState, useEffect, useCallback, useMemo } from 'react';
import Dialog from './Dialog';
import WorkflowDialogButton from './WorkflowDialogButton';
import { useIsNarrow } from '../lib/useMediaQuery';

// Our guests: who they are, how to reach them, and when they have been with us.
//
// This used to render only what the church website knew — a name from a heading
// and a list of dates — so the page read as comments and visit history with
// nobody's details on it. Everything now comes from our own records, and
// whoever looks after the Guest Tracker can add a guest and keep their details
// up to date here.
const API = '/api/visitors';

// Visit dates come off the church site as MM/DD/YY. Sorting them as text would
// put December before February, so they are turned into a comparable number
// and anything unrecognised is left at the end.
function dateKey(raw) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(String(raw || '').trim());
  if (!m) return -1;
  const [, mm, dd, yy] = m;
  const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
  return year * 10000 + Number(mm) * 100 + Number(dd);
}

function summarise(visitor) {
  const visits = [...(visitor.visits || [])].sort((a, b) => dateKey(b.date) - dateKey(a.date));
  return {
    ...visitor,
    visits,
    count:   visits.length,
    last:    visits[0]?.date || '',
    first:   visits[visits.length - 1]?.date || '',
    lastKey: visits.length ? dateKey(visits[0].date) : -1,
  };
}

async function send(url, options = {}) {
  const res  = await fetch(url, { credentials: 'include', ...options });
  const json = await res.json().catch(() => ({}));
  if (!json.success) throw new Error(json.error || 'Something went wrong');
  return json;
}

function jsonBody(body) {
  return { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

// Where this guest's follow-up has got to. Three states worth telling apart:
// somebody is on it, somebody reached them, or nobody has tried.
function followUpState(guest) {
  if (guest.followUp?.active) return { tone: 'bg-amber-100 text-amber-800', label: 'Follow-up in progress' };
  if (guest.last_contacted_at) {
    const how = guest.last_contact_method === 'phone' ? 'Phoned' : 'Emailed';
    return {
      tone:  'bg-emerald-100 text-emerald-800',
      label: `${how}${guest.last_contacted_by ? ` by ${guest.last_contacted_by}` : ''}`,
    };
  }
  if (guest.followUp?.lastDone?.outcome === 'no-contact') {
    return { tone: 'bg-gray-100 text-gray-600', label: 'Never reached' };
  }
  return null;
}

function FollowUpBadge({ guest }) {
  const state = followUpState(guest);
  if (!state) return null;
  return <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${state.tone}`}>{state.label}</span>;
}

// The button that starts one for this guest, with them already chosen. It is
// the same workflow the page's own panel starts — only the guest is settled.
function FollowUpButton({ guest, user, onDone, className }) {
  if (!user || guest.followUp?.active) return null;
  return (
    <WorkflowDialogButton
      page="visitors"
      user={user}
      icon={false}
      label={guest.last_contacted_at ? 'Follow up again' : 'Follow up'}
      title={`Follow up with ${guest.name}`}
      prefill={{ visitorId: String(guest.id) }}
      startImmediately
      onClosed={onDone}
      className={className || 'text-xs px-2.5 py-1 rounded-lg border border-gray-200 text-gray-600 hover:border-church-gold hover:text-church-navy transition-colors whitespace-nowrap'}
    />
  );
}

function Stat({ value, label, tone = 'text-church-navy' }) {
  return (
    <div className="card text-center py-4">
      <p className={`text-2xl font-bold ${tone}`}>{value}</p>
      <p className="text-xs text-gray-500 mt-1">{label}</p>
    </div>
  );
}

// What we know about a guest, beyond their name. Only what has been filled in
// is shown, so a guest we know little about does not render a wall of dashes.
const DETAIL_FIELDS = [
  { key: 'phone',      label: 'Phone' },
  { key: 'email',      label: 'Email' },
  { key: 'address',    label: 'Address' },
  { key: 'city',       label: 'City' },
  { key: 'state',      label: 'State' },
  { key: 'zip',        label: 'ZIP' },
  { key: 'invited_by', label: 'Invited by' },
  { key: 'status',     label: 'Follow-up' },
];

const BLANK = {
  name: '', phone: '', email: '', address: '', city: '', state: '', zip: '',
  invited_by: '', status: '', notes: '',
};

// ─── Adding or editing a guest ────────────────────────────────────────────────

function GuestForm({ guest, onClose, onSaved, onDeleted }) {
  const isNew = !guest?.id;
  const [form, setForm]   = useState(() => ({ ...BLANK, ...(guest || {}) }));
  const [visit, setVisit] = useState({ date: '', service: '' });
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');

  const set = (key, value) => setForm(p => ({ ...p, [key]: value }));

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim()) return setError('A guest needs a name');
    setBusy(true); setError('');
    try {
      const body = { ...BLANK, ...form };
      delete body.id; delete body.visits; delete body.created_at; delete body.comments;
      if (isNew && visit.date.trim()) body.visit = visit;

      const json = await send(isNew ? API : `${API}/${guest.id}`, {
        method: isNew ? 'POST' : 'PATCH',
        ...jsonBody(body),
      });
      onSaved(json.visitor);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Remove ${guest.name} and everything recorded about them?`)) return;
    setBusy(true);
    try {
      await send(`${API}/${guest.id}`, { method: 'DELETE' });
      onDeleted(guest.id);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const field = 'mt-1 block w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold';
  const label = 'text-xs font-medium text-gray-500 uppercase tracking-wide';

  return (
    <Dialog title={isNew ? 'Add a guest' : `Edit ${guest.name}`} onClose={onClose} width="max-w-lg">
      <form onSubmit={submit} className="space-y-3">
        <label className="block">
          <span className={label}>Name <span className="text-red-400" aria-hidden="true">*</span></span>
          <input autoFocus required value={form.name} onChange={e => set('name', e.target.value)} className={field} />
        </label>

        <div className="grid grid-cols-2 gap-3">
          {DETAIL_FIELDS.map(f => (
            <label key={f.key} className={f.key === 'address' ? 'block col-span-2' : 'block'}>
              <span className={label}>{f.label}</span>
              <input value={form[f.key] ?? ''} onChange={e => set(f.key, e.target.value)} className={field} />
            </label>
          ))}
        </div>

        <label className="block">
          <span className={label}>Our notes</span>
          <textarea
            rows={3}
            value={form.notes ?? ''}
            onChange={e => set('notes', e.target.value)}
            placeholder="What was said, who spoke with them, anything worth remembering"
            className={field}
          />
          {guest?.comments?.trim() && (
            <span className="block text-xs text-gray-400 mt-1">
              The tracker&apos;s own comments are shown separately and are replaced by the next refresh,
              so anything worth keeping belongs here.
            </span>
          )}
        </label>

        {isNew && (
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={label}>First visit</span>
              <input
                value={visit.date}
                placeholder="06/07/26"
                onChange={e => setVisit(v => ({ ...v, date: e.target.value }))}
                className={field}
              />
            </label>
            <label className="block">
              <span className={label}>Service</span>
              <input
                value={visit.service}
                placeholder="Sun AM"
                onChange={e => setVisit(v => ({ ...v, service: e.target.value }))}
                className={field}
              />
            </label>
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex items-center justify-between gap-2 pt-1">
          {!isNew ? (
            <button type="button" onClick={remove} disabled={busy}
              className="text-sm px-3 py-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50">
              Delete
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="text-sm px-3 py-2 rounded-lg border border-gray-200 text-gray-600">Cancel</button>
            <button type="submit" disabled={busy} className="btn-primary text-sm disabled:opacity-50">
              {busy ? 'Saving…' : isNew ? 'Add guest' : 'Save'}
            </button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}

// ─── One guest, in full ───────────────────────────────────────────────────────

function GuestDetail({ guest, canManage, user, onClose, onChanged, onEdit, onFollowUpDone }) {
  const [visit, setVisit] = useState({ date: '', service: '' });
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');

  const known = DETAIL_FIELDS.filter(f => String(guest[f.key] || '').trim());

  async function addVisit(e) {
    e.preventDefault();
    if (!visit.date.trim()) return setError('A visit needs a date');
    setBusy(true); setError('');
    try {
      const json = await send(`${API}/${guest.id}/visits`, { method: 'POST', ...jsonBody(visit) });
      setVisit({ date: '', service: '' });
      onChanged(json.visitor);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeVisit(visitId) {
    setBusy(true); setError('');
    try {
      const json = await send(`${API}/${guest.id}/visits/${visitId}`, { method: 'DELETE' });
      onChanged(json.visitor);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={guest.name}
      subtitle={`${guest.count} visit${guest.count === 1 ? '' : 's'} on record`}
      onClose={onClose}
      width="max-w-lg"
    >
      <div className="space-y-5">
        {/* Follow-up: where it has got to, and how to reach them */}
        <section className="rounded-xl border border-gray-200 px-4 py-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <h4 className="text-sm font-semibold text-church-navy">Follow-up</h4>
              <p className="text-xs text-gray-500 mt-0.5">
                {guest.followUp?.active
                  ? 'Somebody has been asked to reach out. It closes when they do.'
                  : guest.last_contacted_at
                    ? `Last reached ${guest.last_contact_method === 'phone' ? 'by phone' : 'by email'}` +
                      `${guest.last_contacted_by ? ` by ${guest.last_contacted_by}` : ''}.`
                    : 'Nobody has been asked to reach out yet.'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <FollowUpBadge guest={guest} />
              <FollowUpButton
                guest={guest}
                user={user}
                onDone={onFollowUpDone}
                className="text-xs px-3 py-1.5 rounded-lg border border-church-navy text-church-navy hover:bg-church-navy hover:text-white transition-colors font-medium"
              />
            </div>
          </div>

          {/* Reaching them is the point of the follow-up, so the two ways of
              doing it are here rather than buried in the details below. */}
          {(guest.phone || guest.email) && (
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {guest.phone && (
                <a href={`tel:${guest.phone.replace(/[^0-9+]/g, '')}`}
                   className="text-xs px-2.5 py-1 rounded-lg bg-church-cream text-church-navy hover:bg-church-gold/20 transition-colors">
                  Call {guest.phone}
                </a>
              )}
              {guest.email && (
                <a href={`mailto:${guest.email}`}
                   className="text-xs px-2.5 py-1 rounded-lg bg-church-cream text-church-navy hover:bg-church-gold/20 transition-colors">
                  Email {guest.email}
                </a>
              )}
            </div>
          )}
        </section>

        {/* Details */}
        <section>
          <h4 className="text-sm font-semibold text-church-navy mb-2">Details</h4>
          {known.length > 0 ? (
            <dl className="grid grid-cols-2 gap-3 text-sm">
              {known.map(f => (
                <div key={f.key} className={f.key === 'address' ? 'col-span-2' : ''}>
                  <dt className="text-xs text-gray-400 uppercase tracking-wide">{f.label}</dt>
                  <dd className="text-gray-700">{guest[f.key]}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-gray-400">
              Nothing beyond their name yet.{canManage && ' Choose Edit to fill in how to reach them.'}
            </p>
          )}
        </section>

        {/* What the church site's tracker recorded, which a re-scrape replaces */}
        {guest.comments?.trim() && (
          <section>
            <h4 className="text-sm font-semibold text-church-navy mb-1">Comments from the tracker</h4>
            <p className="text-sm text-gray-700 whitespace-pre-line">{guest.comments}</p>
            <p className="text-xs text-gray-400 mt-1">
              From capshawchurch.org. Refreshing the site replaces this; notes added here are kept.
            </p>
          </section>
        )}

        {/* What we have added ourselves, which nothing overwrites */}
        {guest.notes?.trim() && (
          <section>
            <h4 className="text-sm font-semibold text-church-navy mb-1">Our notes</h4>
            <p className="text-sm text-gray-700 whitespace-pre-line">{guest.notes}</p>
          </section>
        )}

        {/* Visits */}
        <section>
          <h4 className="text-sm font-semibold text-church-navy mb-2">Visit history</h4>
          {guest.visits.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
                  <th className="py-2 pr-4">Date</th>
                  <th className="py-2">Service</th>
                  {canManage && <th className="py-2 w-10" />}
                </tr>
              </thead>
              <tbody>
                {guest.visits.map(v => (
                  <tr key={v.id ?? `${v.date}-${v.service}`} className="border-b border-gray-50 last:border-0">
                    <td className="py-2 pr-4 text-gray-500 whitespace-nowrap">{v.date}</td>
                    <td className="py-2">{v.service}</td>
                    {canManage && (
                      <td className="py-2 text-right">
                        <button
                          onClick={() => removeVisit(v.id)}
                          disabled={busy}
                          aria-label={`Remove the visit on ${v.date}`}
                          className="text-xs text-gray-400 hover:text-red-600 disabled:opacity-50"
                        >
                          ✕
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-gray-400">No visits recorded yet.</p>
          )}

          {canManage && (
            <form onSubmit={addVisit} className="flex items-end gap-2 mt-3 flex-wrap">
              <label className="block">
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Date</span>
                <input
                  value={visit.date}
                  placeholder="06/07/26"
                  onChange={e => setVisit(v => ({ ...v, date: e.target.value }))}
                  className="mt-1 block w-32 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Service</span>
                <input
                  value={visit.service}
                  placeholder="Sun AM"
                  onChange={e => setVisit(v => ({ ...v, service: e.target.value }))}
                  className="mt-1 block w-36 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold"
                />
              </label>
              <button type="submit" disabled={busy} className="btn-primary text-sm disabled:opacity-50">Record a visit</button>
            </form>
          )}
        </section>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {canManage && (
          <div className="flex justify-end">
            <button onClick={onEdit} className="text-sm px-3 py-2 rounded-lg border border-gray-200 text-gray-600 hover:border-church-gold hover:text-church-navy transition-colors">
              Edit details
            </button>
          </div>
        )}
      </div>
    </Dialog>
  );
}

// ─── The page ─────────────────────────────────────────────────────────────────

export default function VisitorTracker({ user }) {
  const [guests, setGuests]   = useState([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [search, setSearch]   = useState('');
  const [openId, setOpenId]   = useState(null);
  // Seven columns of guest details do not fit a phone, so it gets a card each.
  const onPhone = useIsNarrow();
  const [editing, setEditing] = useState(null);   // a guest, or {} for a new one

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const json = await send(API);
      setGuests(json.visitors.map(summarise));
      setCanManage(json.canManage);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return guests.filter(g =>
      !q ||
      g.name.toLowerCase().includes(q) ||
      DETAIL_FIELDS.some(f => String(g[f.key] || '').toLowerCase().includes(q)) ||
      String(g.comments || '').toLowerCase().includes(q) ||
      String(g.notes || '').toLowerCase().includes(q)
    );
  }, [guests, search]);

  const totalVisits = filtered.reduce((s, g) => s + g.count, 0);
  const returning   = filtered.filter(g => g.count > 1).length;
  const mostRecent  = filtered.reduce((best, g) => (g.lastKey > (best?.lastKey ?? -1) ? g : best), null);

  const open = guests.find(g => g.id === openId) || null;

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
      <div className="flex items-end justify-between flex-wrap gap-3">
        <h2 className="section-heading mb-0">Our Guests</h2>
        {canManage && (
          <button onClick={() => setEditing({})} className="btn-primary text-sm">Add a guest</button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Stat value={filtered.length} label={filtered.length === 1 ? 'Guest' : 'Guests'} />
        <Stat value={totalVisits} label="Visits recorded" tone="text-green-600" />
        <Stat value={returning} label="Came back" tone="text-church-gold" />
        <Stat value={mostRecent?.last || '—'} label="Most recent visit" tone="text-gray-400" />
      </div>

      {/* Search */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <input
          type="text"
          placeholder="Search guests…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-church-navy w-64"
        />
        <span className="text-xs text-gray-400">{filtered.length} guest{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Phones: a card each, since a seven-column table is unreadable there. */}
      {onPhone ? (
      <div className="space-y-2">
        {filtered.map(g => (
          <button
            key={g.id}
            onClick={() => setOpenId(g.id)}
            className="card w-full text-left hover:border-church-gold transition-colors"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="font-medium text-church-navy">{g.name}</span>
              <span className="text-xs text-gray-400 whitespace-nowrap">{g.count} visit{g.count === 1 ? '' : 's'}</span>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {[g.phone, g.email, g.city].filter(Boolean).join(' · ') || 'No contact details yet'}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              {g.last ? `Last with us ${g.last}` : 'No visits recorded'}
              {g.invited_by ? ` · invited by ${g.invited_by}` : ''}
            </p>
            <span className="inline-block mt-1.5"><FollowUpBadge guest={g} /></span>
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="card text-center text-gray-400 text-sm py-8">No guests match your search.</p>
        )}
      </div>
      ) : (
      /* Tablets up: the full table, names and details together. */
      <div className="card p-0 overflow-hidden overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="bg-church-navy text-left text-xs text-gray-300 uppercase tracking-wide">
              <th className="px-4 py-3">Guest</th>
              <th className="px-4 py-3">Contact</th>
              <th className="px-4 py-3">Invited by</th>
              <th className="px-4 py-3 text-right whitespace-nowrap">Visits</th>
              <th className="px-4 py-3 whitespace-nowrap">First visit</th>
              <th className="px-4 py-3 whitespace-nowrap">Last visit</th>
              <th className="px-4 py-3 w-28">Follow-up</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((g, i) => (
              <tr
                key={g.id}
                onClick={() => setOpenId(g.id)}
                className={`cursor-pointer hover:bg-blue-50/60 transition-colors ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}
              >
                <td className="px-4 py-2">
                  <button
                    onClick={e => { e.stopPropagation(); setOpenId(g.id); }}
                    className="font-medium text-church-navy hover:text-church-gold transition-colors text-left"
                  >
                    {g.name}
                  </button>
                  {g.status && <span className="block text-xs text-gray-400">{g.status}</span>}
                  <span className="block mt-1"><FollowUpBadge guest={g} /></span>
                </td>
                <td className="px-4 py-2 text-gray-500">
                  {[g.phone, g.email].filter(Boolean).join(' · ') || <span className="text-gray-300">—</span>}
                  {(g.city || g.state) && (
                    <span className="block text-xs text-gray-400">{[g.city, g.state].filter(Boolean).join(', ')}</span>
                  )}
                </td>
                <td className="px-4 py-2 text-gray-500">{g.invited_by || <span className="text-gray-300">—</span>}</td>
                <td className="px-4 py-2 text-right font-semibold text-church-navy">{g.count}</td>
                <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{g.first || '—'}</td>
                <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{g.last || '—'}</td>
                <td className="px-4 py-2" onClick={e => e.stopPropagation()}>
                  {g.followUp?.active
                    ? <span className="text-xs text-amber-700">In progress</span>
                    : <FollowUpButton guest={g} user={user} onDone={load} />}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-gray-400">
                  {guests.length ? 'No guests match your search.' : 'No guests recorded yet.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      )}

      {open && !editing && (
        <GuestDetail
          guest={open}
          canManage={canManage}
          user={user}
          onFollowUpDone={load}
          onClose={() => setOpenId(null)}
          onChanged={updated => setGuests(prev => prev.map(g => (g.id === updated.id ? summarise(updated) : g)))}
          onEdit={() => setEditing(open)}
        />
      )}

      {editing && (
        <GuestForm
          guest={editing.id ? editing : null}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
          onDeleted={() => { setEditing(null); setOpenId(null); load(); }}
        />
      )}
    </div>
  );
}
