import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const root = new URL('../', import.meta.url);

async function moduleUrl(path, replacements = []) {
  const source = await readFile(new URL(path, root), 'utf8');
  let js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const [from, to] of replacements) js = js.replaceAll(from, to);
  return `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`;
}

const compilerUrl = await moduleUrl('src/creator/GraphCompiler.ts');
const graphUrl = await moduleUrl('src/creator/RealityGraph.ts', [
  ["'./GraphCompiler'", `'${compilerUrl}'`],
]);
const { RealityGraph } = await import(graphUrl);

const node = (id = 'node-a') => ({
  id,
  type: 'field.energy',
  category: 'Field',
  label: 'Energy',
  position: { x: 12, y: 24 },
  parameters: { field: 'energy' },
  inputs: [],
  outputs: [{ id: 'out-energy', name: 'energy', type: 'field', direction: 'output' }],
  enabled: true,
  metadata: { description: 'Energy field', color: '#ef8f3f', gpuCost: 1 },
});
const validGraph = () => ({
  nodes: [node()],
  edges: [],
  metadata: { name: 'Test graph', version: '1.0.0', author: 'test', timestamp: 1 },
});

const graph = new RealityGraph();
graph.load(validGraph());
const before = structuredClone(graph.toJSON());

const invalidCandidates = [
  [null, /expected nodes, edges and metadata/],
  [{ ...validGraph(), nodes: 'not-an-array' }, /expected nodes, edges and metadata/],
  [{ ...validGraph(), nodes: [node(), node()] }, /duplicate node ID/],
  [{ ...validGraph(), nodes: [{ ...node(), position: { x: Number.NaN, y: 0 } }] }, /finite x\/y coordinates/],
  [{ ...validGraph(), nodes: [{ ...node(), parameters: [] }] }, /parameters must be an object/],
  [{ ...validGraph(), nodes: [{ ...node(), enabled: 1 }] }, /enabled must be a boolean/],
  [{ ...validGraph(), nodes: [{ ...node(), inputs: [{ id: 'bad', name: 'bad', type: 'field', direction: 'output' }] }] }, /direction must be input/],
  [{ ...validGraph(), nodes: [{ ...node(), outputs: [
    { id: 'dup', name: 'one', type: 'field', direction: 'output' },
    { id: 'dup', name: 'two', type: 'field', direction: 'output' },
  ] }] }, /duplicate output port ID/],
  [{ ...validGraph(), edges: [
    { id: 'edge-1', source: 'node-a', sourcePort: 'out-energy', target: 'node-a', targetPort: 'missing' },
    { id: 'edge-1', source: 'node-a', sourcePort: 'out-energy', target: 'node-a', targetPort: 'missing' },
  ] }, /duplicate edge ID/],
  [{ ...validGraph(), metadata: { name: 'bad', version: '1', author: 'test', timestamp: Infinity } }, /timestamp must be finite/],
];

for (const [candidate, pattern] of invalidCandidates) {
  assert.throws(() => graph.load(candidate), pattern);
  assert.deepEqual(graph.toJSON(), before,
    'a malformed graph must not replace any part of the currently active graph');
}

const callerOwned = validGraph();
graph.load(callerOwned);
callerOwned.nodes[0].position.x = 999;
callerOwned.nodes[0].parameters.field = 'corrupted';
assert.equal(graph.nodes[0].position.x, 12, 'loaded nodes must be detached from caller-owned objects');
assert.equal(graph.nodes[0].parameters.field, 'energy', 'nested node parameters must be detached');

// Structural loading must not reject semantic edge problems; the compiler owns diagnostics.
const inspectable = validGraph();
inspectable.edges = [{
  id: 'dangling-edge',
  source: 'node-a',
  sourcePort: 'not-a-real-port',
  target: 'missing-node',
  targetPort: 'missing-port',
}];
graph.load(inspectable);
const plan = graph.compileToPipeline();
assert.ok(plan.issues.some(issue => issue.edgeId === 'dangling-edge'),
  'semantically invalid references must remain available to GraphCompiler diagnostics');

console.log('RealityGraph structural validation and fail-closed load regression: PASS');
