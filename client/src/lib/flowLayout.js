// Lays a workflow graph out top-to-bottom: each layer is a row, the steps
// within a layer sit side by side. Vertical reads better than horizontal for
// a process, and it survives a narrow phone column far better.
//
// Pure and deterministic — given the same graph it always produces the same
// coordinates, which is what makes it testable without rendering anything.

export const NODE_W = 172;
export const NODE_H = 58;
export const H_GAP  = 28;
export const V_GAP  = 52;
export const PAD    = 16;
// Room to the right of the widest layer for edges that loop backwards.
export const BACK_EDGE_LANE = 34;

// Which edges loop backwards. Found by a depth-first walk: an edge into a node
// still open on the current path is the one closing a cycle, so it is the one
// to draw as a loop rather than letting it dictate the rows.
function findBackEdges(nodes, edges, start) {
  const outgoing = new Map(nodes.map(n => [n.id, []]));
  for (const e of edges) if (outgoing.has(e.from) && outgoing.has(e.to)) outgoing.get(e.from).push(e.to);

  const back = new Set();
  const state = new Map();   // undefined = unseen, 1 = on the path, 2 = finished

  const visit = id => {
    state.set(id, 1);
    for (const next of outgoing.get(id) || []) {
      if (state.get(next) === 1) back.add(`${id} ${next}`);
      else if (!state.has(next)) visit(next);
    }
    state.set(id, 2);
  };

  const first = start && outgoing.has(start) ? start : nodes[0]?.id;
  if (first !== undefined) visit(first);
  for (const node of nodes) if (!state.has(node.id)) visit(node.id);

  return back;
}

// Rows by longest path, ignoring loops: a step sits below *every* step that
// can lead to it, not just the first one found. Without this a node could be
// drawn above one of its own predecessors, with the arrow running upwards.
function assignLayers(nodes, edges, start, backEdges) {
  const forward = edges.filter(e => !backEdges.has(`${e.from} ${e.to}`));
  const layer = new Map(nodes.map(n => [n.id, 0]));

  // Relaxing |nodes| times is enough for a DAG; the guard is belt and braces
  // in case an odd graph slips a cycle past the back-edge pass.
  for (let pass = 0; pass < nodes.length; pass++) {
    let moved = false;
    for (const e of forward) {
      if (!layer.has(e.from) || !layer.has(e.to)) continue;
      const wanted = layer.get(e.from) + 1;
      if (wanted > layer.get(e.to)) { layer.set(e.to, wanted); moved = true; }
    }
    if (!moved) break;
  }

  return layer;
}

// Orders the nodes within each row so edges cross as little as possible, by
// pulling each node towards the average position of what points at it.
function orderRows(rows, rowIndexes, edges) {
  const position = new Map();
  rowIndexes.forEach(l => rows.get(l).forEach((n, i) => position.set(n.id, i)));

  for (let pass = 0; pass < 4; pass++) {
    for (const l of rowIndexes.slice(1)) {
      const row = rows.get(l);
      const barycentre = new Map(row.map((node, i) => {
        const parents = edges
          .filter(e => e.to === node.id && position.has(e.from))
          .map(e => position.get(e.from));
        return [node.id, parents.length ? parents.reduce((a, b) => a + b, 0) / parents.length : i];
      }));

      row.sort((a, b) => barycentre.get(a.id) - barycentre.get(b.id));
      row.forEach((n, i) => position.set(n.id, i));
    }
  }
}

export function layoutFlow(graph) {
  const nodes = graph?.nodes ?? [];
  const edges = graph?.edges ?? [];
  if (!nodes.length) return { width: 0, height: 0, nodes: [], edges: [] };

  const backEdges = findBackEdges(nodes, edges, graph.start);
  const layer = assignLayers(nodes, edges, graph.start, backEdges);

  // Group by row, keeping declaration order within a row for stability.
  const rows = new Map();
  for (const node of nodes) {
    const l = layer.get(node.id) ?? 0;
    if (!rows.has(l)) rows.set(l, []);
    rows.get(l).push(node);
  }

  const rowIndexes = [...rows.keys()].sort((a, b) => a - b);
  orderRows(rows, rowIndexes, edges.filter(e => !backEdges.has(`${e.from} ${e.to}`)));
  const widest = Math.max(...rowIndexes.map(l => rows.get(l).length));
  const contentW = widest * NODE_W + (widest - 1) * H_GAP;

  const placed = new Map();
  const laidOut = [];

  for (const l of rowIndexes) {
    const row = rows.get(l);
    const rowW = row.length * NODE_W + (row.length - 1) * H_GAP;
    const offset = PAD + (contentW - rowW) / 2;   // centre each row

    row.forEach((node, i) => {
      const box = {
        ...node,
        layer: l,
        x: offset + i * (NODE_W + H_GAP),
        y: PAD + rowIndexes.indexOf(l) * (NODE_H + V_GAP),
        w: NODE_W,
        h: NODE_H,
      };
      placed.set(node.id, box);
      laidOut.push(box);
    });
  }

  const width  = contentW + PAD * 2 + BACK_EDGE_LANE;
  const height = rowIndexes.length * NODE_H + (rowIndexes.length - 1) * V_GAP + PAD * 2;

  const routed = edges
    .map(edge => {
      const from = placed.get(edge.from);
      const to   = placed.get(edge.to);
      if (!from || !to) return null;      // an edge to a node we never drew

      // Only an edge that genuinely closes a loop is drawn as one. An edge
      // across a row is a sideways move, not a repeat, and drawing it dashed
      // would claim the workflow goes backwards when it does not.
      const back    = backEdges.has(`${edge.from} ${edge.to}`);
      const lateral = !back && to.layer === from.layer;

      const path = back    ? backPath(from, to, width)
                 : lateral ? lateralPath(from, to)
                 :           forwardPath(from, to);

      return { ...edge, back, lateral, path, label: edge.label };
    })
    .filter(Boolean);

  return { width, height, nodes: laidOut, edges: routed };
}

// A gentle S-curve from the bottom of one box to the top of the next, so
// edges that change column do not cut diagonally across other boxes.
function forwardPath(from, to) {
  const x1 = from.x + from.w / 2;
  const y1 = from.y + from.h;
  const x2 = to.x + to.w / 2;
  const y2 = to.y;
  const mid = y1 + (y2 - y1) / 2;
  return `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`;
}

// A move across a row: out of one side and into the facing side of the other,
// bowed slightly so it does not sit flat on top of the boxes.
function lateralPath(from, to) {
  const rightwards = to.x > from.x;
  const x1 = rightwards ? from.x + from.w : from.x;
  const x2 = rightwards ? to.x : to.x + to.w;
  const y  = from.y + from.h / 2;
  const dip = y + 14;
  return `M ${x1} ${y} C ${(x1 + x2) / 2} ${dip}, ${(x1 + x2) / 2} ${dip}, ${x2} ${to.y + to.h / 2}`;
}

// A loop back to an earlier step drops into the gap below its row, runs out to
// a lane on the right, then climbs back up. Leaving from the side at node
// height would take it straight through whatever sits beside it, which reads
// as an edge joining those two boxes instead.
function backPath(from, to, width) {
  const lane   = width - BACK_EDGE_LANE / 2;
  const exitX  = from.x + from.w - 14;
  const gapY   = from.y + from.h + V_GAP / 2;
  const enterX = to.x + to.w;
  const enterY = to.y + to.h / 2;
  return `M ${exitX} ${from.y + from.h} L ${exitX} ${gapY} L ${lane} ${gapY} L ${lane} ${enterY} L ${enterX} ${enterY}`;
}

// What state to draw a node in, given where the instance has got to.
export function nodeState(node, { currentStepId, visited = [], outcome, status }) {
  if (node.kind === 'outcome') {
    return status === 'completed' && node.id === outcome ? 'reached' : 'idle';
  }
  if (node.id === currentStepId) return 'current';
  if (visited.includes(node.id)) return 'done';
  return 'idle';
}
