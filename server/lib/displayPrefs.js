// A member's display settings (My Household → Display): how the portal looks
// for them, on every device they sign in on. Stored as JSON in
// users.display_prefs. Anything missing or not recognised reads as the default,
// which is the portal's usual look, so an empty object is "change nothing".

const OPTIONS = {
  textSize: ['standard', 'large', 'largest'],
  theme:    ['standard', 'dark', 'contrast'],
  motion:   ['standard', 'reduce'],
};

const DEFAULTS = Object.fromEntries(Object.entries(OPTIONS).map(([k, v]) => [k, v[0]]));

// Whatever was stored, as a complete, valid set of settings.
function read(json) {
  let stored = {};
  try {
    const parsed = typeof json === 'string' ? JSON.parse(json || '{}') : json;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) stored = parsed;
  } catch { /* a damaged value means the defaults */ }
  const out = { ...DEFAULTS };
  for (const key of Object.keys(OPTIONS)) {
    if (OPTIONS[key].includes(stored[key])) out[key] = stored[key];
  }
  return out;
}

// Checks a change sent from the page. Returns { prefs } with the changed keys
// merged over the current settings, or { error } naming what was wrong.
function merge(current, change) {
  if (!change || typeof change !== 'object' || Array.isArray(change)) {
    return { error: 'Send the settings to change as an object' };
  }
  const keys = Object.keys(change);
  if (keys.length === 0) return { error: 'Nothing to change' };
  for (const key of keys) {
    if (!OPTIONS[key]) return { error: `Unknown setting: ${key}` };
    if (!OPTIONS[key].includes(change[key])) {
      return { error: `${key} must be one of: ${OPTIONS[key].join(', ')}` };
    }
  }
  return { prefs: { ...read(current), ...change } };
}

module.exports = { OPTIONS, DEFAULTS, read, merge };
