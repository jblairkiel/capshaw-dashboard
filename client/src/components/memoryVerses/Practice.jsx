import { useState, useEffect, useMemo, useRef } from 'react';
import { GAMES, wordsOf, bare, firstLetters, shuffled, hiddenAt, gradeTyped, PASS, practiceOrder } from './games';

// Practising a set: any of the five games, one verse at a time, due verses
// first. Each verse finished is sent to the server, which moves it up or down
// the member's review ladder. In Present mode — the teacher's screen on a TV
// or projector — the same games fill the screen in large type, and nothing is
// recorded against the teacher's own practice.

const API = '/api/memory-verses';

async function record(verseId, correct) {
  try {
    await fetch(`${API}/practice`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verseId, correct }),
    });
  } catch { /* practice still works offline; it just is not remembered */ }
}

const btn = 'px-4 py-2 rounded-lg text-sm font-semibold border-2 transition-colors disabled:opacity-40';
const primary = `${btn} bg-church-navy text-white border-church-navy hover:bg-church-navy/90`;
const plain = `${btn} bg-white text-church-navy border-gray-200 hover:border-church-gold`;

function SelfMark({ onDone, big }) {
  return (
    <div className={`flex justify-center gap-3 ${big ? 'mt-10' : 'mt-5'}`}>
      <button type="button" onClick={() => onDone(false)} className={`${plain} ${big ? 'text-2xl px-8 py-4' : ''}`}>Not yet</button>
      <button type="button" onClick={() => onDone(true)} className={`${primary} ${big ? 'text-2xl px-8 py-4' : ''}`}>I knew it</button>
    </div>
  );
}

const verseClass = big => (big ? 'text-4xl sm:text-5xl leading-snug' : 'text-xl sm:text-2xl leading-relaxed');

// ─── The five games ───────────────────────────────────────────────────────────

function FlashCard({ verse, big, onDone, reverse }) {
  const [flipped, setFlipped] = useState(false);
  const front = reverse ? verse.text : verse.reference;
  const back = reverse ? verse.reference : verse.text;
  return (
    <div className="text-center">
      <button type="button" onClick={() => setFlipped(f => !f)} aria-label={flipped ? 'Turn the card back' : 'Turn the card over'}
        className={`w-full rounded-2xl border-2 border-church-gold bg-church-cream px-6 ${big ? 'py-20' : 'py-12'} shadow-sm`}>
        <span className={`block font-serif text-church-navy ${flipped || reverse ? verseClass(big) : big ? 'text-6xl font-bold' : 'text-3xl font-bold'}`}>
          {flipped ? back : front}
        </span>
        <span className="block mt-4 text-xs text-gray-500">{flipped ? 'Tap to turn back' : 'Say it, then tap to turn over'}</span>
      </button>
      {flipped && <SelfMark onDone={onDone} big={big} />}
    </div>
  );
}

function Blanks({ verse, big, onDone }) {
  const [level, setLevel] = useState(1);
  const hidden = useMemo(() => hiddenAt(verse.text, level), [verse.text, level]);
  const [shown, setShown] = useState(() => new Set());
  useEffect(() => { setShown(new Set()); }, [level, verse.id]);
  const words = wordsOf(verse.text);
  return (
    <div className="text-center">
      <p className={`font-serif text-church-navy ${verseClass(big)}`}>
        {words.map((w, i) => (hidden.has(i) && !shown.has(i)
          ? <button key={i} type="button" onClick={() => setShown(s => new Set(s).add(i))} aria-label={`Show word ${i + 1}`}
              className="inline-block align-baseline mx-1 border-b-4 border-church-gold text-transparent select-none" style={{ minWidth: `${Math.max(2, bare(w).length) * 0.55}em` }}>
              {w}
            </button>
          : <span key={i} className={`mx-1 ${hidden.has(i) ? 'text-church-gold' : ''}`}>{w}</span>
        ))}
      </p>
      <div className="mt-4 flex flex-wrap justify-center items-center gap-2 text-sm">
        <span className="text-gray-500">Words hidden:</span>
        {[1, 2, 3, 4].map(n => (
          <button key={n} type="button" aria-pressed={level === n} onClick={() => setLevel(n)}
            className={`px-3 py-1 rounded-full border ${level === n ? 'bg-church-navy text-white border-church-navy' : 'border-gray-200 text-gray-600'}`}>
            {['', 'A few', 'Half', 'Most', 'All'][n]}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-gray-500">Say the verse out loud, filling each blank. Tap a blank to check it.</p>
      <SelfMark onDone={onDone} big={big} />
    </div>
  );
}

function Letters({ verse, big, onDone }) {
  const [reveal, setReveal] = useState(false);
  return (
    <div className="text-center">
      <p className={`font-serif text-church-navy tracking-wide ${verseClass(big)}`}>{reveal ? verse.text : firstLetters(verse.text)}</p>
      <button type="button" onClick={() => setReveal(r => !r)} className={`${plain} mt-5`}>{reveal ? 'Hide the words' : 'Show the words'}</button>
      <SelfMark onDone={onDone} big={big} />
    </div>
  );
}

function WordOrder({ verse, big, onDone }) {
  const words = useMemo(() => wordsOf(verse.text), [verse.text]);
  const [pool, setPool] = useState(() => shuffled(words.map((w, i) => ({ w, i }))));
  const [placed, setPlaced] = useState([]);
  const [misses, setMisses] = useState(0);
  const [wrong, setWrong] = useState(null);
  useEffect(() => { setPool(shuffled(words.map((w, i) => ({ w, i })))); setPlaced([]); setMisses(0); }, [words]);

  const done = placed.length === words.length;
  function tap(chip) {
    // Any copy of the right word will do: "the" twice in a verse is the same.
    const want = bare(words[placed.length]);
    if (bare(chip.w) === want) {
      setPlaced(p => [...p, words[placed.length]]);
      setPool(p => p.filter(c => c !== chip));
      setWrong(null);
    } else {
      setMisses(m => m + 1);
      setWrong(chip);
    }
  }
  const allowed = Math.max(1, Math.floor(words.length / 10));
  return (
    <div className="text-center">
      <p className={`font-serif text-church-navy min-h-[3em] ${verseClass(big)}`} aria-label="Your verse so far">
        {placed.join(' ')}{!done && <span className="text-church-gold"> …</span>}
      </p>
      {!done && (
        <div className="mt-4 flex flex-wrap justify-center gap-2" role="group" aria-label="Words to place">
          {pool.map(chip => (
            <button key={chip.i} type="button" onClick={() => tap(chip)}
              className={`rounded-lg border-2 px-3 py-1.5 ${big ? 'text-2xl' : 'text-base'} ${wrong === chip ? 'border-red-400 bg-red-50 text-red-700' : 'border-gray-200 bg-white text-church-navy hover:border-church-gold'}`}>
              {chip.w}
            </button>
          ))}
        </div>
      )}
      <p className="mt-3 text-sm text-gray-500">{misses ? `${misses} wrong tap${misses === 1 ? '' : 's'}` : 'Tap the next word'}</p>
      {done && (
        <div className="mt-4">
          <p className={`font-semibold ${misses <= allowed ? 'text-emerald-700' : 'text-amber-700'}`}>
            {misses <= allowed ? 'Well done!' : 'Done — keep practising this one.'}
          </p>
          <button type="button" onClick={() => onDone(misses <= allowed)} className={`${primary} mt-3`}>Next</button>
        </div>
      )}
    </div>
  );
}

function TypeIt({ verse, big, onDone }) {
  const [typed, setTyped] = useState('');
  const [result, setResult] = useState(null);
  const ref = useRef(null);
  useEffect(() => { setTyped(''); setResult(null); ref.current?.focus(); }, [verse.id]);
  return (
    <div>
      <p className={`text-center font-serif font-bold text-church-navy mb-3 ${big ? 'text-5xl' : 'text-2xl'}`}>{verse.reference}</p>
      {!result ? (
        <>
          <textarea ref={ref} value={typed} onChange={e => setTyped(e.target.value)} rows={big ? 5 : 4} aria-label="Type the verse"
            className={`w-full border-2 border-gray-200 rounded-xl p-3 focus:border-church-gold focus:outline-none ${big ? 'text-3xl' : 'text-base'}`}
            placeholder="Type the verse from memory…" />
          <div className="mt-3 text-center">
            <button type="button" onClick={() => setResult(gradeTyped(verse.text, typed))} disabled={!typed.trim()} className={primary}>Check</button>
          </div>
        </>
      ) : (
        <div className="text-center">
          <p className={`font-serif ${verseClass(big)}`}>
            {result.words.map((w, i) => (
              <span key={i} className={`mx-0.5 ${w.ok ? 'text-church-navy' : 'text-red-600 underline decoration-wavy'}`}>{w.word} </span>
            ))}
          </p>
          <p className={`mt-3 font-semibold ${result.score >= PASS ? 'text-emerald-700' : 'text-amber-700'}`}>
            {Math.round(result.score * 100)}% right{result.score >= PASS ? ' — well done!' : ' — the words in red are the ones to work on.'}
          </p>
          <button type="button" onClick={() => onDone(result.score >= PASS)} className={`${primary} mt-3`}>Next</button>
        </div>
      )}
    </div>
  );
}

// ─── The runner ───────────────────────────────────────────────────────────────

export default function Practice({ set, initialGame = 'flash', present = false, onClose, onRecorded }) {
  const [game, setGame] = useState(initialGame);
  const [big, setBig] = useState(present);
  const [reverse, setReverse] = useState(false);
  const order = useMemo(() => practiceOrder(set.verses), [set.verses]);
  const [at, setAt] = useState(0);
  const [results, setResults] = useState([]);
  const frame = useRef(null);

  useEffect(() => {
    if (!big) return undefined;
    const el = frame.current;
    el?.requestFullscreen?.().catch(() => {});
    const onKey = e => { if (e.key === 'Escape') setBig(false); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
  }, [big]);

  const verse = order[at];
  const finished = at >= order.length;
  const right = results.filter(r => r.correct).length;

  function done(correct) {
    // Present mode is the teacher's screen: a class's answers are not the
    // teacher's own practice.
    if (!big) { record(verse.id, correct); onRecorded?.(); }
    setResults(r => [...r, { verseId: verse.id, correct }]);
    setAt(a => a + 1);
  }
  const restart = () => { setAt(0); setResults([]); };
  const Game = { flash: FlashCard, blanks: Blanks, letters: Letters, order: WordOrder, type: TypeIt }[game];

  const body = (
    <div className={big ? 'max-w-5xl mx-auto w-full' : ''}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className="min-w-0">
          <h3 className={`font-serif font-semibold text-church-navy ${big ? 'text-3xl' : 'text-lg'}`}>{set.title}</h3>
          <p className="text-xs text-gray-500">{finished ? 'Finished' : `Verse ${at + 1} of ${order.length}`} · {set.translation}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setBig(b => !b)} className={plain} aria-pressed={big}>
            {big ? 'Leave Present mode' : 'Present'}
          </button>
          <button type="button" onClick={onClose} className={plain}>{big ? 'Close' : 'Back to the set'}</button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-5" role="group" aria-label="Game">
        {GAMES.map(g => (
          <button key={g.id} type="button" aria-pressed={game === g.id} onClick={() => setGame(g.id)} title={g.blurb}
            className={`px-3 py-1.5 rounded-full text-sm border-2 ${game === g.id ? 'bg-church-navy text-church-gold border-church-gold font-semibold' : 'bg-white text-church-navy border-gray-200 hover:border-church-gold'}`}>
            {g.label}
          </button>
        ))}
        {game === 'flash' && (
          <label className="ml-2 flex items-center gap-1.5 text-xs text-gray-600">
            <input type="checkbox" checked={reverse} onChange={e => setReverse(e.target.checked)} className="accent-church-gold" />
            Show the verse first
          </label>
        )}
      </div>

      {finished ? (
        <div className="text-center py-8">
          <p className={`font-serif text-church-navy ${big ? 'text-5xl' : 'text-2xl'}`}>{right} of {order.length} right</p>
          <p className="text-sm text-gray-500 mt-2">
            {big ? 'Practice in Present mode is not saved to anyone\'s progress.' : 'Your progress is saved. Verses you missed come back first next time.'}
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <button type="button" onClick={restart} className={primary}>Practise again</button>
            <button type="button" onClick={onClose} className={plain}>Back to the set</button>
          </div>
        </div>
      ) : (
        <Game key={`${game}-${verse.id}-${at}`} verse={verse} big={big} onDone={done} reverse={reverse} />
      )}
    </div>
  );

  if (big) {
    return (
      <div ref={frame} className="fixed inset-0 z-50 bg-white overflow-y-auto p-6 sm:p-10 flex" role="dialog" aria-modal="true" aria-label={`Present: ${set.title}`}>
        {body}
      </div>
    );
  }
  return <div ref={frame} className="card">{body}</div>;
}
