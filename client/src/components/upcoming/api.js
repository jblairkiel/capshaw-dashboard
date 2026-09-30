// Helpers every tab of the Upcoming Service page shares (components are in
// ./shared.jsx).

export async function call(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'include',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  });
  const json = await res.json().catch(() => ({}));
  if (!json.success) throw new Error(json.error || 'Something went wrong');
  return json;
}

// Dates arrive as YYYY-MM-DD; read at midday so no timezone moves the day.
export const dayLabel = (iso, opts = { weekday: 'long', month: 'long', day: 'numeric' }) =>
  iso ? new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, opts) : '';

export const songLabel = song => song
  ? `${song.title}${song.number ? ` · ${[song.hymnal, song.number].filter(Boolean).join(' ')}` : ''}`
  : '';

export const STATUS = {
  none:      { label: 'Not submitted yet',        tone: 'bg-gray-100 text-gray-600' },
  submitted: { label: 'Waiting to be confirmed',  tone: 'bg-amber-100 text-amber-800' },
  confirmed: { label: 'Confirmed',                tone: 'bg-emerald-100 text-emerald-800' },
};
