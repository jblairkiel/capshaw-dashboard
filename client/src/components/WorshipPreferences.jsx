import { useState } from 'react';
import { WORSHIP_ROLES, PREFERENCE_LEVELS } from '../lib/worship';

// Editor for one person's worship role preferences. Used both on a member's own
// profile and by admins from the directory, so it takes the person and reports
// what to save rather than owning the request itself.
export default function WorshipPreferences({ person, onSave, disabled = false }) {
  const [preferences, setPreferences] = useState(() => ({ ...(person.worship?.preferences ?? {}) }));
  const [notes,   setNotes]   = useState(person.worship?.notes ?? '');
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  const [saved,   setSaved]   = useState(false);

  // Clicking the level a role already has clears it back to "no preference".
  function choose(role, level) {
    setSaved(false);
    setPreferences(prev => {
      const next = { ...prev };
      if (next[role] === level) delete next[role];
      else next[role] = level;
      return next;
    });
  }

  async function save() {
    setSaving(true); setError(''); setSaved(false);
    try {
      // Roles the person cleared must be sent as null so the server drops them.
      const payload = { ...preferences };
      for (const role of WORSHIP_ROLES) if (!(role in payload)) payload[role] = null;
      await onSave({ preferences: payload, notes });
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-sm font-semibold text-church-navy">Worship role preferences</h4>
        <p className="text-xs text-gray-500 mt-0.5">
          Tell whoever builds the schedule which roles suit you. Leave a role blank if you have no preference.
        </p>
      </div>

      <div className="space-y-1.5">
        {WORSHIP_ROLES.map(role => (
          <div key={role} className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-gray-700 w-40 shrink-0">{role}</span>
            <div className="flex gap-1" role="group" aria-label={`${role} preference`}>
              {PREFERENCE_LEVELS.map(level => {
                const active = preferences[role] === level.id;
                return (
                  <button
                    key={level.id}
                    type="button"
                    disabled={disabled}
                    aria-pressed={active}
                    title={level.hint}
                    onClick={() => choose(role, level.id)}
                    className={`text-xs px-2.5 py-1 rounded-lg border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                      active ? level.tone : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    {level.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <label className="block">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Scheduling notes</span>
        <textarea
          rows={2}
          disabled={disabled}
          value={notes}
          onChange={e => { setNotes(e.target.value); setSaved(false); }}
          placeholder="Anything the scheduler should know — travel, availability, training needed…"
          className="mt-1 block w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold disabled:bg-gray-50"
        />
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {!disabled && (
        <div className="flex items-center gap-3">
          <button onClick={save} disabled={saving} className="btn-primary text-sm">
            {saving ? 'Saving…' : 'Save preferences'}
          </button>
          {saved && <span className="text-xs text-emerald-600">Saved</span>}
        </div>
      )}
    </div>
  );
}
