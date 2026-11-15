import assert from "node:assert/strict";
import { CELL_FIELDS } from "../src/core/CellState";
import { WorldSaveSystem } from "../src/world/save/WorldSaveSystem";

const graph = {
  nodes: [{
    id: "node-1",
    type: "process",
    category: "Process",
    label: "Source node",
    position: { x: 1, y: 2 },
    parameters: { nested: { coefficient: 0.75 } },
    inputs: [],
    outputs: [],
    enabled: true,
    metadata: { description: "fixture", color: "#ffffff" },
  }],
  edges: [],
  metadata: {
    name: "Creator graph",
    version: "1.0.0",
    author: "test",
    timestamp: 1,
  },
};

const graphNestedParameters = graph.nodes[0].parameters.nested as { coefficient: number };

const grid = {
  W: 1,
  H: 1,
  D: 1,
  size: 1,
  buffer: new Float32Array(CELL_FIELDS),
  totalField: () => 0,
};

const lawEngine = {
  laws: [],
  activeProcessMask: 0,
  applyGraphPlan() {},
};

const saves = new WorldSaveSystem(grid, lawEngine, null, {
  graphProvider: () => graph,
  getEntities: () => [],
  getCivs: () => [],
});

const snapshot = saves.captureSnapshot("ownership-fixture");
assert.ok(snapshot.realityGraph);
assert.notEqual(snapshot.realityGraph, graph);
assert.notEqual(snapshot.realityGraph.nodes, graph.nodes);
assert.notEqual(snapshot.realityGraph.nodes[0].parameters, graph.nodes[0].parameters);
const snapshotNestedParameters = snapshot.realityGraph.nodes[0].parameters.nested as { coefficient: number };

graphNestedParameters.coefficient = 9;
graph.nodes.push({ ...graph.nodes[0], id: "later-node" });
graph.metadata.name = "Mutated live graph";

assert.equal(snapshotNestedParameters.coefficient, 0.75,
  "later nested Creator parameter edits must not mutate an already captured world snapshot");
assert.equal(snapshot.realityGraph.nodes.length, 1,
  "later Creator node insertions must not mutate an already captured world snapshot");
assert.equal(snapshot.realityGraph.metadata.name, "Creator graph",
  "later Creator metadata edits must not mutate an already captured world snapshot");

snapshot.realityGraph.nodes[0].parameters.nested.coefficient = 0.25;
assert.equal(graph.nodes[0].parameters.nested.coefficient, 9,
  "editing a detached snapshot must not mutate the live Creator graph");

console.log("World snapshot Creator graph ownership and detachment: PASS");
