import { useState, useEffect, useCallback, useRef } from 'react';
import Dialog from '../Dialog';
import JeopardyPlay from './JeopardyPlay';

// Bible Jeopardy: games built in an Excel template and uploaded with a name.
// Every game has its own permanent link (?page=bible-class&game=12), names its
// author, and the list can be searched by name, author, who uploaded it, or
// anything on its board, and narrowed to one author's games.

const API = '/api/jeopardy';
const gameLink = id => `${window.location.origin}/?page=bible-class&game=${id}`;

async function call(url, options = {}) {
  const res = await fetch(url, { credentials: 'include', ...options });
  const json = await res.json().catch(() => ({}));
  if (!json.success) {
    const err = new Error(json.error || 'Something went wrong');
    err.details = json.errors || [];
    throw err;
  }
  return json;
}

const shortDate = raw => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw || ''));
  return m ? new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
};

function CopyLink({ id }) {
  const [state, setState] = useState('');
  async function copy() {
    try { await navigator.clipboard.writeText(gameLink(id)); setState('copied'); setTimeout(() => setState(''), 2500); }
    catch { setState('shown'); }
  }
  return (
    <span className="inline-flex items-center gap-2 flex-wrap">
      <button type="button" onClick={copy} className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:border-church-navy">
        {state === 'copied' ? 'Link copied' : 'Copy link'}
      </button>
      {state === 'shown' && <input readOnly value={gameLink(id)} onFocus={e => e.target.select()} aria-label="Link to this game" className="text-xs border border-gray-200 rounded px-2 py-1 w-64" />}
    </span>
  );
}

function TemplateLink({ className = '' }) {
  return (
    <a href={`${API}/template`} download="Bible Jeopardy template.xlsx"
      className={`inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:border-church-navy ${className}`}>
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
      </svg>
      Download the template
    </a>
  );
}

// ─── Uploading a game, new or corrected ───────────────────────────────────────

function UploadDialog({ game = null, user = null, onClose, onSaved }) {
  const isNew = !game;
  const [title, setTitle] = useState(game?.title || '');
  const [author, setAuthor] = useState(game?.author || user?.name || '');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [details, setDetails] = useState([]);

  async function submit(e) {
    e.preventDefault();
    if (!title.trim()) return setError('Give the game a name');
    if (!author.trim()) return setError('Say who wrote the game');
    if (isNew && !file) return setError('Choose the filled-in template to upload');
    setBusy(true); setError(''); setDetails([]);
    const body = new FormData();
    body.append('title', title.trim());
    body.append('author', author.trim());
    if (file) body.append('file', file);
    try {
      const json = await call(isNew ? API : `${API}/${game.id}`, { method: isNew ? 'POST' : 'PUT', body });
      onSaved(json.game);
    } catch (err) {
      setError(err.message);
      setDetails(err.details);
      setBusy(false);
    }
  }

  const field = 'mt-1 block w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold';
  const label = 'text-xs font-medium text-gray-500 uppercase tracking-wide';
  return (
    <Dialog
      title={isNew ? 'New Bible Jeopardy game' : `Change ${game.title}`}
      subtitle={isNew ? 'Fill in the template in Excel, then upload it here with a name.' : 'Rename it, change its author, or upload a corrected template. Its link stays the same.'}
      onClose={onClose}
      width="max-w-lg"
    >
      <form onSubmit={submit} className="space-y-4">
        {isNew && (
          <ol className="text-sm text-gray-600 space-y-1 list-decimal list-inside bg-church-cream/60 rounded-lg px-4 py-3">
            <li>Download the template and open it in Excel.</li>
            <li>Fill in the Board sheet: a category, then a clue and answer on each row. Type <b>yes</b> under Daily Double for any you like.</li>
            <li>Fill in the Final sheet for Final Jeopardy, or leave it empty.</li>
            <li>Save it, then choose it below.</li>
          </ol>
        )}
        {isNew && <TemplateLink />}

        <label className="block">
          <span className={label}>Name of the game <span className="text-red-400" aria-hidden="true">*</span></span>
          <input autoFocus value={title} maxLength={120} onChange={e => setTitle(e.target.value)}
            placeholder="Genesis review — Noah to Abraham" className={field} />
        </label>

        <label className="block">
          <span className={label}>Author <span className="text-red-400" aria-hidden="true">*</span></span>
          <input value={author} maxLength={80} onChange={e => setAuthor(e.target.value)} placeholder="Who wrote the game" className={field} />
          <span className="block text-xs text-gray-400 mt-1">Whoever wrote the clues, if that is not you.</span>
        </label>

        <label className="block">
          <span className={label}>{isNew ? 'Filled-in template' : 'A corrected template (optional)'}</span>
          <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={e => setFile(e.target.files?.[0] || null)} className="mt-1 block w-full text-sm" />
        </label>

        {error && (
          <div role="alert" className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            <p className="font-medium">{error}</p>
            {details.length > 0 && (
              <ul className="mt-1 list-disc list-inside space-y-0.5">
                {details.map((d, i) => <li key={i}>{d}</li>)}
              </ul>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="text-sm px-3 py-2 rounded-lg border border-gray-200 text-gray-600">Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary text-sm disabled:opacity-50">
            {busy ? 'Saving…' : isNew ? 'Save the game' : 'Save'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ─── One game ─────────────────────────────────────────────────────────────────

function GameDetail({ id, user, onBack, onChanged, onDeleted, onAuthor }) {
  const [game, setGame] = useState(null);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [answers, setAnswers] = useState(false);

  useEffect(() => {
    let live = true;
    call(`${API}/${id}`).then(json => live && setGame(json.game)).catch(err => live && setError(err.message));
    return () => { live = false; };
  }, [id]);

  async function remove() {
    if (!window.confirm(`Delete "${game.title}"? Its link will stop working.`)) return;
    try { await call(`${API}/${id}`, { method: 'DELETE' }); onDeleted(id); }
    catch (err) { setError(err.message); }
  }

  if (error) return <div className="card text-center py-10 text-sm text-red-600">{error}</div>;
  if (!game) return <div className="card text-center py-10 text-sm text-gray-400">Loading the game…</div>;
  if (playing) return <JeopardyPlay game={game} onExit={() => setPlaying(false)} />;

  const dailies = game.board.categories.reduce((n, c) => n + c.clues.filter(q => q.daily).length, 0);
  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="text-sm text-church-navy hover:text-church-gold">← All games</button>
      <div className="card space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h3 className="text-xl font-semibold text-church-navy">{game.title}</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              {game.board.categories.length} categor{game.board.categories.length === 1 ? 'y' : 'ies'} · {game.clueCount} clues
              {dailies > 0 && ` · ${dailies} Daily Double${dailies === 1 ? '' : 's'}`}
              {game.board.final ? ' · Final Jeopardy' : ''}
            </p>
            <p className="text-sm text-gray-600 mt-1">
              By{' '}
              <button type="button" onClick={() => onAuthor(game.author)} title={`All games by ${game.author}`}
                className="font-medium text-church-navy underline decoration-dotted hover:text-church-gold">{game.author}</button>
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              {game.createdByName && game.createdByName !== game.author ? `Uploaded by ${game.createdByName}` : 'Uploaded'} · {shortDate(game.createdAt)}
              {game.updatedAt !== game.createdAt && ` · changed ${shortDate(game.updatedAt)}`}
            </p>
          </div>
          <button type="button" onClick={() => setPlaying(true)} className="btn-primary">Play this game</button>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <CopyLink id={game.id} />
          {game.canEdit && (
            <>
              <button type="button" onClick={() => setEditing(true)} className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:border-church-navy">
                Rename, change the author, or upload a correction
              </button>
              <button type="button" onClick={remove} className="text-sm px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50">Delete</button>
            </>
          )}
        </div>
      </div>

      {/* What is on the board, for checking before class. The answers stay
          hidden until asked for, in case the screen is already up. */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h4 className="font-semibold text-church-navy">On the board</h4>
          <button type="button" onClick={() => setAnswers(a => !a)} className="text-xs text-gray-500 underline hover:text-church-navy">
            {answers ? 'Hide the clues and answers' : 'Show the clues and answers'}
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {game.board.categories.map((cat, c) => (
            <section key={c} className="rounded-lg border border-gray-200 p-3">
              <h5 className="text-sm font-semibold text-church-navy">{cat.name}</h5>
              <ul className="mt-1 space-y-1">
                {cat.clues.map((q, i) => (
                  <li key={i} className="text-xs text-gray-600">
                    <span className="font-semibold tabular-nums text-church-gold">{q.points}</span>
                    {q.daily && <span className="ml-1 px-1.5 rounded bg-amber-100 text-amber-800">Daily Double</span>}
                    {answers && <span className="block">{q.clue} <span className="text-gray-400">— {q.answer}</span></span>}
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {game.board.final && (
            <section className="rounded-lg border border-church-gold/50 bg-church-cream/40 p-3">
              <h5 className="text-sm font-semibold text-church-navy">Final Jeopardy · {game.board.final.category}</h5>
              {answers && <p className="text-xs text-gray-600 mt-1">{game.board.final.clue} <span className="text-gray-400">— {game.board.final.answer}</span></p>}
            </section>
          )}
        </div>
      </div>

      {editing && (
        <UploadDialog game={game} user={user} onClose={() => setEditing(false)}
          onSaved={updated => { setEditing(false); setGame(updated); onChanged(updated); }} />
      )}
    </div>
  );
}

// ─── The list ─────────────────────────────────────────────────────────────────

export default function JeopardyView({ user = null, initialGameId = null }) {
  const [games, setGames] = useState(null);
  const [authors, setAuthors] = useState([]);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [author, setAuthor] = useState('');
  const [openId, setOpenId] = useState(initialGameId);
  const [creating, setCreating] = useState(false);
  const timer = useRef(null);

  const load = useCallback(async (q = '', by = '') => {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (by) params.set('author', by);
    try {
      const query = params.toString();
      const json = await call(`${API}${query ? `?${query}` : ''}`);
      setGames(json.games); setAuthors(json.authors || []); setError('');
    } catch (err) { setError(err.message); }
  }, []);

  useEffect(() => { load(); }, [load]);
  const reload = () => load(search, author);

  function chooseAuthor(value) {
    setAuthor(value);
    load(search, value);
  }
  useEffect(() => () => clearTimeout(timer.current), []);

  function onSearch(value) {
    setSearch(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => load(value, author), 250);
  }

  if (openId) {
    return (
      <GameDetail
        id={openId}
        user={user}
        onBack={() => { setOpenId(null); reload(); }}
        onChanged={reload}
        onDeleted={() => { setOpenId(null); reload(); }}
        onAuthor={name => { setOpenId(null); chooseAuthor(name); }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-xl font-semibold text-church-navy">Bible Jeopardy</h3>
          <p className="text-sm text-gray-500">Build a game in the Excel template, upload it, and play it on the classroom screen with teams.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <TemplateLink />
          <button type="button" onClick={() => setCreating(true)} className="btn-primary text-sm">New game</button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="search"
          value={search}
          onChange={e => onSearch(e.target.value)}
          placeholder="Search names, authors or clues…"
          aria-label="Search games"
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-church-navy w-full sm:w-80"
        />
        <select
          value={author}
          onChange={e => chooseAuthor(e.target.value)}
          aria-label="Author"
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-church-navy w-full sm:w-56"
        >
          <option value="">All authors</option>
          {/* A filter chosen from a game's page may not be in the list yet. */}
          {author && !authors.some(a => a.name.toLowerCase() === author.toLowerCase()) && <option value={author}>{author}</option>}
          {authors.map(a => <option key={a.name} value={a.name}>{a.name} ({a.games})</option>)}
        </select>
        {author && (
          <button type="button" onClick={() => chooseAuthor('')} className="text-xs text-gray-500 underline hover:text-church-navy">
            Show every author
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {games === null && !error && <p className="text-sm text-gray-400">Loading…</p>}
      {games?.length === 0 && (
        <p className="card text-center text-sm text-gray-400 py-8">
          {search.trim() || author ? 'No games match that search.' : 'No games yet. Download the template to make the first one.'}
        </p>
      )}

      {games?.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {games.map(g => (
            <li key={g.id}>
              <button type="button" onClick={() => setOpenId(g.id)}
                className="card w-full h-full text-left hover:border-church-gold transition-colors">
                <span className="block font-semibold text-church-navy">{g.title}</span>
                <span className="block text-sm text-gray-600">by {g.author}</span>
                <span className="block text-xs text-gray-500 mt-1 line-clamp-2">{g.categoryNames.join(' · ')}</span>
                <span className="block text-xs text-gray-400 mt-2">
                  {g.clueCount} clues{g.hasFinal ? ' · Final' : ''} · {shortDate(g.updatedAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {creating && (
        <UploadDialog user={user} onClose={() => setCreating(false)}
          onSaved={game => { setCreating(false); setOpenId(game.id); reload(); }} />
      )}
    </div>
  );
}
