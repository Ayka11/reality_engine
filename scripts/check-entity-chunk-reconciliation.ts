import assert from "node:assert/strict";
import { VoxelGrid } from "../src/core/VoxelGrid.ts";
import { CELL_FIELDS, F } from "../src/core/CellState.ts";
import { EntityChunkConnectivity } from "../src/infinity/EntityChunkConnectivity.ts";
import type { InfinityScaleChunkExecutionContext } from "../src/infinity/InfinityScaleChunkExecutionContext.ts";

const connectivityGrid = new VoxelGrid(2, 1, 1);
connectivityGrid.buffer[0 * CELL_FIELDS + F.BIO_POTENTIAL] = 1;
connectivityGrid.buffer[1 * CELL_FIELDS + F.BIO_POTENTIAL] = 1;
const twoAdjacentRanges = {
  simulationRanges: [
    { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 },
    { minX: 1, maxX: 1, minY: 0, maxY: 0, minZ: 0, maxZ: 0 },
  ],
  getBoundaryTransferSpecsForCell: () => [],
  containsReadCell: () => false,
  containsSimulationCell: (x: number, y: number, z: number) =>
    (x === 0 || x === 1) && y === 0 && z === 0,
} as unknown as InfinityScaleChunkExecutionContext;

const connectivity = new EntityChunkConnectivity().analyze(
  connectivityGrid,
  twoAdjacentRanges,
);
assert.equal(connectivity.components.length, 1, "adjacent occupied cells across simulation ranges must stitch into one component");
assert.equal(connectivity.components[0]?.cells.length, 2, "cross-range stitching must preserve both cells");

const singletonGrid = new VoxelGrid(1, 1, 1);
singletonGrid.buffer[F.BIO_POTENTIAL] = 1;
const singletonContext = {
  simulationRanges: [
    { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 },
  ],
  getBoundaryTransferSpecsForCell: () => [],
  containsReadCell: () => false,
  containsSimulationCell: () => true,
} as unknown as InfinityScaleChunkExecutionContext;
const singletonConnectivity = new EntityChunkConnectivity().analyze(
  singletonGrid,
  singletonContext,
);
assert.equal(singletonConnectivity.components.length, 1, "isolated occupied cell must remain visible as a singleton component");
assert.deepEqual(singletonConnectivity.components[0]?.cells, [0], "singleton component must preserve its cell index");

import { EntityChunkReconciliation } from "../src/infinity/EntityChunkReconciliation.ts";
import type { EntityChunkComponent, EntityChunkConnectivityResult } from "../src/infinity/EntityChunkConnectivity.ts";
import type { Entity } from "../src/simulation/EntityLayer.ts";

const component: EntityChunkComponent = {
  id: 4,
  cells: [10],
  centroid: [10, 0, 0],
  touchesSimulationBoundary: true,
  touchesReadBoundary: false,
  touchesMixedLODBoundary: true,
};

const entity = {
  id: 77,
  cells: [999],
  centroid: [100, 100, 100],
} as unknown as Entity;

const incompleteConnectivity: EntityChunkConnectivityResult = {
  components: [component],
  closedComponentCount: 0,
  boundaryComponentCount: 1,
  openReadComponentCount: 0,
  mixedLodComponentCount: 1,
  mixedLodTopology: [],
  mixedLodCoverageComplete: false,
};

const planner = new EntityChunkReconciliation();
const plan = planner.plan([component], [entity], true, incompleteConnectivity);

assert.equal(plan.commitReady, false, "incomplete mixed-LOD coverage must block commit");
assert.deepEqual(plan.ambiguousMixedLodComponents, [4], "boundary component must be marked ambiguous even with zero observed source IDs");
assert.equal(plan.proposals[0]?.safeToCommit, false, "ambiguous component must remain pending");
assert.deepEqual(plan.extinctEntityIds, [], "unresolved topology must never infer entity extinction");

const noSnapshotPlan = planner.plan([component], [entity], true, {
  ...incompleteConnectivity,
  mixedLodCoverageComplete: false,
});
assert.equal(noSnapshotPlan.commitReady, false, "missing boundary evidence must fail closed");
assert.deepEqual(noSnapshotPlan.extinctEntityIds, [], "missing boundary evidence must suppress extinction");

console.log("Entity chunk reconciliation boundary safety: PASS");
