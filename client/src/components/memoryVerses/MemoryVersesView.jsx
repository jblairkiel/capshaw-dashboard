import { useState, useEffect, useCallback } from 'react';
import HowTo from './HowTo';
import Practice from './Practice';
import SetEditor from './SetEditor';
import Classes from './Classes';
import { DIFFICULTY_LABEL, AUDIENCE_LABEL, DIFFICULTY_TONE, starsOf } from './games';

// ─── Memory Verses ────────────────────────────────────────────────────────────
//
// Bible Class → Memory Verses. The how-to sits at the front. Then four tabs:
//   · Library — every set, searchable and filtered by category, difficulty,
//     age group and translation; open one to practise, present, copy or change it.
//   · My practice — what is due today, verses learned, and the streak.
//   · My classes — the classes this member teaches, and scoring them.
//   · My scores — their own (and their household's) scores from classes.
// The server says what each member may do (lib/memoryVerses).

const API = '/api/memory-verses';

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

const TABS = [['library', 'Library'], ['practice', 'My practice'], ['classes', 'My classes'], ['scores', 'My scores']];
const field = 'border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-church-gold';

function Badges({ set }) {
  return (
    <span className="flex flex-wrap gap-1 text-[11px]">
      <span className={`px-2 py-0.5 rounded-full ${DIFFICULTY_TONE[set.difficulty] || 'bg-gray-100'}`}>{DIFFICULTY_LABEL[set.difficulty]}</span>
      <span className="px-2 py-0.5 rounded-full bg-church-cream text-church-navy">{set.category}</span>
      <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{AUDIENCE_LABEL[set.audience]}</span>
    </span>
  );
}

function Progress({ learned, total }) {
  if (!total) return null;
  const pct = Math.round((learned / total) * 100);
  return (
    <span className="block mt-2" aria-label={`${learned} of ${total} learned`}>
      <span className="block h-1.5 rounded-full bg-gray-100 overflow-hidden"><span className="block h-full bg-church-gold" style={{ width: `${pct}%` }} /></span>
      <span className="block text-[11px] text-gray-500 mt-0.5">{learned ? `${learned} of ${total} learned` : `${total} verse${total === 1 ? '' : 's'}`}</span>
    </span>
  );
}

// ─── The library ──────────────────────────────────────────────────────────────

function Library({ meta, onOpen, onNew, reloadKey }) {
  const [filters, setFilters] = useState({ q: '', category: '', difficulty: '', audience: '', translation: '', mine: false, sort: 'title' });
  const [sets, setSets] = useState(null);
  const [error, setError] = useState('');
  const put = (k, v) => setFilters(f => ({ ...f, [k]: v }));

  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v).map(([k, v]) => [k, v === true ? '1' : v]));
      send(`${API}/sets?${params}`).then(json => live && setSets(json.sets)).catch(err => live && setError(err.message));
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [filters, reloadKey]);

  const any = filters.q || filters.category || filters.difficulty || filters.audience || filters.translation || filters.mine;
  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div className="flex flex-wrap gap-2">
          <input type="search" value={filters.q} onChange={e => put('q', e.target.value)} placeholder="Search a word, a reference, or a topic…"
            aria-label="Search the library" className={`${field} flex-1 min-w-[14rem]`} />
          <button type="button" onClick={onNew} className="btn-primary text-sm">Make a new set</button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <select value={filters.category} onChange={e => put('category', e.target.value)} aria-label="Category" className={field}>
            <option value="">Every category</option>
            {meta.categories.map(c => <option key={c}>{c}</option>)}
          </select>
          <select value={filters.difficulty} onChange={e => put('difficulty', e.target.value)} aria-label="Difficulty" className={field}>
            <option value="">Any difficulty</option>
            {meta.difficulties.map(d => <option key={d} value={d}>{DIFFICULTY_LABEL[d]}</option>)}
          </select>
          <select value={filters.audience} onChange={e => put('audience', e.target.value)} aria-label="Age group" className={field}>
            <option value="">Any age</option>
            {meta.audiences.filter(a => a !== 'everyone').map(a => <option key={a} value={a}>{AUDIENCE_LABEL[a]}</option>)}
          </select>
          <select value={filters.translation} onChange={e => put('translation', e.target.value)} aria-label="Translation" className={field}>
            <option value="">Any translation</option>
            {meta.translations.map(t => <option key={t}>{t}</option>)}
          </select>
          <select value={filters.sort} onChange={e => put('sort', e.target.value)} aria-label="Sort" className={field}>
            <option value="title">A to Z</option>
            <option value="difficulty">Easiest first</option>
            <option value="newest">Newest first</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2 text-gray-600">
            <input type="checkbox" checked={filters.mine} onChange={e => put('mine', e.target.checked)} className="accent-church-gold" />
            Only sets I made
          </label>
          {any && <button type="button" onClick={() => setFilters({ q: '', category: '', difficulty: '', audience: '', translation: '', mine: false, sort: filters.sort })} className="text-church-navy underline">Clear</button>}
          {sets && <span className="text-gray-400 ml-auto">{sets.length} set{sets.length === 1 ? '' : 's'}</span>}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!sets ? <p className="text-sm text-gray-400">Loading…</p> : !sets.length ? (
        <p className="text-sm text-gray-500">No sets match. Try fewer words, clear the filters — or make the set yourself.</p>
      ) : (
        <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3" aria-label="Sets">
          {sets.map(s => (
            // min-w-0: a grid item will not shrink below its longest unbroken
            // line otherwise, and the one-line verse preview would push the
            // card off a phone's screen.
            <li key={s.id} className="min-w-0">
              <button type="button" onClick={() => onOpen(s.id)} className="card w-full h-full min-w-0 overflow-hidden text-left border-2 border-transparent hover:border-church-gold transition-colors">
                <span className="block font-semibold text-church-navy">{s.title}</span>
                <span className="block mt-1.5"><Badges set={s} /></span>
                {s.description && <span className="block text-xs text-gray-500 mt-2 line-clamp-2">{s.description}</span>}
                <span className="block text-[11px] text-gray-400 mt-1.5 truncate">{s.preview}</span>
                <Progress learned={s.learned} total={s.verseCount} />
                <span className="block text-[11px] text-gray-400 mt-1">{s.builtIn ? 'Built in' : `By ${s.createdBy || 'a member'}`} · {s.translation}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── One set ──────────────────────────────────────────────────────────────────

function SetView({ id, meta, onBack, onChanged, onPractise, onEdit }) {
  const [set, setSet] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => send(`${API}/sets/${id}`).then(json => setSet(json.set)).catch(err => setError(err.message)), [id]);
  useEffect(() => { load(); }, [load]);

  async function copy() {
    try { const json = await send(`${API}/sets/${id}/copy`, { method: 'POST' }); onChanged(); onEdit(json.set); }
    catch (err) { setError(err.message); }
  }
  async function remove() {
    if (!window.confirm(`Remove "${set.title}" from the library? Everybody's practice on it goes too.`)) return;
    try { await send(`${API}/sets/${id}`, { method: 'DELETE' }); onChanged(); onBack(); }
    catch (err) { setError(err.message); }
  }

  if (!set) return error ? <p className="text-sm text-red-600">{error}</p> : <p className="text-sm text-gray-400">Loading…</p>;
  const learned = set.verses.filter(v => v.progress?.learned).length;
  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="text-sm text-church-navy hover:text-church-gold">← The library</button>
      <div className="card space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-serif text-2xl font-semibold text-church-navy">{set.title}</h3>
            <div className="mt-1.5"><Badges set={set} /></div>
            {set.description && <p className="text-sm text-gray-600 mt-2">{set.description}</p>}
            <p className="text-xs text-gray-400 mt-1">{set.builtIn ? 'Built in' : `Made by ${set.createdBy || 'a member'}`} · {set.translation}{set.tags.length ? ` · ${set.tags.join(', ')}` : ''}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => onPractise(set, false)} className="btn-primary text-sm">Practise</button>
            <button type="button" onClick={() => onPractise(set, true)} className="text-sm px-3 py-2 rounded-lg border border-church-gold text-church-navy">Present</button>
          </div>
        </div>
        <Progress learned={learned} total={set.verses.length} />
        <div className="flex flex-wrap gap-3 text-xs">
          <button type="button" onClick={copy} className="text-church-navy underline">Make a copy</button>
          {set.canEdit && <button type="button" onClick={() => onEdit(set)} className="text-church-navy underline">Change</button>}
          {set.canRemove && <button type="button" onClick={remove} className="text-red-600 underline">Remove</button>}
        </div>
      </div>
      <ol className="space-y-2" aria-label="Verses">
        {set.verses.map(v => (
          <li key={v.id} className="card py-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-semibold text-church-navy">{v.reference}</span>
              {v.progress && (
                <span className={`text-[11px] px-2 py-0.5 rounded-full ${v.progress.learned ? 'bg-emerald-100 text-emerald-800' : v.progress.due ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600'}`}>
                  {v.progress.learned ? 'Learned' : v.progress.due ? 'Due today' : `Next on ${v.progress.dueOn}`}
                </span>
              )}
            </div>
            <p className="font-serif text-gray-700 mt-1">{v.text}</p>
          </li>
        ))}
      </ol>
      {set.translation === meta.defaultTranslation && <p className="text-[11px] text-gray-400">{meta.notice}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

// ─── My practice and my scores ────────────────────────────────────────────────

function MyPractice({ me, onOpen }) {
  const p = me.practice;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {[['Verses learned', p.learned], ['Day streak', p.streak], ['Due today', p.due.length]].map(([label, n]) => (
          <div key={label} className="card text-center py-4">
            <span className="block text-3xl font-serif font-bold text-church-navy">{n}</span>
            <span className="block text-xs text-gray-500 mt-1">{label}</span>
          </div>
        ))}
      </div>
      {p.streak > 0 && !p.practisedToday && <p className="text-sm text-amber-700">Practise today to keep your {p.streak}-day streak going.</p>}
      <section className="card">
        <h4 className="section-heading">Due for review</h4>
        {!p.due.length ? <p className="text-sm text-gray-500">Nothing due. Open a set in the library to start something new.</p> : (
          <ul className="divide-y divide-gray-100">
            {[...new Map(p.due.map(d => [d.setId, d])).values()].map(d => (
              <li key={d.setId} className="flex items-center justify-between py-2 text-sm">
                <span><span className="font-medium text-church-navy">{d.setTitle}</span> <span className="text-gray-500">· {p.due.filter(x => x.setId === d.setId).map(x => x.reference).join(', ')}</span></span>
                <button type="button" onClick={() => onOpen(d.setId)} className="text-church-navy underline whitespace-nowrap">Open</button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {p.sets.length > 0 && (
        <section className="card">
          <h4 className="section-heading">Sets you are learning</h4>
          <ul className="divide-y divide-gray-100">
            {p.sets.map(s => (
              <li key={s.id} className="py-2">
                <button type="button" onClick={() => onOpen(s.id)} className="w-full text-left text-sm">
                  <span className="font-medium text-church-navy">{s.title}</span>
                  <Progress learned={s.learned} total={s.verseCount} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function MyScores({ me }) {
  if (!me.scores.length) {
    return <p className="text-sm text-gray-500">No class scores yet. When a teacher scores you — or a child in your household — in a memory verse class, they show here.</p>;
  }
  return (
    <div className="space-y-4">
      {me.scores.map(c => (
        <section key={`${c.classId}-${c.student}`} className="card" aria-label={`${c.student} in ${c.className}`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="font-semibold text-church-navy">{c.self ? c.className : `${c.student} · ${c.className}`}</h4>
            <span className="text-sm text-gray-600">{c.points} point{c.points === 1 ? '' : 's'} · {c.verses} verse{c.verses === 1 ? '' : 's'} · {c.perfect} word-perfect</span>
          </div>
          <ul className="mt-2 divide-y divide-gray-100 text-sm">
            {c.scores.map((s, i) => (
              <li key={i} className="py-1.5 flex justify-between gap-2">
                <span><span className="text-church-gold">{starsOf(s.stars)}</span> {s.reference}{s.setTitle ? <span className="text-gray-400"> · {s.setTitle}</span> : ''}</span>
                <span className="text-xs text-gray-400">{s.scoredOn}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ─── The app ──────────────────────────────────────────────────────────────────

export default function MemoryVersesView({ user }) {
  const [meta, setMeta] = useState(null);
  const [me, setMe] = useState(null);
  const [tab, setTab] = useState('library');
  const [openId, setOpenId] = useState(null);
  const [practising, setPractising] = useState(null);   // { set, present }
  const [editing, setEditing] = useState(null);         // a set, or {} for a new one
  const [reloadKey, setReloadKey] = useState(0);
  const [allSets, setAllSets] = useState([]);
  const [error, setError] = useState('');

  const loadMe = useCallback(() => send(`${API}/me`).then(setMe).catch(err => setError(err.message)), []);
  useEffect(() => {
    send(`${API}/meta`).then(setMeta).catch(err => setError(err.message));
    loadMe();
  }, [loadMe]);
  useEffect(() => {
    if (tab === 'classes') send(`${API}/sets`).then(json => setAllSets(json.sets)).catch(() => {});
  }, [tab, reloadKey]);

  const changed = () => { setReloadKey(k => k + 1); loadMe(); };
  const open = id => { setOpenId(id); setTab('library'); };
  async function present(setId) {
    try { const json = await send(`${API}/sets/${setId}`); setPractising({ set: json.set, present: true }); }
    catch (err) { setError(err.message); }
  }

  if (!meta || !me) return error ? <p className="text-sm text-red-600">{error}</p> : <p className="text-sm text-gray-400">Loading Memory Verses…</p>;

  if (practising) {
    return (
      <Practice set={practising.set} present={practising.present} onRecorded={loadMe}
        onClose={() => { setPractising(null); changed(); }} />
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="section-heading mb-1">Memory Verses</h2>
        <p className="text-sm text-gray-500">Learn scripture by heart with flash cards and memory games — at home or in class.</p>
      </div>

      <HowTo />

      <div className="flex flex-wrap gap-1 border-b border-gray-200" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => { setTab(id); if (id === 'library') setOpenId(null); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === id ? 'border-church-gold text-church-navy' : 'border-transparent text-gray-500 hover:text-church-navy'}`}>
            {label}
            {id === 'practice' && me.practice.due.length > 0 && <span className="ml-1.5 text-[11px] bg-amber-100 text-amber-800 rounded-full px-1.5">{me.practice.due.length}</span>}
          </button>
        ))}
      </div>

      {tab === 'library' && (openId
        ? <SetView id={openId} meta={meta} onBack={() => setOpenId(null)} onChanged={changed}
            onPractise={(set, isPresent) => setPractising({ set, present: isPresent })} onEdit={s => setEditing(s)} />
        : <Library meta={meta} onOpen={setOpenId} onNew={() => setEditing({})} reloadKey={reloadKey} />)}
      {tab === 'practice' && <MyPractice me={me} onOpen={open} />}
      {tab === 'classes' && <Classes classes={me.classes} sets={allSets} me={user} onChanged={changed} onPresent={present} />}
      {tab === 'scores' && <MyScores me={me} />}

      <p className="text-[11px] text-gray-400">{meta.notice}</p>

      {editing && (
        <SetEditor meta={meta} set={editing.id ? editing : null} onClose={() => setEditing(null)}
          onSaved={saved => { setEditing(null); changed(); setOpenId(saved.id); setTab('library'); }} />
      )}
    </div>
  );
}
