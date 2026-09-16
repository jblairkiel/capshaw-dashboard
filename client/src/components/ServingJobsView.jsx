import { useState, useEffect, useCallback, useMemo } from 'react';
import { levelInfo } from '../lib/worship';

// The page behind the Serving Schedule area: who may sign themselves up for
// which worship job.
//
// Being a man in the directory is what makes somebody eligible to serve at all;
// this is where the schedule keeper says which particular jobs each of them has
// been signed off for. Nobody can hand themselves one — the server refuses it.
const API = '/api/serving';

async function send(url, options = {}) {
  const res  = await fetch(url, { credentials: 'include', ...options });
  const json = await res.json().catch(() => ({}));
  if (!json.success) throw new Error(json.error || 'Something went wrong');
  return json;
}

function GenderBadge({ gender }) {
  if (gender === 'male')   return <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">Man</span>;
  if (gender === 'female') return <span className="text-xs px-2 py-0.5 rounded-full bg-rose-50 text-rose-700">Woman</span>;
  return <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Not said</span>;
}

// One person's row of job checkboxes. Saving is per person, so a slip only ever
// affects the person being edited.
function MemberRow({ member, jobs, onSaved }) {
  const [chosen, setChosen] = useState(() => new Set(member.jobs));
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState('');
  const [saved, setSaved]   = useState(false);

  useEffect(() => { setChosen(new Set(member.jobs)); setSaved(false); }, [member.jobs]);

  const dirty = useMemo(() => {
    const before = [...member.jobs].sort().join('|');
    return [...chosen].sort().join('|') !== before;
  }, [chosen, member.jobs]);

  function toggle(job) {
    setSaved(false);
    setChosen(prev => {
      const next = new Set(prev);
      if (next.has(job)) next.delete(job); else next.add(job);
      return next;
    });
  }

  async function save() {
    setBusy(true); setError('');
    try {
      const json = await send(`${API}/members/${member.id}/jobs`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ jobs: [...chosen] }),
      });
      onSaved(json.member);
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-b border-gray-100 last:border-0 px-4 py-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-church-navy">{member.name}</span>
            <GenderBadge gender={member.gender} />
            {member.assignments > 0 && (
              <span className="text-xs text-gray-400">{member.assignments} turn{member.assignments === 1 ? '' : 's'} on the roster</span>
            )}
          </div>
          {member.gender !== 'male' && (
            <p className="text-xs text-gray-400 mt-0.5">
              Only the men can sign themselves up. Jobs set here wait until their profile says so.
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {saved && !dirty && <span className="text-xs text-emerald-600">Saved</span>}
          <button
            onClick={save}
            disabled={busy || !dirty}
            className="btn-primary text-sm disabled:opacity-40"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {jobs.map(job => {
          const on = chosen.has(job);
          // What they said about the job themselves, so a keeper is not signing
          // somebody off for something they asked not to do.
          const preference = levelInfo(member.preferences?.[job]);
          return (
            <button
              key={job}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(job)}
              title={preference ? `They said: ${preference.label}` : 'No preference given'}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                on
                  ? 'bg-church-navy text-white border-church-navy'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-church-gold'
              }`}
            >
              {job}
              {preference && (
                <span className={on ? 'ml-1 opacity-70' : 'ml-1 text-gray-400'}>· {preference.label}</span>
              )}
            </button>
          );
        })}
      </div>

      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
    </div>
  );
}

export default function ServingJobsView() {
  const [members, setMembers] = useState([]);
  const [jobs, setJobs]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [search, setSearch]   = useState('');
  const [onlyMen, setOnlyMen] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const json = await send(`${API}/members`);
      setMembers(json.members);
      setJobs(json.jobs);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return members.filter(m =>
      (!onlyMen || m.gender === 'male') &&
      (!q || m.name.toLowerCase().includes(q))
    );
  }, [members, search, onlyMen]);

  const signedOff = members.filter(m => m.jobs.length > 0).length;

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
          <h2 className="section-heading mb-1">Member Jobs</h2>
          <p className="text-sm text-gray-500">
            Who may sign themselves up for which worship job. {signedOff} of {members.length} members are signed off for something.
          </p>
        </div>
        <button onClick={load} className="text-sm text-church-gold hover:text-church-navy transition-colors px-2">Refresh</button>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="text"
          placeholder="Search members…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-church-navy w-64 max-w-full"
        />
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={onlyMen} onChange={e => setOnlyMen(e.target.checked)} className="accent-church-gold" />
          Only show the men
        </label>
        <span className="text-xs text-gray-400">{shown.length} shown</span>
      </div>

      <div className="card p-0 overflow-hidden">
        {shown.map(member => (
          <MemberRow
            key={member.id}
            member={member}
            jobs={jobs}
            onSaved={updated => setMembers(prev => prev.map(m => (m.id === updated.id ? { ...m, jobs: updated.jobs } : m)))}
          />
        ))}
        {shown.length === 0 && (
          <p className="px-4 py-12 text-center text-gray-400 text-sm">
            Nobody matches. {onlyMen && 'Members show up here once their profile says they are a man.'}
          </p>
        )}
      </div>
    </div>
  );
}
