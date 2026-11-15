// Numbers, dates and colours shared by the report views (charts.jsx and the
// two reports), matching the PDFs' (server/lib/reportPdf.js).

export const C = {
  ink: '#0b0b0b', ink2: '#52514e', muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7',
  context: '#c9ccd3', accent: '#2a78d6', accentWash: '#e3eefb', second: '#eb6834',
  good: '#0ca30c', goodText: '#006300', bad: '#d03b3b',
  ramp: ['#f4f8fe', '#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'],
};

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const d = iso => new Date(`${iso}T12:00:00Z`);
export const dayMonth = iso => (iso ? `${MONTHS[d(iso).getUTCMonth()]} ${d(iso).getUTCDate()}` : '');
export const num = n => (n === null || n === undefined ? '—' : Math.round(n).toLocaleString('en-US'));
export const money = n => (n === null || n === undefined ? '—' : `$${Math.round(n).toLocaleString('en-US')}`);
export const compactMoney = n => (n === null || n === undefined ? '—' : n >= 10000 ? `$${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}K` : money(n));
export const pct = n => (n === null || n === undefined ? '—' : `${Math.round(n)}%`);
export const monthTick = iso => (d(iso).getUTCDate() <= 7 ? MONTHS[d(iso).getUTCMonth()] : '');

// A change against a comparison: { text, dir } with dir up, down or flat.
export function change(now, then) {
  if (now === null || now === undefined || !then) return null;
  const diff = now - then;
  if (Math.abs(diff) / then < 0.005) return { text: 'level', dir: 'flat' };
  return { text: `${Math.round(Math.abs(diff) / then * 100)}%`, dir: diff > 0 ? 'up' : 'down' };
}

// A change as a table cell.
export function changeCell(now, then, upIsGood = true) {
  const ch = change(now, then);
  if (!ch) return { v: '—' };
  if (ch.dir === 'flat') return { v: 'level' };
  return { v: `${ch.dir === 'up' ? '▲ +' : '▼ –'}${ch.text}`, tone: (ch.dir === 'up') === upIsGood ? 'good' : 'bad' };
}
