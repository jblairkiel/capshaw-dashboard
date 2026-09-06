import { useState, useEffect, useCallback } from 'react';
import { DIRECTORY_FIELDS, PREFERENCE_LEVELS } from '../lib/worship';
import WorshipPreferences from './WorshipPreferences';
import PersonPhoto from './PersonPhoto';

const API = '/api/profile';

async function send(url, options) {
  const res  = await fetch(url, { credentials: 'include', ...options });
  const json = await res.json().catch(() => ({}));
  if (!json.success) throw new Error(json.error || 'Something went wrong');
  return json;
}

// ─── Contact details ──────────────────────────────────────────────────────────

function ContactForm({ person, onSaved, disabled }) {
  const [form, setForm] = useState(() =>
    Object.fromEntries(DIRECTORY_FIELDS.map(f => [f.key, person[f.key] ?? '']))
  );
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const [saved,  setSaved]  = useState(false);

  const dirty = DIRECTORY_FIELDS.some(f => (form[f.key] ?? '') !== (person[f.key] ?? ''));

  async function save(e) {
    e.preventDefault();
    setSaving(true); setError(''); setSaved(false);
    try {
      const json = await send(`${API}/person/${person.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(form),
      });
      onSaved(json.person);
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <h4 className="text-sm font-semibold text-church-navy">Contact details</h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {DIRECTORY_FIELDS.map(f => (
          <label key={f.key} className={f.key === 'notes' ? 'block sm:col-span-2' : 'block'}>
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{f.label}</span>
            <input
              type="text"
              disabled={disabled}
              value={form[f.key]}
              placeholder={f.placeholder}
              onChange={e => { setForm(p => ({ ...p, [f.key]: e.target.value })); setSaved(false); }}
              className="mt-1 block w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold disabled:bg-gray-50 disabled:text-gray-500"
            />
          </label>
        ))}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {!disabled && (
        <div className="flex items-center gap-3">
          <button type="submit" disabled={saving || !dirty} className="btn-primary text-sm disabled:opacity-50">
            {saving ? 'Saving…' : 'Save details'}
          </button>
          {saved && <span className="text-xs text-emerald-600">Saved</span>}
        </div>
      )}
    </form>
  );
}

// ─── One household member ─────────────────────────────────────────────────────

function PersonCard({ person, isSelf, canEdit, onSaved, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);

  const chosen = Object.entries(person.worship?.preferences ?? {});
  const summary = chosen.length
    ? chosen
        .map(([role, level]) => `${role} (${PREFERENCE_LEVELS.find(l => l.id === level)?.label ?? level})`)
        .join(' · ')
    : 'No worship preferences set';

  return (
    <div className="card">
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <PersonPhoto person={person} size={44} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-church-navy">{person.name}</h3>
              {isSelf && <span className="text-xs px-2 py-0.5 rounded-full bg-church-gold/20 text-church-navy">You</span>}
            </div>
            <p className="text-xs text-gray-500 mt-0.5 truncate">{summary}</p>
          </div>
        </div>
        <svg
          className={`w-4 h-4 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="mt-4 pt-4 border-t border-gray-100 space-y-6">
          <ContactForm person={person} disabled={!canEdit} onSaved={onSaved} />
          <div className="pt-4 border-t border-gray-100">
            <WorshipPreferences
              person={person}
              disabled={!canEdit}
              onSave={async body => {
                const json = await send(`${API}/person/${person.id}/worship`, {
                  method:  'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body:    JSON.stringify(body),
                });
                onSaved(json.person);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

export default function MyProfileView({ user }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      setData(await send(`${API}/me`));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function handleSaved(updated) {
    setData(prev => prev && {
      ...prev,
      person:    prev.person?.id === updated.id ? updated : prev.person,
      household: prev.household.map(p => (p.id === updated.id ? updated : p)),
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-church-gold" />
      </div>
    );
  }

  if (error) return <div className="card text-center py-10 text-red-600 text-sm">{error}</div>;

  // Nobody in the directory matches this login yet.
  if (!data.linked) {
    return (
      <div className="space-y-4">
        <h2 className="section-heading mb-0">My Info</h2>
        <div className="card text-center py-10">
          <p className="text-sm text-gray-600">
            Your sign-in isn&apos;t matched to a directory entry yet, so there is nothing to edit here.
          </p>
          <p className="text-xs text-gray-400 mt-2">
            We match automatically when your sign-in email is the one in the directory
            {user?.email ? ` (yours is ${user.email})` : ''}. Ask an admin to link your account from
            Admin → Users &amp; Roles.
          </p>
        </div>
      </div>
    );
  }

  const canEdit = data.canEdit;
  const others  = data.household.filter(p => p.id !== data.person.id);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="section-heading mb-0">My Info</h2>
        <p className="text-xs text-gray-400 mt-0.5">
          Your details and worship preferences, and those of everyone at your address.
        </p>
      </div>

      {!canEdit && (
        <div className="card bg-amber-50 border border-amber-200 text-sm text-amber-800">
          Your account is pending approval, so this is read-only for now.
        </div>
      )}

      <PersonCard
        person={data.person}
        isSelf
        canEdit={canEdit}
        onSaved={handleSaved}
        defaultOpen
      />

      {others.length > 0 && (
        <>
          <h3 className="text-sm font-semibold text-church-navy pt-2">
            My household <span className="text-gray-400 font-normal">({others.length})</span>
          </h3>
          {others.map(p => (
            <PersonCard
              key={p.id}
              person={p}
              canEdit={canEdit}
              onSaved={handleSaved}
              defaultOpen={false}
            />
          ))}
        </>
      )}

      <p className="text-xs text-gray-400">
        Household is everyone sharing your street address. If someone is missing or listed at the
        wrong address, an admin can fix it from the Directory.
      </p>
    </div>
  );
}
