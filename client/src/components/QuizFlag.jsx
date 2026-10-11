import { useState } from 'react';

// ─── Flagging a Bible Quiz question ───────────────────────────────────────────
//
// For a question that looks wrong: the answer key, an answer that should have
// counted, or the wording. Sent to whoever keeps the quiz (the Bible Quiz
// Keeper), who decides; the member is told what was decided. "My answer should
// have counted" is offered only for an answer of theirs that was marked wrong.

const REASONS = [
  ['answer-wrong', 'The answer key is wrong'],
  ['my-answer', 'My answer should have counted'],
  ['unclear', 'The question is unclear'],
  ['other', 'Something else'],
];

export default function QuizFlag({ questionId, answerId = null, wasWrong = false, flagged = null, compact = false }) {
  const offered = REASONS.filter(([val]) => val !== 'my-answer' || (answerId && wasWrong));
  const [state, setState] = useState(flagged ? 'sent' : 'closed');
  const [reason, setReason] = useState(offered[0][0]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function send() {
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/bible-quiz/flags', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId, reason, note, ...(answerId ? { answerId } : {}) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!json.success && res.status !== 409) throw new Error(json.error || 'Could not send the flag');
      setState('sent');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (state === 'sent') {
    return <p className="text-xs text-gray-500" role="status">🚩 Flagged — the Bible Quiz Keeper will look at it.</p>;
  }
  if (state === 'closed') {
    return (
      <button type="button" onClick={() => setState('open')}
        className={`text-xs text-gray-500 hover:text-red-700 underline ${compact ? '' : 'mt-1'}`}>
        🚩 Flag this question
      </button>
    );
  }
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-2 text-left" role="group" aria-label="Flag this question">
      <p className="text-xs font-semibold text-gray-600">What looks wrong?</p>
      <div className="space-y-1">
        {offered.map(([val, label]) => (
          <label key={val} className="flex items-center gap-2 text-sm text-gray-700">
            <input type="radio" name={`flag-${questionId}`} checked={reason === val} onChange={() => setReason(val)} className="accent-church-gold" />
            {label}
          </label>
        ))}
      </div>
      <textarea rows={2} value={note} onChange={e => setNote(e.target.value)} maxLength={500}
        aria-label="Anything to add" placeholder={reason === 'other' ? 'Say what is wrong (needed)' : 'Anything to add (optional) — the verse you have in mind, say'}
        className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-church-gold" />
      {error && <p className="text-xs text-red-600" role="alert">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setState('closed')} className="text-xs text-gray-500 underline">Cancel</button>
        <button type="button" onClick={send} disabled={busy || (reason === 'other' && !note.trim())}
          className="text-xs px-3 py-1.5 rounded-lg bg-church-navy text-white disabled:opacity-50">
          {busy ? 'Sending…' : 'Send flag'}
        </button>
      </div>
    </div>
  );
}
