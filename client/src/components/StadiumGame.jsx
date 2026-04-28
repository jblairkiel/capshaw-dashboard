import { useState, useMemo, useCallback, useEffect, useRef } from 'react';

// ─── Built-in question bank (multiple-choice) ─────────────────────────────────

const BUILTIN = [
  { q: 'Who built the ark?', a: ['Moses', 'Noah', 'Abraham', 'Elijah'], c: 1 },
  { q: 'What did God create on the very first day?', a: ['Animals', 'Light', 'Stars', 'Water'], c: 1 },
  { q: 'Who was swallowed by a great fish?', a: ['Elijah', 'Daniel', 'Jonah', 'Ezekiel'], c: 2 },
  { q: 'How many disciples did Jesus choose?', a: ['7', '10', '12', '14'], c: 2 },
  { q: 'What did David use to defeat Goliath?', a: ['A sword', 'A sling and stone', 'A spear', 'His fists'], c: 1 },
  { q: 'What is the very first book of the Bible?', a: ['Exodus', 'Matthew', 'Genesis', 'Psalms'], c: 2 },
  { q: 'What did Jesus turn water into at a wedding?', a: ['Juice', 'Milk', 'Honey', 'Wine'], c: 3 },
  { q: 'Where was Jesus born?', a: ['Jerusalem', 'Nazareth', 'Bethlehem', 'Egypt'], c: 2 },
  { q: 'How many days was Jesus in the tomb?', a: ['1', '2', '3', '7'], c: 2 },
  { q: 'Who was thrown into the lions\' den?', a: ['Shadrach', 'Daniel', 'Ezekiel', 'Nehemiah'], c: 1 },
  { q: 'What did Jesus feed 5,000 people with?', a: ['Manna and honey', 'Bread and fish', 'Figs and olives', 'Loaves and grapes'], c: 1 },
  { q: 'Who was the first man God created?', a: ['Noah', 'Cain', 'Adam', 'Abraham'], c: 2 },
  { q: 'Which sea did God part for Moses?', a: ['Dead Sea', 'Red Sea', 'Sea of Galilee', 'Mediterranean'], c: 1 },
  { q: 'Who was the first king of Israel?', a: ['David', 'Solomon', 'Saul', 'Samuel'], c: 2 },
  { q: 'What river was Jesus baptized in?', a: ['Nile', 'Euphrates', 'Jordan', 'Tigris'], c: 2 },
  { q: 'Which disciple denied Jesus three times?', a: ['John', 'James', 'Judas', 'Peter'], c: 3 },
  { q: 'What was the name of Abraham\'s wife?', a: ['Rachel', 'Rebecca', 'Ruth', 'Sarah'], c: 3 },
  { q: 'Which disciple betrayed Jesus?', a: ['Thomas', 'Judas', 'Simon', 'Philip'], c: 1 },
  { q: 'How many plagues came upon Egypt?', a: ['7', '8', '10', '12'], c: 2 },
  { q: 'Who wrote most of the Psalms?', a: ['Moses', 'David', 'Solomon', 'Isaiah'], c: 1 },
  { q: 'What was the name of Moses\'s brother?', a: ['Aaron', 'Caleb', 'Joshua', 'Levi'], c: 0 },
  { q: 'Who was wrestling with God in Genesis?', a: ['Abraham', 'Isaac', 'Jacob', 'Joseph'], c: 2 },
  { q: 'What did God use to lead Israel through the desert?', a: ['A star', 'An angel', 'A pillar of cloud and fire', 'A rainbow'], c: 2 },
  { q: 'Who survived a fiery furnace and praised God?', a: ['Daniel and friends', 'Shadrach, Meshach & Abednego', 'Elijah and Elisha', 'Moses and Aaron'], c: 1 },
  { q: 'What is the shortest verse in the Bible?', a: ['God is love', 'Jesus wept', 'Pray always', 'Fear not'], c: 1 },
  { q: 'How many books are in the New Testament?', a: ['24', '25', '27', '39'], c: 2 },
  { q: 'Who was the father of John the Baptist?', a: ['Joseph', 'Zacharias', 'Simeon', 'Eli'], c: 1 },
  { q: 'Who hid two Israelite spies in Jericho?', a: ['Ruth', 'Deborah', 'Rahab', 'Esther'], c: 2 },
  { q: 'What tribe was the apostle Paul from?', a: ['Judah', 'Levi', 'Benjamin', 'Ephraim'], c: 2 },
  { q: 'On what day did God rest after creation?', a: ['5th', '6th', '7th', '8th'], c: 2 },
  { q: 'Who built the first temple in Jerusalem?', a: ['David', 'Solomon', 'Josiah', 'Ezra'], c: 1 },
  { q: 'What garden did Adam and Eve live in?', a: ['Garden of Gethsemane', 'Garden of Eden', 'Garden of Olives', 'Garden of God'], c: 1 },
  { q: 'How did Elijah go to heaven?', a: ['On angel wings', 'He walked up a mountain', 'A whirlwind and chariot of fire', 'A great white cloud'], c: 2 },
  { q: 'Which judge had supernatural strength?', a: ['Gideon', 'Samson', 'Jephthah', 'Othniel'], c: 1 },
  { q: 'How many brothers did Joseph (son of Jacob) have?', a: ['10', '11', '12', '8'], c: 1 },
  { q: 'Who was the first woman?', a: ['Ruth', 'Mary', 'Eve', 'Deborah'], c: 2 },
];

// ─── Constants ────────────────────────────────────────────────────────────────

const TOTAL_SQUARES = 32;

const SPECIAL = {
  8:  { emoji: '⭐', label: 'Star Power!',    color: '#f59e0b', msg: '+3 bonus spaces!' },
  16: { emoji: '🙏', label: 'Prayer Circle!', color: '#6366f1', msg: 'Bonus question for +3 more!' },
  24: { emoji: '🏆', label: 'Trophy Spot!',   color: '#10b981', msg: 'Take another turn!' },
};

const TEAM_PRESETS = [
  { name: 'Red Eagles',   color: '#ef4444', token: '#fca5a5', emoji: '🦅' },
  { name: 'Blue Lions',   color: '#3b82f6', token: '#93c5fd', emoji: '🦁' },
  { name: 'Green Sharks', color: '#10b981', token: '#6ee7b7', emoji: '🦈' },
  { name: 'Gold Bears',   color: '#f59e0b', token: '#fcd34d', emoji: '🐻' },
];

const ROUND_OPTIONS = [5, 10, 15, 20];

// ─── DB → game format ─────────────────────────────────────────────────────────

function dbToGame(q) {
  if (q.type === 'mc')
    return { q: q.question, a: q.options, c: Number(q.answer) };
  return {
    q: q.question, answer: q.answer, hint: q.hint || '',
    type: q.type === 'true-false' ? 'true-false' : 'comprehension',
    isLibrary: true,
  };
}

// ─── Custom question editor ───────────────────────────────────────────────────

const TYPE_LABELS = { mc: 'Multiple Choice', 'true-false': 'True / False', open: 'Open-Ended' };

function CustomQuestionEditor({ initial, onSave, onCancel }) {
  const isEdit = !!initial;
  const [type,        setType]        = useState(initial?.type || 'mc');
  const [questionText, setQuestionText] = useState(initial?.question || '');
  const [mcOptions,   setMcOptions]   = useState(initial?.options ?? ['', '', '', '']);
  const [mcCorrect,   setMcCorrect]   = useState(initial?.type === 'mc' ? Number(initial.answer) : 0);
  const [tfAnswer,    setTfAnswer]    = useState(initial?.type === 'true-false' ? initial.answer : 'true');
  const [openAnswer,  setOpenAnswer]  = useState(initial?.type === 'open' ? initial.answer : '');
  const [hint,        setHint]        = useState(initial?.hint || '');
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState('');

  const validate = () => {
    if (!questionText.trim()) return 'Question text is required.';
    if (type === 'mc' && mcOptions.some(o => !o.trim())) return 'All 4 answer options are required.';
    if (type === 'open' && !openAnswer.trim()) return 'An expected answer is required for open-ended questions.';
    return null;
  };

  const handleSave = async () => {
    const err = validate();
    if (err) { setError(err); return; }
    setSaving(true); setError('');
    const payload = {
      type,
      question: questionText.trim(),
      options:  type === 'mc' ? mcOptions.map(o => o.trim()) : null,
      answer:   type === 'mc' ? String(mcCorrect) : type === 'true-false' ? tfAnswer : openAnswer.trim(),
      hint:     hint.trim(),
    };
    try {
      const url    = isEdit ? `/api/game-questions/${initial.id}` : '/api/game-questions';
      const method = isEdit ? 'PUT' : 'POST';
      const res    = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const json   = await res.json();
      if (!json.success) throw new Error(json.error || 'Save failed');
      onSave(isEdit ? { ...initial, ...payload } : json.question);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card space-y-4 border-2 border-church-gold">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-church-navy">{isEdit ? 'Edit Question' : 'New Question'}</h4>
        <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
      </div>

      {/* Type */}
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Question Type</label>
        <div className="flex gap-1.5">
          {Object.entries(TYPE_LABELS).map(([val, lbl]) => (
            <button key={val} onClick={() => setType(val)}
              className={`flex-1 py-2 rounded-lg text-xs font-bold border-2 transition-all ${type === val ? 'bg-church-navy text-church-gold border-church-gold' : 'bg-white text-church-navy border-gray-200 hover:border-church-gold'}`}
            >{lbl}</button>
          ))}
        </div>
      </div>

      {/* Question text */}
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Question</label>
        <textarea
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold resize-none"
          rows={2} placeholder="Enter your question…"
          value={questionText} onChange={e => setQuestionText(e.target.value)}
        />
      </div>

      {/* MC options */}
      {type === 'mc' && (
        <div className="space-y-2">
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Answer Options — select correct</label>
          {['A','B','C','D'].map((letter, i) => (
            <div key={i} className="flex items-center gap-2">
              <input type="radio" name="mcCorrect" checked={mcCorrect === i} onChange={() => setMcCorrect(i)}
                className="accent-green-500 w-4 h-4 shrink-0" />
              <span className="text-xs font-bold text-gray-400 w-3">{letter}</span>
              <input
                className={`flex-1 border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-church-gold ${mcCorrect === i ? 'border-green-400 bg-green-50' : 'border-gray-200'}`}
                placeholder={`Option ${letter}`} value={mcOptions[i]}
                onChange={e => { const n = [...mcOptions]; n[i] = e.target.value; setMcOptions(n); }}
              />
            </div>
          ))}
        </div>
      )}

      {/* True/False */}
      {type === 'true-false' && (
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Correct Answer</label>
          <div className="flex gap-2">
            {['true','false'].map(opt => (
              <button key={opt} onClick={() => setTfAnswer(opt)}
                className={`flex-1 py-2.5 rounded-lg font-bold border-2 capitalize transition-all ${tfAnswer === opt ? 'bg-church-navy text-church-gold border-church-gold' : 'bg-white text-church-navy border-gray-200 hover:border-church-gold'}`}
              >{opt}</button>
            ))}
          </div>
        </div>
      )}

      {/* Open-ended */}
      {type === 'open' && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Expected Answer</label>
            <textarea
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold resize-none"
              rows={2} placeholder="The answer students should give…"
              value={openAnswer} onChange={e => setOpenAnswer(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Teacher Hint (optional)</label>
            <input
              className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-church-gold"
              placeholder="Extra context for the teacher…"
              value={hint} onChange={e => setHint(e.target.value)}
            />
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex gap-2 pt-1">
        <button onClick={onCancel} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-500 hover:bg-gray-50 transition-colors">Cancel</button>
        <button onClick={handleSave} disabled={saving}
          className="flex-1 py-2 bg-church-gold text-church-navy font-bold rounded-lg text-sm hover:bg-amber-400 disabled:opacity-50 transition-colors"
        >{saving ? 'Saving…' : isEdit ? 'Update Question' : 'Save Question'}</button>
      </div>
    </div>
  );
}

// ─── AI question generator (game-optimized) ───────────────────────────────────

const GRADE_OPTIONS = [
  { value: 'preschool',        label: 'Preschool',         sub: 'Ages 3–5' },
  { value: 'early-elementary', label: 'Early Elementary',  sub: 'Grades 1–3' },
  { value: 'upper-elementary', label: 'Upper Elementary',  sub: 'Grades 4–6' },
  { value: 'middle-school',    label: 'Middle School',     sub: 'Grades 7–8' },
  { value: 'high-school',      label: 'High School',       sub: 'Grades 9–12' },
  { value: 'adult',            label: 'Adult',             sub: 'All ages' },
];

function GameQuestionGenerator({ onGenerated, onCancel }) {
  const [passage,  setPassage]  = useState('');
  const [grade,    setGrade]    = useState('upper-elementary');
  const [count,    setCount]    = useState(10);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [result,   setResult]   = useState(null);

  const generate = async () => {
    if (!passage.trim()) { setError('Enter a passage or topic.'); return; }
    setLoading(true); setError('');
    try {
      const res  = await fetch('/api/game-questions/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passage: passage.trim(), gradeLevel: grade, questionCount: count }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setResult(json.questions);
      onGenerated(json.questions);
    } catch (e) {
      setError(e.message || 'Generation failed. Check the server connection.');
    } finally {
      setLoading(false);
    }
  };

  if (result) {
    const counts = result.reduce((acc, q) => { acc[q.type] = (acc[q.type] || 0) + 1; return acc; }, {});
    return (
      <div className="space-y-3">
        <div className="card bg-green-50 border-2 border-green-300 text-center space-y-2 py-4">
          <div className="text-4xl">✅</div>
          <p className="font-bold text-green-800">{result.length} questions generated &amp; saved!</p>
          <div className="flex justify-center gap-3 text-xs text-green-700">
            {counts.mc        && <span>🎯 {counts.mc} multiple choice</span>}
            {counts['true-false'] && <span>✓✗ {counts['true-false']} true/false</span>}
            {counts.open      && <span>💬 {counts.open} open-ended</span>}
          </div>
        </div>

        <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
          {result.map((q, i) => (
            <div key={i} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2 border border-gray-200">
              <span className="text-xs font-bold bg-church-navy text-church-gold px-1.5 py-0.5 rounded shrink-0">
                {TYPE_BADGE[q.type]}
              </span>
              <span className="text-sm text-gray-700 truncate">{q.question}</span>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => { setResult(null); setPassage(''); }}
            className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
          >Generate More</button>
          <button
            onClick={onCancel}
            className="flex-1 py-2 bg-church-navy text-church-gold font-bold rounded-lg hover:bg-church-brown transition-colors"
          >Done</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button onClick={onCancel} className="text-gray-400 hover:text-church-navy transition-colors p-1">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h4 className="font-semibold text-church-navy">Generate Questions with AI</h4>
      </div>

      {/* Passage */}
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Passage or Topic</label>
        <textarea
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold resize-none"
          rows={3}
          placeholder={'e.g. "John 3:1-21", "The Lord\'s Prayer", "David and Goliath", "The Ten Commandments"…'}
          value={passage} onChange={e => setPassage(e.target.value)}
        />
      </div>

      {/* Grade level */}
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Grade Level</label>
        <div className="grid grid-cols-2 gap-1.5">
          {GRADE_OPTIONS.map(g => (
            <button key={g.value} onClick={() => setGrade(g.value)}
              className={`text-left px-3 py-2 rounded-lg border-2 transition-colors text-xs ${grade === g.value ? 'border-church-navy bg-church-navy text-white' : 'border-gray-200 hover:border-church-gold text-gray-700'}`}
            >
              <span className="font-semibold block">{g.label}</span>
              <span className={`${grade === g.value ? 'text-gray-300' : 'text-gray-400'}`}>{g.sub}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Count */}
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          Questions: <span className="text-church-gold font-bold">{count}</span>
        </label>
        <input type="range" min={5} max={20} value={count}
          onChange={e => setCount(Number(e.target.value))}
          className="w-full accent-church-gold"
        />
        <div className="flex justify-between text-xs text-gray-400"><span>5</span><span>20</span></div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
        Generates a mix of <strong>multiple choice</strong>, <strong>true/false</strong>, and <strong>open-ended</strong> questions optimized for gameplay. All questions auto-save to your custom pool.
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <button
        onClick={generate}
        disabled={loading}
        className="w-full py-3 bg-church-gold text-church-navy font-bold rounded-xl hover:bg-amber-400 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <span className="animate-spin w-4 h-4 border-2 border-church-navy border-t-transparent rounded-full inline-block" />
            Generating…
          </>
        ) : '⚡ Generate Game Questions'}
      </button>
    </div>
  );
}

// ─── Custom questions panel (list + inline editor) ────────────────────────────

const TYPE_BADGE = { mc: 'MC', 'true-false': 'T/F', open: 'Open' };

function CustomQuestionsPanel({ onQuestionsChange, canWrite }) {
  const [questions, setQuestions] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [editingQ,  setEditingQ]  = useState(null); // null | 'new' | questionObject

  useEffect(() => {
    fetch('/api/game-questions')
      .then(r => r.json())
      .then(j => { if (j.success) { setQuestions(j.questions); onQuestionsChange(j.questions); } else setError(j.error); })
      .catch(() => setError('Could not load custom questions.'))
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sync = (next) => { setQuestions(next); onQuestionsChange(next); };

  const handleSaved = (saved) => {
    const next = editingQ === 'new'
      ? [...questions, saved]
      : questions.map(q => q.id === saved.id ? saved : q);
    sync(next);
    setEditingQ(null);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this question?')) return;
    await fetch(`/api/game-questions/${id}`, { method: 'DELETE' });
    sync(questions.filter(q => q.id !== id));
  };

  if (editingQ === 'generate') {
    return (
      <GameQuestionGenerator
        onGenerated={qs => sync([...questions, ...qs])}
        onCancel={() => setEditingQ(null)}
      />
    );
  }

  if (editingQ !== null) {
    return (
      <CustomQuestionEditor
        initial={editingQ === 'new' ? null : editingQ}
        onSave={handleSaved}
        onCancel={() => setEditingQ(null)}
      />
    );
  }

  return (
    <div className="space-y-2">
      {loading && <p className="text-sm text-gray-400 text-center py-2">Loading…</p>}
      {error   && <p className="text-sm text-red-500">{error}</p>}
      {!loading && !error && questions.length === 0 && (
        <p className="text-xs text-gray-400 text-center py-3 italic">No custom questions yet. Add one below!</p>
      )}
      {questions.map(q => (
        <div key={q.id} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2 border border-gray-200">
          <span className="text-xs font-bold bg-church-navy text-church-gold px-1.5 py-0.5 rounded shrink-0">{TYPE_BADGE[q.type]}</span>
          <span className="flex-1 text-sm text-gray-700 truncate">{q.question}</span>
          {canWrite && <button onClick={() => setEditingQ(q)}     className="text-gray-400 hover:text-church-navy p-1 text-base leading-none" title="Edit">✏️</button>}
          {canWrite && <button onClick={() => handleDelete(q.id)} className="text-gray-400 hover:text-red-500  p-1 text-base leading-none" title="Delete">🗑️</button>}
        </div>
      ))}
      {canWrite ? (
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => setEditingQ('new')}
            className="flex-1 py-2 border-2 border-dashed border-gray-300 text-gray-500 rounded-lg text-sm font-medium hover:border-church-gold hover:text-church-gold transition-colors"
          >+ Add Manually</button>
          <button
            onClick={() => setEditingQ('generate')}
            className="flex-1 py-2 border-2 border-dashed border-church-gold text-church-gold rounded-lg text-sm font-medium hover:bg-amber-50 transition-colors"
          >⚡ Generate with AI</button>
        </div>
      ) : (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-center">
          Pending approval — you can view questions but cannot add or generate new ones.
        </p>
      )}
    </div>
  );
}

// ─── Stadium SVG ──────────────────────────────────────────────────────────────

function StadiumSVG({ teams }) {
  const W = 640, H = 370, cx = 320, cy = 185, rx = 252, ry = 150;

  const positions = useMemo(() => Array.from({ length: TOTAL_SQUARES }, (_, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / TOTAL_SQUARES;
    return { x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) };
  }), []);

  const fieldRx = rx - 46, fieldRy = ry - 44;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-xl border-2 border-church-navy shadow-lg" style={{ background: '#1a2744' }}>
      {/* Stadium lights */}
      {[[58,28],[582,28],[58,342],[582,342]].map(([lx, ly], i) => (
        <g key={i}>
          <circle cx={lx} cy={ly} r={9} fill="#fbbf24" opacity={0.9} />
          <circle cx={lx} cy={ly} r={15} fill="#fbbf24" opacity={0.18} />
        </g>
      ))}

      {/* Field */}
      <ellipse cx={cx} cy={cy} rx={fieldRx} ry={fieldRy} fill="#166534" />
      <ellipse cx={cx} cy={cy} rx={fieldRx - 6} ry={fieldRy - 6} fill="none" stroke="#15803d" strokeWidth={2} />
      <line x1={cx - fieldRx + 18} y1={cy} x2={cx + fieldRx - 18} y2={cy} stroke="#15803d" strokeWidth={1} />
      <line x1={cx} y1={cy - fieldRy + 18} x2={cx} y2={cy + fieldRy - 18} stroke="#15803d" strokeWidth={1} />
      <circle cx={cx} cy={cy} r={26} fill="none" stroke="#15803d" strokeWidth={1.5} />
      <text x={cx} y={cy + 4} textAnchor="middle" fill="#bbf7d0" fontSize={10} fontWeight="bold">✝ BIBLE</text>
      <text x={cx} y={cy + 17} textAnchor="middle" fill="#bbf7d0" fontSize={10} fontWeight="bold">BOWL</text>

      {/* Track squares */}
      {positions.map((pos, i) => {
        const special = SPECIAL[i];
        const isStart = i === 0;
        const fill = isStart ? '#c9a84c' : special ? special.color : '#e2e8f0';
        const stroke = isStart ? '#92400e' : special ? '#1e1b4b' : '#94a3b8';
        return (
          <g key={i}>
            <rect x={pos.x - 13} y={pos.y - 12} width={26} height={24} rx={4} fill={fill} stroke={stroke} strokeWidth={1.5} />
            {isStart
              ? <text x={pos.x} y={pos.y + 5} textAnchor="middle" fill="#92400e" fontSize={7} fontWeight="bold">START</text>
              : special
                ? <text x={pos.x} y={pos.y + 5} textAnchor="middle" fontSize={12}>{special.emoji}</text>
                : <text x={pos.x} y={pos.y + 5} textAnchor="middle" fill="#475569" fontSize={8}>{i}</text>
            }
          </g>
        );
      })}

      {/* Team tokens */}
      {teams.map((team, ti) => {
        const sq = team.position % TOTAL_SQUARES;
        const pos = positions[sq];
        const offset = (ti - (teams.length - 1) / 2) * 9;
        return (
          <g key={ti}>
            <circle cx={pos.x + offset} cy={pos.y - 22} r={10} fill={team.color} stroke="white" strokeWidth={2} />
            <text x={pos.x + offset} y={pos.y - 18} textAnchor="middle" fontSize={10}>{team.emoji}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Setup Screen ─────────────────────────────────────────────────────────────

function SetupScreen({ onStart, canWrite }) {
  const [count, setCount] = useState(2);
  const [names, setNames] = useState(TEAM_PRESETS.map(t => t.name));
  const [rounds, setRounds] = useState(10);
  const [source, setSource] = useState('builtin');
  const [libSets, setLibSets] = useState([]);
  const [libLoading, setLibLoading] = useState(false);
  const [libError, setLibError] = useState('');
  const [selectedSetId, setSelectedSetId] = useState('all');
  const [customQs, setCustomQs] = useState([]);

  useEffect(() => {
    if (source !== 'library') return;
    setLibLoading(true);
    setLibError('');
    fetch('/api/bible-class/questions')
      .then(r => r.json())
      .then(j => { if (j.success) setLibSets(j.sets); else setLibError(j.error || 'Load failed'); })
      .catch(() => setLibError('Network error — check server connection.'))
      .finally(() => setLibLoading(false));
  }, [source]);

  const canStart =
    source === 'builtin' ||
    (source === 'library' && !libLoading && libSets.length > 0) ||
    (source === 'custom'  && customQs.length > 0);

  const handleStart = () => {
    const teams = TEAM_PRESETS.slice(0, count).map((p, i) => ({
      ...p, name: names[i].trim() || p.name, position: 0, totalDistance: 0,
    }));

    let pool = null;
    if (source === 'library') {
      const sets = selectedSetId === 'all' ? libSets : libSets.filter(s => s.id === Number(selectedSetId));
      pool = sets.flatMap(s => s.questions.map(q => ({
        q: q.question, answer: q.answer, hint: q.hint || '', type: q.type, isLibrary: true,
      })));
    } else if (source === 'custom') {
      pool = customQs.map(dbToGame);
    }

    onStart(teams, rounds, pool);
  };

  return (
    <div className="max-w-lg mx-auto space-y-5 pb-6">
      <div className="card text-center space-y-1 bg-church-navy text-white border-0">
        <div className="text-5xl pt-2">🏟️</div>
        <h2 className="text-2xl font-bold text-church-gold">Bible Bowl Stadium</h2>
        <p className="text-gray-300 text-sm pb-2">Answer Bible questions to race around the stadium!</p>
      </div>

      {/* Teams */}
      <div className="card space-y-3">
        <h3 className="font-semibold text-church-navy">Number of Teams</h3>
        <div className="flex gap-2">
          {[2, 3, 4].map(n => (
            <button key={n} onClick={() => setCount(n)}
              className={`flex-1 py-3 rounded-lg font-bold text-lg border-2 transition-all ${count === n ? 'bg-church-navy text-church-gold border-church-gold' : 'bg-white text-church-navy border-gray-200 hover:border-church-gold'}`}
            >{n}</button>
          ))}
        </div>
        <div className="space-y-2 pt-1">
          {TEAM_PRESETS.slice(0, count).map((p, i) => (
            <div key={i} className="flex items-center gap-3">
              <span className="text-xl">{p.emoji}</span>
              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: p.color }} />
              <input
                className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-church-gold"
                value={names[i]}
                onChange={e => setNames(prev => { const n = [...prev]; n[i] = e.target.value; return n; })}
                placeholder={p.name}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Rounds */}
      <div className="card space-y-3">
        <h3 className="font-semibold text-church-navy">Questions Per Team</h3>
        <div className="flex gap-2">
          {ROUND_OPTIONS.map(r => (
            <button key={r} onClick={() => setRounds(r)}
              className={`flex-1 py-2.5 rounded-lg font-bold border-2 transition-all ${rounds === r ? 'bg-church-navy text-church-gold border-church-gold' : 'bg-white text-church-navy border-gray-200 hover:border-church-gold'}`}
            >{r}</button>
          ))}
        </div>
        <p className="text-xs text-gray-400">The team furthest around the stadium after all turns wins.</p>
      </div>

      {/* Question Source */}
      <div className="card space-y-3">
        <h3 className="font-semibold text-church-navy">Question Source</h3>
        <div className="flex gap-1.5">
          {[['builtin', '🎲 Built-in'], ['library', '📚 Library'], ['custom', '✏️ Custom']].map(([val, label]) => (
            <button key={val} onClick={() => setSource(val)}
              className={`flex-1 py-2.5 rounded-lg font-medium text-sm border-2 transition-all ${source === val ? 'bg-church-navy text-church-gold border-church-gold' : 'bg-white text-church-navy border-gray-200 hover:border-church-gold'}`}
            >{label}</button>
          ))}
        </div>

        {source === 'library' && (
          <div className="pt-1">
            {libLoading && <p className="text-sm text-gray-400 text-center py-2">Loading library…</p>}
            {libError && <p className="text-sm text-red-500">{libError}</p>}
            {!libLoading && !libError && libSets.length === 0 && (
              <p className="text-sm text-amber-600 bg-amber-50 rounded-lg p-3">
                No question sets saved yet. Generate and save some in the Question Generator first, or use Built-in Trivia.
              </p>
            )}
            {!libLoading && libSets.length > 0 && (
              <select
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold"
                value={selectedSetId}
                onChange={e => setSelectedSetId(e.target.value)}
              >
                <option value="all">All sets ({libSets.reduce((s, x) => s + x.questions.length, 0)} questions)</option>
                {libSets.map(s => (
                  <option key={s.id} value={s.id}>{s.passage} — {s.questions.length} Qs</option>
                ))}
              </select>
            )}
            {source === 'library' && !libLoading && libSets.length > 0 && (
              <p className="text-xs text-gray-400 mt-1">Library questions are teacher-judged: read aloud, then click Correct or Incorrect.</p>
            )}
          </div>
        )}

        {source === 'custom' && (
          <div className="pt-1 space-y-2">
            <CustomQuestionsPanel onQuestionsChange={setCustomQs} canWrite={canWrite} />
            {customQs.length === 0 && (
              <p className="text-xs text-amber-600 bg-amber-50 rounded-lg p-2 text-center">Add at least one question to start the game.</p>
            )}
            {customQs.length > 0 && (
              <p className="text-xs text-gray-400 text-center">{customQs.length} question{customQs.length !== 1 ? 's' : ''} ready · questions auto-save for future games</p>
            )}
          </div>
        )}
      </div>

      {/* Special squares legend */}
      <div className="card bg-amber-50 border border-amber-200 space-y-1.5">
        <h3 className="font-semibold text-amber-800 text-sm">Special Squares</h3>
        {Object.entries(SPECIAL).map(([sq, s]) => (
          <div key={sq} className="text-sm text-amber-700">{s.emoji} <strong>Square {sq}</strong> — {s.label} {s.msg}</div>
        ))}
      </div>

      <button
        onClick={handleStart}
        disabled={!canStart}
        className="w-full py-4 bg-church-gold text-church-navy font-bold text-xl rounded-xl shadow hover:bg-amber-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        🏁 Start the Game!
      </button>
    </div>
  );
}

// ─── Question Card ────────────────────────────────────────────────────────────

function QuestionCard({ question, selected, onAnswer, isBonus }) {
  const letters = ['A', 'B', 'C', 'D'];
  const answerColors = [
    'bg-red-100 border-red-300 hover:bg-red-200',
    'bg-blue-100 border-blue-300 hover:bg-blue-200',
    'bg-emerald-100 border-emerald-300 hover:bg-emerald-200',
    'bg-amber-100 border-amber-300 hover:bg-amber-200',
  ];

  return (
    <div className={`card space-y-4 border-2 ${isBonus ? 'border-indigo-400 bg-indigo-50' : 'border-church-gold'}`}>
      {isBonus && <div className="text-center text-indigo-700 font-bold text-sm">🙏 BONUS — Correct = +3 extra spaces!</div>}

      <p className="text-base sm:text-lg font-semibold text-church-navy text-center leading-snug">{question.q}</p>

      {question.isLibrary && question.type === 'true-false' ? (
        /* Auto-graded True / False */
        <div className="space-y-3">
          {question.hint && <p className="text-xs text-center text-gray-400 italic">Hint: {question.hint}</p>}
          {(() => {
            const expected = question.answer?.trim().toLowerCase().startsWith('true') ? 'true' : 'false';
            return (
              <div className="flex gap-3">
                {['true', 'false'].map(opt => {
                  let cls = 'flex-1 py-3 font-bold rounded-xl text-lg border-2 transition-colors ';
                  if (selected === null) {
                    cls += opt === 'true'
                      ? 'bg-blue-100 border-blue-300 hover:bg-blue-200 text-blue-800 cursor-pointer'
                      : 'bg-amber-100 border-amber-300 hover:bg-amber-200 text-amber-800 cursor-pointer';
                  } else if (opt === expected) {
                    cls += 'bg-green-400 border-green-500 text-white cursor-default';
                  } else if (opt === selected) {
                    cls += 'bg-red-400 border-red-500 text-white cursor-default';
                  } else {
                    cls += 'bg-gray-100 border-gray-200 text-gray-400 cursor-default';
                  }
                  return (
                    <button key={opt} className={cls} onClick={() => onAnswer(opt)} disabled={selected !== null}>
                      {opt.charAt(0).toUpperCase() + opt.slice(1)}
                    </button>
                  );
                })}
              </div>
            );
          })()}
          {selected !== null && question.answer && (
            <div className="bg-gray-50 rounded-xl p-3 border border-gray-200">
              <p className="text-xs text-gray-500 font-semibold mb-1">ANSWER</p>
              <p className="text-sm text-gray-700">{question.answer}</p>
            </div>
          )}
        </div>
      ) : question.isLibrary ? (
        /* Teacher-judged for comprehension / application / discussion */
        <div className="space-y-3">
          {question.hint && <p className="text-xs text-center text-gray-400 italic">Hint: {question.hint}</p>}
          {selected === null ? (
            <div className="flex gap-3">
              <button onClick={() => onAnswer(true)}  className="flex-1 py-3 bg-green-500 hover:bg-green-600 text-white font-bold rounded-xl text-lg transition-colors">✓ Correct</button>
              <button onClick={() => onAnswer(false)} className="flex-1 py-3 bg-red-500   hover:bg-red-600   text-white font-bold rounded-xl text-lg transition-colors">✗ Incorrect</button>
            </div>
          ) : (
            <div className={`rounded-xl p-3 text-center font-semibold ${selected === true ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
              {selected === true ? '✓ Correct!' : '✗ Incorrect'}
            </div>
          )}
          {selected !== null && question.answer && (
            <div className="bg-gray-50 rounded-xl p-3 border border-gray-200">
              <p className="text-xs text-gray-500 font-semibold mb-1">MODEL ANSWER</p>
              <p className="text-sm text-gray-700">{question.answer}</p>
            </div>
          )}
        </div>
      ) : (
        /* Multiple choice */
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {question.a.map((ans, i) => {
            const isSelected = selected === i;
            const isCorrect = i === question.c;
            let cls = 'border-2 rounded-xl px-3 py-2.5 text-left font-medium transition-all flex items-center gap-2.5 text-sm ';
            if (selected === null) cls += answerColors[i] + ' cursor-pointer';
            else if (isCorrect)   cls += 'bg-green-400 border-green-500 text-white cursor-default';
            else if (isSelected)  cls += 'bg-red-400 border-red-500 text-white cursor-default';
            else                  cls += 'bg-gray-100 border-gray-200 text-gray-400 cursor-default';
            return (
              <button key={i} className={cls} onClick={() => onAnswer(i)} disabled={selected !== null}>
                <span className="w-6 h-6 rounded-full bg-white/40 flex items-center justify-center text-xs font-bold shrink-0">{letters[i]}</span>
                {ans}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Final Standings ──────────────────────────────────────────────────────────

function FinalStandings({ teams, onRestart }) {
  const ranked = [...teams].sort((a, b) => b.totalDistance - a.totalDistance);
  const medals = ['🥇', '🥈', '🥉', '4️⃣'];

  return (
    <div className="max-w-md mx-auto space-y-5">
      <div className="card text-center border-2 border-church-gold bg-amber-50 space-y-3">
        <div className="text-5xl">🏟️</div>
        <h2 className="text-2xl font-bold text-church-navy">Final Standings</h2>
        <p className="text-gray-500 text-sm">Ranked by total distance around the stadium</p>
      </div>

      <div className="space-y-2">
        {ranked.map((team, i) => (
          <div key={team.name}
            className={`card flex items-center gap-4 border-2 ${i === 0 ? 'border-church-gold bg-amber-50' : 'border-gray-100'}`}
          >
            <span className="text-3xl">{medals[i]}</span>
            <span className="text-2xl">{team.emoji}</span>
            <div className="flex-1">
              <div className="font-bold" style={{ color: team.color }}>{team.name}</div>
              <div className="text-sm text-gray-500">{team.totalDistance} squares • Lap {Math.floor(team.totalDistance / TOTAL_SQUARES) + 1}</div>
            </div>
            {i === 0 && <span className="text-xs bg-church-gold text-church-navy font-bold px-2 py-1 rounded-lg">WINNER!</span>}
          </div>
        ))}
      </div>

      <p className="text-center text-church-brown italic text-sm px-4">
        &ldquo;I can do all things through Christ who strengthens me.&rdquo; — Philippians 4:13
      </p>

      <button onClick={onRestart} className="w-full py-3 bg-church-navy text-church-gold font-bold rounded-xl hover:bg-church-brown transition-colors">
        Play Again
      </button>
    </div>
  );
}

// ─── Main Game ────────────────────────────────────────────────────────────────

export default function StadiumGame({ user }) {
  const canWrite = user?.role === 'admin';
  const [phase, setPhase]           = useState('setup');
  const [teams, setTeams]           = useState([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [question, setQuestion]     = useState(null);
  const [selected, setSelected]     = useState(null);
  const [wasCorrect, setWasCorrect] = useState(false);
  const [isBonus, setIsBonus]       = useState(false);
  const [resultMsg, setResultMsg]   = useState('');
  const [extraTurn, setExtraTurn]   = useState(false);
  const [totalRounds, setTotalRounds] = useState(10);
  const [turnsDone, setTurnsDone]   = useState(0);
  const [questionPool, setQuestionPool] = useState(null); // null = use BUILTIN
  const [usedIdxs, setUsedIdxs]    = useState(new Set());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef(null);

  // ── Fullscreen ──────────────────────────────────────────────────────────────
  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!isFullscreen) {
      if (el?.requestFullscreen) el.requestFullscreen().catch(() => {});
      else if (el?.webkitRequestFullscreen) el.webkitRequestFullscreen();
      setIsFullscreen(true);
    } else {
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
      }
      setIsFullscreen(false);
    }
  }, [isFullscreen]);

  useEffect(() => {
    const onFSChange = () => {
      if (!document.fullscreenElement && !document.webkitFullscreenElement) setIsFullscreen(false);
    };
    document.addEventListener('fullscreenchange', onFSChange);
    document.addEventListener('webkitfullscreenchange', onFSChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFSChange);
      document.removeEventListener('webkitfullscreenchange', onFSChange);
    };
  }, []);

  // ── Pick question ───────────────────────────────────────────────────────────
  const pickQuestion = useCallback((pool, used) => {
    const source = pool ?? BUILTIN;
    const avail = source.map((q, i) => ({ q, i })).filter(({ i }) => !used.has(i));
    const list = avail.length > 0 ? avail : source.map((q, i) => ({ q, i }));
    const pick = list[Math.floor(Math.random() * list.length)];
    setUsedIdxs(prev => new Set([...prev, pick.i]));
    return pick.q;
  }, []);

  // ── Game start ──────────────────────────────────────────────────────────────
  const startGame = (initialTeams, rounds, pool) => {
    setTeams(initialTeams);
    setCurrentIdx(0);
    setTotalRounds(rounds);
    setTurnsDone(0);
    setQuestionPool(pool);
    setUsedIdxs(new Set());
    setExtraTurn(false);
    setPhase('playing');
  };

  // ── Draw question ───────────────────────────────────────────────────────────
  const drawQuestion = (bonus = false) => {
    const q = pickQuestion(questionPool, usedIdxs);
    setQuestion(q);
    setSelected(null);
    setWasCorrect(false);
    setIsBonus(bonus);
    setPhase('question');
  };

  // ── Submit answer ───────────────────────────────────────────────────────────
  const submitAnswer = (val) => {
    if (selected !== null) return;
    setSelected(val);

    const isLibrary = question.isLibrary;
    let correct;
    if (!isLibrary) {
      correct = val === question.c;
    } else if (question.type === 'true-false') {
      const expected = question.answer?.trim().toLowerCase().startsWith('true') ? 'true' : 'false';
      correct = val === expected;
    } else {
      correct = val === true; // teacher-judged
    }
    setWasCorrect(correct);

    if (correct) {
      const spaces = 2 + Math.floor(Math.random() * 3); // 2–4
      const effective = isBonus ? 3 : spaces;

      let msg = isBonus ? `🙏 Correct! +3 bonus spaces!` : `✅ Correct! +${effective} spaces!`;
      let extra = false;
      let bonusQ = false;

      const newPos = (teams[currentIdx].position + effective) % TOTAL_SQUARES;
      const newDist = teams[currentIdx].totalDistance + effective;
      const special = SPECIAL[newPos];

      let finalPos = newPos;
      let finalDist = newDist;

      if (special && !isBonus) {
        if (special.emoji === '⭐') {
          finalPos = (newPos + 3) % TOTAL_SQUARES;
          finalDist = newDist + 3;
          msg += ` ⭐ Star Power! +3 more!`;
        } else if (special.emoji === '🏆') {
          extra = true;
          msg += ` 🏆 Trophy Spot! Take another turn!`;
        } else if (special.emoji === '🙏') {
          bonusQ = true;
          msg += ` 🙏 Prayer Circle!`;
        }
      }

      setTeams(prev => prev.map((t, i) =>
        i !== currentIdx ? t : { ...t, position: finalPos, totalDistance: finalDist }
      ));
      setExtraTurn(extra);
      setResultMsg(msg);

      if (bonusQ) { setTimeout(() => setPhase('bonus-prompt'), 350); return; }
    } else {
      setResultMsg(isLibrary ? `❌ Incorrect. ${question.answer ? 'See the answer below.' : ''}` : `❌ Not quite! Answer: ${question.a[question.c]}`);
    }

    setTimeout(() => setPhase('result'), 350);
  };

  // ── Next turn ───────────────────────────────────────────────────────────────
  const nextTurn = () => {
    if (extraTurn) { setExtraTurn(false); setPhase('playing'); return; }

    const nextDone = turnsDone + 1;
    const totalTurns = totalRounds * teams.length;

    if (nextDone >= totalTurns) { setTurnsDone(nextDone); setPhase('standings'); return; }

    setTurnsDone(nextDone);
    setCurrentIdx((currentIdx + 1) % teams.length);
    setPhase('playing');
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  const currentTeam = teams[currentIdx];
  const totalTurns = totalRounds * teams.length;
  const turnsLeft = Math.max(0, totalTurns - turnsDone);
  const roundNum = Math.floor(turnsDone / (teams.length || 1)) + 1;

  const fsBtn = (
    <button
      onClick={toggleFullscreen}
      title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
      className="p-2 rounded-lg bg-church-navy/10 hover:bg-church-navy/20 text-church-navy transition-colors shrink-0"
    >
      {isFullscreen ? (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V4m0 5H4m11-5v5m0 0h5M9 15v5m0-5H4m11 5v-5m0 0h5" />
        </svg>
      ) : (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0-4l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5h-4m4 0v-4m0 4l-5-5" />
        </svg>
      )}
    </button>
  );

  return (
    <div
      ref={containerRef}
      className={isFullscreen
        ? 'fixed inset-0 z-50 bg-church-cream overflow-auto flex flex-col'
        : 'relative'
      }
    >
      {phase === 'setup' && (
        <div className={isFullscreen ? 'flex-1 overflow-auto p-4' : ''}>
          <div className="flex justify-end mb-2">{fsBtn}</div>
          <SetupScreen onStart={startGame} canWrite={canWrite} />
        </div>
      )}

      {phase === 'standings' && (
        <div className={isFullscreen ? 'flex-1 overflow-auto p-4' : ''}>
          <div className="flex justify-end mb-2">{fsBtn}</div>
          <FinalStandings teams={teams} onRestart={() => setPhase('setup')} />
        </div>
      )}

      {['playing', 'question', 'bonus-prompt', 'result'].includes(phase) && (
        <div className={`space-y-3 ${isFullscreen ? 'flex-1 flex flex-col p-3 sm:p-4 overflow-auto' : ''}`}>
          {/* Header bar */}
          <div className="flex items-center gap-3">
            <div className="flex-1 bg-church-navy rounded-xl px-4 py-2 flex items-center justify-between gap-2">
              <span className="text-church-gold font-bold text-sm">Round {roundNum}/{totalRounds}</span>
              <span className="text-gray-300 text-xs">{turnsLeft} turn{turnsLeft !== 1 ? 's' : ''} left</span>
              <div className="flex-1 max-w-32 bg-white/10 rounded-full h-2">
                <div className="bg-church-gold h-2 rounded-full transition-all" style={{ width: `${((totalTurns - turnsLeft) / totalTurns) * 100}%` }} />
              </div>
            </div>
            {fsBtn}
          </div>

          {/* Stadium */}
          <StadiumSVG teams={teams} />

          {/* Scoreboard */}
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${teams.length}, 1fr)` }}>
            {teams.map((team, i) => {
              const laps = Math.floor(team.totalDistance / TOTAL_SQUARES);
              const active = i === currentIdx && phase !== 'result';
              return (
                <div key={i} className={`rounded-xl p-2 text-center border-2 transition-all ${active ? 'border-church-gold shadow' : 'border-transparent bg-white/60'}`}
                  style={{ background: active ? team.token + 'bb' : '#f8fafc' }}
                >
                  <div className="text-xl">{team.emoji}</div>
                  <div className="font-bold text-xs text-church-navy truncate">{team.name}</div>
                  <div className="text-xs text-gray-500">Sq.{team.position} · {team.totalDistance}▲</div>
                  <div className="text-xs text-gray-400">Lap {laps + 1}</div>
                </div>
              );
            })}
          </div>

          {/* Turn / question / result panels */}
          {phase === 'playing' && currentTeam && (
            <div className="card text-center space-y-3 border-2" style={{ borderColor: currentTeam.color }}>
              <div className="text-3xl">{currentTeam.emoji}</div>
              <h3 className="text-lg font-bold" style={{ color: currentTeam.color }}>{currentTeam.name}&apos;s Turn!</h3>
              <p className="text-gray-500 text-xs">Square {currentTeam.position} · Total distance: {currentTeam.totalDistance}</p>
              <button
                onClick={() => drawQuestion(false)}
                className="w-full py-3.5 text-white font-bold text-base rounded-xl shadow hover:opacity-90 transition-opacity"
                style={{ background: currentTeam.color }}
              >📖 Draw a Bible Question!</button>
            </div>
          )}

          {phase === 'question' && question && (
            <QuestionCard question={question} selected={selected} onAnswer={submitAnswer} isBonus={isBonus} />
          )}

          {phase === 'bonus-prompt' && (
            <div className="card text-center space-y-3 border-2 border-indigo-400 bg-indigo-50">
              <div className="text-4xl">🙏</div>
              <h3 className="font-bold text-indigo-800">Prayer Circle Bonus!</h3>
              <p className="text-indigo-600 text-sm">Answer correctly to move +3 extra spaces!</p>
              <button onClick={() => drawQuestion(true)} className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700">
                Draw Bonus Question!
              </button>
            </div>
          )}

          {phase === 'result' && (
            <div className={`card text-center space-y-3 border-2 ${wasCorrect ? 'border-green-400 bg-green-50' : 'border-red-300 bg-red-50'}`}>
              <div className="text-4xl">{wasCorrect ? '🎉' : '😅'}</div>
              <p className="font-semibold text-church-navy">{resultMsg}</p>
              <button onClick={nextTurn} className="w-full py-3 bg-church-navy text-church-gold font-bold rounded-xl hover:bg-church-brown transition-colors">
                {extraTurn ? `${currentTeam?.emoji} Take Another Turn →` : turnsDone + 1 >= totalTurns ? '🏆 See Final Standings!' : 'Next Team →'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
