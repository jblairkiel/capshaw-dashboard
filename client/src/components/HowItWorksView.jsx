import { useState, useEffect } from 'react';
import { call } from '../lib/groups';
import { AREAS } from '../lib/roles';
import WorkflowChart from './WorkflowChart';

// ─── How It Works ──────────────────────────────────────────────────────────────
//
// One page, written for the person using the portal rather than the person
// building it: what actually moves data around here, and who is allowed to
// move it. Two of the diagrams below (Monthly Worship Schedule, Guest
// Follow-Up) are drawn straight from the live workflow definitions — change
// a step in server/workflows/definitions/ and the picture here changes with
// it, no separate diagram to remember to update.
//
// The rest of this page is not that automatic. Keep it current by hand:
// whenever a PR adds or renames an area (server/lib/areas.js), changes what
// feeds the Monthly Worship Schedule draft, or adds another flow that
// actually writes data (the way bug reports or time away do), touch the
// matching section below in the same PR.

// Small, hand-drawn diagrams for flows that are not a `workflow` — reusing
// the exact chart renderer the live workflows use below, so every diagram on
// this page reads as one system rather than two different styles of picture.
//
// WorkflowChart wraps a label onto at most two lines of ~22 characters and
// silently drops anything past that — there is no ellipsis, it just
// disappears. Every label below is written short enough to fit; if you
// lengthen one, check it against a real live workflow's step titles (all
// short, for the same reason) rather than trusting it will wrap cleanly.
export const PERMISSIONS_FLOW = {
  title: 'How permissions work',
  start: 'grant',
  nodes: [
    { id: 'grant',   kind: 'step', label: 'An admin grants you an area' },
    { id: 'hold',    kind: 'step', label: 'You hold that area' },
    { id: 'buttons', kind: 'step', label: 'Its Add/Edit buttons appear' },
    { id: 'logged',  kind: 'outcome', tone: 'good', label: 'Recorded in Action History' },
  ],
  edges: [
    { from: 'grant',   to: 'hold' },
    { from: 'hold',    to: 'buttons' },
    { from: 'buttons', to: 'logged' },
  ],
};

export const ROSTER_INPUTS_FLOW = {
  title: 'What feeds the roster',
  start: 'prefs',
  nodes: [
    { id: 'prefs',    kind: 'step', label: 'Everyone sets their preferences' },
    { id: 'away',     kind: 'step', label: 'Everyone marks their time away' },
    { id: 'generate', kind: 'step', label: 'The schedule keeper clicks Generate' },
    { id: 'draft',    kind: 'outcome', tone: 'neutral', label: 'See Monthly Worship Schedule below' },
  ],
  edges: [
    { from: 'prefs', to: 'generate' },
    { from: 'away',  to: 'generate' },
    { from: 'generate', to: 'draft' },
  ],
};

export const BUG_REPORT_FLOW = {
  title: 'Reporting a problem',
  start: 'report',
  nodes: [
    { id: 'report', kind: 'step', label: 'Anyone signed in reports a problem' },
    { id: 'notify', kind: 'step', label: 'Every admin is told' },
    { id: 'work',   kind: 'step', label: 'An admin updates the status' },
    { id: 'back',   kind: 'outcome', tone: 'good', label: 'You are told when it changes' },
  ],
  edges: [
    { from: 'report', to: 'notify' },
    { from: 'notify', to: 'work' },
    { from: 'work',   to: 'back' },
  ],
};

// Every step in a hand-drawn chart above shown in the same solid style,
// whatever order they were declared in — there is no "not reached yet" here,
// every box is simply a real part of how it works.
function allStepIds(chart) {
  return chart.nodes.filter(n => n.kind !== 'outcome').map(n => n.id);
}

function Diagram({ chart }) {
  return <WorkflowChart chart={chart} visited={allStepIds(chart)} />;
}

function Section({ title, children }) {
  return (
    <div className="card space-y-3">
      <h2 className="section-heading">{title}</h2>
      {children}
    </div>
  );
}

export default function HowItWorksView() {
  const [worshipChart, setWorshipChart]   = useState(null);
  const [followUpChart, setFollowUpChart] = useState(null);
  const [loaded, setLoaded]               = useState(false);

  useEffect(() => {
    call('/api/workflows/definitions')
      .then(json => {
        const byId = Object.fromEntries((json.definitions || []).map(d => [d.id, d]));
        setWorshipChart(byId['worship-schedule']?.chart || null);
        setFollowUpChart(byId['visitor-follow-up']?.chart || null);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-church-navy">How It Works</h1>
        <p className="text-sm text-gray-500 mt-1">
          What actually changes the schedule, the roster and the rest of the portal — and who
          is allowed to change it.
        </p>
      </div>

      <Section title="Who can do what">
        <p className="text-sm text-gray-600">
          The portal is not &ldquo;member&rdquo; versus &ldquo;admin&rdquo; for most of what happens day to day. Each
          part of the site — the songs, the announcements, the serving schedule — has its own
          area, and holding one only unlocks that one page. An admin holds every area at once;
          everyone else holds only what has been granted to them.
        </p>
        <Diagram chart={PERMISSIONS_FLOW} />
        <div className="flex flex-wrap gap-2 pt-1">
          {AREAS.map(a => (
            <span key={a.id} title={a.description} className={`text-xs px-2.5 py-1 rounded-full ${a.tone}`}>
              {a.label}
            </span>
          ))}
        </div>
      </Section>

      <Section title="How the Serving Schedule gets filled">
        <p className="text-sm text-gray-600">
          Nobody types names into next month&rsquo;s roster. It is built from what everyone has
          already said on <strong>My Household &amp; Preferences</strong> — glad to do it, willing,
          or would rather not — and the days people have marked as time away. Whoever holds
          Serving Schedule reviews the draft this produces and publishes it; nothing on the real
          roster moves until they do. The only other way a slot changes afterwards is the
          schedule keeper editing it by hand, or someone taking themselves off a slot they are
          down for.
        </p>
        <Diagram chart={ROSTER_INPUTS_FLOW} />
      </Section>

      {loaded && worshipChart && (
        <Section title="Monthly Worship Schedule">
          <p className="text-sm text-gray-600">
            Started from the <strong>Generate</strong> button at the top of the Serving Schedule
            page, by whoever holds that area. Regenerating tries a different, equally fair draft
            without touching the live roster; only Publish writes it and emails everyone who is
            serving.
          </p>
          <WorkflowChart chart={worshipChart} />
        </Section>
      )}

      {loaded && followUpChart && (
        <Section title="Guest Follow-Up">
          <p className="text-sm text-gray-600">
            Started from a guest&rsquo;s own row on the Guests page. Whoever is asked reaches out and
            says how it went — that is the end of it, or it loops back for another try if nobody
            answered.
          </p>
          <WorkflowChart chart={followUpChart} />
        </Section>
      )}

      <Section title="Reporting a problem">
        <p className="text-sm text-gray-600">
          The &ldquo;Report a problem&rdquo; link at the bottom of every page reaches every admin, whoever
          is signed in — a pending account included, since they can already see enough of the
          portal to hit something broken. You hear back through your own bell when it changes.
        </p>
        <Diagram chart={BUG_REPORT_FLOW} />
      </Section>
    </div>
  );
}
