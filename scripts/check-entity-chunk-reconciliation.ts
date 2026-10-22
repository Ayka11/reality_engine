import assert from "node:assert/strict";
import { VoxelGrid } from "../src/core/VoxelGrid.ts";
import { CELL_FIELDS, F } from "../src/core/CellState.ts";
import { EntityChunkConnectivity } from "../src/infinity/EntityChunkConnectivity.ts";
import type { InfinityScaleChunkExecutionContext } from "../src/infinity/InfinityScaleChunkExecutionContext.ts";
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
const plan = planner.plan([component], [entity], incompleteConnectivity);

assert.equal(plan.commitReady, false, "incomplete mixed-LOD coverage must block commit");
assert.deepEqual(plan.ambiguousMixedLodComponents, [4], "boundary component must be marked ambiguous even with zero observed source IDs");
assert.equal(plan.proposals[0]?.safeToCommit, false, "ambiguous component must remain pending");
assert.deepEqual(plan.extinctEntityIds, [], "unresolved topology must never infer entity extinction");
assert.equal(planner.commitRecords(plan, [component]), null, "incomplete mixed-LOD plan must not yield commit records");

const noSnapshotPlan = planner.plan([component], [entity], {
  ...incompleteConnectivity,
  mixedLodCoverageComplete: false,
});
assert.equal(noSnapshotPlan.commitReady, false, "missing boundary evidence must fail closed");
assert.deepEqual(noSnapshotPlan.extinctEntityIds, [], "missing boundary evidence must suppress extinction");

const completeButConflictingConnectivity: EntityChunkConnectivityResult = {
  ...incompleteConnectivity,
  mixedLodCoverageComplete: true,
  mixedLodTopology: [
    { localCell: 10, neighborCell: [11, 0, 0], sourceChunk: "1:1,0,0", relation: "coarse-to-fine", occupied: true, sourceEntityId: 101 },
    { localCell: 10, neighborCell: [12, 0, 0], sourceChunk: "1:2,0,0", relation: "fine-to-coarse", occupied: true, sourceEntityId: 102 },
  ],
};
const conflictingPlan = planner.plan([component], [entity], completeButConflictingConnectivity);
assert.equal(conflictingPlan.commitReady, false, "conflicting mixed-LOD source identities must block commit even with complete coverage");
assert.deepEqual(conflictingPlan.ambiguousMixedLodComponents, [4], "multiple mixed-LOD source identities must remain ambiguous");
assert.deepEqual(conflictingPlan.extinctEntityIds, [], "conflicting topology must suppress extinction");
assert.equal(planner.commitRecords(conflictingPlan, [component]), null, "conflicting mixed-LOD plan must not yield commit records");

const mergeComponent: EntityChunkComponent = {
  id: 9,
  cells: [10, 11],
  centroid: [10.5, 0, 0],
  touchesSimulationBoundary: false,
  touchesReadBoundary: false,
  touchesMixedLODBoundary: false,
};
const mergeEntities = [
  { ...entity, id: 201, cells: [10], centroid: [10, 0, 0] },
  { ...entity, id: 202, cells: [11], centroid: [11, 0, 0] },
] as Entity[];
const mergePlan = planner.plan([mergeComponent], mergeEntities);
assert.equal(mergePlan.proposals[0]?.continuity, "merge", "overlapping source identities must be recognized as a merge");
assert.equal(mergePlan.proposals[0]?.safeToCommit, false, "merge must fail closed without authoritative domain evidence");
assert.equal(mergePlan.commitReady, false, "an unverified merge must block the aggregate commit");
assert.deepEqual(mergePlan.extinctEntityIds, [], "unverified merge must never extinguish source entities");
assert.equal(planner.commitRecords(mergePlan, [mergeComponent]), null, "unverified merge must not produce commit records");


const closedComponent: EntityChunkComponent = {
  id: 5,
  cells: [0],
  centroid: [0, 0, 0],
  touchesSimulationBoundary: false,
  touchesReadBoundary: false,
  touchesMixedLODBoundary: false,
};
const partialDomainPlan = planner.plan([closedComponent], [entity], {
  components: [closedComponent],
  closedComponentCount: 1,
  boundaryComponentCount: 0,
  openReadComponentCount: 0,
  mixedLodComponentCount: 0,
  mixedLodTopology: [],
  mixedLodCoverageComplete: true,
});
assert.deepEqual(partialDomainPlan.extinctEntityIds, [], "extinction must remain disabled without authoritative domain evidence");
assert.equal(partialDomainPlan.commitReady, true, "closed non-merge component may be planned without claiming global domain coverage");


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

console.log("Entity chunk reconciliation boundary safety: PASS");
