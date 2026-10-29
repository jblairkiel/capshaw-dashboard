import { useState, useEffect, useCallback } from 'react';
import { starsOf } from './games';

// A teacher's classes: who is in each (from the directory, or a name typed
// in), who else teaches it, the class's board, and scoring recitations — pick
// a set, then give each student 1, 2 or 3 stars on each verse they recite.
// Only a class's own teachers ever see it.

const API = '/api/memory-verses';
const STAR_HELP = { 3: 'Word-perfect', 2: 'One or two helps', 1: 'Needed a lot of help' };

async function send(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'include',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  });
  const json = await res.json().catch(() => ({}));
  if (!json.success) throw new Error(json.error || 'Something went wrong');
  return json;
}
const post = (url, body) => send(url, { method: 'POST', body: JSON.stringify(body) });

const field = 'border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-church-gold';

// A quick search of the directory (for students) or accounts (for teachers).
function PersonFinder({ kind, placeholder, onPick, allowTyped }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState([]);
  useEffect(() => {
    if (q.trim().length < 2) { setFound([]); return undefined; }
    let live = true;
    const t = setTimeout(() => {
      send(`${API}/people?q=${encodeURIComponent(q.trim())}`).then(json => live && setFound(json[kind] || [])).catch(() => {});
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [q, kind]);
  const pick = choice => { onPick(choice); setQ(''); setFound([]); };
  return (
    <div className="relative">
      <div className="flex gap-2">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder} className={`${field} flex-1`} />
        {allowTyped && q.trim().length >= 2 && (
          <button type="button" onClick={() => pick({ name: q.trim() })} className="text-sm px-3 py-2 rounded-lg border border-gray-200 text-gray-600 whitespace-nowrap">
            Add &ldquo;{q.trim()}&rdquo;
          </button>
        )}
      </div>
      {found.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto" role="listbox" aria-label="Matches">
          {found.map(p => (
            <li key={p.id}>
              <button type="button" role="option" aria-selected="false" onClick={() => pick(p)} className="w-full text-left px-3 py-2 text-sm hover:bg-church-cream">{p.name}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Scoring one set: students down, verses across, stars in each cell.
function ScoreGrid({ classId, setId, onScored }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busyCell, setBusyCell] = useState('');

  useEffect(() => {
    send(`${API}/classes/${classId}/sets/${setId}`).then(setData).catch(err => setError(err.message));
  }, [classId, setId]);

  async function give(studentId, verseId, stars) {
    setBusyCell(`${studentId}|${verseId}`); setError('');
    try {
      const json = await post(`${API}/classes/${classId}/scores`, { studentId, verseId, stars });
      setData(d => ({ ...d, grid: json.grid }));
      onScored(json.class);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyCell('');
    }
  }

  if (error && !data) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return <p className="text-sm text-gray-400">Loading…</p>;
  const best = new Map(data.grid.map(g => [`${g.studentId}|${g.verseId}`, g.stars]));
  return (
    <div>
      <p className="text-xs text-gray-500 mb-2">
        Tap the stars for each verse a student recites: ★★★ {STAR_HELP[3].toLowerCase()}, ★★ {STAR_HELP[2].toLowerCase()}, ★ {STAR_HELP[1].toLowerCase()}.
        A verse can be scored again — their best counts.
      </p>
      {!data.students.length ? <p className="text-sm text-gray-500">Add students to the class first.</p> : (
        <div className="overflow-x-auto">
          <table className="text-sm border-collapse" aria-label={`Scores for ${data.set.title}`}>
            <thead>
              <tr className="bg-church-navy text-white">
                <th className="text-left px-2 py-1.5 font-medium sticky left-0 bg-church-navy">Student</th>
                {data.set.verses.map(v => <th key={v.id} className="px-2 py-1.5 font-semibold whitespace-nowrap">{v.reference}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.students.map((s, i) => (
                <tr key={s.id} className={i % 2 ? 'bg-white' : 'bg-church-cream'}>
                  <th scope="row" className={`text-left font-medium text-church-navy px-2 py-1 whitespace-nowrap sticky left-0 ${i % 2 ? 'bg-white' : 'bg-church-cream'}`}>{s.name}</th>
                  {data.set.verses.map(v => {
                    const have = best.get(`${s.id}|${v.id}`) || 0;
                    const key = `${s.id}|${v.id}`;
                    return (
                      <td key={v.id} className="px-2 py-1 text-center whitespace-nowrap">
                        {[1, 2, 3].map(n => (
                          <button key={n} type="button" disabled={busyCell === key} onClick={() => give(s.id, v.id, n)}
                            aria-label={`${s.name}, ${v.reference}: ${n} star${n === 1 ? '' : 's'}`} title={STAR_HELP[n]}
                            className={`text-lg leading-none px-0.5 ${n <= have ? 'text-church-gold' : 'text-gray-300 hover:text-church-gold/60'}`}>
                            ★
                          </button>
                        ))}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
    </div>
  );
}

const startOfTerm = () => {
  // This quarter, as Bible classes usually run.
  const d = new Date();
  const m = Math.floor(d.getMonth() / 3) * 3;
  return `${d.getFullYear()}-${String(m + 1).padStart(2, '0')}-01`;
};

function ClassDetail({ classId, sets, me, onBack, onChanged, onPresent }) {
  const [cls, setCls] = useState(null);
  const [period, setPeriod] = useState('term');
  const [scoringSet, setScoringSet] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');

  const query = period === 'term' ? `?from=${startOfTerm()}` : '';
  const load = useCallback(() => {
    send(`${API}/classes/${classId}${query}`).then(json => { setCls(json.class); setName(json.class.name); }).catch(err => setError(err.message));
  }, [classId, query]);
  useEffect(() => { load(); }, [load]);

  async function act(promise) {
    setError('');
    try {
      const json = await promise;
      if ('class' in json) {
        if (json.class) setCls(json.class);
        else { onChanged(); onBack(); }
      }
      return json;
    } catch (err) { setError(err.message); return null; }
  }

  if (!cls) return error ? <p className="text-sm text-red-600">{error}</p> : <p className="text-sm text-gray-400">Loading…</p>;
  const scoring = sets.find(s => String(s.id) === String(scoringSet));

  return (
    <div className="space-y-5">
      <button type="button" onClick={onBack} className="text-sm text-church-navy hover:text-church-gold">← All my classes</button>
      <div className="card space-y-2">
        {editing ? (
          <form className="flex flex-wrap gap-2" onSubmit={async e => { e.preventDefault(); if (await act(send(`${API}/classes/${cls.id}${query}`, { method: 'PUT', body: JSON.stringify({ name }) }))) { setEditing(false); onChanged(); } }}>
            <input value={name} onChange={e => setName(e.target.value)} className={`${field} flex-1`} aria-label="Class name" />
            <button className="btn-primary text-sm">Save</button>
            <button type="button" onClick={() => setEditing(false)} className="text-sm text-gray-500 underline">Cancel</button>
          </form>
        ) : (
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-serif text-xl font-semibold text-church-navy">{cls.name}{cls.archived && <span className="ml-2 text-xs font-sans text-gray-400">put away</span>}</h3>
            <div className="flex gap-3 text-xs">
              <button type="button" onClick={() => setEditing(true)} className="text-church-navy underline">Rename</button>
              <button type="button" onClick={async () => { await act(send(`${API}/classes/${cls.id}${query}`, { method: 'PUT', body: JSON.stringify({ archived: !cls.archived }) })); onChanged(); }}
                className="text-church-navy underline">{cls.archived ? 'Bring back' : 'Put away'}</button>
              <button type="button" onClick={async () => {
                if (!window.confirm(`Remove "${cls.name}" and all its scores? This cannot be undone.`)) return;
                await act(send(`${API}/classes/${cls.id}`, { method: 'DELETE' })); onChanged(); onBack();
              }} className="text-red-600 underline">Remove</button>
            </div>
          </div>
        )}
        <p className="text-xs text-gray-500">Teachers: {cls.teachers.map(t => t.name).join(', ')}. Only the teachers see this class; each student (or their family) sees just their own scores.</p>
      </div>

      <section className="card space-y-3" aria-label="Score recitations">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h4 className="section-heading mb-0">Score recitations</h4>
          <div className="flex flex-wrap gap-2 items-center">
            <select value={scoringSet} onChange={e => setScoringSet(e.target.value)} aria-label="Set to score" className={field}>
              <option value="">Choose a set…</option>
              {sets.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
            {scoring && <button type="button" onClick={() => onPresent(scoring.id)} className="text-sm px-3 py-2 rounded-lg border border-church-gold text-church-navy">Present this set</button>}
          </div>
        </div>
        {scoring ? <ScoreGrid classId={cls.id} setId={scoring.id} onScored={c => setCls(c)} /> : <p className="text-sm text-gray-500">Choose the set the class is learning to score its verses.</p>}
      </section>

      <section className="card space-y-3" aria-label="Class board">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="section-heading mb-0">Board</h4>
          <div className="flex gap-1 text-xs" role="group" aria-label="Period">
            {[['term', 'This quarter'], ['all', 'All time']].map(([id, label]) => (
              <button key={id} type="button" aria-pressed={period === id} onClick={() => setPeriod(id)}
                className={`px-3 py-1 rounded-full border ${period === id ? 'bg-church-navy text-white border-church-navy' : 'border-gray-200 text-gray-600'}`}>{label}</button>
            ))}
          </div>
        </div>
        {cls.board.length ? (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-500"><th className="py-1">Student</th><th>Points</th><th>Verses</th><th>Word-perfect</th></tr></thead>
            <tbody>
              {cls.board.map((b, i) => (
                <tr key={b.id} className="border-t border-gray-100">
                  <td className="py-1.5 font-medium text-church-navy">{i < 3 && b.points ? ['🥇', '🥈', '🥉'][i] : ''} {b.name}</td>
                  <td>{b.points}</td><td>{b.verses}</td><td>{b.perfect}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="text-sm text-gray-500">No students yet.</p>}
        <p className="text-xs text-gray-400">Points are each student&apos;s best stars on each verse they have recited.</p>
      </section>

      <div className="grid sm:grid-cols-2 gap-4">
        <section className="card space-y-2" aria-label="Students">
          <h4 className="section-heading mb-0">Students ({cls.students.length})</h4>
          <PersonFinder kind="people" placeholder="Add a student: search the directory or type a name" allowTyped
            onPick={p => act(post(`${API}/classes/${cls.id}/students${query}`, p.id ? { directoryId: p.id } : { name: p.name }))} />
          <ul className="divide-y divide-gray-100">
            {cls.students.map(s => (
              <li key={s.id} className="flex items-center justify-between py-1.5 text-sm">
                <span>{s.name}{!s.directoryId && <span className="ml-1 text-xs text-gray-400">(not in the directory)</span>}</span>
                <button type="button" onClick={() => window.confirm(`Take ${s.name} out of the class, with their scores?`) && act(send(`${API}/classes/${cls.id}/students/${s.id}${query}`, { method: 'DELETE' }))}
                  aria-label={`Remove ${s.name}`} className="text-xs text-red-600 underline">Remove</button>
              </li>
            ))}
          </ul>
        </section>
        <section className="card space-y-2" aria-label="Teachers">
          <h4 className="section-heading mb-0">Teachers</h4>
          <PersonFinder kind="accounts" placeholder="Add a teacher: search members' accounts"
            onPick={p => act(post(`${API}/classes/${cls.id}/teachers${query}`, { userId: p.id }))} />
          <ul className="divide-y divide-gray-100">
            {cls.teachers.map(t => (
              <li key={t.id} className="flex items-center justify-between py-1.5 text-sm">
                <span>{t.name}{t.id === me?.id && ' (you)'}</span>
                {cls.teachers.length > 1 && (
                  <button type="button" onClick={() => act(send(`${API}/classes/${cls.id}/teachers/${t.id}${query}`, { method: 'DELETE' }))}
                    className="text-xs text-red-600 underline">{t.id === me?.id ? 'Stop teaching' : 'Remove'}</button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>

      {cls.recent.length > 0 && (
        <section className="card" aria-label="Recent scores">
          <h4 className="section-heading">Recent scores</h4>
          <ul className="divide-y divide-gray-100 text-sm">
            {cls.recent.slice(0, 25).map(r => (
              <li key={r.id} className="flex items-center justify-between py-1.5 gap-2">
                <span><span className="text-church-gold">{starsOf(r.stars)}</span> {r.student} · {r.reference} <span className="text-xs text-gray-400">{r.scoredOn}</span></span>
                <button type="button" onClick={() => act(send(`${API}/classes/${cls.id}/scores/${r.id}${query}`, { method: 'DELETE' }))}
                  aria-label={`Take back ${r.student}'s score on ${r.reference}`} className="text-xs text-gray-500 underline">Take back</button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

export default function Classes({ classes, sets, me, onChanged, onPresent }) {
  const [open, setOpen] = useState(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  if (open) return <ClassDetail classId={open} sets={sets} me={me} onBack={() => setOpen(null)} onChanged={onChanged} onPresent={onPresent} />;

  async function start(e) {
    e.preventDefault(); setError('');
    try {
      const json = await post(`${API}/classes`, { name });
      setName(''); onChanged(); setOpen(json.id);
    } catch (err) { setError(err.message); }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={start} className="card flex flex-wrap items-end gap-2">
        <label className="flex-1 min-w-[14rem]">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Start a class</span>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Wednesday 3rd–5th grade" className={`${field} mt-1 w-full`} />
        </label>
        <button disabled={name.trim().length < 3} className="btn-primary text-sm disabled:opacity-50">Start</button>
        {error && <p className="w-full text-sm text-red-600">{error}</p>}
      </form>
      {!classes.length ? (
        <p className="text-sm text-gray-500">You do not teach any classes yet. Start one above, or ask a teacher to add you to theirs.</p>
      ) : (
        <ul className="grid sm:grid-cols-2 gap-3">
          {classes.map(c => (
            <li key={c.id}>
              <button type="button" onClick={() => setOpen(c.id)} className={`card w-full text-left hover:border-church-gold border-2 border-transparent ${c.archived ? 'opacity-60' : ''}`}>
                <span className="block font-semibold text-church-navy">{c.name}</span>
                <span className="block text-xs text-gray-500 mt-1">
                  {c.students} student{c.students === 1 ? '' : 's'}{c.lastScored ? ` · last scored ${c.lastScored}` : ''}{c.archived ? ' · put away' : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
