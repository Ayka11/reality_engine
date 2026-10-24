import assert from "node:assert/strict";
import { VoxelGrid } from "../src/core/VoxelGrid.ts";
import { SparseVoxelGrid } from "../src/core/SparseVoxelGrid.ts";
import { CELL_FIELDS, F } from "../src/core/CellState.ts";
import { EntityChunkConnectivity } from "../src/infinity/EntityChunkConnectivity.ts";
import type { InfinityScaleChunkExecutionContext } from "../src/infinity/InfinityScaleChunkExecutionContext.ts";
import { EntityChunkReconciliation } from "../src/infinity/EntityChunkReconciliation.ts";
import type { EntityChunkComponent, EntityChunkConnectivityResult } from "../src/infinity/EntityChunkConnectivity.ts";
import { EntityLayer, type Entity } from "../src/simulation/EntityLayer.ts";
import { SimulationEngine } from "../src/simulation/SimulationEngine.ts";
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

// Guard against stack overflow when one connected component contains more
// cell indices than V8 can safely pass as one function's argument list.
const largeComponentWidth = 140_000;
const largeConnectivityGrid = new VoxelGrid(largeComponentWidth, 1, 1);
for (let cell = 0; cell < largeComponentWidth; cell++) {
  largeConnectivityGrid.buffer[cell * CELL_FIELDS + F.BIO_POTENTIAL] = 1;
}
const largeConnectivityContext = {
  simulationRanges: [{
    minX: 0, maxX: largeComponentWidth - 1,
    minY: 0, maxY: 0,
    minZ: 0, maxZ: 0,
  }],
  getBoundaryTransferSpecsForCell: () => [],
  containsReadCell: () => false,
  containsSimulationCell: (x: number, y: number, z: number) =>
    x >= 0 && x < largeComponentWidth && y === 0 && z === 0,
} as unknown as InfinityScaleChunkExecutionContext;
const largeComponentResult = new EntityChunkConnectivity().analyze(
  largeConnectivityGrid,
  largeConnectivityContext,
);
assert.equal(largeComponentResult.components.length, 1, "large occupied range must produce one connected component");
assert.equal(largeComponentResult.components[0]?.cells.length, largeComponentWidth, "all large-component cells must be preserved");


// Sparse dense/chunk ownership must fail closed on unsynchronized writes.
const sparseOwnershipGrid = new SparseVoxelGrid(2, 2, 2);
sparseOwnershipGrid.assertDenseEntityOwnershipSynchronized();
const sparseChunkCell = sparseOwnershipGrid.getCell(0, 0, 0);
assert.ok(sparseChunkCell, "dense-window chunk cell must exist");
sparseChunkCell.entityId = 42;
assert.throws(
  () => sparseOwnershipGrid.assertDenseEntityOwnershipSynchronized(),
  /Dense\/chunk entity ownership mismatch/,
  "chunk-only ENTITY_ID writes must be rejected before inventory capture",
);
sparseOwnershipGrid.syncDenseToChunks();
assert.doesNotThrow(
  () => sparseOwnershipGrid.assertDenseEntityOwnershipSynchronized(),
  "explicit dense-to-chunk synchronization must restore ownership consistency",
);

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

// Extinction must remove stale ownership markers from cells that no longer
// belong to any live entity.
const extinctionCase = makeEntityTickScenario();
const extinctEntityId = extinctionCase.entity.id;
const extinctCells = extinctionCase.entity.cells.slice();
for (const index of extinctCells) {
  extinctionCase.grid.buffer[index * CELL_FIELDS + F.BIO_POTENTIAL] = 0;
}
extinctionCase.layer.tick(extinctionCase.grid, 1 / 60);
assert.equal(
  extinctionCase.layer.getEntities().some(entity => entity.id === extinctEntityId),
  false,
  "fixture entity must become extinct when its active blob disappears",
);
for (const index of extinctCells) {
  assert.equal(
    extinctionCase.grid.buffer[index * CELL_FIELDS + F.ENTITY_ID],
    0,
    `extinct entity ownership must be cleared at cell ${index}`,
  );
}
console.log("Entity extinction clears stale cell ownership: PASS");

// A surviving entity that loses cells must not leave stale ownership markers
// outside its newly reconciled footprint.
const footprintShiftCase = makeEntityTickScenario();
const survivingEntityId = footprintShiftCase.entity.id;
const previousFootprint = footprintShiftCase.entity.cells.slice();
const removedFootprintCell = previousFootprint[0]!;
footprintShiftCase.grid.buffer[removedFootprintCell * CELL_FIELDS + F.BIO_POTENTIAL] = 0;
footprintShiftCase.layer.tick(footprintShiftCase.grid, 1 / 60);
const survivingEntity = footprintShiftCase.layer.getEntities().find(entity => entity.id === survivingEntityId);
assert.ok(survivingEntity, "entity must survive when its connected blob shrinks");
assert.equal(
  footprintShiftCase.grid.buffer[removedFootprintCell * CELL_FIELDS + F.ENTITY_ID],
  0,
  "cell dropped from a surviving entity footprint must lose its stale ownership marker",
);
for (const index of survivingEntity.cells) {
  assert.equal(
    footprintShiftCase.grid.buffer[index * CELL_FIELDS + F.ENTITY_ID],
    survivingEntityId,
    `new surviving footprint must retain ownership at cell ${index}`,
  );
}
assert.equal(survivingEntity.cells.includes(removedFootprintCell), false, "removed cell must not remain in the entity footprint");
console.log("Surviving entity footprint shift clears stale ownership: PASS");

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

// SparseVoxelGrid rollback must restore the back buffer and keep chunk mirrors
// consistent with the restored dense front buffer.
const sparseRollbackGrid = new SparseVoxelGrid(8, 8, 1);
const sparseRollbackLayer = new EntityLayer();
sparseRollbackLayer.setRandomSeed(0x12345678);
for (const index of [9, 10, 17, 18]) {
  sparseRollbackGrid.buffer[index * CELL_FIELDS + F.BIO_POTENTIAL] = 1;
  sparseRollbackGrid.buffer[index * CELL_FIELDS + F.ENERGY] = 200;
}
sparseRollbackGrid.syncDenseToChunks();
sparseRollbackLayer.tick(sparseRollbackGrid, 1 / 60);
sparseRollbackGrid.syncDenseToChunks();
const sparseRollbackEntity = sparseRollbackLayer.getEntities()[0];
assert.ok(sparseRollbackEntity, "sparse rollback fixture must create a real entity");
sparseRollbackEntity.age = 59;
sparseRollbackEntity.genome.reproThreshold = 1;
sparseRollbackEntity.energy = 321;
for (const index of sparseRollbackEntity.cells) {
  sparseRollbackGrid.buffer[index * CELL_FIELDS + F.ENERGY] = 200;
}
sparseRollbackGrid.snapshot();
const sparseBackBufferBeforeFailure = Array.from(sparseRollbackGrid.backBuffer);
const sparseRollbackInternals = sparseRollbackLayer as unknown as {
  _spawnChild: (...args: unknown[]) => void;
};
const sparseOriginalSpawnChild = sparseRollbackInternals._spawnChild;
sparseRollbackInternals._spawnChild = function (...args: unknown[]) {
  sparseOriginalSpawnChild.apply(sparseRollbackLayer, args);
  throw new Error("injected sparse-grid reproduction failure");
};
assert.throws(
  () => sparseRollbackLayer.tick(sparseRollbackGrid, 1 / 60),
  /injected sparse-grid reproduction failure/,
);
assert.deepEqual(
  Array.from(sparseRollbackGrid.backBuffer),
  sparseBackBufferBeforeFailure,
  "failed sparse entity tick must restore backBuffer",
);
assert.doesNotThrow(
  () => sparseRollbackGrid.assertDenseEntityOwnershipSynchronized(),
  "failed sparse entity tick must restore dense/chunk ownership consistency",
);
const sparseDenseAfterRollback = Array.from(sparseRollbackGrid.buffer);
sparseRollbackGrid.syncChunksToDense();
assert.deepEqual(
  Array.from(sparseRollbackGrid.buffer),
  sparseDenseAfterRollback,
  "syncChunksToDense after rollback must not reintroduce stale ownership",
);
sparseRollbackInternals._spawnChild = sparseOriginalSpawnChild;
console.log("SparseVoxelGrid entity tick rollback consistency: PASS");



// Revision-bound authoritative inventory contract: immutable snapshot, stale
// revision rejection, and fail-closed global operations on partial worksets.
const inventoryRevision4 = captureEntityDomainInventory({
  scopeId: "world:alpha",
  revision: 4,
  completeness: "complete",
  entityIds: [12, 3],
  occupiedCells: [8, 2, 5],
  entityCellOwnership: [
    { entityId: 3, cells: [2, 5] },
    { entityId: 12, cells: [8] },
  ],
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
  entityCellOwnership: [
    { entityId: 3, cells: [2, 5] },
    { entityId: 12, cells: [8] },
  ],
});
assert.doesNotThrow(() => assertEntityDomainRevision(inventoryRevision4, sameRevisionInventory));
const forgedSameRevisionInventory = captureEntityDomainInventory({
  scopeId: "world:alpha",
  revision: 4,
  completeness: "complete",
  entityIds: [3, 12],
  occupiedCells: [2, 5, 8, 99],
  entityCellOwnership: [
    { entityId: 3, cells: [2, 5, 99] },
    { entityId: 12, cells: [8] },
  ],
});
assert.throws(
  () => assertEntityDomainRevision(inventoryRevision4, forgedSameRevisionInventory),
  /content mismatch/,
  "matching revision numbers must not authorize a different inventory payload",
);
assert.throws(
  () => captureEntityDomainInventory({
    scopeId: "world:alpha", revision: 4, completeness: "unknown" as "complete",
    entityIds: [], occupiedCells: [],
  }),
  /completeness must be/,
  "inventory completeness must be validated at the runtime boundary",
);
const newerRevisionInventory = captureEntityDomainInventory({
  scopeId: "world:alpha",
  revision: 5,
  completeness: "complete",
  entityIds: [3, 12],
  occupiedCells: [2, 5, 8, 9],
  entityCellOwnership: [
    { entityId: 3, cells: [2, 5, 9] },
    { entityId: 12, cells: [8] },
  ],
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
const completeLegacyInventory = captureEntityDomainInventory({
  scopeId: "world:legacy-complete",
  revision: 1,
  completeness: "complete",
  entityIds: [7],
  occupiedCells: [0],
});
assert.throws(
  () => assertCompleteEntityDomain(completeLegacyInventory, "merge"),
  /without entity-cell ownership inventory/,
  "complete flag alone must not authorize a global merge",
);
assert.throws(
  () => assertCompleteEntityDomain(completeLegacyInventory, "extinction"),
  /without entity-cell ownership inventory/,
  "complete flag alone must not authorize extinction",
);
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

// A split must retain the source identity on exactly one deterministic component
// and allocate a new identity for the other component; planning must not claim
// either source entity is extinct merely because the source was split.
const splitSource = {
  ...entity,
  id: 303,
  cells: [10, 11],
  centroid: [10.5, 0, 0] as [number, number, number],
} as Entity;
const splitComponents: EntityChunkComponent[] = [
  {
    id: 31, cells: [10], centroid: [10, 0, 0],
    touchesSimulationBoundary: false, touchesReadBoundary: false, touchesMixedLODBoundary: false,
  },
  {
    id: 32, cells: [11], centroid: [11, 0, 0],
    touchesSimulationBoundary: false, touchesReadBoundary: false, touchesMixedLODBoundary: false,
  },
];
const splitPlan = planner.plan(splitComponents, [splitSource]);
assert.equal(splitPlan.commitReady, true, "closed split components can be planned without global extinction inference");
assert.deepEqual(splitPlan.proposals.map(proposal => proposal.continuity), ["retained", "split"]);
assert.deepEqual(splitPlan.proposals.map(proposal => proposal.existingEntityId), [303, null]);
assert.deepEqual(splitPlan.proposals.map(proposal => proposal.sourceEntityIds), [[303], [303]]);
assert.deepEqual(splitPlan.extinctEntityIds, [], "splitting a source entity must not infer source extinction");
const splitRecords = planner.commitRecords(splitPlan, splitComponents);
assert.ok(splitRecords, "valid closed split plan should produce staged records");
assert.deepEqual(splitRecords?.map(record => record.entityId), [303, null], "only one split component may retain the original identity");
assert.deepEqual(splitRecords?.map(record => record.sourceEntityIds), [[303], [303]]);
console.log("Entity split identity planning regression: PASS");

// Revision-bound plans must be checked against the latest authoritative snapshot
// before any commit records are staged.
const revisionBoundPlan = planner.planAtInventory(
  [closedComponent],
  [{ ...entity, id: 404, cells: [0], centroid: [0, 0, 0] } as Entity],
  inventoryRevision4,
);
assert.ok(revisionBoundPlan.sourceInventory, "revision-bound plan must retain its source inventory");
assert.ok(planner.commitRecords(revisionBoundPlan, [closedComponent], sameRevisionInventory));
assert.throws(
  () => planner.commitRecords(revisionBoundPlan, [closedComponent]),
  /requires current inventory/,
  "revision-bound plan must not stage records without re-reading current authority",
);
assert.throws(
  () => planner.commitRecords(revisionBoundPlan, [closedComponent], newerRevisionInventory),
  /Stale entity reconciliation plan/,
  "revision-bound plan must reject a stale source revision before staging records",
);

assert.throws(
  () => planner.buildCommit(revisionBoundPlan),
  /requires current inventory/,
  "summary API must not bypass revision checks",
);
assert.ok(planner.buildCommit(revisionBoundPlan, sameRevisionInventory));
assert.throws(
  () => planner.buildCommit(revisionBoundPlan, newerRevisionInventory),
  /Stale entity reconciliation plan/,
  "summary API must reject stale plans too",
);
console.log("Revision-bound reconciliation plan stale-revision gate: PASS");

// The synchronous transaction API checks revision immediately before apply,
// and rolls back if apply fails or changes the authoritative revision.
const transactionAuthority = new EntityDomainInventoryAuthority("world:atomic-transaction");
const transactionInventory = transactionAuthority.update({
  completeness: "complete",
  entityIds: [404],
  occupiedCells: [0],
});
const transactionPlan = planner.planAtInventory(
  [closedComponent],
  [{ ...entity, id: 404, cells: [0], centroid: [0, 0, 0] } as Entity],
  transactionInventory,
);
const transactionState = { value: "before" };
let transactionApplied = false;
let transactionRolledBack = false;
const transactionRecords = planner.commitAtomically(
  transactionPlan,
  [closedComponent],
  () => transactionAuthority.snapshot(),
  records => ({ before: transactionState.value, records }),
  (_staged, records) => {
    transactionApplied = true;
    transactionState.value = `committed:${records.length}`;
    // A successful reconciliation may publish the resulting domain at a newer
    // revision. The source revision guards entry into apply; it is not a required
    // postcondition after the transaction has committed.
    transactionAuthority.update({
      completeness: "complete",
      entityIds: [404],
      occupiedCells: [0, 1],
    });
  },
  staged => {
    transactionRolledBack = true;
    transactionState.value = staged.before;
  },
);
assert.ok(transactionRecords);
assert.equal(transactionApplied, true, "revision-valid transaction must apply exactly once");
assert.equal(transactionRolledBack, false, "successful transaction must not roll back");
assert.equal(transactionState.value, "committed:1");
assert.equal(transactionAuthority.snapshot().revision, transactionInventory.revision + 1, "successful apply may publish the next domain revision");
console.log("Entity reconciliation synchronous atomic apply: PASS");

// A revision change after staging but before apply must be rejected, and the
// apply callback must never run.
const staleTransactionAuthority = new EntityDomainInventoryAuthority("world:atomic-stale");
const staleTransactionInventory = staleTransactionAuthority.update({
  completeness: "complete",
  entityIds: [404],
  occupiedCells: [0],
});
const staleTransactionPlan = planner.planAtInventory(
  [closedComponent],
  [{ ...entity, id: 404, cells: [0], centroid: [0, 0, 0] } as Entity],
  staleTransactionInventory,
);
let staleApplyCalled = false;
let staleRollbackCalled = false;
assert.throws(() => planner.commitAtomically(
  staleTransactionPlan,
  [closedComponent],
  () => staleTransactionAuthority.snapshot(),
  () => {
    staleTransactionAuthority.update({
      completeness: "complete",
      entityIds: [404],
      occupiedCells: [0, 1],
    });
    return { snapshot: "pre-apply" };
  },
  () => { staleApplyCalled = true; },
  () => { staleRollbackCalled = true; },
), /Stale entity reconciliation plan/);
assert.equal(staleApplyCalled, false, "stale plan must never enter the apply callback");
assert.equal(staleRollbackCalled, true, "staged transaction must invoke rollback on failed pre-apply validation");
console.log("Entity reconciliation stale revision blocks apply: PASS");

// A partial apply failure must call rollback and preserve the original error.
const failureAuthority = new EntityDomainInventoryAuthority("world:atomic-failure");
const failureInventory = failureAuthority.update({
  completeness: "complete",
  entityIds: [404],
  occupiedCells: [0],
});
const failurePlan = planner.planAtInventory(
  [closedComponent],
  [{ ...entity, id: 404, cells: [0], centroid: [0, 0, 0] } as Entity],
  failureInventory,
);
const failureState = { value: "original" };
let failureRollbackCalled = false;
assert.throws(() => planner.commitAtomically(
  failurePlan,
  [closedComponent],
  () => failureAuthority.snapshot(),
  () => ({ before: failureState.value }),
  () => {
    failureState.value = "partially-mutated";
    throw new Error("simulated apply failure");
  },
  staged => {
    failureState.value = staged.before;
    failureRollbackCalled = true;
  },
), /simulated apply failure/);
assert.equal(failureState.value, "original", "rollback must restore the staged snapshot");
assert.equal(failureRollbackCalled, true);
console.log("Entity reconciliation apply failure rollback: PASS");


// GPU readback must not overwrite state changed while the readback promise is pending.
async function checkStaleGpuReadbackIsRejected(): Promise<void> {
  const engine = new SimulationEngine();
  const internals = engine as unknown as { _gpuReady: boolean };
  internals._gpuReady = true;

  let resolveReadback!: (data: Float32Array) => void;
  let markReadbackStarted!: () => void;
  const readbackStarted = new Promise<void>(resolve => { markReadbackStarted = resolve; });
  let uploadCount = 0;
  const gpu = engine.gpu as unknown as {
    writeParams: (...args: unknown[]) => void;
    submitCompute: (nSteps: number) => void;
    readback: () => Promise<Float32Array>;
    upload: (data: Float32Array) => void;
  };
  gpu.writeParams = () => undefined;
  gpu.submitCompute = () => undefined;
  gpu.readback = () => new Promise<Float32Array>(resolve => {
    resolveReadback = resolve;
    markReadbackStarted();
  });
  gpu.upload = () => { uploadCount++; };

  const stepPromise = engine.step(1 / 60);
  await readbackStarted;

  // Simulate a synchronous runtime/script mutation while GPU readback is awaiting.
  engine.grid.buffer[0] = 123.25;
  engine.syncTick(0);
  const newerValue = engine.grid.buffer[0];
  resolveReadback(new Float32Array(engine.grid.buffer.length).fill(7));

  await assert.rejects(stepPromise, /Discarded stale GPU readback/);
  assert.equal(engine.grid.buffer[0], newerValue, "stale GPU data must not overwrite newer grid state");
  assert.equal(newerValue, 123.25, "newer synchronous mutation must survive");
  assert.ok(uploadCount >= 1, "GPU must be resynchronized from the authoritative CPU buffer");
  console.log("SimulationEngine rejects stale GPU readback after syncTick mutation: PASS");
}

await checkStaleGpuReadbackIsRejected();



// Aggregate plan readiness must be enforced at the transaction boundary too:
// incomplete mixed-LOD topology must not even enter stage/apply.
const incompleteTransactionAuthority = new EntityDomainInventoryAuthority("world:atomic-incomplete");
const incompleteTransactionInventory = incompleteTransactionAuthority.update({
  completeness: "partial",
  entityIds: [77],
  occupiedCells: [10],
});
const incompleteTransactionPlan = planner.planAtInventory(
  [component],
  [entity],
  incompleteTransactionInventory,
  incompleteConnectivity,
);
assert.equal(incompleteTransactionPlan.commitReady, false);
let incompleteStageCalled = false;
let incompleteApplyCalled = false;
let incompleteRollbackCalled = false;
const incompleteTransactionRecords = planner.commitAtomically(
  incompleteTransactionPlan,
  [component],
  () => incompleteTransactionAuthority.snapshot(),
  () => {
    incompleteStageCalled = true;
    return { staged: true };
  },
  () => { incompleteApplyCalled = true; },
  () => { incompleteRollbackCalled = true; },
);
assert.equal(incompleteTransactionRecords, null, "incomplete plan must be rejected at transaction boundary");
assert.equal(incompleteStageCalled, false, "incomplete plan must not stage mutations");
assert.equal(incompleteApplyCalled, false, "incomplete plan must never enter apply");
assert.equal(incompleteRollbackCalled, false, "no rollback is needed when transaction is rejected before staging");
console.log("Entity reconciliation incomplete plan blocked before staging: PASS");


// The atomic entry point must reject an unbound plan before reading authority
// or invoking any user-supplied transaction callback.
const unboundPlan = planner.plan([closedComponent], [
  { ...entity, id: 505, cells: [0], centroid: [0, 0, 0] } as Entity,
]);
let unboundAuthorityRead = false;
let unboundStageCalled = false;
let unboundApplyCalled = false;
let unboundRollbackCalled = false;
assert.throws(() => planner.commitAtomically(
  unboundPlan,
  [closedComponent],
  () => {
    unboundAuthorityRead = true;
    return transactionAuthority.snapshot();
  },
  () => {
    unboundStageCalled = true;
    return { staged: true };
  },
  () => { unboundApplyCalled = true; },
  () => { unboundRollbackCalled = true; },
), /requires a revision-bound plan/);
assert.equal(unboundAuthorityRead, false, "unbound plan must be rejected before authority read");
assert.equal(unboundStageCalled, false, "unbound plan must not enter staging");
assert.equal(unboundApplyCalled, false, "unbound plan must not enter apply");
assert.equal(unboundRollbackCalled, false, "unbound plan rejected before staging must not invoke rollback");
console.log("Entity reconciliation unbound plan rejected before transaction callbacks: PASS");


// Canonical entity-to-cell ownership must participate in same-revision checks.
// Swapping cell membership while preserving entity IDs and the global occupied
// cell set is a different authoritative domain and must be rejected.
const ownershipSnapshotA = captureEntityDomainInventory({
  scopeId: "world:ownership",
  revision: 7,
  completeness: "complete",
  entityIds: [11, 12],
  occupiedCells: [100, 101],
  entityCellOwnership: [
    { entityId: 11, cells: [100] },
    { entityId: 12, cells: [101] },
  ],
});
const ownershipSnapshotSwapped = captureEntityDomainInventory({
  scopeId: "world:ownership",
  revision: 7,
  completeness: "complete",
  entityIds: [12, 11],
  occupiedCells: [101, 100],
  entityCellOwnership: [
    { entityId: 11, cells: [101] },
    { entityId: 12, cells: [100] },
  ],
});
assert.throws(
  () => assertEntityDomainRevision(ownershipSnapshotA, ownershipSnapshotSwapped),
  /content mismatch/,
  "same revision and global cell set must not conceal changed entity-cell ownership",
);
console.log("Entity inventory rejects same-revision ownership reassignment: PASS");


// The trusted inventory authority must advance its revision when ownership
// changes, even if entity IDs and the global occupied-cell set are unchanged.
const ownershipAuthority = new EntityDomainInventoryAuthority("world:ownership-authority");
const ownershipRevisionA = ownershipAuthority.update({
  completeness: "complete",
  entityIds: [11, 12],
  occupiedCells: [100, 101],
  entityCellOwnership: [
    { entityId: 11, cells: [100] },
    { entityId: 12, cells: [101] },
  ],
});
const ownershipRevisionB = ownershipAuthority.update({
  completeness: "complete",
  entityIds: [12, 11],
  occupiedCells: [101, 100],
  entityCellOwnership: [
    { entityId: 11, cells: [101] },
    { entityId: 12, cells: [100] },
  ],
});
assert.equal(ownershipRevisionB.revision, ownershipRevisionA.revision + 1);
assert.throws(
  () => assertEntityDomainRevision(ownershipRevisionA, ownershipRevisionB),
  /Stale entity reconciliation plan/,
  "authority must invalidate plans after entity-cell ownership changes",
);
console.log("Entity inventory authority increments revision on ownership reassignment: PASS");


// SparseVoxelGrid dense access must reject coordinates that would otherwise
// alias a valid dense linear index while creating an unrelated chunk.
const boundsGrid = new SparseVoxelGrid(4, 3, 2);
const boundsLastCell = boundsGrid.cell(3, 2, 1);
boundsLastCell.energy = 123;
const boundsLastIndex = (1 * 3 * 4 + 2 * 4 + 3);
assert.equal(boundsGrid.cellAt(boundsLastIndex).energy, 123, "last valid dense cell must remain addressable");
const chunksBeforeRejectedAccess = boundsGrid.chunks.size;
for (const [x, y, z] of [[4, 0, 0], [0, 3, 0], [0, 0, 2], [-1, 0, 0], [0.5, 0, 0]] as const) {
  assert.throws(() => boundsGrid.cell(x, y, z), RangeError, `cell must reject out-of-range/non-integer coordinate (${x}, ${y}, ${z})`);
  assert.throws(() => boundsGrid.cellBack(x, y, z), RangeError, `cellBack must reject out-of-range/non-integer coordinate (${x}, ${y}, ${z})`);
}
assert.equal(boundsGrid.chunks.size, chunksBeforeRejectedAccess, "rejected dense coordinates must not create out-of-window chunks");
assert.equal(boundsGrid.cellAt(boundsLastIndex).energy, 123, "rejected coordinates must not alias or overwrite a valid dense cell");
for (const invalidIndex of [-1, boundsGrid.size, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
  assert.throws(() => boundsGrid.cellAt(invalidIndex), RangeError, `cellAt must reject invalid linear index ${invalidIndex}`);
}
console.log("SparseVoxelGrid rejects invalid dense coordinates and linear indices: PASS");

// Characterize the production legacy lifecycle policy before replacing it with
// chunk reconciliation: a connected component that shrinks to one cell is
// currently discarded by EntityLayer.tick(). This is intentionally a
// migration guard, not a statement that singleton extinction is the desired
// long-term policy.
const singletonLifecycleGrid = new VoxelGrid(3, 1, 1);
singletonLifecycleGrid.buffer[0 * CELL_FIELDS + F.BIO_POTENTIAL] = 1;
singletonLifecycleGrid.buffer[1 * CELL_FIELDS + F.BIO_POTENTIAL] = 1;
const singletonLifecycleLayer = new EntityLayer();
singletonLifecycleLayer.tick(singletonLifecycleGrid, 0.016);
assert.equal(singletonLifecycleLayer.getEntities().length, 1,
  "legacy EntityLayer must recognize the initial two-cell blob");
singletonLifecycleGrid.buffer[1 * CELL_FIELDS + F.BIO_POTENTIAL] = 0;
singletonLifecycleLayer.tick(singletonLifecycleGrid, 0.016);
assert.equal(singletonLifecycleLayer.getEntities().length, 0,
  "legacy lifecycle currently discards a blob after it shrinks to one cell");
assert.equal(singletonLifecycleLayer.extinctCount, 1,
  "legacy singleton disappearance is currently counted as extinction");
console.log("EntityLayer legacy singleton lifecycle characterization: PASS");

