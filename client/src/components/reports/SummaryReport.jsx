import { C, num, pct, compactMoney, monthTick, dayMonth } from './format';
import {
  Delta, Sparkline, StatTile, Meter, Section, BulletRows, Columns, WeekdayColumns, RankedBars, RunningLine, StackedColumns,
} from './charts';

// The Weekly Summary on the page: the same figures and charts as the PDF
// (server/lib/reportPdf.js → summaryWeek, summaryYear).

function DidRow({ did }) {
  const items = [
    ['RSVPs', did.rsvps], ['Song requests', did.songRequests], ['Bible Quiz games', did.quizGames],
    ['Practised verses', did.versePracticers], ['Sign-ups', did.signups], ['Comments', did.comments], ['Emails sent', did.emails],
  ];
  return (
    <dl className="grid grid-cols-4 sm:grid-cols-7 gap-3">
      {items.map(([label, n]) => (
        <div key={label}>
          <dd className={`text-xl font-bold ${n ? 'text-gray-900' : 'text-gray-300'}`}>{num(n)}</dd>
          <dt className="text-[11px] text-gray-600">{label}</dt>
        </div>
      ))}
    </dl>
  );
}

export function SummaryWeek({ week, year }) {
  const head = week.attendance.headline;
  const p = week.portal;
  const trend = year.attendance.weeks.slice(-12).map(w => (head ? w.byService[head.service] || 0 : 0));
  const cards = [
    { title: 'Member roll call', big: pct(week.roll.rate), sub: week.roll.rate === null ? 'Not taken this week' : 'of members marked were present', meter: week.roll.rate },
    { title: 'Serving', big: week.serving.jobs ? `${week.serving.filled} of ${week.serving.jobs}` : '—', sub: week.serving.jobs ? `jobs filled · ${week.serving.open.length || 'none'} open` : 'No jobs on the schedule', meter: week.serving.jobs ? (week.serving.filled / week.serving.jobs) * 100 : null },
    { title: 'Group meetings', big: num(week.meetings.length), sub: week.meetings.length ? `${num(week.meetings.reduce((n, m) => n + (m.headCount || 0), 0))} people came` : 'None this week' },
    { title: 'Guest follow-ups', big: num(week.followUps.reached), sub: `reached this week · ${week.followUps.open} still open` },
  ];
  const songs = [...new Set(week.songs.flatMap(s => s.songs))];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr_1fr]">
        <StatTile onPage hero label={head ? `${head.service} attendance` : 'Attendance'} value={head ? num(head.count) : '—'}
          delta={head && <Delta now={head.count} then={head.avg4} against="the 4-week average" />}
          spark={<Sparkline values={trend} />} />
        <StatTile onPage label="Contribution" value={compactMoney(week.giving.amount ?? 0)} delta={<Delta now={week.giving.amount} then={week.giving.avg4} against="4-wk avg" />} />
        <StatTile onPage label="Guests" value={num(week.guests.visits)} note={week.guests.visits ? `${week.guests.firstTime} first time · ${week.guests.returning} returning` : 'No guests recorded'} />
      </div>

      <Section title="Attendance by service" note="bar: this week · line: average of the 4 weeks before">
        <BulletRows rows={week.attendance.services.map(s => ({ label: s.service, value: s.count, ref: s.avg4 }))} />
      </Section>

      <Section title="On the portal" note={`${num(p.accounts)} members have an account`}>
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr_1fr]">
          <div className="col-span-2 lg:col-span-1">
            <StatTile label="Members who used the portal" value={num(p.members)} delta={<Delta now={p.members} then={p.avg4} against="4-wk avg" />} spark={<Sparkline values={p.trend} width={90} />} />
          </div>
          <StatTile label="On a phone" value={pct(p.phoneShare)} note={p.members ? `${num(p.onPhone)} of ${num(p.members)} members` : ''}><Meter value={p.phoneShare} /></StatTile>
          <StatTile label="Changes made" value={num(p.changes)} note={`by ${num(p.changedBy)} keeping records`} />
          <StatTile label="Inactive 30+ days" value={p.inactiveCount === null ? '—' : num(p.inactiveCount)}
            note={p.inactiveCount === null ? 'counted once there are 30 days of visits' : `of ${num(p.accounts)} with an account`} />
        </div>
        <div className="grid gap-6 md:grid-cols-[1.5fr_1fr] mt-5">
          <div>
            <h4 className="text-sm font-semibold text-church-navy mb-2">Most-opened pages</h4>
            {p.pages.length ? <RankedBars rows={p.pages.slice(0, 6).map(pg => ({ label: pg.label, value: pg.views }))} /> : <p className="text-sm text-gray-400">No pages counted yet.</p>}
          </div>
          <div>
            <h4 className="text-sm font-semibold text-church-navy mb-2">Busiest days</h4>
            <WeekdayColumns days={p.weekdays.days} />
          </div>
        </div>
        <h4 className="text-sm font-semibold text-church-navy mt-5 mb-2">What members did</h4>
        <DidRow did={p.did} />
      </Section>

      <Section title="Around the congregation">
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          {cards.map(c => (
            <div key={c.title} className="rounded-xl bg-church-cream/70 px-4 py-3">
              <p className="text-xs text-gray-600">{c.title}</p>
              <p className="text-2xl font-bold">{c.big}</p>
              <p className="text-xs text-gray-400">{c.sub}</p>
              {c.meter !== undefined && c.meter !== null && <Meter value={c.meter} />}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Songs sung">
        <p className="text-sm text-gray-700">{songs.length ? songs.join(' · ') : 'No songs recorded yet this week.'}</p>
      </Section>
    </div>
  );
}

export function SummaryYear({ year }) {
  const main = [...year.attendance.services].sort((a, b) => (b.average || 0) - (a.average || 0))[0];
  const p = year.portal;
  const portalWeeks = p.since ? p.weeks.filter(w => w.start >= p.since.slice(0, 10) || w.members) : [];
  return (
    <div className="space-y-4">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <StatTile onPage label={main ? `Average ${main.service}` : 'Average attendance'} value={main ? num(main.average) : '—'} delta={main && <Delta now={main.average} then={main.lastYear} against="last year" />} />
        <StatTile onPage label="Contributions so far" value={compactMoney(year.giving.total)} delta={<Delta now={year.giving.total} then={year.giving.lastYearToDate} against="last year" />} />
        <StatTile onPage label="Guests so far" value={num(year.guests.unique)} note={`${pct(year.guests.returnRate)} came back again`} />
        <StatTile onPage label="Members on the portal" value={num(p.weeklyAverage)} note="in an average week" />
      </div>

      {main && (
        <Section title={`${main.service}, every week this year`} note="this week in blue">
          <Columns values={year.attendance.weeks.map(w => w.byService[main.service] || 0)} labels={year.attendance.weeks.map(w => monthTick(w.start))}
            titles={year.attendance.weeks.map(w => `Week of ${dayMonth(w.start)}:`)} average={main.average} />
        </Section>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Contributions, running total">
          <RunningLine values={year.giving.weeks.map(g => g.running)} compare={year.giving.lastYearToDate} endLabel={compactMoney(year.giving.total)} />
        </Section>
        <Section title="Guests by month">
          <StackedColumns rows={year.guests.byMonth} keys={['firstTime', 'returning']} names={['First time', 'Returning']} colors={[C.accent, C.second]} />
        </Section>
      </div>

      <div className="grid gap-4 md:grid-cols-[1.3fr_1fr_1.2fr]">
        <Section title="Members on the portal, each week" note={p.since ? `since ${dayMonth(p.since)}` : ''}>
          {portalWeeks.length ? <Columns values={portalWeeks.map(w => w.members)} labels={portalWeeks.map(w => monthTick(w.start))} average={p.weeklyAverage} height={90} /> : <p className="text-sm text-gray-400">Not counted yet.</p>}
        </Section>
        <Section title="Busiest days"><WeekdayColumns days={p.weekdays.days} /></Section>
        <Section title="Most-opened pages" note={`${num(p.pageViews)} in all`}>
          <RankedBars rows={p.pages.slice(0, 6).map(pg => ({ label: pg.label, value: pg.views }))} />
        </Section>
      </div>

      <Section title="Also this year">
        <dl className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          {[
            ['Serving jobs filled', year.serving.jobs ? pct(year.serving.fillRate) : '—', year.serving.jobs ? `${num(year.serving.filled)} of ${num(year.serving.jobs)} by ${num(year.serving.people)} men` : ''],
            ['Guests reached', year.followUps.finished ? pct(year.followUps.rate) : '—', `${num(year.followUps.reached)} of ${num(year.followUps.finished)} follow-ups`],
            ['Inactive 30+ days', p.inactiveCount === null ? '—' : num(p.inactiveCount), p.inactiveCount === null ? 'counted once there are 30 days of visits' : `of ${num(p.accounts)} with an account`],
            ['Changes on the portal', num(p.changes), `by ${num(p.changedBy)} keeping records`],
          ].map(([label, big, sub]) => (
            <div key={label}>
              <dt className="text-xs text-gray-600">{label}</dt>
              <dd className="text-2xl font-bold">{big}</dd>
              <dd className="text-xs text-gray-400">{sub}</dd>
            </div>
          ))}
        </dl>
        {year.songs.top.length > 0 && (
          <p className="text-xs text-gray-600 mt-4">
            Most-sung songs: {year.songs.top.slice(0, 3).map(t => `${t.title} (${t.count})`).join(' · ')} · {num(year.songs.distinct)} different songs in all
          </p>
        )}
      </Section>
    </div>
  );
}

export { DidRow };
