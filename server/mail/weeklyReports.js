// ─── The weekly reports, by email ─────────────────────────────────────────────
//
// The Weekly Summary and the Weekly Analytical Report (lib/reportPdf.js), each
// sent once a week as a PDF to whoever holds its area — Weekly Summary Report
// or Weekly Analytical Report. A report nobody holds goes to the admins, so it
// is never sent to nobody.
//
// An admin sets the day and time for each (default Sunday, 3 PM church time)
// on the Settings tab of Reports & Record Keeping, or turns one off. A report
// covers the week ending on the Saturday before it is sent — or that day's own
// week, when it is sent on a Saturday.
//
// Each send is claimed in scheduled_jobs against the moment it was due, so
// ticking every few minutes, or two servers ticking at once, never sends a
// report twice; a server that was down when one was due sends it on its next
// tick.

const db = require('../db');
const mailer = require('./mailer');
const { link } = require('./notify');
const weekly = require('../lib/weeklyReport');
const { reportPdf, reportFilename, KINDS, weekLabel } = require('../lib/reportPdf');
const { churchToday, addDays } = require('../lib/recordKeeping');

const AREAS = { summary: 'summary-report', analytical: 'analytical-report' };
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const jobName = kind => `weekly-report:${kind}`;

// ─── Settings ─────────────────────────────────────────────────────────────────

function settings() {
  return db.prepare('SELECT kind, weekday, send_time AS time, enabled, updated_at AS updatedAt, updated_by AS updatedBy FROM report_settings ORDER BY kind DESC').all()
    .filter(r => KINDS[r.kind])
    .map(r => ({ ...r, enabled: !!r.enabled, title: KINDS[r.kind].title, area: AREAS[r.kind], lastSent: lastSent(r.kind) }));
}

function settingFor(kind) {
  return settings().find(s => s.kind === kind) || null;
}

function lastSent(kind) {
  return db.prepare('SELECT last_run_at FROM scheduled_jobs WHERE name = ?').get(jobName(kind))?.last_run_at || null;
}

// Church time, now: the date, the day of the week and the minute of the day.
function churchNow(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
  }).formatToParts(now).map(p => [p.type, p.value]));
  const today = churchToday(now);
  return { today, weekday: new Date(`${today}T12:00:00Z`).getUTCDay(), minute: Number(parts.hour) * 60 + Number(parts.minute) };
}

const minuteOf = time => { const [h, m] = time.split(':').map(Number); return h * 60 + m; };

// The date of the most recent moment this report was due, at or before now.
function lastDue(setting, now = new Date()) {
  const { today, weekday, minute } = churchNow(now);
  let back = (weekday - setting.weekday + 7) % 7;
  if (back === 0 && minute < minuteOf(setting.time)) back = 7;
  return addDays(today, -back);
}

function updateSetting(kind, { weekday, time, enabled }, user) {
  const current = settingFor(kind);
  if (!current) return { error: 'No such report', status: 404 };
  const next = {
    weekday: weekday === undefined ? current.weekday : Number(weekday),
    time: time === undefined ? current.time : String(time),
    enabled: enabled === undefined ? current.enabled : !!enabled,
  };
  if (!Number.isInteger(next.weekday) || next.weekday < 0 || next.weekday > 6) return { error: 'Choose a day of the week' };
  if (!TIME.test(next.time)) return { error: 'Give the time as hours and minutes, like 15:00' };
  db.prepare(`
    UPDATE report_settings SET weekday = ?, send_time = ?, enabled = ?, updated_at = datetime('now'), updated_by = ? WHERE kind = ?
  `).run(next.weekday, next.time, next.enabled ? 1 : 0, user?.name || '', kind);
  // Moving the day or time must not set it off at once: the moment just
  // passed under the new setting counts as done, so the next send is the
  // next one due.
  db.prepare(`
    INSERT INTO scheduled_jobs (name, last_key, last_run_at) VALUES (?, ?, NULL)
    ON CONFLICT(name) DO UPDATE SET last_key = excluded.last_key
  `).run(jobName(kind), lastDue(next));
  return { before: current, setting: settingFor(kind) };
}

// ─── Who gets it ──────────────────────────────────────────────────────────────

function recipients(kind) {
  const holders = db.prepare(`
    SELECT u.name, u.email FROM users u JOIN user_areas a ON a.user_id = u.id
     WHERE a.area = ? AND u.role = 'approved' AND u.email IS NOT NULL AND u.email <> ''
  `).all(AREAS[kind]);
  if (holders.length) return holders;
  return db.prepare("SELECT name, email FROM users WHERE role = 'admin' AND email IS NOT NULL AND email <> ''").all();
}

// ─── The message ──────────────────────────────────────────────────────────────

const num = n => (n === null || n === undefined ? '—' : Math.round(n).toLocaleString('en-US'));
const money = n => (n === null || n === undefined ? '—' : `$${Math.round(n).toLocaleString('en-US')}`);
const esc = mailer.escapeHtml;

const compose = {};

compose.weeklyReport = ({ kind, data }) => {
  const { week } = data;
  const range = weekLabel(week.start, week.end);
  const title = KINDS[kind].title;
  const head = week.attendance.headline;
  const lines = [
    head ? `${head.service}: ${num(head.count)}${head.avg4 ? ` (4-week average ${num(head.avg4)})` : ''}` : null,
    week.giving.amount !== null ? `Contribution: ${money(week.giving.amount)}` : null,
    `Guests: ${num(week.guests.visits)}`,
    `Members on the portal: ${num(week.portal.members)}`,
  ].filter(Boolean);
  const url = link('record-keeping', { tab: kind === 'summary' ? 'summary' : 'analytical' });
  const body = [
    `The ${title} for ${range} is attached, with the week on the first page${kind === 'analytical' ? 's' : ''} and the year so far after it.`,
    '',
    'At a glance:',
    ...lines.map(l => `  • ${l}`),
    '',
    `The same report, for any week, is on the portal: ${url}`,
    '',
    `You are getting this because you receive the ${title}.`,
  ].join('\n');
  const html = `<div style="font-family:Helvetica,Arial,sans-serif;color:#1f2937;max-width:560px;line-height:1.5">
  <p style="margin:0 0 4px;color:#c9a84c;font-size:11px;font-weight:bold;letter-spacing:.04em">CAPSHAW CHURCH OF CHRIST</p>
  <h2 style="margin:0 0 2px;color:#1a2744;font-size:20px">${esc(title)}</h2>
  <p style="margin:0 0 16px;color:#6b7280;font-size:14px">${esc(range)}</p>
  <p style="margin:0 0 12px">The report is attached as a PDF: the week first, then the year so far.</p>
  <table style="border-collapse:collapse;margin:0 0 16px">${lines.map(l => {
    const [k, ...v] = l.split(': ');
    return `<tr><td style="padding:3px 16px 3px 0;color:#52514e">${esc(k)}</td><td style="padding:3px 0;font-weight:bold">${esc(v.join(': '))}</td></tr>`;
  }).join('')}</table>
  <p style="margin:0 0 24px"><a href="${esc(url)}" style="display:inline-block;background:#1a2744;color:#ffffff;padding:8px 16px;border-radius:6px;text-decoration:none;font-size:14px">See it on the portal</a></p>
  <p style="color:#9ca3af;font-size:12px;margin:0">You are getting this because you receive the ${esc(title)}.</p>
</div>`;
  return { subject: `${title}: ${range}`, body, html };
};

// ─── Sending ──────────────────────────────────────────────────────────────────

// Builds and queues one report, for the week holding `date` (the week just
// ended by default). Returns who it went to.
function sendReport(kind, { date, to } = {}) {
  const data = weekly.build(date ? { date } : {});
  const people = to || recipients(kind);
  if (!people.length) return { kind, week: data.week.start, sent: 0 };
  const attachment = mailer.saveAttachment({
    buffer: reportPdf(kind, data), filename: reportFilename(kind, data.week), contentType: 'application/pdf',
  });
  // Spelled out per report, so the Emails page can tell the two apart.
  const message = kind === 'summary'
    ? { context: `weekly-report:summary:${data.week.start}` }
    : { context: `weekly-report:analytical:${data.week.start}` };
  const queued = mailer.send({
    to: people,
    ...compose.weeklyReport({ kind, data }),
    ...message,
    attachments: [attachment],
  });
  return { kind, week: data.week.start, sent: queued.length };
}

// The Saturday ending the week a report sent on `due` covers: that day itself
// on a Saturday, otherwise the Saturday before.
function weekEndingFor(weekday, due) {
  return weekday === 6 ? due : addDays(due, -(weekday + 1));
}

// Called on a timer. Sends each report that has come due and not yet gone.
function tick(now = new Date()) {
  const results = [];
  for (const setting of settings()) {
    if (!setting.enabled) continue;
    const due = lastDue(setting, now);
    const last = db.prepare('SELECT last_key FROM scheduled_jobs WHERE name = ?').get(jobName(setting.kind));
    if (last?.last_key === due) continue;
    // Never on first start-up for a moment that passed long before the
    // reports existed: only one due within the last week counts.
    if (!last) {
      db.prepare("INSERT INTO scheduled_jobs (name, last_key, last_run_at) VALUES (?, ?, NULL)").run(jobName(setting.kind), due);
      continue;
    }
    // Claimed before it is built, so a second process finds it taken.
    const claimed = db.prepare(`
      UPDATE scheduled_jobs SET last_key = ?, last_run_at = datetime('now') WHERE name = ? AND last_key IS NOT ?
    `).run(due, jobName(setting.kind), due);
    if (!claimed.changes) continue;
    // A report sent on a Saturday is that week's; any other day, the week just ended.
    results.push(sendReport(setting.kind, { date: weekEndingFor(setting.weekday, due) }));
  }
  return results;
}

module.exports = { compose, settings, settingFor, updateSetting, recipients, sendReport, tick, lastDue, weekEndingFor, AREAS, WEEKDAYS };
