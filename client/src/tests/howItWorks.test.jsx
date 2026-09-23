import { render, screen } from '@testing-library/react';
import { describe, test, expect, vi, afterEach } from 'vitest';
import HowItWorksView, { PERMISSIONS_FLOW, ROSTER_INPUTS_FLOW, BUG_REPORT_FLOW } from '../components/HowItWorksView';
import { wrap } from '../components/WorkflowChart';

// The hand-drawn diagrams (permissions, roster inputs, bug reports) need no
// data and should always be there. The two workflow diagrams are drawn from
// whatever the server currently defines, so they only appear once that load
// resolves — and degrade quietly if it does not.

const DEFINITIONS = [
  {
    id: 'worship-schedule', page: 'assignments', title: 'Monthly Worship Schedule',
    chart: {
      id: 'worship-schedule', title: 'Monthly Worship Schedule', start: 'review',
      nodes: [
        { id: 'review', kind: 'step', label: 'Review the draft' },
        { id: 'published', kind: 'outcome', tone: 'good', label: 'Published to the roster' },
        { id: 'cancelled', kind: 'outcome', tone: 'neutral', label: 'Abandoned' },
      ],
      edges: [{ from: 'review', to: 'published' }, { from: 'review', to: 'cancelled' }],
    },
  },
  {
    id: 'visitor-follow-up', page: 'visitors', title: 'Guest Follow-Up',
    chart: {
      id: 'visitor-follow-up', title: 'Guest Follow-Up', start: 'reach-out',
      nodes: [
        { id: 'reach-out', kind: 'step', label: 'Reach out' },
        { id: 'contacted', kind: 'outcome', tone: 'good', label: 'Contacted' },
      ],
      edges: [{ from: 'reach-out', to: 'contacted' }],
    },
  },
];

function mockDefinitions(definitions = DEFINITIONS) {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
    json: () => Promise.resolve({ success: true, definitions }),
  })));
}

afterEach(() => { vi.unstubAllGlobals(); });

// WorkflowChart wraps a label onto at most two lines and silently drops
// whatever does not fit — no ellipsis, no warning. Every hand-drawn label on
// this page has to fit inside that, or a word just vanishes off the diagram.
describe('the hand-drawn charts fit WorkflowChart’s label limit', () => {
  const charts = { PERMISSIONS_FLOW, ROSTER_INPUTS_FLOW, BUG_REPORT_FLOW };

  for (const [chartName, chart] of Object.entries(charts)) {
    for (const node of chart.nodes) {
      test(`${chartName} → "${node.label}" is not truncated`, () => {
        const words = node.label.split(/\s+/);
        const wrapped = wrap(node.label).join(' ').split(/\s+/);
        expect(wrapped).toEqual(words);
      });
    }
  }
});

describe('HowItWorksView', () => {
  test('the hand-drawn diagrams render without waiting on anything', () => {
    mockDefinitions();
    render(<HowItWorksView />);

    expect(screen.getByRole('img', { name: 'Flowchart for How permissions work' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Flowchart for What feeds the roster' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Flowchart for Reporting a problem' })).toBeInTheDocument();
  });

  test('every area is named, so the permissions section stays complete on its own', () => {
    mockDefinitions();
    render(<HowItWorksView />);
    expect(screen.getByText('Worship Order')).toBeInTheDocument();
    expect(screen.getByText('Serving Schedule')).toBeInTheDocument();
    expect(screen.getByText('Weekly Newsletter')).toBeInTheDocument();
  });

  test('the live workflow charts appear once the definitions load', async () => {
    mockDefinitions();
    render(<HowItWorksView />);

    expect(await screen.findByRole('img', { name: 'Flowchart for Monthly Worship Schedule' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Flowchart for Guest Follow-Up' })).toBeInTheDocument();
  });

  test('a workflow nobody may currently start is simply left out, not shown broken', async () => {
    mockDefinitions([DEFINITIONS[1]]);
    render(<HowItWorksView />);

    await screen.findByRole('img', { name: 'Flowchart for Guest Follow-Up' });
    expect(screen.queryByRole('img', { name: 'Flowchart for Monthly Worship Schedule' })).not.toBeInTheDocument();
  });

  test('a failed load still leaves the rest of the page usable', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network error'))));
    render(<HowItWorksView />);

    expect(screen.getByRole('img', { name: 'Flowchart for How permissions work' })).toBeInTheDocument();
    // Give the failed fetch a tick to settle, then confirm neither live chart appears.
    await new Promise(r => setTimeout(r, 0));
    expect(screen.queryByRole('img', { name: 'Flowchart for Monthly Worship Schedule' })).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Flowchart for Guest Follow-Up' })).not.toBeInTheDocument();
  });
});
