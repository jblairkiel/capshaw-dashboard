import { num, pct, money, compactMoney, dayMonth, monthTick, changeCell } from './format';
import {
  Section, Table, Heatmap, RankedBars, Columns, WeekdayColumns,
} from './charts';
import { DidRow } from './SummaryReport';

// The Weekly Analytical Report on the page: the same tables and charts as the
// PDF (server/lib/reportPdf.js → analyticalWeek, analyticalWeekPortal,
// analyticalYear, analyticalYearPortal), names included.

function Keepers({ p }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Section title="Records kept, by area" note={`${num(p.changes)} changes`}>
        <Table cols={[{ title: 'Area' }, { title: 'Changes', align: 'right' }]} rows={p.changesByArea.map(a => [a.label, num(a.changes)])} empty="Nothing changed." />
      </Section>
      <Section title="Busiest record keepers" note={`${num(p.changedBy)} people`}>
        <Table cols={[{ title: 'Name', bold: true }, { title: 'Changes', align: 'right' }, { title: 'Areas', align: 'right' }]}
          rows={p.keepers.map(k => [k.name, num(k.changes), num(k.areas)])} empty="Nobody made a change." />
      </Section>
    </div>
  );
}

function PagesTable({ pages }) {
  return (
    <Table cols={[{ title: 'Page' }, { title: 'Opened', align: 'right', bold: true }, { title: 'Members', align: 'right' }]}
      rows={pages.map(pg => [pg.label, num(pg.views), num(pg.people)])} empty="No pages counted yet." />
  );
}

export function AnalyticalWeek({ week }) {
  const p = week.portal;
  return (
    <div className="space-y-4">
      <Section title="Attendance" note="against the 4 weeks before, and the same week last year">
        <Table cols={[{ title: 'Service' }, { title: 'This week', align: 'right', bold: true }, { title: '4-week avg', align: 'right' }, { title: 'Change', align: 'right' }, { title: 'Last year', align: 'right' }, { title: 'Change', align: 'right' }]}
          rows={week.attendance.services.map(s => [s.service, num(s.count), num(s.avg4), changeCell(s.count, s.avg4), num(s.lastYear), changeCell(s.count, s.lastYear)])}
          empty="No attendance recorded this week." />
      </Section>

      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Contribution">
          <Table cols={[{ title: '' }, { title: '', align: 'right' }]} rows={[
            ['This week', { v: money(week.giving.amount), bold: true }],
            ['Average of the 4 weeks before', money(week.giving.avg4)],
            ['Change', changeCell(week.giving.amount, week.giving.avg4)],
          ]} />
        </Section>
        <Section title="Member roll call">
          <Table cols={[{ title: 'Roll' }, { title: 'Present', align: 'right' }, { title: 'Rate', align: 'right' }]}
            rows={week.roll.rolls.map(r => [`${dayMonth(r.date)} · ${r.service}`, `${r.present} / ${r.marked}`, pct(r.marked ? (r.present / r.marked) * 100 : null)])}
            empty="No roll call was taken this week." />
        </Section>
      </div>

      <Section title={`Guests (${week.guests.visits})`} note={`${week.guests.firstTime} first time · ${week.guests.returning} returning`}>
        <Table cols={[{ title: 'Name', bold: true }, { title: 'When' }, { title: 'Visit' }, { title: 'Invited by' }, { title: 'From' }]}
          rows={week.guests.list.map(g => [g.name, `${dayMonth(g.date)} · ${g.service}`, g.firstTime ? 'First time' : 'Returning', g.invitedBy || '—', g.place || '—'])}
          empty="No guests recorded this week." />
      </Section>

      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Members missing 3 or more in a row">
          <Table cols={[{ title: 'Name', bold: true }, { title: 'Missed', align: 'right' }, { title: 'Last here', align: 'right' }]}
            rows={week.roll.missing.map(m => [m.name, `${m.missed} in a row`, m.lastPresent ? dayMonth(m.lastPresent) : 'not this year'])}
            empty="Nobody has missed three in a row." />
        </Section>
        <Section title={`Serving: ${week.serving.filled} of ${week.serving.jobs} jobs filled`}>
          <Table cols={[{ title: 'Open job', bold: true }, { title: 'When' }]}
            rows={week.serving.open.map(j => [{ v: j.job, tone: 'warn' }, `${dayMonth(j.date)} · ${j.service}`])}
            empty={week.serving.jobs ? 'Every job was filled.' : 'Nothing on the serving schedule this week.'} />
        </Section>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Group meetings">
          <Table cols={[{ title: 'Meeting' }, { title: 'Day' }, { title: 'Came', align: 'right' }, { title: 'Said yes', align: 'right' }]}
            rows={week.meetings.map(m => [`${m.group}: ${m.title}`, dayMonth(m.date), num(m.headCount), num(m.rsvpYes)])} empty="No group meetings this week." />
        </Section>
        <Section title="Songs sung">
          {week.songs.length ? week.songs.map(s => (
            <div key={s.id} className="mb-2">
              <p className="text-xs font-semibold text-gray-600">{dayMonth(s.iso)} · {s.service}{s.leader ? ` · led by ${s.leader}` : ''}</p>
              <p className="text-sm text-gray-700">{s.songs.join(' · ')}</p>
            </div>
          )) : <p className="text-sm text-gray-400">No songs recorded yet.</p>}
        </Section>
      </div>

      <Section title="Guest follow-ups">
        <p className="text-sm text-gray-700">
          {week.followUps.started} started, {week.followUps.reached} reached, {week.followUps.unreached} could not be reached, {week.followUps.open} still open.
          Memory verses said in class: {week.engagement.versesScored}.
        </p>
      </Section>

      <h3 className="section-heading pt-2">The week on the portal</h3>
      <div className="grid gap-4 md:grid-cols-2">
        <Section title="On the portal" note={`${num(p.accounts)} have an account`}>
          <Table cols={[{ title: '' }, { title: 'This week', align: 'right', bold: true }, { title: '4-week avg', align: 'right' }]} rows={[
            ['Members who used the portal', num(p.members), num(p.avg4)],
            ['\u00a0\u00a0\u00a0on a phone', num(p.onPhone), ''], ['\u00a0\u00a0\u00a0on a computer', num(p.onComputer), ''],
            ['Pages opened', num(p.pageViews), ''], ['Changes made', num(p.changes), ''],
            ['Inactive 30+ days', p.inactiveCount === null ? '—' : num(p.inactiveCount), ''],
          ]} />
        </Section>
        <Section title="Busiest days" note="members each day"><WeekdayColumns days={p.weekdays.days} /></Section>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Each day">
          <Table cols={[{ title: 'Day' }, { title: 'Members', align: 'right', bold: true }, { title: 'Phone', align: 'right' }, { title: 'Computer', align: 'right' }, { title: 'Pages', align: 'right' }]}
            rows={p.daily.map(dd => [`${dd.weekday.slice(0, 3)}, ${dayMonth(dd.date)}`, num(dd.members), num(dd.phone), num(dd.computer), num(dd.opens)])} />
        </Section>
        <Section title="Pages opened" note="times · members"><PagesTable pages={p.pages} /></Section>
      </div>
      <Section title="What members did"><DidRow did={p.did} /></Section>
      <Keepers p={p} />
      <Section title={p.inactive === null ? 'Inactive 30+ days' : `Inactive 30+ days (${p.inactive.length})`} note="members with an account not on the portal in 30 days">
        {p.inactive === null
          ? <p className="text-sm text-gray-400">Listed once the portal has counted 30 days of visits.</p>
          : <Table cols={[{ title: 'Name', bold: true }, { title: 'Last on', align: 'right' }]}
              rows={p.inactive.map(m => [m.name, m.lastVisit ? dayMonth(m.lastVisit) : 'not since counting began'])}
              empty="Every member has used the portal in the last 30 days." />}
      </Section>
    </div>
  );
}

export function AnalyticalYear({ year }) {
  const p = year.portal;
  const portalWeeks = p.since ? p.weeks.filter(w => w.start >= p.since.slice(0, 10) || w.members) : [];
  return (
    <div className="space-y-4">
      <Section title="Attendance by service" note="a week's total for each service">
        <Table cols={[{ title: 'Service' }, { title: 'Average', align: 'right', bold: true }, { title: 'High', align: 'right' }, { title: 'Low', align: 'right' }, { title: 'Weeks', align: 'right' }, { title: 'Last year avg', align: 'right' }, { title: 'Change', align: 'right' }]}
          rows={year.attendance.services.map(s => [s.service, num(s.average), num(s.high), num(s.low), num(s.services), num(s.lastYear), changeCell(s.average, s.lastYear)])} />
      </Section>
      <Section title="Every week, every service" note="darker means more people">
        <Heatmap weeks={year.attendance.weeks} services={year.attendance.serviceNames} />
      </Section>
      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Contributions by month" note={`${money(year.giving.total)} so far`}>
          <RankedBars rows={year.giving.byMonth.map(m => ({ label: m.month, value: m.amount }))} format={compactMoney} />
          <p className="text-xs text-gray-600 mt-2">Weekly average {money(year.giving.average)} · last year to this date {money(year.giving.lastYearToDate)}</p>
        </Section>
        <Section title="Guests and roll call by month" note={`${pct(year.guests.returnRate)} of guests came back`}>
          <Table cols={[{ title: 'Month' }, { title: 'First time', align: 'right' }, { title: 'Returning', align: 'right' }, { title: 'Roll call', align: 'right' }]}
            rows={year.guests.byMonth.map((m, i) => [m.month, num(m.firstTime), num(m.returning), pct(year.roll.byMonth[i]?.rate)])} />
        </Section>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Ten most-sung songs" note={`${num(year.songs.distinct)} different in ${num(year.songs.services)} services`}>
          <RankedBars rows={year.songs.top.map(s => ({ label: s.title, value: s.count }))} />
        </Section>
        <Section title="Group meetings by group" note={`${num(year.groups.meetings)} meetings`}>
          <Table cols={[{ title: 'Group' }, { title: 'Meetings', align: 'right' }, { title: 'People', align: 'right' }]} rows={year.groups.byGroup.map(g => [g.group, num(g.meetings), num(g.people)])} empty="No group meetings yet." />
        </Section>
      </div>
      <Section title="Serving and follow-ups">
        <p className="text-sm text-gray-700">
          Serving: {num(year.serving.filled)} of {num(year.serving.jobs)} jobs filled ({pct(year.serving.fillRate)}) by {num(year.serving.people)} men.
          Follow-ups: {num(year.followUps.finished)} finished, {num(year.followUps.reached)} reached ({pct(year.followUps.rate)}).
          Memory verses said in class: {num(year.engagement.versesScored)}.
        </p>
      </Section>

      <h3 className="section-heading pt-2">The year on the portal</h3>
      <Section title="Month by month" note={p.since ? `visits and pages counted since ${dayMonth(p.since)}` : 'visits not counted yet'}>
        <Table cols={[{ title: 'Month' }, { title: 'Members', align: 'right', bold: true }, { title: 'Member-days', align: 'right' }, { title: 'Pages opened', align: 'right' }, { title: 'Changes made', align: 'right' }]}
          rows={p.byMonth.map(m => [m.month, m.members ? num(m.members) : '—', m.visits ? num(m.visits) : '—', m.opens ? num(m.opens) : '—', num(m.changes)])} />
        <p className="text-xs text-gray-400 mt-1">Members: how many used the portal that month. Member-days: each member counted once for each day they used it.</p>
      </Section>
      <div className="grid gap-4 md:grid-cols-[1.6fr_1fr]">
        <Section title="Members on the portal, each week" note={p.weeklyAverage ? `average ${num(p.weeklyAverage)}` : ''}>
          {portalWeeks.length ? <Columns values={portalWeeks.map(w => w.members)} labels={portalWeeks.map(w => monthTick(w.start))} average={p.weeklyAverage} height={100} /> : <p className="text-sm text-gray-400">Not counted yet.</p>}
        </Section>
        <Section title="Busiest days"><WeekdayColumns days={p.weekdays.days} /></Section>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Pages opened" note={`${num(p.pageViews)} in all`}><PagesTable pages={p.pages} /></Section>
        <Section title="What members did this year">
          <Table cols={[{ title: '' }, { title: '', align: 'right', bold: true }]} rows={[
            ['RSVPs to group meetings', num(p.did.rsvps)], ['Song requests', num(p.did.songRequests)], ['Bible Quiz games', num(p.did.quizGames)],
            ['Members who practised memory verses', num(p.did.versePracticers)], ['Sign-ups', num(p.did.signups)], ['Comments', num(p.did.comments)], ['Emails sent', num(p.did.emails)],
          ]} />
        </Section>
      </div>
      <Keepers p={p} />
    </div>
  );
}
