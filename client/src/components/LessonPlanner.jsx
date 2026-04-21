import { useState, useCallback } from 'react';

// ─── Constants ────────────────────────────────────────────────────────────────

const GRADE_LEVELS = [
  { value: 'preschool',        label: 'Preschool',        sub: 'Ages 3–5' },
  { value: 'early-elementary', label: 'Early Elementary', sub: 'Grades 1–3' },
  { value: 'upper-elementary', label: 'Upper Elementary', sub: 'Grades 4–6' },
  { value: 'middle-school',    label: 'Middle School',    sub: 'Grades 7–8' },
  { value: 'high-school',      label: 'High School',      sub: 'Grades 9–12' },
  { value: 'adult',            label: 'Adult',            sub: 'All ages' },
];

const GRADE_LABELS = Object.fromEntries(GRADE_LEVELS.map(g => [g.value, `${g.label} (${g.sub})`]));

const DURATIONS = [
  { value: 30,  label: '30 min' },
  { value: 45,  label: '45 min' },
  { value: 60,  label: '60 min' },
  { value: 90,  label: '90 min' },
];

const FOCUS_OPTIONS = [
  { value: 'scripture',    label: 'Scripture Study',   icon: '📖', desc: 'Deep text exploration' },
  { value: 'discussion',   label: 'Discussion',        icon: '💬', desc: 'Group conversation' },
  { value: 'application',  label: 'Life Application',  icon: '🌱', desc: 'Connecting faith to life' },
  { value: 'activity',     label: 'Hands-On Activity', icon: '✏️', desc: 'Crafts & interactive' },
  { value: 'memory',       label: 'Memory Work',       icon: '⭐', desc: 'Verses & key facts' },
];

const SECTION_STYLES = {
  opener:     { border: 'border-l-church-gold',   bg: 'bg-amber-50',   badge: 'bg-amber-100 text-amber-800',   icon: '👋' },
  scripture:  { border: 'border-l-blue-800',      bg: 'bg-blue-50',    badge: 'bg-blue-100 text-blue-800',     icon: '📖' },
  discussion: { border: 'border-l-purple-500',    bg: 'bg-purple-50',  badge: 'bg-purple-100 text-purple-800', icon: '💬' },
  activity:   { border: 'border-l-emerald-500',   bg: 'bg-emerald-50', badge: 'bg-emerald-100 text-emerald-800', icon: '✏️' },
  closing:    { border: 'border-l-church-gold',   bg: 'bg-amber-50',   badge: 'bg-amber-100 text-amber-800',   icon: '🙏' },
};

// ─── Section card ─────────────────────────────────────────────────────────────

function SectionCard({ section, index }) {
  const [noteOpen, setNoteOpen] = useState(false);
  const style = SECTION_STYLES[section.type] || SECTION_STYLES.activity;

  return (
    <div className={`card border-l-4 py-4 px-5 print:shadow-none print:border print:border-gray-200 ${style.bg} ${style.border}`}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <span className="text-xl">{style.icon}</span>
        <span className={`text-xs font-bold px-2 py-0.5 rounded uppercase tracking-wide ${style.badge}`}>
          {section.type}
        </span>
        <h3 className="font-bold text-church-navy flex-1 leading-snug">{section.title}</h3>
        <span className="text-xs font-semibold text-gray-500 bg-white border border-gray-200 px-2 py-0.5 rounded-full shrink-0">
          {section.duration} min
        </span>
      </div>

      {/* Content */}
      <p className="text-sm text-gray-700 leading-relaxed mb-3">{section.content}</p>

      {/* Items */}
      {section.items?.length > 0 && (
        <ul className="space-y-1.5 mb-3">
          {section.items.map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
              <span className="text-church-gold font-bold mt-0.5 shrink-0">›</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Teacher note */}
      {section.teacherNote && (
        <div className="mt-2 print:block">
          <button
            onClick={() => setNoteOpen(o => !o)}
            className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-church-navy transition-colors print:hidden"
          >
            <svg className={`w-3.5 h-3.5 transition-transform ${noteOpen ? 'rotate-90' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            Teacher note
          </button>
          {(noteOpen) && (
            <div className="mt-2 bg-white/70 border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-600 italic leading-relaxed">
              📝 {section.teacherNote}
            </div>
          )}
          {/* Always visible in print */}
          <div className="hidden print:block mt-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-600 italic">
            📝 Teacher note: {section.teacherNote}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Plan display ─────────────────────────────────────────────────────────────

function PlanDisplay({ plan, passage, grade, duration, focuses, onBack, onSave, saving, savedId, canWrite }) {
  const totalMin = plan.sections?.reduce((s, sec) => s + (sec.duration || 0), 0) ?? 0;

  return (
    <div className="space-y-5">
      {/* Toolbar — hidden when printing */}
      <div className="flex items-center gap-3 flex-wrap print:hidden">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-church-navy hover:text-church-gold transition-colors font-medium"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>

        <div className="flex-1" />

        {savedId ? (
          <span className="flex items-center gap-1.5 text-sm text-emerald-600 font-medium">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Saved to library
          </span>
        ) : canWrite ? (
          <button
            onClick={onSave}
            disabled={saving}
            className="flex items-center gap-1.5 text-sm border border-church-navy text-church-navy hover:bg-church-navy hover:text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
          >
            {saving ? (
              <span className="animate-spin w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full inline-block" />
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
              </svg>
            )}
            {saving ? 'Saving…' : 'Save to Library'}
          </button>
        ) : null}

        <button
          onClick={() => window.print()}
          className="flex items-center gap-1.5 text-sm border border-gray-300 text-church-navy hover:border-church-gold px-3 py-1.5 rounded-lg transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
          </svg>
          Print
        </button>
      </div>

      {/* Plan header */}
      <div className="card bg-church-navy text-white border-0 space-y-3 print:shadow-none print:border print:border-gray-300">
        <h2 className="text-2xl font-bold text-church-gold leading-snug">{plan.title}</h2>
        <div className="flex flex-wrap gap-3 text-sm text-gray-300">
          <span>📖 {passage}</span>
          <span>·</span>
          <span>🎓 {GRADE_LABELS[grade] || grade}</span>
          <span>·</span>
          <span>⏱ {duration} min</span>
          {totalMin !== duration && (
            <span className="text-amber-400 text-xs">(sections: {totalMin} min)</span>
          )}
        </div>

        {/* Memory verse */}
        {plan.memoryVerse && (
          <div className="border-l-4 border-church-gold pl-4 py-1">
            <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide mb-1">Memory Verse</p>
            <p className="text-white italic leading-relaxed">"{plan.memoryVerse.text}"</p>
            <p className="text-church-gold text-sm font-medium mt-1">— {plan.memoryVerse.reference}</p>
          </div>
        )}
      </div>

      {/* Objectives + Materials */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {plan.objectives?.length > 0 && (
          <div className="card space-y-2 print:shadow-none print:border print:border-gray-200">
            <h3 className="font-bold text-church-navy flex items-center gap-2">
              <span className="text-church-gold">🎯</span> Learning Objectives
            </h3>
            <ul className="space-y-1.5">
              {plan.objectives.map((obj, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                  <span className="text-church-gold font-bold shrink-0 mt-0.5">{i + 1}.</span>
                  <span>{obj}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {plan.materials?.length > 0 && (
          <div className="card space-y-2 print:shadow-none print:border print:border-gray-200">
            <h3 className="font-bold text-church-navy flex items-center gap-2">
              <span className="text-church-gold">📦</span> Materials Needed
            </h3>
            <ul className="space-y-1">
              {plan.materials.map((mat, i) => (
                <li key={i} className="flex items-center gap-2 text-sm text-gray-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-church-gold shrink-0" />
                  {mat}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Lesson flow */}
      <div className="space-y-1">
        <div className="flex items-center justify-between mb-2">
          <h3 className="section-heading mb-0">Lesson Flow</h3>
          <div className="flex gap-1 flex-wrap print:hidden">
            {plan.sections?.map((sec, i) => (
              <span key={i} className="text-xs text-gray-400">{sec.duration}m</span>
            )).reduce((acc, el, i) => i === 0 ? [el] : [...acc, <span key={`d${i}`} className="text-xs text-gray-300">+</span>, el], [])}
            <span className="text-xs font-bold text-church-navy ml-1">= {totalMin} min</span>
          </div>
        </div>

        <div className="space-y-3">
          {plan.sections?.map((section, i) => (
            <SectionCard key={i} section={section} index={i} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Saved plans library ──────────────────────────────────────────────────────

function SavedPlansLibrary({ onOpen, onBack, canWrite }) {
  const [plans,   setPlans]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/lesson-planner')
      .then(r => r.json())
      .then(j => { if (j.success) setPlans(j.plans); else setError(j.error); })
      .catch(() => setError('Could not load saved plans.'))
      .finally(() => setLoading(false));
  }, []);

  useState(() => { load(); }, []);

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    if (!window.confirm('Delete this lesson plan?')) return;
    await fetch(`/api/lesson-planner/${id}`, { method: 'DELETE' });
    setPlans(prev => prev.filter(p => p.id !== id));
  };

  const handleOpen = async (id) => {
    const res  = await fetch(`/api/lesson-planner/${id}`);
    const json = await res.json();
    if (json.success) onOpen(json.plan);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-church-navy hover:text-church-gold font-medium transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <h2 className="section-heading mb-0 flex-1">Saved Lesson Plans</h2>
      </div>

      {loading && (
        <div className="flex justify-center py-12">
          <span className="animate-spin w-6 h-6 border-2 border-church-gold border-t-transparent rounded-full" />
        </div>
      )}

      {error && <p className="text-sm text-red-600 text-center py-6">{error}</p>}

      {!loading && !error && plans?.length === 0 && (
        <div className="text-center py-12 text-gray-400 space-y-2">
          <svg className="w-12 h-12 mx-auto opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <p className="text-sm">No saved lesson plans yet.</p>
          <p className="text-xs">Generate a plan and click "Save to Library" to add it here.</p>
        </div>
      )}

      {plans?.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-gray-400">{plans.length} saved plan{plans.length !== 1 ? 's' : ''}</p>
          {plans.map(plan => {
            const grade = GRADE_LEVELS.find(g => g.value === plan.grade);
            const dateStr = new Date(plan.created_at + 'Z').toLocaleDateString(undefined, {
              month: 'short', day: 'numeric', year: 'numeric',
            });
            return (
              <div
                key={plan.id}
                onClick={() => handleOpen(plan.id)}
                className="card hover:shadow-lg hover:-translate-y-0.5 cursor-pointer transition-all border border-gray-100 hover:border-church-gold/40 flex items-start gap-4"
              >
                <div className="w-10 h-10 rounded-xl bg-church-navy flex items-center justify-center text-church-gold shrink-0 text-lg">📋</div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-church-navy leading-snug truncate">{plan.title}</p>
                  <p className="text-sm text-gray-500 truncate">{plan.passage}</p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="text-xs bg-church-navy/10 text-church-navy px-2 py-0.5 rounded font-medium">
                      {grade?.label || plan.grade}
                    </span>
                    <span className="text-xs text-gray-400">{plan.duration} min</span>
                    <span className="text-xs text-gray-400">{dateStr}</span>
                  </div>
                </div>
                {canWrite && (
                  <button
                    onClick={e => handleDelete(plan.id, e)}
                    className="shrink-0 p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                    title="Delete"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function LessonPlanner({ user }) {
  const canWrite = user?.role === 'approved' || user?.role === 'admin';
  const [view,    setView]    = useState('setup'); // 'setup' | 'plan' | 'library'
  const [plan,    setPlan]    = useState(null);
  const [planCtx, setPlanCtx] = useState(null);   // { passage, grade, duration, focuses }

  // Form state
  const [passage,  setPassage]  = useState('');
  const [grade,    setGrade]    = useState('upper-elementary');
  const [duration, setDuration] = useState(45);
  const [focuses,  setFocuses]  = useState(['scripture', 'discussion', 'application']);

  // Status
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [saving,  setSaving]  = useState(false);
  const [savedId, setSavedId] = useState(null);

  const toggleFocus = f =>
    setFocuses(prev => prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f]);

  const generate = async () => {
    if (!passage.trim()) { setError('Enter a Bible passage or topic.'); return; }
    if (focuses.length === 0) { setError('Select at least one focus area.'); return; }
    setError('');
    setLoading(true);
    setPlan(null);
    try {
      const res  = await fetch('/api/lesson-planner/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ passage, gradeLevel: grade, duration, focuses }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setPlan(json.plan);
      setPlanCtx({ passage, grade, duration, focuses });
      setSavedId(null);
      setView('plan');
    } catch (e) {
      setError(e.message || 'Generation failed. Check server connection.');
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    if (!plan || !planCtx) return;
    setSaving(true);
    try {
      const res  = await fetch('/api/lesson-planner/save', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ...planCtx, plan }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setSavedId(json.id);
    } catch (e) {
      console.error('Save failed:', e.message);
    } finally {
      setSaving(false);
    }
  };

  const openSavedPlan = (savedRow) => {
    setPlan(savedRow.plan);
    setPlanCtx({ passage: savedRow.passage, grade: savedRow.grade, duration: savedRow.duration, focuses: savedRow.focuses?.split(',').filter(Boolean) || [] });
    setSavedId(savedRow.id);
    setView('plan');
  };

  // ── Library view ────────────────────────────────────────────────────────────
  if (view === 'library') {
    return <SavedPlansLibrary onOpen={openSavedPlan} onBack={() => setView('setup')} canWrite={canWrite} />;
  }

  // ── Plan view ───────────────────────────────────────────────────────────────
  if (view === 'plan' && plan) {
    return (
      <PlanDisplay
        plan={plan}
        passage={planCtx.passage}
        grade={planCtx.grade}
        duration={planCtx.duration}
        focuses={planCtx.focuses}
        onBack={() => setView('setup')}
        onSave={save}
        saving={saving}
        savedId={savedId}
        canWrite={canWrite}
      />
    );
  }

  // ── Setup view ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="section-heading mb-0">Lesson Planner</h2>
          <p className="text-sm text-gray-400 mt-0.5">AI-generated, grade-specific lesson plans ready to teach</p>
        </div>
        <button
          onClick={() => setView('library')}
          className="flex items-center gap-1.5 text-sm border border-gray-300 text-church-navy hover:border-church-gold px-3 py-1.5 rounded-lg transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
          </svg>
          Saved Plans
        </button>
      </div>

      <div className="card space-y-6">

        {/* Passage */}
        <div>
          <label className="block text-sm font-semibold text-church-navy mb-1">
            Bible Passage or Topic
          </label>
          <textarea
            value={passage}
            onChange={e => setPassage(e.target.value)}
            placeholder={'e.g. "John 3:1–21", "The Sermon on the Mount", "David and Goliath", "The Fruit of the Spirit"…'}
            rows={3}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-church-navy resize-y"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Grade level */}
          <div>
            <label className="block text-sm font-semibold text-church-navy mb-2">Grade Level</label>
            <div className="grid grid-cols-2 gap-1.5">
              {GRADE_LEVELS.map(g => (
                <button
                  key={g.value}
                  onClick={() => setGrade(g.value)}
                  className={`text-left px-3 py-2 rounded-lg border-2 transition-colors ${
                    grade === g.value
                      ? 'border-church-navy bg-church-navy text-white'
                      : 'border-gray-200 hover:border-church-gold text-gray-700'
                  }`}
                >
                  <span className="font-semibold block text-sm leading-tight">{g.label}</span>
                  <span className={`text-xs ${grade === g.value ? 'text-gray-300' : 'text-gray-400'}`}>{g.sub}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-5">
            {/* Duration */}
            <div>
              <label className="block text-sm font-semibold text-church-navy mb-2">Class Duration</label>
              <div className="grid grid-cols-4 gap-1.5">
                {DURATIONS.map(d => (
                  <button
                    key={d.value}
                    onClick={() => setDuration(d.value)}
                    className={`py-2 rounded-lg font-semibold text-sm border-2 transition-colors ${
                      duration === d.value
                        ? 'border-church-navy bg-church-navy text-church-gold'
                        : 'border-gray-200 hover:border-church-gold text-gray-700'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Focus areas */}
            <div>
              <label className="block text-sm font-semibold text-church-navy mb-2">
                Focus Areas
                <span className="text-xs text-gray-400 font-normal ml-2">select any</span>
              </label>
              <div className="flex flex-col gap-1.5">
                {FOCUS_OPTIONS.map(f => (
                  <button
                    key={f.value}
                    onClick={() => toggleFocus(f.value)}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border-2 text-left transition-colors ${
                      focuses.includes(f.value)
                        ? 'border-church-navy bg-church-navy text-white'
                        : 'border-gray-200 hover:border-church-gold text-gray-700'
                    }`}
                  >
                    <span className="text-base">{f.icon}</span>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium block leading-tight">{f.label}</span>
                      <span className={`text-xs ${focuses.includes(f.value) ? 'text-gray-300' : 'text-gray-400'}`}>
                        {f.desc}
                      </span>
                    </div>
                    <div className={`w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center transition-colors ${
                      focuses.includes(f.value) ? 'border-white bg-white' : 'border-gray-300'
                    }`}>
                      {focuses.includes(f.value) && (
                        <svg className="w-3 h-3 text-church-navy" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {!canWrite && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Your account is pending approval. Lesson plan generation requires an approved account.
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
              Generating lesson plan…
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              Generate Lesson Plan
            </>
          )}
        </button>
      </div>
    </div>
  );
}
