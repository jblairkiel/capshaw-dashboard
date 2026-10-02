// Shared by the Member Attendance roll and its analytics.

export const API = '/api/member-attendance';

// The chart palette's eight slots, in the order they are handed out (kept in
// step with TONES in server/lib/memberAttendance.js). A status's colour only
// ever marks it — a dot, a bar, a ring — and its label always sits beside it,
// so nobody has to tell two statuses apart by colour alone.
export const TONES = {
  blue:    '#2a78d6',
  orange:  '#eb6834',
  aqua:    '#1baf7a',
  yellow:  '#eda100',
  magenta: '#e87ba4',
  green:   '#008300',
  violet:  '#4a3aa7',
  red:     '#e34948',
};
export const TONE_NAMES = Object.keys(TONES);
export const toneHex = tone => TONES[tone] || TONES.blue;

export async function call(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'include',
    // A FormData body sets its own multipart content type.
    headers: typeof options.body === 'string' ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  });
  const json = await res.json().catch(() => ({}));
  // The rest of the reply rides along: a refused import still lists the sheets.
  if (!json.success) throw Object.assign(new Error(json.error || 'Something went wrong'), { data: json });
  return json;
}

export const photoUrl = id => `${API}/photo/${id}`;

// Today on this device, as YYYY-MM-DD — the roll is taken where the service is.
export function localToday(now = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// Dates arrive as YYYY-MM-DD; read at midday so no timezone moves the day.
export const dayLabel = (iso, opts = { weekday: 'short', month: 'short', day: 'numeric' }) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, opts);

export const percent = r => (r === null || r === undefined ? '—' : `${Math.round(r)}%`);
