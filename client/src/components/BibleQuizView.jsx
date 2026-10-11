import { useState, useEffect, useCallback, useRef } from 'react';
import StadiumGame from './StadiumGame';

// ─── Bible Quiz ───────────────────────────────────────────────────────────────
//
// The church's 500 Bible quiz questions, three ways:
//   - Single player: a game of 10 or 20, marked on the server, scored by
//     difficulty (easy 1, medium 2, hard 3) — and every point counts toward
//   - the Leaderboard of all members, for all time or this month;
//   - Classroom: the teacher sets up teams to race around the stadium.

const API = '/api/bible-quiz';
const LEVELS = [['mixed', 'Mixed'], ['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']];
const LEVEL_TONE = { easy: 'bg-emerald-100 text-emerald-800', medium: 'bg-amber-100 text-amber-800', hard: 'bg-red-100 text-red-800' };
const SAVED_GAME = 'bibleQuiz.soloGame';

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

const remember = id => { try { if (id) localStorage.setItem(SAVED_GAME, String(id)); else localStorage.removeItem(SAVED_GAME); } catch { /* storage off */ } };
const remembered = () => { try { return localStorage.getItem(SAVED_GAME); } catch { return null; } };

const choiceButton = 'w-full text-left px-4 py-3 rounded-xl border-2 text-sm font-medium transition-colors disabled:cursor-default';

// ─── Single player ────────────────────────────────────────────────────────────

function SoloSetup({ bank, onStarted }) {
  const [difficulty, setDifficulty] = useState('mixed');
  const [length, setLength] = useState(10);
  const [sections, setSections] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function start() {
    setBusy(true); setError('');
    try {
      const { game } = await send(`${API}/solo`, { method: 'POST', body: JSON.stringify({ difficulty, length, sections }) });
      onStarted(game);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const pick = (on, val, set) => set(list => (on ? list.filter(x => x !== val) : [...list, val]));

  return (
    <div className="card space-y-4 max-w-xl mx-auto">
      <div>
        <h3 className="section-heading mb-1">Single player</h3>
        <p className="text-sm text-gray-500">
          Answer {length} questions on your own. A right answer is worth {bank ? `${bank.points.easy} point on easy, ${bank.points.medium} on medium and ${bank.points.hard} on hard` : 'more on harder questions'}, and every point goes toward the members&apos; leaderboard.
        </p>
      </div>
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Difficulty</p>
        <div className="grid grid-cols-4 gap-1.5">
          {LEVELS.map(([val, label]) => (
            <button key={val} type="button" onClick={() => setDifficulty(val)} aria-pressed={difficulty === val}
              className={`py-2 rounded-lg text-sm font-bold border-2 ${difficulty === val ? 'bg-church-navy text-church-gold border-church-gold' : 'bg-white text-church-navy border-gray-200 hover:border-church-gold'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Questions</p>
        <div className="grid grid-cols-2 gap-1.5">
          {(bank?.lengths || [10, 20]).map(n => (
            <button key={n} type="button" onClick={() => setLength(n)} aria-pressed={length === n}
              className={`py-2 rounded-lg text-sm font-bold border-2 ${length === n ? 'bg-church-navy text-church-gold border-church-gold' : 'bg-white text-church-navy border-gray-200 hover:border-church-gold'}`}>
              {n} questions
            </button>
          ))}
        </div>
      </div>
      {bank && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Sections {sections.length ? '' : '(all)'}</p>
          <div className="flex flex-wrap gap-1.5">
            {bank.sections.map(sec => {
              const on = sections.includes(sec.id);
              return (
                <button key={sec.id} type="button" aria-pressed={on} onClick={() => pick(on, sec.id, setSections)}
                  className={`px-2.5 py-1 rounded-full text-xs border ${on ? 'bg-church-gold text-church-navy border-church-gold font-semibold' : 'bg-white text-gray-600 border-gray-300'}`}>
                  {sec.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <button type="button" onClick={start} disabled={busy} className="btn-primary w-full py-3 text-base disabled:opacity-50">
        {busy ? 'Dealing the questions…' : 'Start'}
      </button>
    </div>
  );
}

function SoloQuestion({ game, onAnswered }) {
  const q = game.question;
  const [given, setGiven] = useState('');
  const [result, setResult] = useState(null);
  const [next, setNext] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef(null);

  useEffect(() => { if (q.type === 'short') input.current?.focus(); }, [q]);

  async function answer(value) {
    if (busy || result) return;
    setBusy(true); setError('');
    try {
      const json = await send(`${API}/solo/${game.id}/answer`, { method: 'POST', body: JSON.stringify({ questionId: q.id, answer: value }) });
      setGiven(String(value));
      setResult(json.result);
      setNext(json.game);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const tone = value => {
    if (!result) return 'border-gray-200 hover:border-church-gold text-church-navy bg-white';
    if (value === result.answer) return 'border-emerald-400 bg-emerald-50 text-emerald-800';
    if (value === given) return 'border-red-400 bg-red-50 text-red-700';
    return 'border-gray-200 text-gray-400 bg-white';
  };

  return (
    <div className="card space-y-4 max-w-xl mx-auto">
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-500">Question {game.position + 1} of {game.length}</span>
        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${LEVEL_TONE[q.difficulty]}`}>
          {q.difficulty[0].toUpperCase() + q.difficulty.slice(1)} · {q.points} {q.points === 1 ? 'point' : 'points'}
        </span>
      </div>
      <p className="text-lg font-semibold text-church-navy leading-snug">{q.question}</p>

      {q.type === 'mc' && (
        <div className="grid gap-2 sm:grid-cols-2">
          {q.options.map(opt => (
            <button key={opt} type="button" disabled={busy || !!result} onClick={() => answer(opt)} className={`${choiceButton} ${tone(opt)}`}>{opt}</button>
          ))}
        </div>
      )}
      {q.type === 'tf' && (
        <div className="grid grid-cols-2 gap-2">
          {[['true', 'True'], ['false', 'False']].map(([val, label]) => (
            <button key={val} type="button" disabled={busy || !!result} onClick={() => answer(val)} className={`${choiceButton} text-center ${tone(val)}`}>{label}</button>
          ))}
        </div>
      )}
      {q.type === 'short' && (
        <form onSubmit={e => { e.preventDefault(); if (given.trim()) answer(given); }} className="flex gap-2">
          <input ref={input} value={given} onChange={e => setGiven(e.target.value)} disabled={!!result} maxLength={200}
            aria-label="Your answer" placeholder="Type your answer"
            className="flex-1 border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-church-gold" />
          {!result && <button type="submit" disabled={busy || !given.trim()} className="btn-primary px-4 disabled:opacity-50">Answer</button>}
        </form>
      )}

      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}

      {result && (
        <div className={`rounded-xl p-3 space-y-1 ${result.correct ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`} role="status">
          <p className="font-semibold">{result.correct ? `Right! +${result.points} ${result.points === 1 ? 'point' : 'points'}` : 'Not quite.'}</p>
          {(!result.correct || q.type === 'short') && (
            <p className="text-sm">Answer: <strong>{q.type === 'tf' ? (result.answer === 'true' ? 'True' : 'False') : result.answer}</strong></p>
          )}
          <p className="text-xs opacity-80">📖 {result.ref}</p>
        </div>
      )}
      {result && (
        <div className="flex justify-end">
          <button type="button" onClick={() => onAnswered(next)} className="btn-primary px-5" autoFocus>
            {next.finished ? 'See how you did' : 'Next'}
          </button>
        </div>
      )}
    </div>
  );
}

function SoloFinished({ game, onAgain, onLeaderboard }) {
  const [standing, setStanding] = useState(null);
  useEffect(() => { send(`${API}/leaderboard`).then(j => setStanding(j.me)).catch(() => {}); }, []);
  return (
    <div className="card text-center space-y-3 max-w-xl mx-auto">
      <div className="text-5xl">📖</div>
      <h3 className="text-xl font-bold text-church-navy">{game.score} {game.score === 1 ? 'point' : 'points'}</h3>
      <p className="text-sm text-gray-600">
        {game.correct} of {game.length} right{game.bestStreak > 1 ? ` · best run of ${game.bestStreak} in a row` : ''}
      </p>
      {standing && (
        <p className="text-sm text-church-navy">
          You are <strong>#{standing.rank}</strong> on the leaderboard with {standing.points} points.
        </p>
      )}
      <div className="flex justify-center gap-2 pt-1">
        <button type="button" onClick={onAgain} className="btn-primary px-5">Play again</button>
        <button type="button" onClick={onLeaderboard} className="px-4 py-2 rounded-lg border border-church-navy text-church-navy text-sm hover:bg-church-navy hover:text-white">Leaderboard</button>
      </div>
    </div>
  );
}

function SoloPlay({ bank, onLeaderboard }) {
  const [game, setGame] = useState(null);
  const [checking, setChecking] = useState(true);

  // Carry on with a game left part way through.
  useEffect(() => {
    const id = remembered();
    if (!id) { setChecking(false); return; }
    send(`${API}/solo/${id}`)
      .then(j => { if (!j.game.finished) setGame(j.game); else remember(null); })
      .catch(() => remember(null))
      .finally(() => setChecking(false));
  }, []);

  const update = useCallback(next => {
    setGame(next);
    remember(next && !next.finished ? next.id : null);
  }, []);

  if (checking) return <div className="card text-sm text-gray-400 text-center">Loading…</div>;
  if (!game) return <SoloSetup bank={bank} onStarted={update} />;
  if (game.finished) return <SoloFinished game={game} onAgain={() => update(null)} onLeaderboard={onLeaderboard} />;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between max-w-xl mx-auto text-sm">
        <span className="font-semibold text-church-navy">{game.score} {game.score === 1 ? 'point' : 'points'}</span>
        {game.streak > 1 && <span className="text-church-gold font-semibold">🔥 {game.streak} in a row</span>}
        <span className="text-gray-500">{game.correct} right so far</span>
      </div>
      <SoloQuestion key={`${game.id}-${game.position}`} game={game} onAnswered={update} />
    </div>
  );
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────

function Leaderboard() {
  const [period, setPeriod] = useState('all');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null);
    send(`${API}/leaderboard?period=${period}`).then(setData).catch(e => setError(e.message));
  }, [period]);

  const medal = rank => ({ 1: '🥇', 2: '🥈', 3: '🥉' }[rank] || rank);

  return (
    <div className="card space-y-3 max-w-2xl mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="section-heading mb-0">Leaderboard</h3>
        <div className="flex gap-1" role="group" aria-label="Period">
          {[['all', 'All time'], ['month', 'This month']].map(([val, label]) => (
            <button key={val} type="button" onClick={() => setPeriod(val)} aria-pressed={period === val}
              className={`px-3 py-1.5 rounded-lg text-sm border ${period === val ? 'bg-church-navy text-white border-church-navy' : 'bg-white text-gray-600 border-gray-300'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-gray-500">Every member who has played single player, by points from right answers (easy 1, medium 2, hard 3).</p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!data && !error && <p className="text-sm text-gray-400">Loading…</p>}
      {data && data.leaders.length === 0 && (
        <p className="text-sm text-gray-500 text-center py-6">Nobody has played {period === 'month' ? 'this month' : 'yet'}. Be the first!</p>
      )}
      {data && data.leaders.length > 0 && (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm" aria-label="Leaderboard">
            <thead>
              <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
                <th className="py-2 px-1 w-10">#</th>
                <th className="py-2 px-1">Member</th>
                <th className="py-2 px-1 text-right">Points</th>
                <th className="py-2 px-1 text-right hidden sm:table-cell">Right</th>
                <th className="py-2 px-1 text-right hidden sm:table-cell">Games</th>
                <th className="py-2 px-1 text-right">Best game</th>
              </tr>
            </thead>
            <tbody>
              {data.leaders.map(l => {
                const me = data.me && l.userId === data.me.userId;
                return (
                  <tr key={l.userId} className={`border-b border-gray-50 ${me ? 'bg-church-cream font-semibold' : ''}`}>
                    <td className="py-2 px-1">{medal(l.rank)}</td>
                    <td className="py-2 px-1 text-church-navy">{l.name}{me ? ' (you)' : ''}</td>
                    <td className="py-2 px-1 text-right font-semibold text-church-navy">{l.points}</td>
                    <td className="py-2 px-1 text-right text-gray-600 hidden sm:table-cell">{l.accuracy}%</td>
                    <td className="py-2 px-1 text-right text-gray-600 hidden sm:table-cell">{l.games}</td>
                    <td className="py-2 px-1 text-right text-gray-600">{l.bestGame ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {data && !data.me && data.leaders.length > 0 && (
        <p className="text-xs text-gray-500">You are not on it {period === 'month' ? 'this month' : 'yet'} — play a single-player game to join in.</p>
      )}
    </div>
  );
}

// ─── The page ─────────────────────────────────────────────────────────────────

const MODES = [
  ['solo', 'Single player'],
  ['classroom', 'Classroom (teams)'],
  ['leaderboard', 'Leaderboard'],
];

export default function BibleQuizView({ user }) {
  const [mode, setMode] = useState('solo');
  const [bank, setBank] = useState(null);

  useEffect(() => { send(`${API}/bank`).then(setBank).catch(() => {}); }, []);

  return (
    <div className="space-y-4">
      <div className="text-center space-y-1">
        <h2 className="text-2xl font-bold text-church-navy">Bible Quiz</h2>
        <p className="text-sm text-gray-500">{bank ? `${bank.total} questions` : 'Hundreds of questions'} from Genesis to Revelation — easy, medium and hard.</p>
      </div>
      <div className="flex justify-center">
        <div className="inline-flex rounded-xl border border-gray-200 bg-white p-1 gap-1" role="tablist" aria-label="Mode">
          {MODES.map(([val, label]) => (
            <button key={val} type="button" role="tab" aria-selected={mode === val} onClick={() => setMode(val)}
              className={`px-3 sm:px-4 py-2 rounded-lg text-sm font-medium ${mode === val ? 'bg-church-navy text-church-gold' : 'text-gray-600 hover:text-church-navy'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {mode === 'solo' && <SoloPlay bank={bank} onLeaderboard={() => setMode('leaderboard')} />}
      {mode === 'classroom' && <StadiumGame user={user} />}
      {mode === 'leaderboard' && <Leaderboard />}
    </div>
  );
}
