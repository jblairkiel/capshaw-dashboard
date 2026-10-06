import { useState, useEffect } from 'react';

// Beside a replacement request in My Inbox: who could take the slot, best fit
// first — free that day and glad or willing to do the job — so the schedule
// keeper can settle it in one click instead of going to the schedule to look.
// Choosing a name is the request's own "Someone else is taking it", with that
// name, so the slot changes and whoever asked is told.

const LEVEL = { preferred: 'Glad to', willing: 'Willing' };
const SHOWN = 5;

export default function ReplacementSuggestions({ context, busy, onChoose }) {
  const [list, setList]   = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    fetch(`/api/serving/assignments/${context.slotId}/candidates`, { credentials: 'include' })
      .then(r => r.json())
      .then(json => {
        if (!live) return;
        if (!json.success) throw new Error(json.error || 'Could not find who could take it');
        setList(json.candidates);
      })
      .catch(err => live && setError(err.message));
    return () => { live = false; };
  }, [context.slotId]);

  if (error) return <p className="text-xs text-gray-400">{error}</p>;
  if (!list) return <p className="text-xs text-gray-400">Finding who could take it…</p>;

  const fits = list.filter(c => c.free && !c.current && LEVEL[c.level]).slice(0, SHOWN);

  return (
    <div className="rounded-lg bg-church-cream/60 border border-church-gold/20 p-3">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Who could take it</p>
      {fits.length === 0 ? (
        <p className="text-sm text-gray-500 mt-1">
          Nobody free that day has said they will do {context.job || 'this job'}. Choose Someone else is taking it and type a name.
        </p>
      ) : (
        <ul className="mt-1 flex flex-wrap gap-2" aria-label={`Who could take ${context.job || 'it'}`}>
          {fits.map(c => (
            <li key={c.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => onChoose(c.name)}
                aria-label={`Put ${c.name} in`}
                className="text-left text-sm px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:border-church-gold disabled:opacity-50"
              >
                <span className="font-medium text-church-navy">{c.name}</span>
                <span className="block text-[11px] text-gray-500">{LEVEL[c.level]} · {c.turns} turn{c.turns === 1 ? '' : 's'} this month</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
