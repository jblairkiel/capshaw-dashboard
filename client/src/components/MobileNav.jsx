import { useState, useEffect, useLayoutEffect, useRef } from 'react';

// ─── Mobile nav ────────────────────────────────────────────────────────────────
// A row of dropdowns cannot fit a phone, and each is whitespace-nowrap, so the
// row used to force the whole page wider than the viewport. Below lg (1024px),
// where every menu first fits beside the Refresh button, the nav collapses to
// one button that opens every group as a folder.
//
// The open panel is sized from what is really on screen, not from 100vh. On a
// phone 100vh is the height with the browser's toolbars hidden, and the bar
// sits further down at the top of a page than once it has stuck, so a panel
// sized from 100vh ran under Safari's bottom toolbar: the last groups (Church
// Office, Admin) were below the edge, and since the panel keeps the scroll to
// itself, there was no way to reach them. Instead it hangs from wherever the
// bar ends and stops at the bottom of the visible area (visualViewport, which
// leaves the toolbars out), and measures again whenever either moves.

// The height of what can actually be seen.
function visibleHeight() {
  return window.visualViewport?.height || window.innerHeight || document.documentElement.clientHeight;
}

export default function MobileNav({ groups, activeTab, onSelect }) {
  const [open, setOpen] = useState(false);
  // Where the panel hangs from, and how tall it may be, while it is open.
  const [fit, setFit] = useState(null);
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

  // Measured before the panel is painted, so it never shows at the wrong size.
  useLayoutEffect(() => {
    if (!open) { setFit(null); return; }
    const measure = () => {
      const top = Math.max(0, Math.round(ref.current?.getBoundingClientRect().bottom ?? 0));
      setFit({ top, maxHeight: Math.max(160, Math.floor(visibleHeight() - top)) });
    };
    measure();
    const viewport = window.visualViewport;
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, { passive: true });
    viewport?.addEventListener('resize', measure);
    viewport?.addEventListener('scroll', measure);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure);
      viewport?.removeEventListener('resize', measure);
      viewport?.removeEventListener('scroll', measure);
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
          className="fixed left-0 right-0 bg-white shadow-xl border-t border-gray-200 z-50 overflow-y-auto overscroll-contain pb-[max(0.5rem,env(safe-area-inset-bottom))]"
          style={fit ? { top: fit.top, maxHeight: fit.maxHeight } : { top: 0, visibility: 'hidden' }}
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
