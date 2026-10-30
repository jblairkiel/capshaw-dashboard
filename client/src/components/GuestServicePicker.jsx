import { useState } from 'react';

// Which service a guest came to. Nearly every guest comes on a Sunday morning,
// a Sunday evening or a Wednesday night, so those are one tap each across the
// top; anything else on the church's list of services is under Other, with a
// box for one that is not on the list at all.
//
// `services` comes from GET /api/visitors: { everyday: [{ label, name }],
// other: [name] }. The value saved is always the list's own name ("Sunday AM
// Worship"), since that is what Record Keeping matches a guest visit against.

const SOMETHING_ELSE = '__something-else__';

export default function GuestServicePicker({ services, value, onChange, compact = false }) {
  const everyday = services?.everyday || [];
  const other = services?.other || [];
  const onList = name => everyday.some(s => s.name === name) || other.includes(name);
  // Typing a service that is not on the list — and one saved that way before.
  const [typing, setTyping] = useState(() => !!value && !onList(value));

  // No list to offer (it failed to load, or none is set up): a plain box.
  if (!everyday.length && !other.length) {
    return (
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        aria-label="Service"
        placeholder="Which service"
        className="block w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold"
      />
    );
  }

  const otherValue = typing ? SOMETHING_ELSE : other.includes(value) ? value : '';
  const pickedOther = !!otherValue;

  return (
    <div className="space-y-2">
      <div role="group" aria-label="Everyday services" className={`grid gap-2 ${everyday.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
        {everyday.map(s => {
          const on = !typing && value === s.name;
          return (
            <button
              key={s.name}
              type="button"
              aria-pressed={on}
              title={s.name}
              onClick={() => { setTyping(false); onChange(on ? '' : s.name); }}
              className={`rounded-lg border text-center transition-colors ${compact ? 'px-2 py-1.5' : 'px-3 py-2.5'} ${
                on
                  ? 'bg-church-navy border-church-navy text-white'
                  : 'bg-white border-gray-200 text-church-navy hover:border-church-gold'}`}
            >
              <span className={`block font-semibold ${compact ? 'text-sm' : 'text-base'}`}>{s.label}</span>
              {!compact && <span className={`block text-[11px] leading-tight ${on ? 'text-white/70' : 'text-gray-400'}`}>{s.name}</span>}
            </button>
          );
        })}
      </div>

      <div className={`flex items-center gap-2 rounded-lg border px-2 py-1 ${pickedOther ? 'border-church-navy bg-church-cream/60' : 'border-dashed border-gray-300'}`}>
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide pl-1 shrink-0">Other</span>
        <select
          value={otherValue}
          aria-label="Other service"
          onChange={e => {
            const v = e.target.value;
            if (v === SOMETHING_ELSE) { setTyping(true); onChange(''); return; }
            setTyping(false);
            onChange(v);
          }}
          className="flex-1 min-w-0 bg-transparent text-sm py-1 focus:outline-none"
        >
          <option value="">{pickedOther ? '— none —' : 'Gospel meeting, singing, class…'}</option>
          {other.map(name => <option key={name} value={name}>{name}</option>)}
          <option value={SOMETHING_ELSE}>Something not on the list…</option>
        </select>
      </div>

      {typing && (
        <input
          autoFocus
          value={value}
          onChange={e => onChange(e.target.value)}
          aria-label="Service not on the list"
          placeholder="Youth rally, VBS night…"
          className="block w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold"
        />
      )}
    </div>
  );
}
