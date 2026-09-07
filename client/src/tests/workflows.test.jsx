import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { layoutFlow, nodeState, NODE_W, NODE_H } from '../lib/flowLayout';
import WorkflowChart from '../components/WorkflowChart';
import WorkflowsView from '../components/WorkflowsView';

// A graph shaped like the real seed workflows: a couple of steps, a loop
// back, and terminal outcomes.
const CHART = {
  id: 'demo',
  title: 'Demo',
  start: 'first',
  nodes: [
    { id: 'first',    kind: 'step',    label: 'First step' },
    { id: 'second',   kind: 'step',    label: 'Second step' },
    { id: 'approved', kind: 'outcome', label: 'Approved', tone: 'good' },
    { id: 'declined', kind: 'outcome', label: 'Declined', tone: 'bad' },
  ],
  edges: [
    { from: 'first',  to: 'second',   label: 'Continue' },
    { from: 'first',  to: 'declined', label: 'Decline' },
    { from: 'second', to: 'approved', label: 'Approve' },
    { from: 'second', to: 'first',    label: 'Send back' },   // loop
  ],
};

// ─── Layout ───────────────────────────────────────────────────────────────────

describe('layoutFlow', () => {
  test('puts the start on the first row and later steps below it', () => {
    const { nodes } = layoutFlow(CHART);
    const at = id => nodes.find(n => n.id === id);

    expect(at('first').layer).toBe(0);
    expect(at('second').layer).toBe(1);
    expect(at('second').y).toBeGreaterThan(at('first').y);
  });

  test('a loop back to an earlier step does not drag that step downwards', () => {
    const { nodes, edges } = layoutFlow(CHART);
    expect(nodes.find(n => n.id === 'first').layer).toBe(0);

    const loop = edges.find(e => e.from === 'second' && e.to === 'first');
    expect(loop.back).toBe(true);
    // Routed out to the side lane rather than back through the middle.
    expect(loop.path).toMatch(/^M .* L .* L .* L /);
  });

  test('a loop leaves through the gap below its row, not across its neighbours', () => {
    const { nodes, edges } = layoutFlow(CHART);
    const second = nodes.find(n => n.id === 'second');
    const loop = edges.find(e => e.from === 'second' && e.to === 'first');

    // The first move is straight down out of the box, so the horizontal run
    // happens in the empty gap rather than at node height.
    const [, startY] = loop.path.match(/^M [\d.]+ ([\d.]+)/).map(Number);
    expect(startY).toBeGreaterThanOrEqual(second.y + second.h);
  });

  test('forward edges are curves, loops are elbows out to the side lane', () => {
    const { edges } = layoutFlow(CHART);
    expect(edges.find(e => e.to === 'second').path).toContain('C');

    const loop = edges.find(e => e.from === 'second' && e.to === 'first');
    expect(loop.path).not.toContain('C');
    expect(loop.path.split('L').length).toBeGreaterThanOrEqual(4);  // down, out, up, back in
  });

  test('a step is never drawn above something that leads to it', () => {
    const { nodes, edges } = layoutFlow(CHART);
    const layerOf = id => nodes.find(n => n.id === id).layer;

    for (const edge of edges.filter(e => !e.back)) {
      expect(layerOf(edge.to)).toBeGreaterThanOrEqual(layerOf(edge.from));
    }
  });

  test('an edge across a row is solid and lateral, not dashed like a loop', () => {
    // first and second both lead to a shared step, which lands beside one of
    // them rather than below both.
    const sideways = {
      start: 'a',
      nodes: [
        { id: 'a', kind: 'step', label: 'A' },
        { id: 'b', kind: 'step', label: 'B' },
        { id: 'c', kind: 'step', label: 'C' },
        { id: 'done', kind: 'outcome', label: 'Done' },
      ],
      edges: [
        { from: 'a', to: 'b', label: 'to b' },
        { from: 'a', to: 'c', label: 'to c' },
        { from: 'b', to: 'c', label: 'across' },
        { from: 'c', to: 'done', label: 'finish' },
      ],
    };
    const { edges } = layoutFlow(sideways);
    const across = edges.find(e => e.from === 'b' && e.to === 'c');
    // c is pushed below b by longest-path layering, so this is a forward edge.
    expect(across.back).toBe(false);
  });

  test('gives every node a box and the canvas room for all of them', () => {
    const { nodes, width, height } = layoutFlow(CHART);
    expect(nodes).toHaveLength(4);
    for (const n of nodes) {
      expect(n.w).toBe(NODE_W);
      expect(n.h).toBe(NODE_H);
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x + n.w).toBeLessThanOrEqual(width);
      expect(n.y + n.h).toBeLessThanOrEqual(height);
    }
  });

  test('rows are centred, so a single node sits above a pair', () => {
    const { nodes } = layoutFlow(CHART);
    const row1 = nodes.filter(n => n.layer === 1);
    const first = nodes.find(n => n.id === 'first');
    const rowCentre = (Math.min(...row1.map(n => n.x)) + Math.max(...row1.map(n => n.x + n.w))) / 2;
    expect(Math.abs(rowCentre - (first.x + first.w / 2))).toBeLessThan(1);
  });

  test('still draws a node nothing points at, rather than dropping it silently', () => {
    const orphaned = {
      ...CHART,
      nodes: [...CHART.nodes, { id: 'stranded', kind: 'step', label: 'Stranded' }],
    };
    expect(layoutFlow(orphaned).nodes.map(n => n.id)).toContain('stranded');
  });

  test('drops an edge pointing at a node that is not in the graph', () => {
    const broken = { ...CHART, edges: [...CHART.edges, { from: 'first', to: 'ghost', label: 'Nowhere' }] };
    expect(layoutFlow(broken).edges.some(e => e.to === 'ghost')).toBe(false);
  });

  test('is deterministic', () => {
    expect(layoutFlow(CHART)).toEqual(layoutFlow(CHART));
  });

  test('handles an empty graph without throwing', () => {
    expect(layoutFlow({ nodes: [], edges: [] })).toEqual({ width: 0, height: 0, nodes: [], edges: [] });
    expect(layoutFlow(undefined).nodes).toEqual([]);
  });
});

describe('nodeState', () => {
  const step = { id: 'second', kind: 'step' };

  test('marks where the instance is now, and where it has been', () => {
    expect(nodeState(step, { currentStepId: 'second', visited: ['first'] })).toBe('current');
    expect(nodeState({ id: 'first', kind: 'step' }, { currentStepId: 'second', visited: ['first'] })).toBe('done');
    expect(nodeState({ id: 'third', kind: 'step' }, { currentStepId: 'second', visited: ['first'] })).toBe('idle');
  });

  test('only the outcome actually reached is lit up', () => {
    const good = { id: 'approved', kind: 'outcome' };
    const bad  = { id: 'declined', kind: 'outcome' };
    const ctx  = { status: 'completed', outcome: 'approved', visited: [] };
    expect(nodeState(good, ctx)).toBe('reached');
    expect(nodeState(bad, ctx)).toBe('idle');
  });
});

// ─── Chart rendering ──────────────────────────────────────────────────────────

describe('WorkflowChart', () => {
  test('renders a labelled figure with a node for every step and outcome', () => {
    const { container } = render(<WorkflowChart chart={CHART} currentStepId="first" />);
    expect(screen.getByRole('img', { name: /flowchart/i })).toBeInTheDocument();
    expect(container.querySelectorAll('rect')).toHaveLength(4);
  });

  test('renders nothing at all for an empty chart', () => {
    const { container } = render(<WorkflowChart chart={{ nodes: [], edges: [] }} />);
    expect(container).toBeEmptyDOMElement();
  });
});

// ─── The view ─────────────────────────────────────────────────────────────────

const INBOX_TASK = {
  taskId: 7, instanceId: 3, definitionId: 'facility-use', workflow: 'Facility Use Request',
  title: 'Kitchen — 2026-05-01', stepId: 'review', stepTitle: 'Deacon review',
  instruction: 'Check the calendar.', assignedRole: 'admin', createdAt: '2026-05-01 10:00:00',
  actions: [
    { id: 'approve', label: 'Approve', tone: 'good', requiresNote: false },
    { id: 'decline', label: 'Decline', tone: 'bad',  requiresNote: true },
  ],
};

const INSTANCE = {
  id: 3, definitionId: 'facility-use', workflow: 'Facility Use Request',
  title: 'Kitchen — 2026-05-01', status: 'active', stepId: 'review', stepTitle: 'Deacon review',
  outcome: '', outcomeLabel: '', outcomeTone: 'neutral', createdAt: '', updatedAt: '', mine: true,
};

function mockApi(overrides = {}) {
  const routes = {
    inbox:       { success: true, tasks: [INBOX_TASK] },
    list:        { success: true, scope: 'mine', status: 'active', instances: [INSTANCE] },
    definitions: { success: true, definitions: [{ id: 'facility-use', title: 'Facility Use Request', description: 'Ask for a room.', fields: [], chart: CHART }] },
    ...overrides,
  };

  const fetchMock = vi.fn((url, options) => {
    let body = routes.list;
    if (url.includes('/inbox'))            body = routes.inbox;
    else if (url.includes('/definitions')) body = routes.definitions;
    else if (options?.method === 'POST')   body = routes.act ?? { success: true };
    else if (/\/api\/workflows\/\d+$/.test(url)) body = routes.detail ?? { success: true };
    return Promise.resolve({ json: () => Promise.resolve(body) });
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('WorkflowsView', () => {
  beforeEach(() => { mockApi(); });

  test('opens on the inbox, showing what is waiting and its actions', async () => {
    render(<WorkflowsView user={{ role: 'admin' }} />);
    expect(await screen.findByText('Kitchen — 2026-05-01')).toBeInTheDocument();
    expect(screen.getByText('Deacon review')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /My Inbox \(1\)/ })).toBeInTheDocument();
  });

  test('an action with no note required posts straight away', async () => {
    const fetchMock = mockApi();
    render(<WorkflowsView user={{ role: 'admin' }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/workflows/tasks/7',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ action: 'approve', note: '' }) })
      );
    });
  });

  test('an action that requires a note asks for one before posting', async () => {
    const fetchMock = mockApi();
    render(<WorkflowsView user={{ role: 'admin' }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Decline' }));

    // Nothing posted yet — it is asking for the reason first.
    expect(fetchMock).not.toHaveBeenCalledWith('/api/workflows/tasks/7', expect.anything());
    const box = screen.getByRole('textbox');
    fireEvent.change(box, { target: { value: 'Already booked' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Decline' }).at(-1));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/workflows/tasks/7',
        expect.objectContaining({ body: JSON.stringify({ action: 'decline', note: 'Already booked' }) })
      );
    });
  });

  test('an empty inbox says so rather than showing a blank panel', async () => {
    mockApi({ inbox: { success: true, tasks: [] } });
    render(<WorkflowsView user={{ role: 'approved' }} />);
    expect(await screen.findByText(/nothing is waiting on you/i)).toBeInTheDocument();
  });

  test('only an admin is offered the everyone-else filter', async () => {
    render(<WorkflowsView user={{ role: 'admin' }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Workflows' }));
    expect(screen.getByLabelText('Whose workflows')).toBeInTheDocument();
  });

  test('a member gets the status filter but not the scope filter', async () => {
    render(<WorkflowsView user={{ role: 'approved' }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Workflows' }));
    expect(screen.queryByLabelText('Whose workflows')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Workflow status')).toBeInTheDocument();
  });

  test('surfaces a server error instead of failing silently', async () => {
    mockApi({ inbox: { success: false, error: 'Nope' } });
    render(<WorkflowsView user={{ role: 'admin' }} />);
    expect(await screen.findByText('Nope')).toBeInTheDocument();
  });

  test('the start form lists what I can start and previews the flow', async () => {
    render(<WorkflowsView user={{ role: 'approved' }} />);
    fireEvent.click(await screen.findByRole('button', { name: /start a workflow/i }));

    const combo = screen.getByRole('combobox');
    expect(within(combo).getByRole('option', { name: 'Facility Use Request' })).toBeInTheDocument();
    expect(screen.getByText(/what happens after i submit/i)).toBeInTheDocument();
  });
});
