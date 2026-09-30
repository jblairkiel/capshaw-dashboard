// server/lib/flowLayout.js is a copy of the client's layout (the server cannot
// import client modules). This keeps it one: the code between the markers must
// be the client file with its `export`s taken off.
const fs = require('fs');
const path = require('path');
const layout = require('../lib/flowLayout');

test('the server copy of the flowchart layout matches the client\'s', () => {
  const client = fs.readFileSync(path.join(__dirname, '../../client/src/lib/flowLayout.js'), 'utf8')
    .replace(/^export /gm, '').trim();
  const server = fs.readFileSync(path.join(__dirname, '../lib/flowLayout.js'), 'utf8');
  const copy = server.split('// ── copied from client/src/lib/flowLayout.js ──')[1].split('// ── end of copy ──')[0].trim();
  expect(copy).toBe(client);
});

test('lays a small chart out top to bottom', () => {
  const { nodes, edges, height } = layout.layoutFlow({
    start: 'a',
    nodes: [{ id: 'a', kind: 'step', label: 'A' }, { id: 'b', kind: 'outcome', label: 'B' }],
    edges: [{ from: 'a', to: 'b' }],
  });
  expect(nodes[1].y).toBeGreaterThan(nodes[0].y);
  expect(edges[0].path).toMatch(/^M /);
  expect(height).toBeGreaterThan(0);
});
