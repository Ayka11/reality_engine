import assert from "node:assert/strict";
import { VoxelGrid } from "../src/core/VoxelGrid.ts";
import { CELL_FIELDS, F } from "../src/core/CellState.ts";
import { EntityChunkConnectivity } from "../src/infinity/EntityChunkConnectivity.ts";
import type { InfinityScaleChunkExecutionContext } from "../src/infinity/InfinityScaleChunkExecutionContext.ts";
import { EntityChunkReconciliation } from "../src/infinity/EntityChunkReconciliation.ts";
import type { EntityChunkComponent, EntityChunkConnectivityResult } from "../src/infinity/EntityChunkConnectivity.ts";
import { EntityLayer, type Entity } from "../src/simulation/EntityLayer.ts";
import { assertCompleteEntityDomain, assertEntityDomainRevision, captureEntityDomainInventory, EntityDomainInventoryAuthority } from "../src/infinity/EntityDomainInventory.ts";

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


// Exercise the production EntityLayer tick transaction, not just the pure planner.
function makeEntityTickScenario() {
  const grid = new VoxelGrid(8, 8, 1);
  const layer = new EntityLayer();
  layer.setRandomSeed(0x12345678);
  for (const index of [9, 10, 17, 18]) {
    grid.buffer[index * CELL_FIELDS + F.BIO_POTENTIAL] = 1;
    grid.buffer[index * CELL_FIELDS + F.ENERGY] = 200;
  }
  layer.tick(grid, 1 / 60);
  const entity = layer.getEntities()[0];
  assert.ok(entity, "fixture must create a real EntityLayer entity");
  entity.age = 59;
  entity.genome.reproThreshold = 1;
  entity.energy = 321;
  for (const index of entity.cells) grid.buffer[index * CELL_FIELDS + F.ENERGY] = 200;
  return { grid, layer, entity };
}

const rollbackCase = makeEntityTickScenario();
const controlCase = makeEntityTickScenario();
const originalEntity = rollbackCase.entity;
const originalCellsRef = originalEntity.cells;
const originalCentroidRef = originalEntity.centroid;
const originalGenomeRef = originalEntity.genome;
const originalMemoryBufferRef = originalEntity.memoryBuffer;
const originalColorRef = originalEntity.colorRgb;
const beforeBuffer = Array.from(rollbackCase.grid.buffer);
const beforeEntity = {
  cells: originalEntity.cells.slice(),
  centroid: originalEntity.centroid.slice(),
  genome: { ...originalEntity.genome },
  age: originalEntity.age,
  energy: originalEntity.energy,
  stage: originalEntity.stage,
  memoryBuffer: Array.from(originalEntity.memoryBuffer),
  memPtr: originalEntity.memPtr,
  children: originalEntity.children,
  reproCounter: originalEntity.reproCounter,
};
const beforeSpawned = rollbackCase.layer.totalSpawned;
const beforeExtinct = rollbackCase.layer.extinctCount;
const rollbackInternals = rollbackCase.layer as unknown as {
  _spawnChild: (...args: unknown[]) => void;
};
const originalSpawnChild = rollbackInternals._spawnChild;
rollbackInternals._spawnChild = function (...args: unknown[]) {
  originalSpawnChild.apply(rollbackCase.layer, args);
  throw new Error("injected failure after reproduction mutation");
};
assert.throws(() => rollbackCase.layer.tick(rollbackCase.grid, 1 / 60), /injected failure/);
assert.deepEqual(Array.from(rollbackCase.grid.buffer), beforeBuffer, "failed tick must restore every grid field");
assert.equal(rollbackCase.layer.getEntities()[0], originalEntity, "rollback must preserve pre-existing entity object identity");
assert.equal(originalEntity.cells, originalCellsRef, "rollback must preserve cell-array identity");
assert.equal(originalEntity.centroid, originalCentroidRef, "rollback must preserve centroid-array identity");
assert.equal(originalEntity.genome, originalGenomeRef, "rollback must preserve genome-object identity");
assert.equal(originalEntity.memoryBuffer, originalMemoryBufferRef, "rollback must preserve memory-buffer identity");
assert.equal(originalEntity.colorRgb, originalColorRef, "rollback must preserve color-array identity");
assert.deepEqual(originalEntity.cells, beforeEntity.cells);
assert.deepEqual(originalEntity.centroid, beforeEntity.centroid);
assert.deepEqual(originalEntity.genome, beforeEntity.genome);
assert.equal(originalEntity.age, beforeEntity.age);
assert.equal(originalEntity.energy, beforeEntity.energy);
assert.equal(originalEntity.stage, beforeEntity.stage);
assert.deepEqual(Array.from(originalEntity.memoryBuffer), beforeEntity.memoryBuffer);
assert.equal(originalEntity.memPtr, beforeEntity.memPtr);
assert.equal(originalEntity.children, beforeEntity.children);
assert.equal(originalEntity.reproCounter, beforeEntity.reproCounter);
assert.equal(rollbackCase.layer.totalSpawned, beforeSpawned, "failed tick must restore identity counter");
assert.equal(rollbackCase.layer.extinctCount, beforeExtinct, "failed tick must restore extinction counter");

rollbackInternals._spawnChild = originalSpawnChild;
rollbackCase.layer.tick(rollbackCase.grid, 1 / 60);
controlCase.layer.tick(controlCase.grid, 1 / 60);
assert.deepEqual(
  Array.from(rollbackCase.grid.buffer),
  Array.from(controlCase.grid.buffer),
  "retry after rollback must reproduce the same grid as a clean deterministic tick",
);
const serializeEntities = (layer: EntityLayer) => layer.getEntities().map(entity => ({
  ...entity,
  memoryBuffer: Array.from(entity.memoryBuffer),
}));
assert.deepEqual(
  serializeEntities(rollbackCase.layer),
  serializeEntities(controlCase.layer),
  "retry after rollback must reproduce entity identities and state",
);
console.log("EntityLayer atomic tick rollback and deterministic RNG replay: PASS");


// Revision-bound authoritative inventory contract: immutable snapshot, stale
// revision rejection, and fail-closed global operations on partial worksets.
const inventoryRevision4 = captureEntityDomainInventory({
  scopeId: "world:alpha",
  revision: 4,
  completeness: "complete",
  entityIds: [12, 3],
  occupiedCells: [8, 2, 5],
});
assert.deepEqual(inventoryRevision4.entityIds, [3, 12], "inventory IDs must be canonicalized");
assert.deepEqual(inventoryRevision4.occupiedCells, [2, 5, 8], "inventory cells must be canonicalized");
assert.equal(Object.isFrozen(inventoryRevision4), true, "captured inventory record must be frozen");
assert.equal(Object.isFrozen(inventoryRevision4.entityIds), true, "captured entity IDs must be frozen");
assert.equal(Object.isFrozen(inventoryRevision4.occupiedCells), true, "captured occupied cells must be frozen");

const sameRevisionInventory = captureEntityDomainInventory({
  scopeId: "world:alpha",
  revision: 4,
  completeness: "complete",
  entityIds: [3, 12],
  occupiedCells: [2, 5, 8],
});
assert.doesNotThrow(() => assertEntityDomainRevision(inventoryRevision4, sameRevisionInventory));
const newerRevisionInventory = captureEntityDomainInventory({
  scopeId: "world:alpha",
  revision: 5,
  completeness: "complete",
  entityIds: [3, 12],
  occupiedCells: [2, 5, 8, 9],
});
assert.throws(() => assertEntityDomainRevision(inventoryRevision4, newerRevisionInventory), /Stale entity reconciliation plan/);
const otherScopeInventory = captureEntityDomainInventory({
  scopeId: "world:beta",
  revision: 4,
  completeness: "complete",
  entityIds: [3, 12],
  occupiedCells: [2, 5, 8],
});
assert.throws(() => assertEntityDomainRevision(inventoryRevision4, otherScopeInventory), /scope mismatch/);

const partialInventory = captureEntityDomainInventory({
  scopeId: "world:alpha",
  revision: 5,
  completeness: "partial",
  entityIds: [3],
  occupiedCells: [2, 5],
});
assert.throws(() => assertCompleteEntityDomain(partialInventory, "merge"), /partial domain inventory/);
assert.throws(() => assertCompleteEntityDomain(partialInventory, "extinction"), /partial domain inventory/);
assert.doesNotThrow(() => assertCompleteEntityDomain(inventoryRevision4, "merge"));
assert.doesNotThrow(() => assertCompleteEntityDomain(inventoryRevision4, "extinction"));
assert.throws(() => captureEntityDomainInventory({
  scopeId: "world:alpha", revision: 1, completeness: "complete",
  entityIds: [7, 7], occupiedCells: [0],
}), /duplicate entity IDs/);
console.log("Entity domain inventory revision and completeness contract: PASS");


// The authority owns a monotonic revision for its scope. Repeated identical
// observations are idempotent; any domain/completeness change invalidates plans.
const inventoryAuthority = new EntityDomainInventoryAuthority("world:runtime-test");
const authorityInitial = inventoryAuthority.snapshot();
assert.equal(authorityInitial.revision, 0);
assert.equal(authorityInitial.completeness, "partial");
const authorityFirst = inventoryAuthority.update({
  completeness: "complete",
  entityIds: [2, 1],
  occupiedCells: [7, 3],
});
assert.equal(authorityFirst.revision, 1, "first authoritative domain publication advances revision");
assert.deepEqual(authorityFirst.entityIds, [1, 2]);
const authorityNoOp = inventoryAuthority.update({
  completeness: "complete",
  entityIds: [1, 2],
  occupiedCells: [3, 7],
});
assert.equal(authorityNoOp, authorityFirst, "canonical identical publication must not advance revision");
const authorityChanged = inventoryAuthority.update({
  completeness: "complete",
  entityIds: [1, 2],
  occupiedCells: [3, 7, 8],
});
assert.equal(authorityChanged.revision, 2, "domain mutation must advance revision");
assert.throws(() => assertEntityDomainRevision(authorityFirst, inventoryAuthority.snapshot()), /Stale entity reconciliation plan/);
const authorityPartial = inventoryAuthority.update({
  completeness: "partial",
  entityIds: [1],
  occupiedCells: [3],
});
assert.equal(authorityPartial.revision, 3, "changing completeness invalidates existing plans");
assert.throws(() => assertCompleteEntityDomain(authorityPartial, "extinction"), /partial domain inventory/);
console.log("Entity domain inventory authority monotonic revisions: PASS");
