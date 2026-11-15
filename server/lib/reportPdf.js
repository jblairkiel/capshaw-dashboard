// ─── The weekly reports as PDFs ───────────────────────────────────────────────
//
// Two reports from the same numbers (lib/weeklyReport.js), each two pages:
// the week just gone (Sunday to Saturday), then the year so far.
//
//   Summary     — high level and quick to take in: a few big numbers, each
//                 against the weeks before, and a handful of small charts.
//   Analytical  — the detail behind them: every service, every guest, who has
//                 been missing, open serving slots, month by month for the year.
//
// Drawn with pdfkit, like the newsletter and the serving schedule, so nothing
// is added to the runtime image. Charts follow the site's chart rules: one
// accent hue for the thing that matters and gray for context, thin marks,
// hairline axes, labels in ink rather than series colour, and an arrow beside
// every coloured up/down so colour never carries the meaning alone.

const PDFDocument = require('pdfkit');

const C = {
  navy: '#1a2744', gold: '#c9a84c', cream: '#f9f6f0', page: '#ffffff',
  ink: '#0b0b0b', ink2: '#52514e', muted: '#898781',
  grid: '#e1e0d9', axis: '#c3c2b7', context: '#c9ccd3',
  accent: '#2a78d6', accentWash: '#e3eefb', second: '#eb6834', third: '#1baf7a',
  good: '#0ca30c', goodText: '#006300', bad: '#d03b3b', warn: '#b45309',
  ramp: ['#f4f8fe', '#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'],
};
const SANS = 'Helvetica';
const BOLD = 'Helvetica-Bold';
const PAGE = { width: 612, height: 792 };
const M = 36;
const W = PAGE.width - M * 2;

// ─── Words and numbers ────────────────────────────────────────────────────────

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT = MONTHS.map(m => m.slice(0, 3));
const d = iso => new Date(`${iso}T12:00:00Z`);
const dayMonth = iso => `${SHORT[d(iso).getUTCMonth()]} ${d(iso).getUTCDate()}`;
const longDate = iso => `${MONTHS[d(iso).getUTCMonth()]} ${d(iso).getUTCDate()}, ${d(iso).getUTCFullYear()}`;
const weekLabel = (start, end) => {
  const a = d(start); const b = d(end);
  return a.getUTCMonth() === b.getUTCMonth()
    ? `${MONTHS[a.getUTCMonth()]} ${a.getUTCDate()}–${b.getUTCDate()}, ${b.getUTCFullYear()}`
    : `${dayMonth(start)} – ${dayMonth(end)}, ${b.getUTCFullYear()}`;
};
const num = n => (n === null || n === undefined ? '—' : Math.round(n).toLocaleString('en-US'));
const money = n => (n === null || n === undefined ? '—' : `$${Math.round(n).toLocaleString('en-US')}`);
const compactMoney = n => (n >= 10000 ? `$${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}K` : money(n));
const addDaysIso = (iso, n) => { const t = d(iso); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const pct = n => (n === null || n === undefined ? '—' : `${Math.round(n)}%`);

// A change against a comparison, as { text, dir } — dir is up, down or flat.
function delta(now, then, { asPct = true, unit = '' } = {}) {
  if (now === null || now === undefined || !then) return null;
  const diff = now - then;
  if (Math.abs(diff) / then < 0.005) return { text: 'level', dir: 'flat' };
  const text = asPct ? `${Math.round(Math.abs(diff) / then * 100)}%` : `${num(Math.abs(diff))}${unit}`;
  return { text, dir: diff > 0 ? 'up' : 'down' };
}

// ─── Drawing pieces ───────────────────────────────────────────────────────────

function text(doc, str, x, y, { size = 9, font = SANS, color = C.ink, width, align = 'left', lineGap = 1, oneLine = false } = {}) {
  doc.font(font).fontSize(size).fillColor(color);
  const s = oneLine && width ? fit(doc, String(str), width) : String(str);
  doc.text(s, x, y, { width, align, lineGap, lineBreak: !!width && !oneLine, ...(oneLine && width ? { height: size * 1.3 } : {}) });
}

// Text shortened with an ellipsis to fit a width, in the current font.
function fit(doc, str, width) {
  if (doc.widthOfString(str) <= width) return str;
  let s = str;
  while (s.length > 1 && doc.widthOfString(`${s}…`) > width) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

function rule(doc, x, y, w, color = C.grid) {
  doc.moveTo(x, y).lineTo(x + w, y).lineWidth(0.75).strokeColor(color).stroke();
}

// A section title with its short gold rule.
function heading(doc, title, x, y, w, note = '') {
  text(doc, title, x, y, { size: 10.5, font: BOLD, color: C.navy });
  if (note) text(doc, note, x, y + 1.5, { size: 7.5, color: C.muted, width: w, align: 'right' });
  doc.rect(x, y + 14, 22, 1.5).fill(C.gold);
  return y + 22;
}

// The arrow and words for a change, drawn so the colour is never alone.
function deltaMark(doc, change, x, y, { against = '', upIsGood = true, size = 8 } = {}) {
  if (!change) {
    text(doc, against ? `no ${against} to compare` : '', x, y, { size, color: C.muted });
    return;
  }
  const good = change.dir === 'flat' ? null : (change.dir === 'up') === upIsGood;
  const color = good === null ? C.muted : good ? C.goodText : C.bad;
  const s = size * 0.62;
  doc.save();
  if (change.dir === 'up') doc.polygon([x, y + s + 1.5], [x + s, y + s + 1.5], [x + s / 2, y + 1.5]).fill(good ? C.good : C.bad);
  else if (change.dir === 'down') doc.polygon([x, y + 1.5], [x + s, y + 1.5], [x + s / 2, y + s + 1.5]).fill(good ? C.good : C.bad);
  else doc.rect(x, y + s / 2 + 1, s, 1.4).fill(C.muted);
  doc.restore();
  const words = change.dir === 'flat' ? `level with ${against}` : `${change.text} ${change.dir === 'up' ? 'above' : 'below'} ${against}`;
  text(doc, words, x + s + 4, y, { size, color });
}

// A small trend line: context in gray, the last point (this week) in the accent.
function sparkline(doc, values, x, y, w, h) {
  const pts = values.map((v, i) => ({ v, i })).filter(p => p.v !== null && p.v !== undefined && p.v > 0);
  if (pts.length < 2) return;
  const max = Math.max(...pts.map(p => p.v)); const min = Math.min(...pts.map(p => p.v));
  const span = max - min || 1;
  const px = i => x + (i / (values.length - 1)) * w;
  const py = v => y + h - ((v - min) / span) * h;
  doc.save().lineWidth(1.5).lineJoin('round').lineCap('round').strokeColor(C.context);
  pts.forEach((p, k) => (k ? doc.lineTo(px(p.i), py(p.v)) : doc.moveTo(px(p.i), py(p.v))));
  doc.stroke();
  const last = pts[pts.length - 1];
  doc.circle(px(last.i), py(last.v), 3.6).fill(C.page);
  doc.circle(px(last.i), py(last.v), 2.6).fill(C.accent);
  doc.restore();
}

// A stat tile: label, value, how it compares, and an optional trend.
function statTile(doc, x, y, w, h, { label, value, change, against, upIsGood = true, note, spark, hero = false }) {
  doc.roundedRect(x, y, w, h, 6).fill(C.cream);
  text(doc, label, x + 12, y + 10, { size: 8, color: C.ink2, width: w - 24 });
  text(doc, value, x + 12, y + 24, { size: hero ? 34 : 22, font: BOLD, color: C.ink });
  const valueBottom = y + 24 + (hero ? 38 : 26);
  if (change !== undefined) deltaMark(doc, change, x + 12, valueBottom, { against, upIsGood });
  if (note) text(doc, note, x + 12, valueBottom + (change !== undefined ? 12 : 0), { size: 7.5, color: C.muted, width: w - 24 });
  if (spark) {
    const sw = hero ? 110 : 70;
    sparkline(doc, spark, x + w - sw - 14, y + 16, sw, hero ? 34 : 20);
    text(doc, 'last 12 weeks', x + w - sw - 14, y + 56, { size: 6.5, color: C.muted, width: sw, align: 'right' });
  }
}

// A bar for this week against a tick for the four-week average.
function bulletRows(doc, rows, x, y, w, { labelW = 120, max } = {}) {
  const top = max || Math.max(1, ...rows.flatMap(r => [r.value, r.ref || 0])) * 1.1;
  const barX = x + labelW; const barW = w - labelW - 44;
  rows.forEach((r, i) => {
    const ry = y + i * 22;
    text(doc, r.label, x, ry + 4.5, { size: 8.5, color: C.ink2, width: labelW - 8, oneLine: true });
    doc.rect(barX, ry + 2, barW, 12).fill('#f2f1ed');
    const bw = Math.max(2, (r.value / top) * barW);
    doc.save().roundedRect(barX, ry + 2, bw, 12, 3).fill(C.accent).restore();
    if (r.ref) {
      const tx = barX + (r.ref / top) * barW;
      doc.save().rect(tx - 1, ry - 1, 2, 18).fill(C.ink).restore();
    }
    text(doc, num(r.value), barX + barW + 6, ry + 4, { size: 9, font: BOLD });
  });
  return y + rows.length * 22;
}

// Thin columns over time: this week in the accent, the rest gray; an average line.
function columns(doc, values, x, y, w, h, { labels = [], highlightLast = true, average, averageLabel, format = num } = {}) {
  const max = Math.max(1, ...values) * 1.08;
  const slot = w / values.length;
  const bw = Math.min(14, slot * 0.7);
  rule(doc, x, y + h, w, C.axis);
  values.forEach((v, i) => {
    if (!v) return;
    const bh = (v / max) * h;
    const color = highlightLast && i === values.length - 1 ? C.accent : C.context;
    doc.save().roundedRect(x + i * slot + (slot - bw) / 2, y + h - bh, bw, bh, Math.min(2, bw / 2)).fill(color).restore();
  });
  if (average) {
    const ay = y + h - (average / max) * h;
    doc.save().moveTo(x, ay).lineTo(x + w, ay).lineWidth(0.75).strokeColor(C.ink2).stroke().restore();
    text(doc, averageLabel || `average ${format(average)}`, x, ay - 10, { size: 7, color: C.ink2 });
  }
  labels.forEach((l, i) => l && text(doc, l, x + i * slot - 10, y + h + 3, { size: 6.5, color: C.muted, width: slot + 20, align: 'center' }));
  const last = values[values.length - 1];
  if (highlightLast && last) {
    const bh = (last / max) * h;
    text(doc, format(last), x + (values.length - 1) * slot - 30, y + h - bh - 11, { size: 7.5, font: BOLD, width: slot + 30, align: 'right' });
  }
}

// A running total through the year, as a line with a light wash beneath.
function runningLine(doc, values, x, y, w, h, { labelEnd, compare } = {}) {
  const max = Math.max(1, ...values, compare || 0) * 1.08;
  const px = i => x + (i / Math.max(1, values.length - 1)) * w;
  const py = v => y + h - (v / max) * h;
  rule(doc, x, y + h, w, C.axis);
  doc.save();
  doc.moveTo(px(0), y + h);
  values.forEach((v, i) => doc.lineTo(px(i), py(v)));
  doc.lineTo(px(values.length - 1), y + h).closePath().fillOpacity(0.12).fill(C.accent);
  doc.fillOpacity(1).lineWidth(2).lineJoin('round').lineCap('round').strokeColor(C.accent);
  values.forEach((v, i) => (i ? doc.lineTo(px(i), py(v)) : doc.moveTo(px(i), py(v))));
  doc.stroke();
  const lx = px(values.length - 1); const ly = py(values[values.length - 1]);
  doc.circle(lx, ly, 4).fill(C.page).circle(lx, ly, 3).fill(C.accent);
  doc.restore();
  if (compare) {
    const cy = py(compare);
    doc.save().circle(lx, cy, 3).lineWidth(1.5).strokeColor(C.ink2).stroke().restore();
    doc.save().circle(x + 3, y + h + 9, 2.5).lineWidth(1.2).strokeColor(C.ink2).stroke().restore();
    text(doc, `last year by this date: ${compactMoney(compare)}`, x + 9, y + h + 5, { size: 7, color: C.ink2 });
  }
  if (labelEnd) text(doc, labelEnd, lx - 150, ly - 15, { size: 9, font: BOLD, width: 144, align: 'right' });
}

// The days of the week, Sunday first: member-visits on each, the busiest in
// the accent and named underneath.
function weekdayColumns(doc, days, x, y, w, h) {
  const names = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const full = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const max = Math.max(1, ...days);
  const top = days.indexOf(Math.max(...days));
  const slot = w / 7; const bw = Math.min(16, slot * 0.6);
  rule(doc, x, y + h, w, C.axis);
  days.forEach((v, i) => {
    const bh = v ? Math.max(2, (v / max) * h) : 0;
    if (bh) doc.save().roundedRect(x + i * slot + (slot - bw) / 2, y + h - bh, bw, bh, 2).fill(i === top ? C.accent : C.context).restore();
    text(doc, names[i], x + i * slot, y + h + 3, { size: 7, font: i === top ? BOLD : SANS, color: i === top ? C.ink : C.muted, width: slot, align: 'center' });
  });
  if (Math.max(...days)) text(doc, `Busiest: ${full[top]}`, x, y + h + 14, { size: 7.5, font: BOLD, color: C.ink2, width: w, align: 'center' });
}

// Ranked horizontal bars, one hue, value at the tip.
function rankedBars(doc, rows, x, y, w, { labelW = 150, rowH = 15, format = num } = {}) {
  const max = Math.max(1, ...rows.map(r => r.value));
  const barW = w - labelW - 30;
  rows.forEach((r, i) => {
    const ry = y + i * rowH;
    text(doc, r.label, x, ry + 1, { size: 8, color: C.ink2, width: labelW - 6 });
    const bw = Math.max(2, (r.value / max) * barW);
    doc.save().roundedRect(x + labelW, ry, bw, rowH - 6, 2.5).fill(C.accent).restore();
    text(doc, format(r.value), x + labelW + bw + 4, ry + 1, { size: 8, font: BOLD });
  });
  return y + rows.length * rowH;
}

// Two series stacked by month (first-time and returning guests), with a legend.
function stackedColumns(doc, rows, x, y, w, h, keys, names, colors) {
  const max = Math.max(1, ...rows.map(r => keys.reduce((n, k) => n + r[k], 0))) * 1.15;
  const slot = w / rows.length; const bw = Math.min(16, slot * 0.6);
  rule(doc, x, y + h, w, C.axis);
  rows.forEach((r, i) => {
    let base = y + h;
    keys.forEach((k, j) => {
      if (!r[k]) return;
      const bh = (r[k] / max) * h;
      doc.save().rect(x + i * slot + (slot - bw) / 2, base - bh, bw, bh - (j ? 0 : 0)).fill(colors[j]).restore();
      base -= bh + 1.5;   // the surface gap between segments
    });
    const total = keys.reduce((n, k) => n + r[k], 0);
    if (total) text(doc, num(total), x + i * slot, base - 10, { size: 7, color: C.ink2, width: slot, align: 'center' });
    text(doc, r.month, x + i * slot, y + h + 3, { size: 6.5, color: C.muted, width: slot, align: 'center' });
  });
  let lx = x;
  names.forEach((n, j) => {
    doc.save().rect(lx, y - 12, 7, 7).fill(colors[j]).restore();
    text(doc, n, lx + 10, y - 13, { size: 7.5, color: C.ink2 });
    lx += doc.widthOfString(n) + 26;
  });
}

// A table: columns of { title, width, align, bold }, and rows of values.
function table(doc, cols, rows, x, y, { size = 8, rowH = 14, zebra = true, maxRows } = {}) {
  let cx = x;
  const xs = cols.map(c => { const at = cx; cx += c.width; return at; });
  const totalW = cx - x;
  cols.forEach((c, i) => text(doc, c.title, xs[i] + 3, y, { size: size - 1, font: BOLD, color: C.ink2, width: c.width - 6, align: c.align || 'left' }));
  rule(doc, x, y + rowH - 2, totalW, C.axis);
  const shown = maxRows ? rows.slice(0, maxRows) : rows;
  shown.forEach((r, j) => {
    const ry = y + rowH * (j + 1);
    if (zebra && j % 2) doc.rect(x, ry - 2, totalW, rowH).fill(C.cream);
    r.forEach((v, i) => {
      const cell = v && typeof v === 'object' && !Array.isArray(v) ? v : { v };
      text(doc, cell.v ?? '', xs[i] + 3, ry + 1, {
        size, font: cols[i].bold || cell.bold ? BOLD : SANS, color: cell.color || C.ink, width: cols[i].width - 6, align: cols[i].align || 'left', oneLine: true,
      });
    });
  });
  let end = y + rowH * (shown.length + 1);
  if (maxRows && rows.length > maxRows) {
    text(doc, `and ${rows.length - maxRows} more`, x + 3, end + 1, { size: size - 1, color: C.muted });
    end += rowH;
  }
  return end;
}

// A change as a table cell: arrow word and colour.
function changeCell(now, then, upIsGood = true) {
  const ch = delta(now, then);
  if (!ch) return { v: '—', color: C.muted };
  if (ch.dir === 'flat') return { v: 'level', color: C.muted };
  const good = (ch.dir === 'up') === upIsGood;
  // An en dash for minus: the standard PDF fonts have no minus sign.
  return { v: `${ch.dir === 'up' ? '+' : '–'}${ch.text}`, color: good ? C.goodText : C.bad };
}

// A grid of weeks across by services down, shaded by how many came.
function heatmap(doc, weeks, services, x, y, w, { labelW = 110, cellH = 13 } = {}) {
  const cols = weeks.length;
  const cw = (w - labelW) / cols;
  const all = weeks.flatMap(wk => services.map(s => wk.byService[s] || 0)).filter(Boolean);
  const max = Math.max(1, ...all); const min = Math.min(...all, max);
  services.forEach((s, r) => {
    const ry = y + r * (cellH + 2);
    text(doc, s, x, ry + 2, { size: 7.5, color: C.ink2, width: labelW - 6 });
    weeks.forEach((wk, c) => {
      const v = wk.byService[s];
      const fill = v ? C.ramp[Math.min(C.ramp.length - 1, 1 + Math.floor(((v - min) / (max - min || 1)) * (C.ramp.length - 2)))] : '#f2f1ed';
      doc.save().rect(x + labelW + c * cw + 0.5, ry, cw - 1, cellH).fill(fill).restore();
    });
  });
  const bottom = y + services.length * (cellH + 2);
  weeks.forEach((wk, c) => {
    const dt = d(wk.start);
    if (dt.getUTCDate() <= 7) text(doc, SHORT[dt.getUTCMonth()], x + labelW + c * cw - 4, bottom + 1, { size: 6.5, color: C.muted, width: 30 });
  });
  // The scale.
  const sx = x + w - 150;
  text(doc, num(min), sx - 24, bottom + 12, { size: 6.5, color: C.muted, width: 20, align: 'right' });
  C.ramp.slice(1).forEach((c, i) => doc.save().rect(sx + i * 16, bottom + 12, 15, 7).fill(c).restore());
  text(doc, `${num(max)} people`, sx + (C.ramp.length - 1) * 16 + 4, bottom + 12, { size: 6.5, color: C.muted });
  return bottom + 24;
}

// A ratio against its whole: a track in a light step and the fill in the accent.
function meter(doc, value, x, y, w) {
  doc.save().roundedRect(x, y, w, 6, 3).fill(C.accentWash);
  if (value) doc.roundedRect(x, y, Math.max(6, Math.min(1, value / 100) * w), 6, 3).fill(C.accent);
  doc.restore();
}

// ─── The page frame ───────────────────────────────────────────────────────────

function banner(doc, { report, period, range }) {
  doc.rect(0, 0, PAGE.width, 70).fill(C.navy);
  doc.rect(0, 70, PAGE.width, 3).fill(C.gold);
  text(doc, 'CAPSHAW CHURCH OF CHRIST', M, 16, { size: 8, font: BOLD, color: C.gold });
  // Which period this page is, set beside the title so it is seen first.
  text(doc, report, M, 28, { size: 20, font: BOLD, color: '#ffffff' });
  doc.font(BOLD).fontSize(20);
  const after = M + doc.widthOfString(report) + 10;
  doc.save().rect(after, 29, 1.5, 18).fill(C.gold).restore();
  text(doc, period, after + 11, 28, { size: 20, font: BOLD, color: C.gold });
  text(doc, range, M, 33, { size: 10.5, color: '#d8dbe3', width: W, align: 'right' });
  return 90;
}

function footer(doc, page, total, kind) {
  const bottom = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  text(doc, `${kind} · Page ${page} of ${total} · Sent by the church's member portal`, M, PAGE.height - 24, { size: 7, color: C.muted, width: W, align: 'center' });
  doc.page.margins.bottom = bottom;
}

// ─── The summary ──────────────────────────────────────────────────────────────

function summaryWeek(doc, { week, year }) {
  let y = banner(doc, { report: 'Weekly Summary', period: 'This week', range: weekLabel(week.start, week.end) });

  // The headline: the week's best-attended service, against the four weeks before.
  const head = week.attendance.headline;
  const amSeries = year.attendance.weeks.slice(-12).map(wk => (head ? wk.byService[head.service] || 0 : 0));
  statTile(doc, M, y, W * 0.56 - 6, 96, {
    hero: true,
    label: head ? `${head.service} attendance` : 'Attendance',
    value: head ? num(head.count) : '—',
    change: head ? delta(head.count, head.avg4) : null, against: '4-week average',
    spark: amSeries,
  });
  const tileW = (W * 0.44 - 6) / 2 - 4;
  const tx = M + W * 0.56 + 2;
  statTile(doc, tx, y, tileW, 96, {
    label: 'Contribution', value: compactMoney(week.giving.amount ?? 0),
    change: delta(week.giving.amount, week.giving.avg4), against: '4-wk avg',
  });
  statTile(doc, tx + tileW + 8, y, tileW, 96, {
    label: 'Guests', value: num(week.guests.visits),
    note: week.guests.visits ? `${week.guests.firstTime} first time · ${week.guests.returning} returning` : 'No guests recorded',
  });
  y += 112;

  // Every service against its own four-week average.
  y = heading(doc, 'Attendance by service', M, y, W, 'bar: this week · line: average of the 4 weeks before');
  y = bulletRows(doc, week.attendance.services.map(s => ({ label: s.service, value: s.count, ref: s.avg4 })), M, y + 2, W, { labelW: 140 }) + 10;

  // The portal: who used it, how, and what they did.
  const p = week.portal;
  y = heading(doc, 'On the portal', M, y, W, `${num(p.accounts)} members have an account`);
  const pw = (W - 24) / 4;
  statTile(doc, M, y, pw * 1.6, 78, {
    label: 'Members who used the portal', value: num(p.members),
    change: delta(p.members, p.avg4), against: '4-wk avg', spark: p.trend,
  });
  const px2 = M + pw * 1.6 + 8;
  const rest = (W - pw * 1.6 - 8 - 16) / 3;
  [
    { label: 'On a phone', value: pct(p.phoneShare), note: p.members ? `${num(p.onPhone)} of ${num(p.members)} members` : '', meter: p.phoneShare },
    { label: 'Changes made', value: num(p.changes), note: `by ${num(p.changedBy)} member${p.changedBy === 1 ? '' : 's'} keeping records` },
    p.inactive === null
      ? { label: 'Inactive 30+ days', value: '—', note: 'counted once the portal has 30 days of visits' }
      : { label: 'Inactive 30+ days', value: num(p.inactive.length), note: `of ${num(p.accounts)} members with an account` },
  ].forEach((t, i) => {
    const x = px2 + i * (rest + 8);
    statTile(doc, x, y, rest, 78, { label: t.label, value: t.value, note: t.note });
    if (t.meter !== undefined && t.meter !== null) meter(doc, t.meter, x + 12, y + 66, rest - 24);
  });
  y += 92;

  const left = W * 0.6 - 10; const right = W - left - 20;
  let ly = heading(doc, 'Most-opened pages', M, y, left, 'times opened');
  if (p.pages.length) rankedBars(doc, p.pages.slice(0, 6).map(pg => ({ label: pg.label, value: pg.views })), M, ly, left, { labelW: 120, rowH: 15 });
  else text(doc, 'No pages counted yet.', M, ly, { size: 8, color: C.muted });
  let dy = heading(doc, 'Busiest days', M + left + 20, y, right, 'members each day');
  weekdayColumns(doc, p.weekdays.days, M + left + 20, dy + 4, right, 58);
  y = ly + 6 * 15 + 6;

  y = heading(doc, 'What members did', M, y, W);
  const did = [
    ['RSVPs', p.did.rsvps], ['Song requests', p.did.songRequests], ['Bible Quiz games', p.did.quizGames],
    ['Practised verses', p.did.versePracticers], ['Sign-ups', p.did.signups], ['Comments', p.did.comments], ['Emails sent', p.did.emails],
  ];
  const dw = W / did.length;
  did.forEach(([label, n], i) => {
    const x = M + i * dw;
    text(doc, num(n), x, y, { size: 13, font: BOLD, color: n ? C.ink : C.axis });
    text(doc, label, x, y + 15, { size: 6.5, color: C.ink2, width: dw - 4, oneLine: true });
  });
  y += 34;

  // The rest of the week in small cards.
  const cards = [
    { title: 'Member roll call', big: pct(week.roll.rate), sub: week.roll.rate === null ? 'Not taken this week' : 'of members marked were present', meter: week.roll.rate },
    { title: 'Serving', big: week.serving.jobs ? `${week.serving.filled} of ${week.serving.jobs}` : '—', sub: week.serving.jobs ? (week.serving.open.length ? `jobs filled · ${week.serving.open.length} open` : 'jobs filled · none open') : 'No jobs on the schedule', meter: week.serving.jobs ? (week.serving.filled / week.serving.jobs) * 100 : null },
    { title: 'Group meetings', big: num(week.meetings.length), sub: week.meetings.length ? `${num(week.meetings.reduce((n, m) => n + (m.headCount || 0), 0))} people came` : 'None this week' },
    { title: 'Guest follow-ups', big: num(week.followUps.reached), sub: `reached this week · ${week.followUps.open} still open` },
  ];
  y = heading(doc, 'Around the congregation', M, y, W);
  const cw = W / 4;
  cards.forEach((c, i) => {
    const x = M + i * cw;
    doc.save().roundedRect(x + 2, y, cw - 4, 66, 5).fill(C.cream).restore();
    text(doc, c.title, x + 10, y + 8, { size: 7.5, color: C.ink2 });
    text(doc, c.big, x + 10, y + 20, { size: 17, font: BOLD });
    text(doc, c.sub, x + 10, y + 40, { size: 7, color: C.muted, width: cw - 20 });
    if (c.meter !== undefined && c.meter !== null) meter(doc, c.meter, x + 10, y + 55, cw - 24);
  });
  y += 78;

  y = heading(doc, 'Songs sung', M, y, W);
  const titles = [...new Set(week.songs.flatMap(s => s.songs))];
  text(doc, titles.length ? titles.slice(0, 10).join(' · ') + (titles.length > 10 ? ` · and ${titles.length - 10} more` : '') : 'No songs recorded yet this week.', M, y, { size: 8, color: C.ink2, width: W, lineGap: 2 });
}

function summaryYear(doc, { week, year }) {
  let y = banner(doc, { report: 'Weekly Summary', period: `${year.year} so far`, range: `January 1 – ${longDate(week.end)}` });

  // The year's big numbers.
  const main = [...year.attendance.services].sort((a, b) => (b.average || 0) - (a.average || 0))[0];
  const tw = W / 4 - 6;
  const tiles = [
    { label: main ? `Average ${main.service}` : 'Average attendance', value: main ? num(main.average) : '—', change: main ? delta(main.average, main.lastYear) : null, against: 'last year' },
    { label: 'Contributions so far', value: compactMoney(year.giving.total), change: delta(year.giving.total, year.giving.lastYearToDate), against: 'last year' },
    { label: 'Guests so far', value: num(year.guests.unique), note: `${pct(year.guests.returnRate)} came back again` },
    { label: 'Members on the portal', value: num(year.portal.weeklyAverage), note: 'in an average week' },
  ];
  tiles.forEach((t, i) => statTile(doc, M + i * (tw + 8), y, tw, 84, t));
  y += 100;

  // Attendance, week by week.
  if (main) {
    y = heading(doc, `${main.service}, every week this year`, M, y, W, 'this week in blue');
    const vals = year.attendance.weeks.map(wk => wk.byService[main.service] || 0);
    const labels = year.attendance.weeks.map(wk => (d(wk.start).getUTCDate() <= 7 ? SHORT[d(wk.start).getUTCMonth()] : ''));
    columns(doc, vals, M, y + 10, W, 84, { labels, average: main.average });
    y += 116;
  }

  // Giving and guests, side by side.
  const half = W / 2 - 10;
  let gy = heading(doc, 'Contributions, running total', M, y, half);
  runningLine(doc, year.giving.weeks.map(g => g.running), M, gy + 14, half, 88, {
    labelEnd: compactMoney(year.giving.total), compare: year.giving.lastYearToDate,
  });
  let hy = heading(doc, 'Guests by month', M + half + 20, y, half);
  stackedColumns(doc, year.guests.byMonth, M + half + 20, hy + 16, half, 86, ['firstTime', 'returning'], ['First time', 'Returning'], [C.accent, C.second]);
  y += 150;

  // The portal through the year.
  const p = year.portal;
  const weeks = p.since ? p.weeks.filter(w => w.start >= addDaysIso(p.since, -6)) : [];
  const c1 = 200; const c2 = 130; const c3 = W - c1 - c2 - 40;
  let wy = heading(doc, 'Members on the portal, each week', M, y, c1);
  if (weeks.length) {
    columns(doc, weeks.map(w => w.members), M, wy + 8, c1, 70, {
      labels: weeks.map(w => (d(w.start).getUTCDate() <= 7 ? SHORT[d(w.start).getUTCMonth()] : '')), average: p.weeklyAverage,
    });
    text(doc, `counted since ${dayMonth(p.since)}`, M, wy + 94, { size: 6.5, color: C.muted });
  } else text(doc, 'Not counted yet.', M, wy, { size: 8, color: C.muted });
  let by = heading(doc, 'Busiest days', M + c1 + 20, y, c2);
  weekdayColumns(doc, p.weekdays.days, M + c1 + 20, by + 8, c2, 62);
  let py = heading(doc, 'Most-opened pages', M + c1 + c2 + 40, y, c3);
  if (p.pages.length) rankedBars(doc, p.pages.slice(0, 6).map(pg => ({ label: pg.label, value: pg.views })), M + c1 + c2 + 40, py, c3, { labelW: 92, rowH: 14 });
  y += 136;

  // A line of the rest.
  y = heading(doc, 'Also this year', M, y, W);
  const s = year.serving; const f = year.followUps;
  const items = [
    ['Serving jobs filled', s.jobs ? pct(s.fillRate) : '—', s.jobs ? `${num(s.filled)} of ${num(s.jobs)} by ${num(s.people)} men` : ''],
    ['Guests reached', f.finished ? pct(f.rate) : '—', `${num(f.reached)} of ${num(f.finished)} follow-ups`],
    p.inactive === null
      ? ['Inactive 30+ days', '—', 'counted once the portal has 30 days of visits']
      : ['Inactive 30+ days', num(p.inactive.length), `of ${num(p.accounts)} members with an account`],
    ['Changes on the portal', num(p.changes), `by ${num(p.changedBy)} members keeping records`],
  ];
  const iw = W / 4;
  items.forEach(([label, big, sub], i) => {
    const x = M + i * iw;
    text(doc, label, x, y, { size: 7.5, color: C.ink2 });
    text(doc, big, x, y + 11, { size: 15, font: BOLD });
    text(doc, sub, x, y + 30, { size: 7, color: C.muted, width: iw - 10 });
  });
  y += 52;
  const top = year.songs.top.slice(0, 3).map(t => `${t.title} (${t.count})`).join(' · ');
  if (top) text(doc, `Most-sung songs: ${top} · ${num(year.songs.distinct)} different songs in all`, M, y, { size: 7.5, color: C.ink2, width: W });
}

// ─── The analytical report ────────────────────────────────────────────────────

function analyticalWeek(doc, { week }) {
  let y = banner(doc, { report: 'Weekly Analytical Report', period: 'This week', range: weekLabel(week.start, week.end) });

  y = heading(doc, 'Attendance', M, y, W, 'against the 4 weeks before, and the same week last year');
  y = table(doc, [
    { title: 'Service', width: 170 }, { title: 'This week', width: 70, align: 'right', bold: true },
    { title: '4-week avg', width: 70, align: 'right' }, { title: 'Change', width: 70, align: 'right' },
    { title: 'Last year', width: 70, align: 'right' }, { title: 'Change', width: 70, align: 'right' },
  ], week.attendance.services.map(s => [s.service, num(s.count), num(s.avg4), changeCell(s.count, s.avg4), num(s.lastYear), changeCell(s.count, s.lastYear)]), M, y) + 8;

  // Giving and the roll call, side by side.
  const half = W / 2 - 10;
  let gy = heading(doc, 'Contribution', M, y, half);
  gy = table(doc, [{ title: '', width: 130 }, { title: '', width: half - 130, align: 'right' }], [
    ['This week', { v: money(week.giving.amount), bold: true }],
    ['Average of the 4 weeks before', money(week.giving.avg4)],
    ['Change', changeCell(week.giving.amount, week.giving.avg4)],
  ], M, gy - 12, { zebra: false });
  let ry = heading(doc, 'Member roll call', M + half + 20, y, half);
  ry = table(doc, [{ title: 'Roll', width: 150 }, { title: 'Present', width: 45, align: 'right' }, { title: 'Rate', width: half - 195, align: 'right' }],
    week.roll.rolls.map(r => [`${dayMonth(r.date)} · ${r.service}`, `${r.present} / ${r.marked}`, pct(r.marked ? (r.present / r.marked) * 100 : null)]),
    M + half + 20, ry, { maxRows: 4 });
  if (!week.roll.rolls.length) text(doc, 'No roll call was taken this week.', M + half + 20, ry, { size: 8, color: C.muted });
  y = Math.max(gy, ry) + 10;

  // Guests, by name.
  y = heading(doc, `Guests (${week.guests.visits})`, M, y, W, `${week.guests.firstTime} first time · ${week.guests.returning} returning`);
  if (week.guests.list.length) {
    y = table(doc, [
      { title: 'Name', width: 140, bold: true }, { title: 'When', width: 110 }, { title: 'Visit', width: 70 },
      { title: 'Invited by', width: 110 }, { title: 'From', width: 110 },
    ], week.guests.list.map(g => [g.name, `${dayMonth(g.date)} · ${g.service}`, g.firstTime ? 'First time' : 'Returning', g.invitedBy || '—', g.place || '—']), M, y, { maxRows: 6 }) + 8;
  } else { text(doc, 'No guests recorded this week.', M, y, { size: 8, color: C.muted }); y += 18; }

  // Missing members, and open serving slots.
  let my = heading(doc, 'Members missing 3 or more in a row', M, y, half);
  if (week.roll.missing.length) {
    my = table(doc, [{ title: 'Name', width: 120, bold: true }, { title: 'Missed', width: 50, align: 'right' }, { title: 'Last here', width: half - 170, align: 'right' }],
      week.roll.missing.map(p => [p.name, `${p.missed} in a row`, p.lastPresent ? dayMonth(p.lastPresent) : 'not this year']), M, my, { maxRows: 6 });
  } else { text(doc, 'Nobody has missed three in a row.', M, my, { size: 8, color: C.muted }); my += 14; }
  let sy = heading(doc, `Serving: ${week.serving.filled} of ${week.serving.jobs} jobs filled`, M + half + 20, y, half);
  if (week.serving.open.length) {
    sy = table(doc, [{ title: 'Open job', width: 110, bold: true }, { title: 'When', width: half - 110 }],
      week.serving.open.map(j => [{ v: j.job, color: C.warn, bold: true }, `${dayMonth(j.date)} · ${j.service}`]), M + half + 20, sy, { maxRows: 6 });
  } else { text(doc, week.serving.jobs ? 'Every job was filled.' : 'Nothing on the serving schedule this week.', M + half + 20, sy, { size: 8, color: C.muted }); sy += 14; }
  y = Math.max(my, sy) + 10;

  // Group meetings and songs.
  let ey = heading(doc, 'Group meetings', M, y, half);
  if (week.meetings.length) {
    ey = table(doc, [{ title: 'Meeting', width: 130 }, { title: 'Day', width: 45 }, { title: 'Came', width: 35, align: 'right' }, { title: 'Said yes', width: half - 210, align: 'right' }],
      week.meetings.map(m => [`${m.group}: ${m.title}`, dayMonth(m.date), num(m.headCount), num(m.rsvpYes)]), M, ey, { maxRows: 5 });
  } else { text(doc, 'No group meetings this week.', M, ey, { size: 8, color: C.muted }); ey += 14; }
  let ky = heading(doc, 'Songs sung', M + half + 20, y, half);
  week.songs.slice(0, 4).forEach(s => {
    text(doc, `${dayMonth(s.iso)} · ${s.service}${s.leader ? ` · led by ${s.leader}` : ''}`, M + half + 20, ky, { size: 7.5, font: BOLD, color: C.ink2, width: half });
    text(doc, s.songs.join(' · '), M + half + 20, ky + 10, { size: 7.5, color: C.ink2, width: half });
    ky += 12 + doc.heightOfString(s.songs.join(' · '), { width: half }) + 4;
  });
  if (!week.songs.length) { text(doc, 'No songs recorded yet.', M + half + 20, ky, { size: 8, color: C.muted }); ky += 14; }
  y = Math.max(ey, ky) + 10;

  // Guest follow-ups, in one line.
  const f = week.followUps;
  heading(doc, 'Guest follow-ups', M, y, W);
  text(doc, `${f.started} started, ${f.reached} reached, ${f.unreached} could not be reached, ${f.open} still open.   Memory verses said in class: ${week.engagement.versesScored}.`,
    M, y + 22, { size: 8, color: C.ink2, width: W, lineGap: 2 });
}

function analyticalYear(doc, { week, year }) {
  let y = banner(doc, { report: 'Weekly Analytical Report', period: `${year.year} so far`, range: `January 1 – ${longDate(week.end)}` });

  y = heading(doc, 'Attendance by service', M, y, W, 'a week\'s total for each service');
  y = table(doc, [
    { title: 'Service', width: 160 }, { title: 'Average', width: 60, align: 'right', bold: true }, { title: 'High', width: 55, align: 'right' },
    { title: 'Low', width: 55, align: 'right' }, { title: 'Weeks', width: 55, align: 'right' },
    { title: 'Last year avg', width: 80, align: 'right' }, { title: 'Change', width: 75, align: 'right' },
  ], year.attendance.services.map(s => [s.service, num(s.average), num(s.high), num(s.low), num(s.services), num(s.lastYear), changeCell(s.average, s.lastYear)]), M, y) + 10;

  y = heading(doc, 'Every week, every service', M, y, W, 'darker means more people');
  y = heatmap(doc, year.attendance.weeks, year.attendance.serviceNames, M, y, W) + 6;

  // Giving by month, and guests by month.
  const half = W / 2 - 10;
  let gy = heading(doc, 'Contributions by month', M, y, half, `${money(year.giving.total)} so far`);
  rankedBars(doc, year.giving.byMonth.map(m => ({ label: m.month, value: m.amount })), M, gy, half, { labelW: 30, rowH: 12, format: compactMoney });
  gy += year.giving.byMonth.length * 12 + 4;
  text(doc, `Weekly average ${money(year.giving.average)} · last year to this date ${money(year.giving.lastYearToDate)}`, M, gy, { size: 7.5, color: C.ink2, width: half });
  let hy = heading(doc, 'Guests by month', M + half + 20, y, half, `${pct(year.guests.returnRate)} came back`);
  hy = table(doc, [{ title: 'Month', width: 50 }, { title: 'First time', width: 70, align: 'right' }, { title: 'Returning', width: 70, align: 'right' }, { title: 'Roll call', width: half - 190, align: 'right' }],
    year.guests.byMonth.map((m, i) => [m.month, num(m.firstTime), num(m.returning), pct(year.roll.byMonth[i]?.rate)]), M + half + 20, hy, { size: 7.5, rowH: 11.5 });
  y = Math.max(gy + 14, hy) + 8;

  // Songs and groups.
  let sy = heading(doc, 'Ten most-sung songs', M, y, half, `${num(year.songs.distinct)} different in ${num(year.songs.services)} services`);
  rankedBars(doc, year.songs.top.map(s => ({ label: s.title, value: s.count })), M, sy, half, { labelW: 150, rowH: 12 });
  let ky = heading(doc, 'Group meetings by group', M + half + 20, y, half, `${num(year.groups.meetings)} meetings`);
  table(doc, [{ title: 'Group', width: 140 }, { title: 'Meetings', width: 50, align: 'right' }, { title: 'People', width: half - 190, align: 'right' }],
    year.groups.byGroup.map(g => [g.group, num(g.meetings), num(g.people)]), M + half + 20, ky, { size: 7.5, rowH: 12, maxRows: 7 });
  y += 22 + Math.max(year.songs.top.length * 12, Math.min(8, year.groups.byGroup.length + 1) * 12) + 10;

  const s = year.serving; const f = year.followUps; const e = year.engagement;
  heading(doc, 'Serving and follow-ups', M, y, W);
  text(doc, `Serving: ${num(s.filled)} of ${num(s.jobs)} jobs filled (${pct(s.fillRate)}) by ${num(s.people)} men.   Follow-ups: ${num(f.finished)} finished, ${num(f.reached)} reached (${pct(f.rate)}).   Memory verses said in class: ${num(e.versesScored)}.`,
    M, y + 22, { size: 8, color: C.ink2, width: W, lineGap: 2 });
}

// The portal pages run on to another page when a list is long.
function room(doc, y, need, frame) {
  if (y + need <= PAGE.height - 44) return y;
  doc.addPage();
  return banner(doc, frame);
}

// What members did on the portal, as a row of figures.
function didRow(doc, did, x, y, w) {
  const items = [
    ['RSVPs', did.rsvps], ['Song requests', did.songRequests], ['Bible Quiz games', did.quizGames],
    ['Practised verses', did.versePracticers], ['Sign-ups', did.signups], ['Comments', did.comments], ['Emails sent', did.emails],
  ];
  const cw = w / items.length;
  items.forEach(([label, n], i) => {
    text(doc, num(n), x + i * cw, y, { size: 12, font: BOLD, color: n ? C.ink : C.axis });
    text(doc, label, x + i * cw, y + 14, { size: 6.5, color: C.ink2, width: cw - 4, oneLine: true });
  });
  return y + 30;
}

// Records kept by area, and the busiest record keepers, side by side.
function keepersBlock(doc, p, x, y, w, frame) {
  y = room(doc, y, 150, frame);
  const half = w / 2 - 10;
  let ay = heading(doc, 'Records kept, by area', x, y, half, `${num(p.changes)} changes`);
  ay = p.changesByArea.length
    ? table(doc, [{ title: 'Area', width: half - 60 }, { title: 'Changes', width: 60, align: 'right' }],
      p.changesByArea.map(a => [a.label, num(a.changes)]), x, ay, { maxRows: 10 })
    : (text(doc, 'Nothing changed.', x, ay, { size: 8, color: C.muted }), ay + 14);
  let ky = heading(doc, 'Busiest record keepers', x + half + 20, y, half, `${num(p.changedBy)} people`);
  ky = p.keepers.length
    ? table(doc, [{ title: 'Name', width: half - 110, bold: true }, { title: 'Changes', width: 55, align: 'right' }, { title: 'Areas', width: 55, align: 'right' }],
      p.keepers.map(k => [k.name, num(k.changes), num(k.areas)]), x + half + 20, ky, { maxRows: 10 })
    : (text(doc, 'Nobody made a change.', x + half + 20, ky, { size: 8, color: C.muted }), ky + 14);
  return Math.max(ay, ky) + 10;
}

function analyticalWeekPortal(doc, { week }) {
  const frame = { report: 'Weekly Analytical Report', period: 'This week', range: weekLabel(week.start, week.end) };
  let y = banner(doc, frame);
  const p = week.portal;

  // The headline figures against the four weeks before.
  const half = W / 2 - 10;
  y = heading(doc, 'On the portal', M, y, half, `${num(p.accounts)} have an account`);
  const figures = table(doc, [{ title: '', width: 150 }, { title: 'This week', width: 60, align: 'right', bold: true }, { title: '4-week avg', width: half - 210, align: 'right' }], [
    ['Members who used the portal', num(p.members), num(p.avg4)],
    ['   on a phone', `${num(p.onPhone)}`, ''],
    ['   on a computer', `${num(p.onComputer)}`, ''],
    ['Pages opened', num(p.pageViews), ''],
    ['Changes made', num(p.changes), ''],
    ['Inactive 30+ days', p.inactive === null ? '—' : num(p.inactive.length), ''],
  ], M, y);
  let dy = heading(doc, 'Busiest days', M + half + 20, y - 22, half, 'members each day');
  weekdayColumns(doc, p.weekdays.days, M + half + 20, dy + 4, half, 66);
  y = Math.max(figures, dy + 96) + 10;

  // Each day of the week, and which pages were opened.
  let ey = heading(doc, 'Each day', M, y, half);
  ey = table(doc, [
    { title: 'Day', width: half - 172 }, { title: 'Members', width: 46, align: 'right', bold: true }, { title: 'Phone', width: 40, align: 'right' },
    { title: 'Computer', width: 46, align: 'right' }, { title: 'Pages', width: 40, align: 'right' },
  ], p.daily.map(dd => [`${dd.weekday.slice(0, 3)}, ${dayMonth(dd.date)}`, num(dd.members), num(dd.phone), num(dd.computer), num(dd.opens)]), M, ey);
  let gy = heading(doc, 'Pages opened', M + half + 20, y, half, 'times · members');
  gy = p.pages.length
    ? table(doc, [{ title: 'Page', width: half - 100 }, { title: 'Opened', width: 50, align: 'right', bold: true }, { title: 'Members', width: 50, align: 'right' }],
      p.pages.map(pg => [pg.label, num(pg.views), num(pg.people)]), M + half + 20, gy)
    : (text(doc, 'No pages counted yet.', M + half + 20, gy, { size: 8, color: C.muted }), gy + 14);
  y = Math.max(ey, gy) + 10;
  y = heading(doc, 'What members did', M, room(doc, y, 60, frame), W);
  y = didRow(doc, p.did, M, y, W) + 8;

  y = keepersBlock(doc, p, M, y, W, frame);

  // Who has not been on the portal for a month, by name.
  y = room(doc, y, 80, frame);
  if (p.inactive === null) {
    y = heading(doc, 'Inactive 30+ days', M, y, W);
    text(doc, 'Listed once the portal has counted 30 days of visits.', M, y, { size: 8, color: C.muted });
    return;
  }
  y = heading(doc, `Inactive 30+ days (${p.inactive.length})`, M, y, W, 'members with an account not on the portal in 30 days');
  if (!p.inactive.length) { text(doc, 'Every member has used the portal in the last 30 days.', M, y, { size: 8, color: C.muted }); return; }
  const per = 2; const colW = W / per - 10;
  const rows = Math.ceil(p.inactive.length / per);
  let start = 0;
  while (start < rows) {
    const fits = Math.max(1, Math.floor((PAGE.height - 50 - y) / 14) - 1);
    const take = Math.min(fits, rows - start);
    for (let c = 0; c < per; c++) {
      const slice = p.inactive.slice(c * rows + start, c * rows + start + take);
      if (slice.length) table(doc, [{ title: 'Name', width: colW - 100, bold: true }, { title: 'Last on', width: 100, align: 'right' }],
        slice.map(m => [m.name, m.lastVisit ? dayMonth(m.lastVisit) : 'not since counting began']), M + c * (colW + 20), y);
    }
    start += take;
    if (start < rows) { doc.addPage(); y = banner(doc, frame); y = heading(doc, 'Inactive 30+ days, continued', M, y, W); }
  }
}

function analyticalYearPortal(doc, { week, year }) {
  const frame = { report: 'Weekly Analytical Report', period: `${year.year} so far`, range: `January 1 – ${longDate(week.end)}` };
  let y = banner(doc, frame);
  const p = year.portal;

  y = heading(doc, 'On the portal, month by month', M, y, W, p.since ? `visits and pages counted since ${longDate(p.since)}` : 'visits not counted yet');
  y = table(doc, [
    { title: 'Month', width: 80 }, { title: 'Members', width: 90, align: 'right', bold: true }, { title: 'Member-days', width: 100, align: 'right' },
    { title: 'Pages opened', width: 100, align: 'right' }, { title: 'Changes made', width: 100, align: 'right' },
  ], p.byMonth.map(m => [m.month, m.members ? num(m.members) : '—', m.visits ? num(m.visits) : '—', m.opens ? num(m.opens) : '—', num(m.changes)]), M, y, { rowH: 13 }) + 4;
  text(doc, 'Members: how many used the portal that month. Member-days: each member counted once for each day they used it.', M, y, { size: 7, color: C.muted, width: W });
  y += 18;

  // Weekly members, and the busiest days.
  const left = W * 0.62 - 10; const right = W - left - 20;
  const weeks = p.since ? p.weeks.filter(w => w.start >= addDaysIso(p.since, -6)) : [];
  let wy = heading(doc, 'Members on the portal, each week', M, y, left, p.weeklyAverage ? `average ${num(p.weeklyAverage)}` : '');
  if (weeks.length) columns(doc, weeks.map(w => w.members), M, wy + 8, left, 70, { labels: weeks.map(w => (d(w.start).getUTCDate() <= 7 ? SHORT[d(w.start).getUTCMonth()] : '')), average: p.weeklyAverage });
  else text(doc, 'Not counted yet.', M, wy, { size: 8, color: C.muted });
  let by = heading(doc, 'Busiest days', M + left + 20, y, right);
  weekdayColumns(doc, p.weekdays.days, M + left + 20, by + 8, right, 62);
  y += 120;

  const half = W / 2 - 10;
  let gy = heading(doc, 'Pages opened', M, y, half, `${num(p.pageViews)} in all`);
  gy = p.pages.length
    ? table(doc, [{ title: 'Page', width: half - 100 }, { title: 'Opened', width: 50, align: 'right', bold: true }, { title: 'Members', width: 50, align: 'right' }],
      p.pages.map(pg => [pg.label, num(pg.views), num(pg.people)]), M, gy)
    : (text(doc, 'No pages counted yet.', M, gy, { size: 8, color: C.muted }), gy + 14);
  let ay = heading(doc, 'Records kept, by area', M + half + 20, y, half, `${num(p.changes)} changes`);
  ay = table(doc, [{ title: 'Area', width: half - 60 }, { title: 'Changes', width: 60, align: 'right' }],
    p.changesByArea.map(a => [a.label, num(a.changes)]), M + half + 20, ay, { maxRows: 8 });
  y = Math.max(gy, ay) + 10;

  let ky = heading(doc, 'Busiest record keepers', M, y, half, `${num(p.changedBy)} people`);
  table(doc, [{ title: 'Name', width: half - 110, bold: true }, { title: 'Changes', width: 55, align: 'right' }, { title: 'Areas', width: 55, align: 'right' }],
    p.keepers.map(k => [k.name, num(k.changes), num(k.areas)]), M, ky, { maxRows: 8 });
  const dy = heading(doc, 'What members did this year', M + half + 20, y, half);
  table(doc, [{ title: '', width: half - 60 }, { title: '', width: 60, align: 'right', bold: true }], [
    ['RSVPs to group meetings', num(p.did.rsvps)], ['Song requests', num(p.did.songRequests)],
    ['Bible Quiz games', num(p.did.quizGames)], ['Members who practised memory verses', num(p.did.versePracticers)],
    ['Sign-ups', num(p.did.signups)], ['Comments', num(p.did.comments)], ['Emails sent', num(p.did.emails)],
  ], M + half + 20, dy - 14);
}

// ─── Making the files ─────────────────────────────────────────────────────────

const KINDS = {
  summary:    { title: 'Weekly Summary', pages: [summaryWeek, summaryYear] },
  analytical: { title: 'Weekly Analytical Report', pages: [analyticalWeek, analyticalWeekPortal, analyticalYear, analyticalYearPortal] },
};

// The PDF as a Buffer, made synchronously (see lib/rosterPdf.js for why).
function reportPdf(kind, data) {
  const spec = KINDS[kind];
  if (!spec) throw new Error(`No such report: ${kind}`);
  const doc = new PDFDocument({ size: 'LETTER', margin: M, bufferPages: true, info: {
    Title: `${spec.title}: ${weekLabel(data.week.start, data.week.end)}`, Author: 'Capshaw Church of Christ',
  } });
  spec.pages.forEach((draw, i) => { if (i) doc.addPage(); draw(doc, data); });
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) { doc.switchToPage(i); footer(doc, i + 1, range.count, spec.title); }
  doc.end();
  const chunks = [];
  let chunk;
  while ((chunk = doc.read()) !== null) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const reportFilename = (kind, week) => `${KINDS[kind].title} - ${weekLabel(week.start, week.end).replace(/[^\w ,.-]/g, '-')}.pdf`;

module.exports = { reportPdf, reportFilename, KINDS, weekLabel };
