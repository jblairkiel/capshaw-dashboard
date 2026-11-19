import { useState } from 'react';
import { DISPLAY_OPTIONS, applyDisplay, saveDisplay, currentDisplay } from '../lib/displayPrefs';

const GROUPS = [
  { key: 'textSize', label: 'Text size',   hint: 'Makes the words and buttons bigger everywhere on the site.' },
  { key: 'theme',    label: 'Colors',      hint: 'Dark is easier on the eyes at night. High contrast makes text and borders stronger.' },
  { key: 'motion',   label: 'Motion',      hint: 'Turns off sliding and fading effects.' },
];

// The member's own display settings. Each choice takes effect at once and is
// saved to their account, so it follows them to their phone or computer. The
// starting point is what the page shows now, which App applied from the account.
export default function DisplaySettings() {
  const [prefs, setPrefs] = useState(currentDisplay);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  async function choose(key, value) {
    if (prefs[key] === value) return;
    const before = prefs;
    const next = applyDisplay({ ...prefs, [key]: value });
    setPrefs(next); setError(''); setSaved(false);
    try {
      setPrefs(applyDisplay(await saveDisplay({ [key]: value })));
      setSaved(true);
    } catch (err) {
      // Put things back as they were, so the screen matches what is saved.
      setPrefs(applyDisplay(before));
      setError(err.message);
    }
  }

  return (
    <div className="card" role="region" aria-label="Display">
      <h3 className="font-semibold text-church-navy text-sm">Display</h3>
      <p className="text-xs text-gray-500 mt-1">
        How the site looks for you. These are saved to your account, so they follow you to any phone or computer you sign in on.
      </p>
      <div className="mt-3 space-y-4">
        {GROUPS.map(group => (
          <fieldset key={group.key}>
            <legend className="text-xs font-medium text-gray-500 uppercase tracking-wide">{group.label}</legend>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {DISPLAY_OPTIONS[group.key].map(option => {
                const on = prefs[group.key] === option.value;
                return (
                  <label
                    key={option.value}
                    className={`cursor-pointer rounded-lg border px-3 py-2 text-sm transition-colors focus-within:ring-2 focus-within:ring-church-gold ${
                      on
                        ? 'bg-church-navy border-church-navy text-white font-semibold'
                        : 'bg-white border-gray-300 text-church-navy hover:border-church-gold'
                    }`}
                  >
                    <input
                      type="radio"
                      name={`display-${group.key}`}
                      value={option.value}
                      checked={on}
                      onChange={() => choose(group.key, option.value)}
                      className="sr-only"
                    />
                    {option.label}
                  </label>
                );
              })}
            </div>
            <p className="text-xs text-gray-500 mt-1">{group.hint}</p>
          </fieldset>
        ))}
      </div>
      <p className="text-xs mt-3 min-h-[1rem]" aria-live="polite">
        {error ? <span className="text-red-600">{error}</span> : saved ? <span className="text-emerald-700">Saved.</span> : null}
      </p>
    </div>
  );
}
