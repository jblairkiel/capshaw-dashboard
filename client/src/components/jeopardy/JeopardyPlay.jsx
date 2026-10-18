import { useState, useEffect, useRef } from 'react';

// Playing a Bible Jeopardy game on the classroom screen: the board, each clue
// big enough to read from the back, the teams' scores along the bottom, Daily
// Doubles with a bet, and Final Jeopardy at the end.
//
// Nothing about a game in progress goes to the server. It is kept in this
// browser instead, so a page refreshed halfway through class picks up where it
// was — the same teams, scores and clues already used.

const MAX_TEAMS = 8;
const storeKey = game => `jeopardy-play:${game.id}:${game.updatedAt}`;

function load(game) {
  try {
    const saved = JSON.parse(window.localStorage.getItem(storeKey(game)) || 'null');
    return saved && Array.isArray(saved.teams) ? saved : null;
  } catch { return null; }
}
function save(game, state) {
  try { window.localStorage.setItem(storeKey(game), JSON.stringify(state)); } catch { /* private window */ }
}
function forget(game) {
  try { window.localStorage.removeItem(storeKey(game)); } catch { /* private window */ }
}

const fresh = teams => ({ teams, used: {}, log: [], phase: 'board', current: null, finalWagers: {}, finalMarks: {} });
const keyOf = (c, i) => `${c}-${i}`;

// The most a Daily Double can be bet: everything the team has, or the board's
// top clue value if they have less than that (Jeopardy's own rule).
function maxBet(team, board) {
  const top = Math.max(0, ...board.categories.flatMap(c => c.clues.map(q => q.points)));
  return Math.max(team?.score || 0, top);
}

// ─── Before the first clue: who is playing ────────────────────────────────────

function TeamSetup({ onStart }) {
  const [names, setNames] = useState(['Team 1', 'Team 2']);
  const set = (i, v) => setNames(list => list.map((n, at) => (at === i ? v : n)));
  const named = names.map((n, i) => n.trim() || `Team ${i + 1}`);

  return (
    <div className="max-w-lg mx-auto bg-white/5 rounded-2xl p-6 space-y-4">
      <h3 className="text-2xl font-bold text-church-gold text-center">Who is playing?</h3>
      <ul className="space-y-2">
        {names.map((name, i) => (
          <li key={i} className="flex gap-2">
            <input
              value={name}
              onChange={e => set(i, e.target.value)}
              aria-label={`Team ${i + 1} name`}
              maxLength={30}
              className="flex-1 rounded-lg px-3 py-2 text-church-navy text-lg"
            />
            {names.length > 1 && (
              <button type="button" onClick={() => setNames(list => list.filter((_, at) => at !== i))}
                aria-label={`Remove ${named[i]}`} className="px-3 rounded-lg text-gray-300 hover:text-white hover:bg-white/10">✕</button>
            )}
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        {names.length < MAX_TEAMS ? (
          <button type="button" onClick={() => setNames(list => [...list, `Team ${list.length + 1}`])}
            className="text-sm px-3 py-1.5 rounded-lg border border-white/30 text-white hover:bg-white/10">+ Add a team</button>
        ) : <span />}
        <button type="button" onClick={() => onStart(named.map(name => ({ name, score: 0 })))}
          className="px-5 py-2 rounded-lg bg-church-gold text-church-navy font-bold hover:brightness-110">Start the game</button>
      </div>
      <button type="button" onClick={() => onStart([])} className="block mx-auto text-xs text-gray-300 underline hover:text-white">
        Play without keeping score
      </button>
    </div>
  );
}

// ─── The scores along the bottom ──────────────────────────────────────────────

function Scoreboard({ teams, highlight }) {
  if (!teams.length) return null;
  return (
    <div className="grid gap-2 mt-4" style={{ gridTemplateColumns: `repeat(${teams.length}, minmax(0, 1fr))` }} aria-label="Scores">
      {teams.map((t, i) => (
        <div key={i} className={`rounded-xl px-3 py-2 text-center ${highlight === i ? 'bg-church-gold text-church-navy' : 'bg-white/10'}`}>
          <p className="text-sm truncate">{t.name}</p>
          <p className={`text-2xl font-bold tabular-nums ${t.score < 0 && highlight !== i ? 'text-red-300' : ''}`}>{t.score.toLocaleString()}</p>
        </div>
      ))}
    </div>
  );
}

// ─── One clue ─────────────────────────────────────────────────────────────────

function ClueScreen({ game, state, onScore, onDone, onBet }) {
  const { c, i, revealed, bet } = state.current;
  const category = game.board.categories[c];
  const clue = category.clues[i];
  const [team, setTeam] = useState(bet?.team ?? 0);
  const [amount, setAmount] = useState('');
  const marked = state.current.marked || {};

  // A Daily Double asks who is answering and what they bet before the clue shows.
  if (clue.daily && !bet && state.teams.length) {
    const limit = maxBet(state.teams[team], game.board);
    const wager = Number(amount);
    const ok = amount !== '' && Number.isInteger(wager) && wager >= 0 && wager <= limit;
    return (
      <div className="text-center space-y-6 py-6">
        <p className="text-5xl sm:text-7xl font-black text-church-gold tracking-wide">DAILY DOUBLE!</p>
        <p className="text-lg text-gray-300">{category.name}</p>
        <div className="max-w-md mx-auto bg-white/5 rounded-2xl p-5 space-y-3 text-left">
          <label className="block">
            <span className="text-sm text-gray-300">Which team chose it?</span>
            <select value={team} onChange={e => setTeam(Number(e.target.value))} className="mt-1 w-full rounded-lg px-3 py-2 text-church-navy">
              {state.teams.map((t, at) => <option key={at} value={at}>{t.name} ({t.score})</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-sm text-gray-300">Their bet (up to {limit.toLocaleString()})</span>
            <input type="number" min={0} max={limit} step={1} value={amount} onChange={e => setAmount(e.target.value)}
              className="mt-1 w-full rounded-lg px-3 py-2 text-church-navy text-lg" />
          </label>
          <button type="button" disabled={!ok} onClick={() => onBet({ team, wager })}
            className="w-full px-5 py-2 rounded-lg bg-church-gold text-church-navy font-bold disabled:opacity-40">Show the clue</button>
        </div>
      </div>
    );
  }

  const worth = bet ? bet.wager : clue.points;
  return (
    <div className="flex flex-col min-h-[50vh]">
      <p className="text-center text-church-gold font-semibold tracking-wide uppercase">
        {category.name} · {bet ? `Daily Double — ${state.teams[bet.team].name} bets ${bet.wager.toLocaleString()}` : clue.points}
      </p>
      <div className="flex-1 flex items-center justify-center px-4 py-8">
        <p className="text-3xl sm:text-5xl font-semibold text-center leading-tight max-w-5xl">{clue.clue}</p>
      </div>
      {revealed ? (
        <p className="text-center text-2xl sm:text-4xl text-church-gold font-bold mb-6" aria-label="Answer">{clue.answer}</p>
      ) : (
        <div className="text-center mb-6">
          <button type="button" onClick={() => onScore(null)} className="px-6 py-2.5 rounded-lg bg-white text-church-navy font-semibold text-lg hover:bg-church-gold">
            Show the answer
          </button>
        </div>
      )}

      {revealed && state.teams.length > 0 && (
        <div className="flex flex-wrap justify-center gap-3 mb-4">
          {(bet ? [bet.team] : state.teams.map((_, at) => at)).map(at => (
            <div key={at} className="bg-white/5 rounded-xl px-3 py-2 flex items-center gap-2">
              <span className="text-sm">{state.teams[at].name}</span>
              <button type="button" disabled={marked[at] !== undefined} onClick={() => onScore({ team: at, delta: worth })}
                aria-label={`${state.teams[at].name} right`}
                className="px-3 py-1 rounded-lg bg-emerald-600 font-bold disabled:opacity-30">+{worth}</button>
              <button type="button" disabled={marked[at] !== undefined} onClick={() => onScore({ team: at, delta: -worth })}
                aria-label={`${state.teams[at].name} wrong`}
                className="px-3 py-1 rounded-lg bg-red-600 font-bold disabled:opacity-30">−{worth}</button>
            </div>
          ))}
        </div>
      )}

      {revealed && (
        <div className="text-center">
          <button type="button" onClick={onDone} className="px-6 py-2.5 rounded-lg bg-church-gold text-church-navy font-bold text-lg hover:brightness-110">
            Back to the board
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Final Jeopardy ───────────────────────────────────────────────────────────

function FinalScreen({ game, state, update }) {
  const final = game.board.final;
  const { phase, teams, finalWagers, finalMarks } = state;
  const scoring = teams.length > 0;

  if (phase === 'final-wager') {
    const valid = teams.every((t, i) => {
      if (t.score <= 0 && !finalWagers[i]) return true;   // nothing to bet
      const w = Number(finalWagers[i]);
      return finalWagers[i] !== undefined && finalWagers[i] !== '' && Number.isInteger(w) && w >= 0 && w <= Math.max(t.score, 0);
    });
    return (
      <div className="text-center space-y-6 py-6">
        <p className="text-4xl sm:text-6xl font-black text-church-gold">FINAL JEOPARDY</p>
        <p className="text-2xl sm:text-3xl">{final.category}</p>
        {scoring && (
          <div className="max-w-md mx-auto bg-white/5 rounded-2xl p-5 space-y-3 text-left">
            <p className="text-sm text-gray-300">Each team bets up to what it has. A team at zero or below bets nothing.</p>
            {teams.map((t, i) => (
              <label key={i} className="flex items-center gap-3">
                <span className="flex-1 truncate">{t.name} <span className="text-gray-400">({t.score})</span></span>
                <input type="number" min={0} max={Math.max(t.score, 0)} step={1} value={finalWagers[i] ?? ''}
                  aria-label={`${t.name} bet`}
                  onChange={e => update(s => ({ ...s, finalWagers: { ...s.finalWagers, [i]: e.target.value } }))}
                  className="w-32 rounded-lg px-3 py-1.5 text-church-navy" />
              </label>
            ))}
          </div>
        )}
        <button type="button" disabled={scoring && !valid} onClick={() => update(s => ({ ...s, phase: 'final-clue' }))}
          className="px-6 py-2.5 rounded-lg bg-church-gold text-church-navy font-bold text-lg disabled:opacity-40">Show the clue</button>
      </div>
    );
  }

  const revealed = phase === 'final-answer';
  const allMarked = teams.every((_, i) => finalMarks[i] !== undefined);
  return (
    <div className="flex flex-col min-h-[50vh]">
      <p className="text-center text-church-gold font-semibold tracking-wide uppercase">Final Jeopardy · {final.category}</p>
      <div className="flex-1 flex items-center justify-center px-4 py-8">
        <p className="text-3xl sm:text-5xl font-semibold text-center leading-tight max-w-5xl">{final.clue}</p>
      </div>
      {revealed ? (
        <p className="text-center text-2xl sm:text-4xl text-church-gold font-bold mb-6" aria-label="Answer">{final.answer}</p>
      ) : (
        <div className="text-center mb-6">
          <button type="button" onClick={() => update(s => ({ ...s, phase: 'final-answer' }))}
            className="px-6 py-2.5 rounded-lg bg-white text-church-navy font-semibold text-lg hover:bg-church-gold">Show the answer</button>
        </div>
      )}
      {revealed && scoring && (
        <div className="flex flex-wrap justify-center gap-3 mb-4">
          {teams.map((t, i) => {
            const wager = Number(finalWagers[i]) || 0;
            const mark = right => update(s => ({
              ...s,
              finalMarks: { ...s.finalMarks, [i]: right },
              teams: s.teams.map((team, at) => (at === i ? { ...team, score: team.score + (right ? wager : -wager) } : team)),
              log: [...s.log, { team: i, delta: right ? wager : -wager, final: true }],
            }));
            return (
              <div key={i} className="bg-white/5 rounded-xl px-3 py-2 flex items-center gap-2">
                <span className="text-sm">{t.name} bet {wager}</span>
                <button type="button" disabled={finalMarks[i] !== undefined} onClick={() => mark(true)}
                  aria-label={`${t.name} right`} className="px-3 py-1 rounded-lg bg-emerald-600 font-bold disabled:opacity-30">Right</button>
                <button type="button" disabled={finalMarks[i] !== undefined} onClick={() => mark(false)}
                  aria-label={`${t.name} wrong`} className="px-3 py-1 rounded-lg bg-red-600 font-bold disabled:opacity-30">Wrong</button>
              </div>
            );
          })}
        </div>
      )}
      {revealed && (!scoring || allMarked) && (
        <div className="text-center">
          <button type="button" onClick={() => update(s => ({ ...s, phase: 'done' }))}
            className="px-6 py-2.5 rounded-lg bg-church-gold text-church-navy font-bold text-lg">See the final scores</button>
        </div>
      )}
    </div>
  );
}

function Results({ teams, onAgain }) {
  const best = Math.max(...teams.map(t => t.score));
  const winners = teams.filter(t => t.score === best);
  const ranked = [...teams].sort((a, b) => b.score - a.score);
  return (
    <div className="text-center space-y-6 py-8">
      {teams.length > 0 ? (
        <>
          <p className="text-lg text-gray-300">{winners.length > 1 ? 'A tie!' : 'The winner is'}</p>
          <p className="text-4xl sm:text-6xl font-black text-church-gold">{winners.map(w => w.name).join(' & ')}</p>
          <ol className="max-w-sm mx-auto space-y-1">
            {ranked.map((t, i) => (
              <li key={i} className="flex justify-between bg-white/5 rounded-lg px-4 py-2">
                <span>{t.name}</span><span className="font-bold tabular-nums">{t.score.toLocaleString()}</span>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <p className="text-4xl font-black text-church-gold">That&apos;s the game!</p>
      )}
      <button type="button" onClick={onAgain} className="px-5 py-2 rounded-lg border border-white/30 hover:bg-white/10">Play again</button>
    </div>
  );
}

// ─── The game ─────────────────────────────────────────────────────────────────

export default function JeopardyPlay({ game, onExit }) {
  const [state, setState] = useState(() => load(game));
  const box = useRef(null);
  const [full, setFull] = useState(false);
  const { board } = game;

  useEffect(() => { if (state) save(game, state); }, [game, state]);
  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === box.current);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);

  const update = fn => setState(s => fn(s));
  const totalClues = board.categories.reduce((n, c) => n + c.clues.length, 0);
  const usedCount = state ? Object.keys(state.used).length : 0;
  const rows = Math.max(...board.categories.map(c => c.clues.length));

  function toggleFull() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else box.current?.requestFullscreen?.().catch(() => {});
  }

  function restart() {
    if (!window.confirm('Start this game again from the beginning? The scores will be cleared.')) return;
    forget(game);
    setState(null);
  }

  function undo() {
    update(s => {
      const last = s.log[s.log.length - 1];
      if (!last) return s;
      return {
        ...s,
        log: s.log.slice(0, -1),
        teams: s.teams.map((t, i) => (i === last.team ? { ...t, score: t.score - last.delta } : t)),
      };
    });
  }

  let body;
  if (!state) {
    body = <TeamSetup onStart={teams => setState(fresh(teams))} />;
  } else if (state.phase === 'clue') {
    body = (
      <ClueScreen
        game={game}
        state={state}
        onBet={bet => update(s => ({ ...s, current: { ...s.current, bet } }))}
        onScore={change => update(s => {
          if (!change) return { ...s, current: { ...s.current, revealed: true } };
          return {
            ...s,
            teams: s.teams.map((t, i) => (i === change.team ? { ...t, score: t.score + change.delta } : t)),
            log: [...s.log, change],
            current: { ...s.current, marked: { ...(s.current.marked || {}), [change.team]: change.delta > 0 } },
          };
        })}
        onDone={() => update(s => ({ ...s, phase: 'board', used: { ...s.used, [keyOf(s.current.c, s.current.i)]: true }, current: null }))}
      />
    );
  } else if (state.phase.startsWith('final')) {
    body = <FinalScreen game={game} state={state} update={update} />;
  } else if (state.phase === 'done') {
    body = <Results teams={state.teams} onAgain={() => { forget(game); setState(null); }} />;
  } else {
    body = (
      <>
        <div className="grid gap-1.5 sm:gap-2" style={{ gridTemplateColumns: `repeat(${board.categories.length}, minmax(0, 1fr))` }}>
          {board.categories.map((cat, c) => (
            <div key={`h${c}`} className="bg-church-navy border border-white/10 rounded-lg px-1 py-3 flex items-center justify-center text-center min-h-[4.5rem]">
              <span className="font-bold uppercase text-xs sm:text-base leading-tight">{cat.name}</span>
            </div>
          ))}
          {Array.from({ length: rows }).map((_, i) => board.categories.map((cat, c) => {
            const clue = cat.clues[i];
            if (!clue) return <div key={`${c}-${i}`} />;
            const used = !!state.used[keyOf(c, i)];
            return (
              <button
                key={`${c}-${i}`}
                type="button"
                onClick={() => update(s => ({ ...s, phase: 'clue', current: { c, i, revealed: false, bet: null, marked: {} } }))}
                aria-label={`${cat.name} for ${clue.points}${used ? ' (played)' : ''}`}
                className={`rounded-lg min-h-[3.5rem] sm:min-h-[4.5rem] text-xl sm:text-3xl font-black tabular-nums transition-colors ${
                  used ? 'bg-white/5 text-white/15' : 'bg-blue-800 text-church-gold hover:bg-blue-700'}`}
              >
                {used ? '' : clue.points}
              </button>
            );
          }))}
        </div>
        {usedCount === totalClues && (
          <div className="text-center mt-6">
            <button type="button" onClick={() => update(s => ({ ...s, phase: board.final ? 'final-wager' : 'done' }))}
              className="px-6 py-2.5 rounded-lg bg-church-gold text-church-navy font-bold text-lg">
              {board.final ? 'On to Final Jeopardy' : 'See the final scores'}
            </button>
          </div>
        )}
      </>
    );
  }

  return (
    <div ref={box} className={`w-full bg-[#0b1636] text-white rounded-2xl p-3 sm:p-5 ${full ? 'overflow-y-auto h-full flex flex-col justify-center' : ''}`}>
      <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
        <h3 className="font-bold text-church-gold text-lg sm:text-xl truncate">{game.title}</h3>
        <div className="flex items-center gap-2 flex-wrap text-sm">
          {state && state.phase === 'board' && (
            <span className="text-gray-400 tabular-nums">{usedCount} of {totalClues} played</span>
          )}
          {state?.phase === 'board' && board.final && usedCount < totalClues && (
            <button type="button" onClick={() => update(s => ({ ...s, phase: 'final-wager' }))}
              className="px-3 py-1 rounded-lg border border-white/20 hover:bg-white/10">Final Jeopardy</button>
          )}
          {state?.log.length > 0 && state.phase === 'board' && (
            <button type="button" onClick={undo} className="px-3 py-1 rounded-lg border border-white/20 hover:bg-white/10">Undo last score</button>
          )}
          {state && <button type="button" onClick={restart} className="px-3 py-1 rounded-lg border border-white/20 hover:bg-white/10">Start over</button>}
          <button type="button" onClick={toggleFull} className="px-3 py-1 rounded-lg border border-white/20 hover:bg-white/10">
            {full ? 'Exit full screen' : 'Full screen'}
          </button>
          <button type="button" onClick={() => { if (document.fullscreenElement) document.exitFullscreen?.(); onExit(); }}
            className="px-3 py-1 rounded-lg border border-white/20 hover:bg-white/10">Close</button>
        </div>
      </div>
      {body}
      {state && state.phase !== 'done' && (
        <Scoreboard teams={state.teams} highlight={state.phase === 'clue' && state.current?.bet ? state.current.bet.team : null} />
      )}
    </div>
  );
}
