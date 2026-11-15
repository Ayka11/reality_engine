import assert from "node:assert/strict";
import { CELL_FIELDS, F } from "../src/core/CellState.ts";
import { SimulationEngine } from "../src/simulation/SimulationEngine.ts";

const engine = new SimulationEngine(8, 8, 1);
for (const cell of [9, 10]) {
  engine.grid.buffer[cell * CELL_FIELDS + F.BIO_POTENTIAL] = 1;
  engine.grid.buffer[cell * CELL_FIELDS + F.ENERGY] = 200;
}
engine.grid.syncDenseToChunks();
engine.entityLayer.tick(engine.grid, 1 / 60);

const liveEntities = engine.entityLayer.getEntities();
assert.equal(liveEntities.length, 1, "fixture must create one authoritative entity");
const liveEntity = liveEntities[0]!;
assert.deepEqual(liveEntity.cells.slice().sort((a, b) => a - b), [9, 10],
  "fixture must have a two-cell identity footprint");
for (const cell of liveEntity.cells) {
  assert.equal(engine.grid.buffer[cell * CELL_FIELDS + F.ENTITY_ID], liveEntity.id,
    "every owned cell must carry the matching ENTITY_ID marker");
}
assert.doesNotThrow(() => engine.entityLayer.assertGridEntityOwnershipSynchronized(engine.grid),
  "a valid active-world identity map must match the dense grid markers");

const baseline = engine.captureCoreRecoveryState();
const replacementCell = Array.from({ length: engine.grid.size }, (_, index) => index)
  .find(index => !liveEntity.cells.includes(index))!;
const malformedCore = engine.captureCoreRecoveryState();
malformedCore.entities.entities[0]!.cells[0] = replacementCell;

assert.throws(
  () => engine.restoreCoreRecoveryState(malformedCore),
  /Grid ENTITY_ID ownership mismatch/,
  "core recovery must reject entity records whose cell ownership disagrees with grid fields",
);
assert.deepEqual(engine.captureCoreRecoveryState(), baseline,
  "rejected cross-domain recovery must restore the complete pre-call engine state");

const malformedEntitySnapshot = engine.entityLayer.snapshot();
malformedEntitySnapshot.entities[0]!.cells[0] = replacementCell;
assert.throws(
  () => engine.restoreEntityLayerSnapshot(malformedEntitySnapshot),
  /Grid ENTITY_ID ownership mismatch/,
  "standalone EntityLayer restore must reject mismatched grid ownership",
);
assert.deepEqual(engine.entityLayer.snapshot(), baseline.entities,
  "rejected standalone entity restore must restore the previous authoritative identity map");

// Orphan IDs and missing IDs are both invalid: the grid is a mirror, never a
// second independent authority that may contain unregistered entity markers.
const orphanCell = replacementCell;
engine.grid.buffer[orphanCell * CELL_FIELDS + F.ENTITY_ID] = liveEntity.id;
engine.grid.syncDenseToChunks();
assert.throws(
  () => engine.entityLayer.assertGridEntityOwnershipSynchronized(engine.grid),
  /Grid ENTITY_ID ownership mismatch/,
  "orphan grid markers must be rejected",
);
engine.grid.buffer[orphanCell * CELL_FIELDS + F.ENTITY_ID] = 0;
engine.grid.syncDenseToChunks();

const ownedCell = liveEntity.cells[0]!;
const correctMarker = engine.grid.buffer[ownedCell * CELL_FIELDS + F.ENTITY_ID];
engine.grid.buffer[ownedCell * CELL_FIELDS + F.ENTITY_ID] = 0;
engine.grid.syncDenseToChunks();
assert.throws(
  () => engine.entityLayer.assertGridEntityOwnershipSynchronized(engine.grid),
  /Grid ENTITY_ID ownership mismatch/,
  "missing grid markers for registered entity cells must be rejected",
);
engine.grid.buffer[ownedCell * CELL_FIELDS + F.ENTITY_ID] = correctMarker;
engine.grid.syncDenseToChunks();
assert.doesNotThrow(() => engine.entityLayer.assertGridEntityOwnershipSynchronized(engine.grid),
  "restoring the exact mirror must re-establish a valid ownership boundary");

console.log("Entity/grid identity ownership boundary: PASS");
