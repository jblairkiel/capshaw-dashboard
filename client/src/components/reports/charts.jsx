// The weekly reports' charts, for the page. The same forms and colours as the
// PDFs (server/lib/reportPdf.js): one accent for what matters and gray for
// context, thin marks, hairline axes, labels in ink rather than series colour,
// and an arrow beside every coloured up/down. Every mark has a hover title,
// and every value is also printed or in a table, so nothing is hover-only.

import { C, num, compactMoney, dayMonth, monthTick, change } from './format';

export function Delta({ now, then, against, upIsGood = true }) {
  const ch = change(now, then);
  if (!ch) return <p className="text-xs text-gray-400">no {against} to compare</p>;
  if (ch.dir === 'flat') return <p className="text-xs text-gray-500">level with {against}</p>;
  const good = (ch.dir === 'up') === upIsGood;
  return (
    <p className="text-xs flex items-center gap-1" style={{ color: good ? C.goodText : C.bad }}>
      <span aria-hidden="true">{ch.dir === 'up' ? '▲' : '▼'}</span>
      {ch.text} {ch.dir === 'up' ? 'above' : 'below'} {against}
    </p>
  );
}

export function Sparkline({ values, width = 110, height = 34, label = 'last 12 weeks' }) {
  const pts = values.map((v, i) => ({ v, i })).filter(p => p.v > 0);
  if (pts.length < 2) return null;
  const max = Math.max(...pts.map(p => p.v)); const min = Math.min(...pts.map(p => p.v));
  const x = i => 4 + (i / (values.length - 1)) * (width - 8);
  const y = v => 4 + (height - 8) - ((v - min) / (max - min || 1)) * (height - 8);
  const last = pts[pts.length - 1];
  return (
    <figure className="m-0">
      <svg width={width} height={height} role="img" aria-label={`Trend, ${label}: ${values.join(', ')}`}>
        <polyline points={pts.map(p => `${x(p.i)},${y(p.v)}`).join(' ')} fill="none" stroke={C.context} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(last.i)} cy={y(last.v)} r="5" fill="#fff" />
        <circle cx={x(last.i)} cy={y(last.v)} r="3.5" fill={C.accent}><title>This week: {last.v}</title></circle>
      </svg>
      <figcaption className="text-[10px] text-gray-400 text-right">{label}</figcaption>
    </figure>
  );
}

// `onPage`: set straight on the page rather than inside a card, so it gets a
// card of its own — the page and the tiles share the same cream.
export function StatTile({ label, value, delta, note, spark, hero = false, onPage = false, children }) {
  return (
    <div className={`rounded-xl px-4 py-3 flex justify-between gap-3 min-w-0 ${onPage ? 'bg-white shadow-sm border border-gray-100' : 'bg-church-cream/70'}`}>
      <div className="min-w-0">
        <p className="text-xs text-gray-600">{label}</p>
        <p className={`font-bold text-gray-900 leading-tight ${hero ? 'text-5xl my-1' : 'text-2xl mt-0.5'}`}>{value}</p>
        {delta}
        {note && <p className="text-xs text-gray-400 mt-0.5">{note}</p>}
        {children}
      </div>
      {spark && <div className="shrink-0 self-start hidden sm:block">{spark}</div>}
    </div>
  );
}

export function Meter({ value }) {
  return (
    <div className="mt-2 h-1.5 rounded-full w-full" style={{ background: C.accentWash }} role="meter" aria-valuenow={value ?? 0} aria-valuemin={0} aria-valuemax={100}>
      {value ? <div className="h-1.5 rounded-full" style={{ width: `${Math.min(100, value)}%`, background: C.accent }} /> : null}
    </div>
  );
}

export function Section({ title, note, children, className = '' }) {
  return (
    <section className={`card ${className}`}>
      <div className="flex items-baseline justify-between gap-2 flex-wrap mb-3">
        <h3 className="font-semibold text-church-navy">
          {title}
          <span className="block w-6 h-0.5 bg-church-gold mt-1" aria-hidden="true" />
        </h3>
        {note && <p className="text-xs text-gray-400">{note}</p>}
      </div>
      {children}
    </section>
  );
}

// This week as a bar, the four weeks before as a tick.
export function BulletRows({ rows }) {
  const top = Math.max(1, ...rows.flatMap(r => [r.value, r.ref || 0])) * 1.1;
  return (
    <ul className="space-y-2.5">
      {rows.map(r => (
        <li key={r.label} className="grid grid-cols-[minmax(0,9rem)_1fr_3rem] sm:grid-cols-[11rem_1fr_3rem] items-center gap-3">
          <span className="text-sm text-gray-600 truncate">{r.label}</span>
          <span className="relative h-4 rounded bg-[#f2f1ed]" title={`${r.label}: ${num(r.value)} this week${r.ref ? `, ${num(r.ref)} on average the 4 weeks before` : ''}`}>
            <span className="absolute inset-y-0 left-0 rounded" style={{ width: `${(r.value / top) * 100}%`, background: C.accent }} />
            {r.ref ? <span className="absolute -top-1 -bottom-1 w-0.5 bg-gray-900" style={{ left: `${(r.ref / top) * 100}%` }} /> : null}
          </span>
          <span className="text-sm font-bold text-right tabular-nums">{num(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}

// Thin columns over time; the last in the accent; an average line.
export function Columns({ values, labels = [], average, format = num, height = 120, titles = [] }) {
  const max = Math.max(1, ...values) * 1.1;
  const w = 100 / Math.max(1, values.length);
  return (
    <div>
      <div className="relative" style={{ height }}>
        <div className="absolute inset-x-0 bottom-0 border-b" style={{ borderColor: C.axis }} />
        {average ? (
          <div className="absolute inset-x-0 border-t" style={{ bottom: `${(average / max) * 100}%`, borderColor: C.ink2 }}>
            <span className="absolute -top-4 left-0 text-[10px] text-gray-600">average {format(average)}</span>
          </div>
        ) : null}
        <div className="absolute inset-0 flex items-end">
          {values.map((v, i) => (
            <div key={i} className="h-full flex items-end justify-center" style={{ width: `${w}%` }}>
              {v ? (
                <div className="rounded-t-sm" title={`${titles[i] || labels[i] || ''} ${format(v)}`.trim()}
                  style={{ width: 'min(70%, 14px)', height: `${(v / max) * 100}%`, background: i === values.length - 1 ? C.accent : C.context }} />
              ) : null}
            </div>
          ))}
        </div>
      </div>
      <div className="flex mt-1">
        {values.map((_, i) => <span key={i} className="text-[10px] text-gray-400 text-center whitespace-nowrap" style={{ width: `${w}%` }}>{labels[i] || ''}</span>)}
      </div>
    </div>
  );
}

// The days of the week, the busiest in the accent and named.
export function WeekdayColumns({ days }) {
  const full = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const max = Math.max(...days);
  const top = max ? days.indexOf(max) : -1;
  return (
    <div>
      <div className="flex items-end h-24 border-b" style={{ borderColor: C.axis }}>
        {days.map((v, i) => (
          <div key={i} className="flex-1 h-full flex items-end justify-center">
            {v ? <div className="rounded-t-sm" title={`${full[i]}: ${v}`} style={{ width: 'min(60%, 16px)', height: `${(v / (max || 1)) * 100}%`, background: i === top ? C.accent : C.context }} /> : null}
          </div>
        ))}
      </div>
      <div className="flex mt-1">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((l, i) => <span key={i} className={`flex-1 text-center text-[11px] ${i === top ? 'font-bold text-gray-900' : 'text-gray-400'}`}>{l}</span>)}
      </div>
      {top >= 0 && <p className="text-xs font-semibold text-gray-600 text-center mt-1">Busiest: {full[top]}</p>}
    </div>
  );
}

export function RankedBars({ rows, format = num }) {
  const max = Math.max(1, ...rows.map(r => r.value));
  return (
    <ul className="space-y-1.5">
      {rows.map(r => (
        <li key={r.label} className="grid grid-cols-[minmax(0,10rem)_1fr] items-center gap-3">
          <span className="text-sm text-gray-600 truncate" title={r.label}>{r.label}</span>
          <span className="flex items-center gap-2">
            <span className="h-3 rounded-r" style={{ width: `${Math.max(2, (r.value / max) * 85)}%`, background: C.accent }} title={`${r.label}: ${format(r.value)}`} />
            <span className="text-sm font-bold tabular-nums">{format(r.value)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

// A running total through the year, with last year to the same date beside it.
export function RunningLine({ values, compare, endLabel, height = 120 }) {
  const max = Math.max(1, ...values, compare || 0) * 1.08;
  const W = 300; const H = height;
  const x = i => (i / Math.max(1, values.length - 1)) * (W - 8) + 4;
  const y = v => H - 4 - (v / max) * (H - 12);
  const line = values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const lx = x(values.length - 1);
  return (
    <div>
      <p className="text-sm font-bold text-right">{endLabel}</p>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img" aria-label={`Running total, now ${endLabel}`}>
        <line x1="0" x2={W} y1={H - 4} y2={H - 4} stroke={C.axis} strokeWidth="1" />
        <polygon points={`${x(0)},${H - 4} ${line} ${lx},${H - 4}`} fill={C.accent} opacity="0.12" />
        <polyline points={line} fill="none" stroke={C.accent} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {compare ? <line x1={lx - 6} x2={lx} y1={y(compare)} y2={y(compare)} stroke={C.ink2} strokeWidth="2" vectorEffect="non-scaling-stroke"><title>Last year by this date</title></line> : null}
      </svg>
      {compare ? <p className="text-xs text-gray-600 mt-1"><span aria-hidden="true" className="inline-block w-3 border-t-2 border-gray-600 align-middle mr-1" />last year by this date: {compactMoney(compare)}</p> : null}
    </div>
  );
}

// Two series stacked by month, with a legend.
export function StackedColumns({ rows, keys, names, colors, height = 110 }) {
  const max = Math.max(1, ...rows.map(r => keys.reduce((n, k) => n + r[k], 0))) * 1.15;
  return (
    <div>
      <div className="flex gap-4 mb-2">
        {names.map((n, i) => <span key={n} className="flex items-center gap-1.5 text-xs text-gray-600"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: colors[i] }} />{n}</span>)}
      </div>
      <div className="flex items-end border-b" style={{ height, borderColor: C.axis }}>
        {rows.map(r => {
          const total = keys.reduce((n, k) => n + r[k], 0);
          return (
            <div key={r.month} className="flex-1 h-full flex flex-col justify-end items-center gap-[2px]" title={`${r.month}: ${keys.map((k, i) => `${names[i]} ${r[k]}`).join(', ')}`}>
              {total ? <span className="text-[10px] text-gray-500">{total}</span> : null}
              {[...keys].reverse().map((k, j) => (r[k] ? <div key={k} style={{ width: 'min(60%, 16px)', height: `${(r[k] / max) * (height - 14)}px`, background: colors[keys.length - 1 - j] }} /> : null))}
            </div>
          );
        })}
      </div>
      <div className="flex mt-1">{rows.map(r => <span key={r.month} className="flex-1 text-center text-[10px] text-gray-400">{r.month}</span>)}</div>
    </div>
  );
}

// Weeks across by services down, darker meaning more people.
export function Heatmap({ weeks, services }) {
  const all = weeks.flatMap(w => services.map(s => w.byService[s] || 0)).filter(Boolean);
  const max = Math.max(1, ...all); const min = Math.min(...all, max);
  const shade = v => (v ? C.ramp[Math.min(C.ramp.length - 1, 1 + Math.floor(((v - min) / (max - min || 1)) * (C.ramp.length - 2)))] : '#f2f1ed');
  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-separate" style={{ borderSpacing: 2 }}>
        <tbody>
          {services.map(s => (
            <tr key={s}>
              <th scope="row" className="text-left font-normal text-gray-600 pr-2 whitespace-nowrap">{s}</th>
              {weeks.map(w => <td key={w.start} title={`${s}, week of ${dayMonth(w.start)}: ${w.byService[s] || 'none'}`} style={{ background: shade(w.byService[s]), width: 12, height: 14 }} />)}
            </tr>
          ))}
          <tr>
            <td />
            {weeks.map(w => <td key={w.start} className="text-[10px] text-gray-400">{monthTick(w.start)}</td>)}
          </tr>
        </tbody>
      </table>
      <p className="text-[11px] text-gray-400 mt-1 flex items-center gap-1">
        {num(min)} {C.ramp.slice(1).map(c => <span key={c} className="inline-block w-4 h-2" style={{ background: c }} />)} {num(max)} people
      </p>
    </div>
  );
}

// A plain table. Columns are { title, align, bold }; a cell may be { v, tone }.
export function Table({ cols, rows, empty = 'Nothing to show.', max }) {
  if (!rows.length) return <p className="text-sm text-gray-400">{empty}</p>;
  const shown = max ? rows.slice(0, max) : rows;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-gray-500 border-b" style={{ borderColor: C.axis }}>
            {cols.map((c, i) => <th key={i} className={`py-1.5 px-2 font-semibold ${c.align === 'right' ? 'text-right' : 'text-left'}`}>{c.title}</th>)}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, j) => (
            <tr key={j} className={j % 2 ? 'bg-church-cream/60' : ''}>
              {r.map((cell, i) => {
                const c = cell && typeof cell === 'object' ? cell : { v: cell };
                const tone = c.tone === 'good' ? C.goodText : c.tone === 'bad' ? C.bad : c.tone === 'warn' ? '#b45309' : undefined;
                return <td key={i} className={`py-1.5 px-2 tabular-nums ${cols[i].align === 'right' ? 'text-right' : ''} ${cols[i].bold || c.bold ? 'font-semibold' : ''}`} style={{ color: tone }}>{c.v ?? ''}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {max && rows.length > max && <p className="text-xs text-gray-400 mt-1">and {rows.length - max} more</p>}
    </div>
  );
}
