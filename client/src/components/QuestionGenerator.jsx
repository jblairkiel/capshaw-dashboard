import { useState } from 'react';

const GRADE_LEVELS = [
  { value: 'preschool',        label: 'Preschool',         sub: 'Ages 3–5' },
  { value: 'early-elementary', label: 'Early Elementary',  sub: 'Grades 1–3' },
  { value: 'upper-elementary', label: 'Upper Elementary',  sub: 'Grades 4–6' },
  { value: 'middle-school',    label: 'Middle School',     sub: 'Grades 7–8' },
  { value: 'high-school',      label: 'High School',       sub: 'Grades 9–12' },
  { value: 'adult',            label: 'Adult',             sub: 'All ages' },
];

const QUESTION_TYPES = [
  { value: 'comprehension', label: 'Comprehension', pill: 'bg-blue-100 text-blue-700' },
  { value: 'application',   label: 'Application',   pill: 'bg-green-100 text-green-700' },
  { value: 'discussion',    label: 'Discussion',     pill: 'bg-purple-100 text-purple-700' },
  { value: 'true-false',    label: 'True / False',   pill: 'bg-amber-100 text-amber-700' },
];

// ─── Single question card ─────────────────────────────────────────────────────

function QuestionCard({ index, q, revealed, onReveal }) {
  const pill = QUESTION_TYPES.find(t => t.value === q.type)?.pill || 'bg-gray-100 text-gray-600';

  return (
    <div className="card border-l-4 border-church-gold py-4 px-4 sm:px-5">
      <div className="flex items-start gap-3">
        <span className="text-church-gold font-bold text-base leading-snug shrink-0 w-6 pt-0.5">
          {index}.
        </span>
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <p className="font-medium text-church-navy leading-snug">{q.question}</p>
            {q.type && (
              <span className={`shrink-0 px-2 py-0.5 rounded text-xs font-medium capitalize ${pill}`}>
                {q.type.replace('-', '\u200b/\u200b')}
              </span>
            )}
          </div>

          <button
            onClick={onReveal}
            className="flex items-center gap-1 text-xs font-medium text-church-gold hover:text-church-navy transition-colors"
          >
            <svg
              className={`w-3.5 h-3.5 transition-transform ${revealed ? 'rotate-90' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            {revealed ? 'Hide answer' : 'Show answer'}
          </button>

          {revealed && (
            <div className="pl-3 border-l-2 border-gray-200 space-y-1">
              <p className="text-sm text-gray-700">{q.answer}</p>
              {q.hint && <p className="text-xs text-gray-400 italic">Teacher hint: {q.hint}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function QuestionGenerator({ user }) {
  const canWrite = user?.role === 'admin';
  const [passage,   setPassage]   = useState('');
  const [grade,     setGrade]     = useState('upper-elementary');
  const [count,     setCount]     = useState(10);
  const [types,     setTypes]     = useState(['comprehension', 'application', 'discussion']);
  const [questions,  setQuestions]  = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');
  const [revealed,   setRevealed]   = useState({});

  const toggleType = t =>
    setTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);

  const generate = async () => {
    if (!passage.trim()) { setError('Enter a Bible passage or reference.'); return; }
    if (types.length === 0) { setError('Select at least one question type.'); return; }
    setError('');
    setLoading(true);
    setQuestions([]);
    setRevealed({});
    try {
      const res  = await fetch('/api/bible-class/generate-questions', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ passage, gradeLevel: grade, questionCount: count, questionTypes: types }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setQuestions(json.questions);
      fetch('/api/bible-class/questions/save', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ passage, gradeLevel: grade, questions: json.questions }),
      }).catch(() => {});
    } catch (e) {
      setError(e.message || 'Generation failed.');
    } finally {
      setLoading(false);
    }
  };

  const copyAll = () => {
    const text = questions
      .map((q, i) => [
        `${i + 1}. ${q.question}`,
        `   Answer: ${q.answer}`,
        q.hint ? `   Hint: ${q.hint}` : '',
      ].filter(Boolean).join('\n'))
      .join('\n\n');
    navigator.clipboard.writeText(text).catch(() => {});
  };

  return (
    <div className="space-y-5">

      {/* ── Inputs ── */}
      <div className="card space-y-5">

        {/* Passage */}
        <div>
          <label className="block text-sm font-semibold text-church-navy mb-1">
            Bible Passage or Reference
          </label>
          <textarea
            value={passage}
            onChange={e => setPassage(e.target.value)}
            placeholder='e.g. "John 3:16–21" or paste the full passage text…'
            rows={4}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-church-navy resize-y"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">

          {/* Grade level */}
          <div>
            <label className="block text-sm font-semibold text-church-navy mb-1">Grade Level</label>
            <div className="grid grid-cols-2 gap-1.5">
              {GRADE_LEVELS.map(g => (
                <button
                  key={g.value}
                  onClick={() => setGrade(g.value)}
                  className={`text-left px-3 py-2 rounded-lg border-2 transition-colors text-sm ${
                    grade === g.value
                      ? 'border-church-navy bg-church-navy text-white'
                      : 'border-gray-200 hover:border-gray-300 text-gray-700'
                  }`}
                >
                  <span className="font-medium block leading-tight">{g.label}</span>
                  <span className={`text-xs ${grade === g.value ? 'text-gray-300' : 'text-gray-400'}`}>
                    {g.sub}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Count + types */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-church-navy mb-1">
                Questions:&nbsp;
                <span className="text-church-gold">{count}</span>
              </label>
              <input
                type="range" min={3} max={20} value={count}
                onChange={e => setCount(Number(e.target.value))}
                className="w-full accent-church-gold"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-0.5">
                <span>3</span><span>20</span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-church-navy mb-1">
                Question Types
              </label>
              <div className="flex flex-wrap gap-1.5">
                {QUESTION_TYPES.map(t => (
                  <button
                    key={t.value}
                    onClick={() => toggleType(t.value)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium border-2 transition-colors ${
                      types.includes(t.value)
                        ? 'border-church-navy bg-church-navy text-white'
                        : 'border-gray-200 text-gray-500 hover:border-gray-400'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {!canWrite && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Your account is pending approval. Question generation requires an approved account.
          </p>
        )}
        <button
          onClick={generate}
          disabled={loading || !canWrite}
          className="btn-primary flex items-center gap-2 w-full sm:w-auto justify-center disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <>
              <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
              Generating…
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              Generate Questions
            </>
          )}
        </button>
      </div>

      {/* ── Results ── */}
      {questions.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <h3 className="section-heading mb-0">{questions.length} Questions</h3>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={copyAll}
                className="flex items-center gap-1.5 text-sm border border-gray-300 px-3 py-1.5 rounded-lg text-church-navy hover:border-church-gold hover:text-church-gold transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Copy all
              </button>
              <button
                onClick={() => window.print()}
                className="text-sm border border-gray-300 px-3 py-1.5 rounded-lg text-church-navy hover:border-church-gold hover:text-church-gold transition-colors"
              >
                Print
              </button>
            </div>
          </div>

          {questions.map((q, i) => (
            <QuestionCard
              key={i}
              index={i + 1}
              q={q}
              revealed={!!revealed[i]}
              onReveal={() => setRevealed(p => ({ ...p, [i]: !p[i] }))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
