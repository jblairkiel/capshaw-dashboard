import { useState, useEffect, useCallback } from 'react';

const GRADE_LABELS = {
  'preschool':        'Preschool',
  'early-elementary': 'Early Elementary',
  'upper-elementary': 'Upper Elementary',
  'middle-school':    'Middle School',
  'high-school':      'High School',
  'adult':            'Adult',
};

const TYPE_PILL = {
  'comprehension': 'bg-blue-100 text-blue-700',
  'application':   'bg-green-100 text-green-700',
  'discussion':    'bg-purple-100 text-purple-700',
  'true-false':    'bg-amber-100 text-amber-700',
};

// ─── Single question row ──────────────────────────────────────────────────────

function QuestionRow({ q }) {
  const [open, setOpen] = useState(false);
  const pill = TYPE_PILL[q.type] || 'bg-gray-100 text-gray-600';

  return (
    <div className="border-l-2 border-gray-200 pl-3 py-1">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full text-left flex items-start gap-2"
      >
        <svg
          className={`w-3.5 h-3.5 mt-0.5 shrink-0 text-church-gold transition-transform ${open ? 'rotate-90' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="flex-1 text-sm text-gray-800 leading-snug">{q.question}</span>
        {q.type && (
          <span className={`shrink-0 ml-2 px-1.5 py-0.5 rounded text-xs font-medium ${pill}`}>
            {q.type.replace('-', '\u200b/\u200b')}
          </span>
        )}
      </button>
      {open && (
        <div className="mt-1.5 ml-5 space-y-1">
          <p className="text-sm text-gray-600">{q.answer}</p>
          {q.hint && <p className="text-xs text-gray-400 italic">Teacher hint: {q.hint}</p>}
        </div>
      )}
    </div>
  );
}

// ─── Set card ─────────────────────────────────────────────────────────────────

function SetCard({ set, onDelete, canWrite }) {
  const [expanded, setExpanded] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async (e) => {
    e.stopPropagation();
    if (!window.confirm('Delete this question set?')) return;
    setDeleting(true);
    try {
      await fetch(`/api/bible-class/questions/set/${set.id}`, { method: 'DELETE' });
      onDelete(set.id);
    } catch {
      setDeleting(false);
    }
  };

  const dateStr = new Date(set.createdAt + 'Z').toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  });

  return (
    <div className="card space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <button
          onClick={() => setExpanded(o => !o)}
          className="flex-1 text-left flex items-start gap-2 min-w-0"
        >
          <svg
            className={`w-4 h-4 mt-0.5 shrink-0 text-church-gold transition-transform ${expanded ? 'rotate-90' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <div className="min-w-0">
            <p className="font-semibold text-church-navy leading-snug truncate">{set.passage}</p>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className="text-xs bg-church-navy/10 text-church-navy px-2 py-0.5 rounded font-medium">
                {GRADE_LABELS[set.grade] || set.grade}
              </span>
              <span className="text-xs text-gray-400">{set.questions.length} questions</span>
              <span className="text-xs text-gray-400">{dateStr}</span>
            </div>
          </div>
        </button>

        {canWrite && <button
          onClick={handleDelete}
          disabled={deleting}
          className="shrink-0 p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
          title="Delete set"
        >
          {deleting
            ? <span className="animate-spin inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
            : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            )
          }
        </button>}
      </div>

      {/* Questions */}
      {expanded && (
        <div className="space-y-2 pt-1">
          {set.questions.map(q => <QuestionRow key={q.id} q={q} />)}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const GRADES = Object.entries(GRADE_LABELS).map(([value, label]) => ({ value, label }));

export default function QuestionLibrary({ user }) {
  const canWrite = user?.role === 'admin';
  const [sets,    setSets]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [search,  setSearch]  = useState('');
  const [grade,   setGrade]   = useState('');
  const [query,   setQuery]   = useState({ search: '', grade: '' });

  const fetchSets = useCallback(async ({ search, grade }) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (grade)  params.set('grade',  grade);
      const res  = await fetch(`/api/bible-class/questions?${params}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setSets(json.sets);
    } catch (e) {
      setError(e.message || 'Failed to load library.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSets(query); }, [query, fetchSets]);

  const handleSearch = (e) => {
    e.preventDefault();
    setQuery({ search, grade });
  };

  const handleGrade = (g) => {
    const next = grade === g ? '' : g;
    setGrade(next);
    setQuery({ search, grade: next });
  };

  const handleDelete = (id) => setSets(prev => prev.filter(s => s.id !== id));

  return (
    <div className="space-y-5">

      {/* ── Filters ── */}
      <div className="card space-y-4">
        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search passages or questions…"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-church-navy"
          />
          <button type="submit" className="btn-primary text-sm px-4 py-2 flex items-center gap-1.5">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
            </svg>
            Search
          </button>
        </form>

        <div className="flex flex-wrap gap-1.5">
          {GRADES.map(g => (
            <button
              key={g.value}
              onClick={() => handleGrade(g.value)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium border-2 transition-colors ${
                grade === g.value
                  ? 'border-church-navy bg-church-navy text-white'
                  : 'border-gray-200 text-gray-500 hover:border-gray-400'
              }`}
            >
              {g.label}
            </button>
          ))}
          {(search || grade) && (
            <button
              onClick={() => { setSearch(''); setGrade(''); setQuery({ search: '', grade: '' }); }}
              className="px-2.5 py-1 rounded-lg text-xs font-medium border-2 border-red-200 text-red-500 hover:bg-red-50 transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* ── Results ── */}
      {loading && (
        <div className="flex justify-center py-10">
          <span className="animate-spin w-6 h-6 border-2 border-church-gold border-t-transparent rounded-full" />
        </div>
      )}

      {!loading && error && (
        <p className="text-sm text-red-600 text-center py-6">{error}</p>
      )}

      {!loading && !error && sets.length === 0 && (
        <div className="text-center py-10 text-gray-400">
          <svg className="w-10 h-10 mx-auto mb-3 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
          </svg>
          <p className="text-sm">No saved question sets yet.</p>
          <p className="text-xs mt-1">Generate questions and click &ldquo;Save to Library&rdquo; to add them here.</p>
        </div>
      )}

      {!loading && !error && sets.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-gray-400">{sets.length} set{sets.length !== 1 ? 's' : ''} found</p>
          {sets.map(set => (
            <SetCard key={set.id} set={set} onDelete={handleDelete} canWrite={canWrite} />
          ))}
        </div>
      )}
    </div>
  );
}
