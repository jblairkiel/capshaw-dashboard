import { useState, useEffect, useRef } from 'react';

// ─── Mobile nav ────────────────────────────────────────────────────────────────
// A row of dropdowns cannot fit a phone, and each is whitespace-nowrap, so the
// row used to force the whole page wider than the viewport. Below md the nav
// collapses to one button that opens every group as a folder.

export default function MobileNav({ groups, activeTab, onSelect }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const activeGroup = groups.find(g => g.items.some(i => i.id === activeTab));
  const activeItem  = activeGroup?.items.find(i => i.id === activeTab);

  useEffect(() => {
    if (!open) return;
    const onPointer = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey     = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="flex-1 min-w-0">
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-controls="mobile-nav-panel"
        className="flex items-center gap-2 w-full px-4 py-3 text-sm font-medium text-gray-200 min-w-0"
      >
        <svg className="w-4 h-4 shrink-0 text-church-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
        </svg>
        <span className="truncate text-left flex-1 min-w-0">
          {activeItem ? activeItem.label : 'Menu'}
          {activeGroup && <span className="text-gray-400 text-xs"> · {activeGroup.label}</span>}
        </span>
        <svg
          className={`w-3.5 h-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          id="mobile-nav-panel"
          className="absolute top-full left-0 right-0 bg-white shadow-xl border-t border-gray-200 z-50 max-h-[calc(100vh-7rem)] overflow-y-auto overscroll-contain pb-2"
        >
          {groups.map(group => (
            <div key={group.id} className="border-b border-gray-100 last:border-0">
              <p className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                {group.label}
              </p>
              {group.items.map(item => (
                <button
                  key={item.id}
                  onClick={() => { onSelect(item.id); setOpen(false); }}
                  className={`w-full text-left pl-7 pr-4 py-2.5 text-sm transition-colors ${
                    activeTab === item.id
                      ? 'bg-church-cream text-church-navy font-semibold'
                      : 'text-gray-700 active:bg-gray-50'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
