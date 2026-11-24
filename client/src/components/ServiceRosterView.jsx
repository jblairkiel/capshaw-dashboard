import { useState, useEffect } from 'react';
import Dialog from './Dialog';
import WorshipPreferences from './WorshipPreferences';
import TimeAway from './TimeAway';
import { AnalysisTab, PreferencesTab } from './WorshipParticipationView';
import ServingSchedule from './ServingSchedule';

// ─── Service Roster ───────────────────────────────────────────────────────────
//
// The Serving Schedule area's page, in three tabs:
//
//   Scheduled   — the month itself, for everyone: who is down for what, each
//                 service with its own link, asking to be replaced. Whoever
//                 keeps the schedule builds a month here (filled from what the
//                 men have said) and changes any name by clicking it.
//   Preferences — what each man has said he will do. The keeper opens a man
//                 to record it for him when he said it in the foyer rather
//                 than on My Household & Preferences, and his time away the
//                 same way; otherwise each man keeps his own.
//   Analysis    — who has served, and how the load is spread.
//
// Members see the Scheduled tab only.
const API = '/api/serving';

async function send(url, options = {}) {
  const res  = await fetch(url, { credentials: 'include', ...options });
  const json = await res.json().catch(() => ({}));
  if (!json.success) throw new Error(json.error || 'Something went wrong');
  return json;
}

// Whether a man is rostered for the worship jobs. By default that is a man who
// is a baptized member; the keeper records the membership here, and can say
// "always" or "never" for one person when the default is wrong for him.

const MEMBERSHIP_OPTIONS = [
  { value: '',           label: 'Not recorded' },
  { value: 'member',     label: 'Baptized member' },
  { value: 'not-member', label: 'Not a member' },
];

const OVERRIDE_OPTIONS = [
  { value: '',    label: 'Follow the default' },
  { value: 'yes', label: 'Always roster' },
  { value: 'no',  label: 'Never roster' },
];

function Participation({ member, onSaved }) {
  const p = member.participation ?? { membership: '', override: '', participates: false, reason: '' };
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function change(field, value) {
    setSaving(true);
    setError('');
    try {
      const json = await send(`${API}/members/${member.id}/participation`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ [field]: value }),
      });
      onSaved(json.member);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const control = 'border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white';
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold text-church-navy">Worship jobs</h4>
      <div className="flex flex-wrap gap-3">
        <label className="text-xs text-gray-500 flex flex-col gap-1">
          Membership
          <select value={p.membership} disabled={saving} onChange={e => change('membership', e.target.value)} className={control}>
            {MEMBERSHIP_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="text-xs text-gray-500 flex flex-col gap-1">
          Rostered
          <select value={p.override} disabled={saving} onChange={e => change('override', e.target.value)} className={control}>
            {OVERRIDE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      </div>
      <p className={`text-xs ${p.participates ? 'text-emerald-700' : 'text-amber-800'}`}>
        {p.participates ? 'Rostered for the worship jobs' : 'Not rostered for the worship jobs'}{p.reason ? ` (${p.reason.replace(/^Not rostered( yet)?: /, '')})` : ''}.
        {' '}By default the worship jobs go to men who are baptized members.
      </p>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

// A man, opened from the Preferences tab: what he has said he will do, and his
// time away — both his own to keep, and the keeper's to record for him when he
// says it in the foyer instead.

function ManDialog({ member, onClose, onSaved, onTimeAwayChanged, onRecord }) {
  async function save(body) {
    const json = await send(`${API}/members/${member.id}/preferences`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    onSaved(json.member);
  }

  async function blockOut(range) {
    await send(`${API}/blackouts`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ...range, directoryId: member.id }),
    });
    await onTimeAwayChanged();
  }

  async function clearTimeAway(id) {
    await send(`${API}/blackouts/${id}`, { method: 'DELETE' });
    await onTimeAwayChanged();
  }

  return (
    <Dialog
      title={member.name}
      subtitle={`${member.assignments || 0} turn${member.assignments === 1 ? '' : 's'} on the roster`}
      onClose={onClose}
      width="max-w-lg"
    >
      <div className="space-y-4">
        {member.gender !== 'male' && member.participation?.override !== 'yes' && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            This congregation rosters the worship jobs among its men, so nothing recorded here puts
            them on the roster until their directory entry says so.
          </p>
        )}

        <Participation member={member} onSaved={onSaved} />

        <WorshipPreferences
          // Remounted whenever what is on file changes, so the editor is
          // never left holding a set that has since been saved over.
          key={JSON.stringify(member.preferences) + member.notes}
          person={{ worship: { preferences: member.preferences, notes: member.notes } }}
          onSave={save}
        />

        <div className="border-t border-gray-100 pt-3">
          <TimeAway
            blackouts={member.blackouts ?? []}
            onAdd={blockOut}
            onRemove={clearTimeAway}
            heading="Time away"
            hint={`Days ${member.name} will not be here. The month builder skips them when filling a slot.`}
            emptyText="Nothing blocked out — he is available for every service on the roster."
          />
        </div>

        <div className="border-t border-gray-100 pt-3 flex justify-end">
          <button type="button" onClick={onRecord} className="text-sm text-church-gold hover:text-church-navy">See what he has served →</button>
        </div>
      </div>
    </Dialog>
  );
}

// ─── The page ─────────────────────────────────────────────────────────────────

const ROSTER_TABS = [
  { id: 'scheduled',   label: 'Scheduled' },
  { id: 'preferences', label: 'Preferences', keeper: true },
  { id: 'analysis',    label: 'Analysis',    keeper: true },
];

export default function ServiceRosterView({ canManage = true, tab = 'scheduled', onTabChange, focus = null }) {
  const tabs = ROSTER_TABS.filter(t => canManage || !t.keeper);
  const [own, setOwn] = useState(tab);
  const wanted = onTabChange ? tab : own;
  // The old Roster tab is the Preferences tab now.
  const asked = wanted === 'roster' ? 'preferences' : wanted;
  const active = tabs.some(t => t.id === asked) ? asked : 'scheduled';
  const choose = id => (onTabChange ? onTabChange(id) : setOwn(id));
  const [who, setWho] = useState('');

  // The man opened from the Preferences tab, read fresh from the roster.
  const [openId, setOpenId] = useState(null);
  const [members, setMembers] = useState([]);
  const [prefsKey, setPrefsKey] = useState(0);
  const loadMembers = async () => setMembers((await send(`${API}/members`)).members);
  useEffect(() => { if (openId && !members.length) loadMembers().catch(() => {}); }, [openId]); // eslint-disable-line react-hooks/exhaustive-deps
  const man = members.find(m => m.id === openId) ?? null;
  const changed = async () => { await loadMembers(); setPrefsKey(k => k + 1); };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="section-heading mb-1">Service Roster</h2>
        <p className="text-sm text-gray-500">
          {canManage
            ? 'Who is down for each worship job, what each man will serve in, and who has served.'
            : 'Who is down for each worship job. If you cannot do one you are down for, ask to be replaced.'}
        </p>
      </div>
      {tabs.length > 1 && (
        <div role="tablist" aria-label="Service roster" className="flex gap-1 border-b border-gray-200 overflow-x-auto">
          {tabs.map(t => (
            <button key={t.id} type="button" role="tab" aria-selected={active === t.id} onClick={() => choose(t.id)}
              className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 whitespace-nowrap ${active === t.id ? 'border-church-gold text-church-navy' : 'border-transparent text-gray-500 hover:text-church-navy'}`}>
              {t.label}
            </button>
          ))}
        </div>
      )}
      {active === 'scheduled' && <ServingSchedule focus={focus} />}
      {active === 'preferences' && <PreferencesTab key={prefsKey} onPick={(name, personId) => setOpenId(personId)} onMarked={() => { if (members.length) loadMembers().catch(() => {}); }} />}
      {active === 'analysis' && <AnalysisTab who={who} setWho={setWho} />}

      {man && (
        <ManDialog
          member={man}
          onClose={() => setOpenId(null)}
          onSaved={changed}
          onTimeAwayChanged={changed}
          onRecord={() => { setWho(man.name); setOpenId(null); choose('analysis'); }}
        />
      )}
    </div>
  );
}
