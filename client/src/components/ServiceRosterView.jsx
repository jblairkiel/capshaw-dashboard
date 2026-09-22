import { useState, useEffect, useCallback, useMemo } from 'react';
import WorshipPreferences from './WorshipPreferences';
import TimeAway from './TimeAway';
import { describeRange } from '../lib/timeAway';
import { WORSHIP_ROLES, levelInfo } from '../lib/worship';

// ─── Service Roster ───────────────────────────────────────────────────────────
//
// The page behind the Serving Schedule area for the question that comes before
// the schedule itself: what will each man of the congregation volunteer for?
//
// A man can say so himself on My Household & Preferences, and most never will —
// they say it in the foyer instead. So whoever builds the roster writes it down
// here, against the same roles and the same three answers, and the action
// history records who recorded it.
//
// It is also where the schedule keeper writes down the days a man will be
// away, for the same reason: he says "we are at the beach that fortnight" in
// the foyer rather than typing it in. Blocked-out days keep him off the
// schedule and out of the sign-up list until they pass.
//
// What this page is *not* is who may sign themselves up: that is Member Jobs,
// and it is a separate decision. A preference is what somebody wants; being
// signed off is what the schedule keeper has agreed to. This page shows both,
// and only edits the first.
const API = '/api/serving';

async function send(url, options = {}) {
  const res  = await fetch(url, { credentials: 'include', ...options });
  const json = await res.json().catch(() => ({}));
  if (!json.success) throw new Error(json.error || 'Something went wrong');
  return json;
}

// Somebody has "said" once they have an opinion about any role at all.
function hasSpoken(member) {
  return Object.keys(member.preferences || {}).length > 0;
}

function rolesAt(member, level) {
  return WORSHIP_ROLES.filter(role => member.preferences?.[role] === level);
}

function GenderBadge({ gender }) {
  if (gender === 'male')   return <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">Man</span>;
  if (gender === 'female') return <span className="text-xs px-2 py-0.5 rounded-full bg-rose-50 text-rose-700">Woman</span>;
  return <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Not said</span>;
}

// ─── Where the roster is thin ─────────────────────────────────────────────────
// A job with nobody behind it is the thing this page exists to surface, so it
// is counted up here rather than left to be noticed row by row — and counted
// over the whole page, not over what a search happens to leave on screen.

function Coverage({ members }) {
  const counts = useMemo(() => WORSHIP_ROLES.map(role => ({
    role,
    glad:    members.filter(m => m.preferences?.[role] === 'preferred').length,
    willing: members.filter(m => m.preferences?.[role] === 'willing').length,
  })), [members]);

  const bare = counts.filter(c => c.glad + c.willing === 0);

  return (
    <div className="card p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-church-navy">Who is behind each job</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Counted across everyone this page covers, whatever the search box below says —
          glad to first, then willing if needed.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {counts.map(({ role, glad, willing }) => {
          const total = glad + willing;
          return (
            <div
              key={role}
              className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 ${
                total === 0 ? 'border-amber-200 bg-amber-50' : 'border-gray-100 bg-white'
              }`}
            >
              <span className="text-sm text-gray-700 truncate">{role}</span>
              {total === 0 ? (
                <span className="text-xs text-amber-700 shrink-0">nobody yet</span>
              ) : (
                <span className="text-xs text-gray-500 shrink-0">
                  <span className="text-emerald-700 font-medium">{glad}</span> glad
                  {willing > 0 && <> · {willing} willing</>}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {bare.length > 0 && (
        <p className="text-xs text-amber-700">
          Nobody has volunteered for {bare.map(c => c.role).join(', ')}. Ask around, then write it down here.
        </p>
      )}
    </div>
  );
}

// ─── One man's row ────────────────────────────────────────────────────────────

function RosterRow({ member, onSaved, onTimeAwayChanged }) {
  const [open, setOpen] = useState(false);

  const glad    = rolesAt(member, 'preferred');
  const willing = rolesAt(member, 'willing');
  const rather  = rolesAt(member, 'unavailable');

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
    <div className="border-b border-gray-100 last:border-0">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-label={`Preferences for ${member.name}`}
        className="w-full text-left px-4 py-3 flex items-start justify-between gap-3 hover:bg-gray-50 transition-colors"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-church-navy">{member.name}</span>
            <GenderBadge gender={member.gender} />
            {member.assignments > 0 && (
              <span className="text-xs text-gray-400">
                {member.assignments} turn{member.assignments === 1 ? '' : 's'} on the roster
              </span>
            )}
          </div>

          {(member.blackouts?.length ?? 0) > 0 && (
            <p className="text-xs text-amber-700 mt-1">
              Away {member.blackouts.map(describeRange).join(', ')}
            </p>
          )}

          {hasSpoken(member) ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {glad.map(role => (
                <span key={role} className={`text-xs px-2 py-0.5 rounded-full border ${levelInfo('preferred').tone}`}>{role}</span>
              ))}
              {willing.map(role => (
                <span key={role} className={`text-xs px-2 py-0.5 rounded-full border ${levelInfo('willing').tone}`}>{role}</span>
              ))}
              {rather.length > 0 && (
                <span className="text-xs text-gray-400 self-center">
                  · rather not: {rather.join(', ')}
                </span>
              )}
            </div>
          ) : (
            <p className="text-xs text-gray-400 mt-1">Nothing said yet — open this to write down what he told you.</p>
          )}
        </div>

        <svg
          className={`w-4 h-4 shrink-0 text-gray-400 mt-1 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4">
          {member.gender !== 'male' && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              This congregation rosters the worship jobs among its men, so nothing recorded here lets
              them sign up until their directory entry says so.
            </p>
          )}

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
              hint={`Days ${member.name} will not be here. The month builder skips them, and he cannot sign himself up for one.`}
              emptyText="Nothing blocked out — he is available for every service on the roster."
            />
          </div>

          <div className="text-xs text-gray-500 border-t border-gray-100 pt-3">
            <span className="font-medium text-gray-600">Signed off to sign up for: </span>
            {member.jobs.length
              ? member.jobs.join(', ')
              : 'nothing yet'}
            <span className="text-gray-400"> — set on Church Office → Member Jobs.</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── The page ─────────────────────────────────────────────────────────────────

const SHOWING = [
  { id: 'all',    label: 'Everyone shown' },
  { id: 'spoken', label: 'Has said something' },
  { id: 'quiet',  label: 'Has not said yet' },
];

export default function ServiceRosterView() {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [search, setSearch]   = useState('');
  const [onlyMen, setOnlyMen] = useState(true);
  const [showing, setShowing] = useState('all');

  // `quiet` reloads without the spinner, for a change made inside an open row —
  // blocking out somebody's days should not fold the row back up under them.
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const json = await send(`${API}/members`);
      setMembers(json.members);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const refresh = useCallback(() => load(true), [load]);

  // The men are who the roster is built from, so the coverage counts follow the
  // same filter the list does rather than the whole directory.
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return members.filter(m =>
      (!onlyMen || m.gender === 'male') &&
      (!q || m.name.toLowerCase().includes(q)) &&
      (showing === 'all' || (showing === 'spoken' ? hasSpoken(m) : !hasSpoken(m)))
    );
  }, [members, search, onlyMen, showing]);

  const pool   = useMemo(() => members.filter(m => !onlyMen || m.gender === 'male'), [members, onlyMen]);
  const spoken = pool.filter(hasSpoken).length;

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
        <div>
          <h2 className="section-heading mb-1">Service Roster</h2>
          <p className="text-sm text-gray-500 max-w-2xl">
            What each man of the congregation will volunteer for, so a month can be built from
            what people have actually agreed to. {spoken} of {pool.length} have said something.
          </p>
        </div>
        <button onClick={load} className="text-sm text-church-gold hover:text-church-navy transition-colors px-2">Refresh</button>
      </div>

      <Coverage members={pool} />

      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="text"
          placeholder="Search members…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-church-navy w-64 max-w-full"
        />
        <select
          value={showing}
          onChange={e => setShowing(e.target.value)}
          aria-label="Who to show"
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-church-navy"
        >
          {SHOWING.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={onlyMen} onChange={e => setOnlyMen(e.target.checked)} className="accent-church-gold" />
          Only show the men
        </label>
        <span className="text-xs text-gray-400">{shown.length} shown</span>
      </div>

      <div className="card p-0 overflow-hidden">
        {shown.map(member => (
          <RosterRow
            key={member.id}
            member={member}
            onSaved={updated => setMembers(prev => prev.map(m => (
              m.id === updated.id
                ? { ...m, preferences: updated.preferences, notes: updated.notes }
                : m
            )))}
            onTimeAwayChanged={refresh}
          />
        ))}
        {shown.length === 0 && (
          <p className="px-4 py-12 text-center text-gray-400 text-sm">
            Nobody matches. {onlyMen && 'Members show up here once their directory entry says they are a man.'}
          </p>
        )}
      </div>
    </div>
  );
}
