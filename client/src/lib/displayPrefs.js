// A member's display settings: text size, color theme, motion. Each is a
// data-* attribute on <html> that src/index.css and theme/palettes.js style;
// the default of each is "standard", which leaves the attribute off so the
// portal looks exactly as it always has.
//
// The settings are saved on the member's account (PATCH /api/profile/display)
// and come back with /api/auth/me, so they follow the member to every device.
// A copy in localStorage lets public/display-prefs.js apply them before the
// page first draws, so nobody sees the usual look flash up first.

export const STORAGE_KEY = 'capshaw.display';

export const DISPLAY_OPTIONS = {
  textSize: [
    { value: 'standard', label: 'Standard' },
    { value: 'large',    label: 'Large' },
    { value: 'largest',  label: 'Largest' },
  ],
  theme: [
    { value: 'standard', label: 'Standard' },
    { value: 'dark',     label: 'Dark' },
    { value: 'contrast', label: 'High contrast' },
  ],
  motion: [
    { value: 'standard', label: 'Standard' },
    { value: 'reduce',   label: 'Reduce motion' },
  ],
};

const ATTRIBUTES = { textSize: 'data-text-size', theme: 'data-theme', motion: 'data-motion' };

export const DEFAULT_DISPLAY = { textSize: 'standard', theme: 'standard', motion: 'standard' };

// Anything missing or unknown becomes the default.
export function normalizeDisplay(prefs) {
  const out = { ...DEFAULT_DISPLAY };
  for (const key of Object.keys(DISPLAY_OPTIONS)) {
    if (DISPLAY_OPTIONS[key].some(o => o.value === prefs?.[key])) out[key] = prefs[key];
  }
  return out;
}

export function applyDisplay(prefs, root = document.documentElement) {
  const p = normalizeDisplay(prefs);
  for (const [key, attr] of Object.entries(ATTRIBUTES)) {
    if (p[key] === 'standard') root.removeAttribute(attr);
    else root.setAttribute(attr, p[key]);
  }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch { /* private window */ }
  return p;
}

// What the page is showing right now, read back from <html>.
export function currentDisplay(root = document.documentElement) {
  return normalizeDisplay(Object.fromEntries(
    Object.entries(ATTRIBUTES).map(([key, attr]) => [key, root.getAttribute(attr) || 'standard'])
  ));
}

export async function saveDisplay(change) {
  const res  = await fetch('/api/profile/display', {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(change),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.success) throw new Error(json.error || 'Could not save that setting');
  return normalizeDisplay(json.display);
}
