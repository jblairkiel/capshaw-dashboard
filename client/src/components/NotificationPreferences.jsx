import { useState, useEffect, useCallback } from 'react';
import { call, jsonBody, WEEKDAYS, hourLabel } from '../lib/notifications';

const API = '/api/notifications/preferences';

// ─── One row of the grid ──────────────────────────────────────────────────────

function TypeRow({ type, modes, disabled, onChange }) {
  return (
    <div className="py-3 border-t border-gray-100 first:border-t-0">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-church-navy">{type.label}</p>
          {type.description && <p className="text-xs text-gray-500 mt-0.5">{type.description}</p>}
        </div>

        <div className="flex rounded-lg border border-gray-200 overflow-hidden shrink-0">
          {modes.map(mode => (
            <button
              key={mode.id}
              disabled={disabled}
              title={mode.label}
              onClick={() => onChange(type.id, { email: mode.id })}
              className={`px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                type.email === mode.id ? 'bg-church-navy text-church-gold' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {mode.short}
            </button>
          ))}
        </div>
      </div>

      <label className="flex items-center gap-2 mt-2 text-xs text-gray-500 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={type.inApp}
          disabled={disabled}
          onChange={e => onChange(type.id, { inApp: e.target.checked })}
          className="accent-church-navy rounded"
        />
        Show these in my notification inbox
      </label>
    </div>
  );
}

// ─── The screen ───────────────────────────────────────────────────────────────

// Every type the site can raise, grouped by the same categories the inbox uses,
// with the choice of being emailed straight away, having it saved for a digest,
// or hearing about it in the inbox only. Above them sit the switches that apply
// to the lot: a master off, and when the digest goes out.
export default function NotificationPreferences() {
  const [settings, setSettings] = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState('');
  const [saved,    setSaved]    = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const json = await call(API);
      setSettings(json.settings);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Saved a change at a time: there is no Save button to forget to press.
  async function update(payload) {
    setSaving(true); setError(''); setSaved(false);
    try {
      const json = await call(API, { method: 'PUT', ...jsonBody(payload) });
      setSettings(json.settings);
      setSaved(true);
    } catch (err) {
      setError(err.message);
      await load();
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="card flex justify-center py-8">
        <span className="animate-spin w-6 h-6 border-2 border-church-gold border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!settings) {
    return <div className="card"><p className="text-sm text-red-600">{error || 'Could not load your settings.'}</p></div>;
  }

  const { account, categories, emailModes, digestFrequencies } = settings;

  return (
    <div className="space-y-4">
      <div className="card space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-church-navy text-sm">Notifications</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Everything below always lands in your inbox on this site unless you say otherwise.
              These settings decide what also reaches your email.
            </p>
          </div>
          {saved && <span className="text-xs text-emerald-600 shrink-0">Saved</span>}
        </div>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={account.emailEnabled}
            disabled={saving}
            onChange={e => update({ emailEnabled: e.target.checked })}
            className="mt-0.5 w-4 h-4 rounded border-gray-300 accent-church-navy"
          />
          <span className="min-w-0">
            <span className="text-sm text-church-navy block">Email me at all</span>
            <span className="text-xs text-gray-500 block mt-0.5">
              Turn this off and the site will never write to you — everything still arrives in your inbox here.
            </span>
          </span>
        </label>

        {/* Digest schedule */}
        <div className={`space-y-2 ${account.emailEnabled ? '' : 'opacity-50 pointer-events-none'}`}>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">My digest arrives</p>
          <div className="flex gap-2 flex-wrap items-center">
            <select
              value={account.digest.frequency}
              disabled={saving}
              onChange={e => update({ digest: { frequency: e.target.value } })}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-church-gold"
            >
              {digestFrequencies.map(f => (
                <option key={f} value={f}>{f === 'daily' ? 'Every day' : 'Once a week'}</option>
              ))}
            </select>

            {account.digest.frequency === 'weekly' && (
              <select
                value={account.digest.weekday}
                disabled={saving}
                onChange={e => update({ digest: { weekday: Number(e.target.value) } })}
                className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-church-gold"
              >
                {WEEKDAYS.map((day, i) => <option key={day} value={i}>{day}</option>)}
              </select>
            )}

            <span className="text-sm text-gray-500">at</span>
            <select
              value={account.digest.hour}
              disabled={saving}
              onChange={e => update({ digest: { hour: Number(e.target.value) } })}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-church-gold"
            >
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* One card per category, in the same order as the inbox drawers */}
      {categories.map(category => (
        <div key={category.id} className="card">
          <div className="flex items-baseline gap-2">
            <span>{category.icon}</span>
            <h3 className="font-semibold text-church-navy text-sm">{category.label}</h3>
          </div>
          <p className="text-xs text-gray-500 mt-0.5 mb-2">{category.description}</p>

          {category.types.map(type => (
            <TypeRow
              key={type.id}
              type={type}
              modes={emailModes}
              disabled={saving}
              onChange={(id, change) => update({ types: { [id]: change } })}
            />
          ))}
        </div>
      ))}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
