import assert from "node:assert/strict";
import { CELL_FIELDS, F } from "../src/core/CellState.ts";
import { Chunk } from "../src/core/Chunk.ts";
import { SparseVoxelGrid } from "../src/core/SparseVoxelGrid.ts";
import { SimulationEngine } from "../src/simulation/SimulationEngine.ts";
import { SculptManager } from "../src/sculpt/SculptManager.ts";
import { WorldSaveSystem } from "../src/world/save/WorldSaveSystem.ts";

async function beginPendingReadback(engine: SimulationEngine, stale: Float32Array) {
  let release!: (data: Float32Array) => void;
  let signalReadback!: () => void;
  const readbackEntered = new Promise<void>(resolve => { signalReadback = resolve; });
  engine.gpu.readback = () => {
    signalReadback();
    return new Promise<Float32Array>(resolve => { release = resolve; });
  };
  const step = engine.step(0.016);
  await readbackEntered;
  return { step, release: (data = stale) => release(data) };
}

export async function runSimulationEngineStaleReadbackRegression(): Promise<void> {
  const engine = new SimulationEngine(8, 8, 8);
  // Exercise the async GPU control path deterministically without a GPU device.
  (engine as unknown as { _gpuReady: boolean })._gpuReady = true;

  const fieldIndex = engine.grid.idx(2, 2, 2) + F.ENERGY;

  // Seed known field values at two cells and verify the multi-field accumulator.
  const metricCellA = engine.grid.idx(0, 0, 0);
  const metricCellB = engine.grid.idx(1, 0, 0);
  engine.grid.buffer[metricCellA + F.ENERGY] = 10;
  engine.grid.buffer[metricCellB + F.ENERGY] = 15;
  engine.grid.buffer[metricCellA + F.ENTROPY] = 2;
  engine.grid.buffer[metricCellB + F.ENTROPY] = 4;
  engine.grid.buffer[metricCellA + F.INFORMATION] = 3;
  engine.grid.buffer[metricCellB + F.INFORMATION] = 7;
  engine.grid.buffer[metricCellA + F.DENSITY] = 0.25;
  engine.grid.buffer[metricCellB + F.DENSITY] = 0.75;
  engine.grid.buffer[metricCellA + F.BIO_POTENTIAL] = 0.1;
  engine.grid.buffer[metricCellB + F.BIO_POTENTIAL] = 0.3;

  const beforeReadOnlyMetrics = engine.grid.mutationRevision;
  const metrics = (engine as unknown as { _worldMetrics: () => {
    totalEnergy: number; avgEntropy: number; avgInfo: number; avgDensity: number; avgBio: number;
  } })._worldMetrics();
  assert.equal(metrics.totalEnergy, 25, "world metrics must sum total energy");
  assert.ok(Math.abs(metrics.avgEntropy - 6 / engine.grid.size) < 1e-7, "world metrics must average entropy");
  assert.ok(Math.abs(metrics.avgInfo - 10 / engine.grid.size) < 1e-7, "world metrics must average information");
  assert.ok(Math.abs(metrics.avgDensity - 1 / engine.grid.size) < 1e-7, "world metrics must average density");
  assert.ok(Math.abs(metrics.avgBio - 0.4 / engine.grid.size) < 1e-7, "world metrics must average bio potential");
  assert.equal(engine.grid.mutationRevision, beforeReadOnlyMetrics,
    "read-only world metrics must not advance the grid mutation revision");

  const publicRevision = engine.grid.mutationRevision;

  // .buffer must never leak authoritative memory through its ArrayBuffer.
  const detachedBuffer = engine.grid.buffer.buffer;
  new Float32Array(detachedBuffer)[fieldIndex] = 777;
  assert.notEqual(engine.grid.buffer[fieldIndex], 777, "ArrayBuffer escape must be detached");

  // A public subarray remains a write-through view, but the write must be tracked.
  const beforeSubviewWrite = engine.grid.mutationRevision;
  const view = engine.grid.buffer.subarray(fieldIndex, fieldIndex + 1);
  view[0] = 31;
  assert.equal(engine.grid.buffer[fieldIndex], 31, "tracked subarray must preserve write-through semantics");
  assert.ok(engine.grid.mutationRevision > beforeSubviewWrite, "subarray writes must advance grid revision");

  // CellState setters are also supported external mutation paths.
  const beforeCellWrite = engine.grid.mutationRevision;
  engine.grid.cell(1, 1, 1).energy = 43;
  assert.ok(engine.grid.mutationRevision > beforeCellWrite, "CellState setter must advance grid revision");

  // Any dense-grid write while a GPU readback is pending must invalidate that result.
  const staleDense = engine.grid.buffer.slice();
  const pendingDense = await beginPendingReadback(engine, staleDense);
  const beforeDenseWrite = engine.grid.mutationRevision;
  engine.grid.buffer[fieldIndex] = 101;
  assert.ok(engine.grid.mutationRevision > beforeDenseWrite, "direct dense buffer write must advance grid revision");
  pendingDense.release(staleDense);
  await assert.rejects(pendingDense.step, /Discarded stale GPU readback/);
  assert.equal(engine.grid.buffer[fieldIndex], 101, "stale GPU data must not overwrite newer dense state");

  // Chunk storage is a separate physical representation. Its writes must invalidate
  // the same grid revision so a dense GPU readback cannot commit over newer chunk state.
  const chunk = engine.grid.chunks.get("0,0,0");
  assert.ok(chunk, "expected default dense-window chunk");
  const chunkFieldIndex = chunk.localIdx(2, 2, 2) + F.ENERGY;
  const beforeChunkCellWrite = engine.grid.mutationRevision;
  chunk.getCell(2, 2, 2).energy = 88;
  assert.ok(engine.grid.mutationRevision > beforeChunkCellWrite, "chunk CellState setter must advance grid revision");
  const beforeChunkMapWrite = engine.grid.mutationRevision;
  engine.grid.getOrCreateChunk(5, 5, 5);
  assert.ok(engine.grid.mutationRevision > beforeChunkMapWrite, "chunk-map topology changes must advance grid revision");

  // Re-inserting the same chunk must not register duplicate mutation listeners.
  const listenerChunk = engine.grid.getOrCreateChunk(12, 12, 12);
  const listenerChunkKey = engine.grid.getChunkKey(12, 12, 12);
  engine.grid.chunks.set(listenerChunkKey, listenerChunk);
  const beforeSingleChunkWrite = engine.grid.mutationRevision;
  listenerChunk.buffer[0] = 313;
  assert.equal(engine.grid.mutationRevision, beforeSingleChunkWrite + 1,
    "one chunk write must notify the grid exactly once after idempotent map insertion");

  // Replacing a chunk must unregister the old instance while tracking the new one.
  const replacementChunk = new Chunk(12, 12, 12);
  engine.grid.chunks.set(listenerChunkKey, replacementChunk);
  const beforeDetachedChunkWrite = engine.grid.mutationRevision;
  listenerChunk.buffer[0] = 314;
  assert.equal(engine.grid.mutationRevision, beforeDetachedChunkWrite,
    "mutating a replaced chunk must not invalidate the current grid revision");
  const beforeReplacementChunkWrite = engine.grid.mutationRevision;
  replacementChunk.buffer[0] = 315;
  assert.equal(engine.grid.mutationRevision, beforeReplacementChunkWrite + 1,
    "mutating the currently mapped replacement chunk must advance grid revision exactly once");

  const staleChunkStep = await beginPendingReadback(engine, engine.grid.buffer.slice());
  const beforeChunkWrite = engine.grid.mutationRevision;
  chunk.buffer[chunkFieldIndex] = 202;
  assert.ok(engine.grid.mutationRevision > beforeChunkWrite, "direct chunk write must advance grid revision");
  staleChunkStep.release();
  await assert.rejects(staleChunkStep.step, /Discarded stale GPU readback/);
  assert.equal(chunk.buffer[chunkFieldIndex], 202, "stale GPU readback must not mutate newer chunk state");

  // The range getter must be detached; whole-range replacement is revision-tracked.
  const originalRange = engine.grid.activeChunkRange;
  const detachedRange = engine.grid.activeChunkRange;
  detachedRange.minX = originalRange.minX - 100;
  assert.equal(engine.grid.activeChunkRange.minX, originalRange.minX,
    "nested writes to a returned active-chunk range must not mutate authoritative state");
  const staleRangeStep = await beginPendingReadback(engine, engine.grid.buffer.slice());
  const beforeRangeMutation = engine.grid.mutationRevision;
  engine.grid.activeChunkRange = { ...originalRange, minX: originalRange.minX - 1 };
  assert.ok(engine.grid.mutationRevision > beforeRangeMutation,
    "active-chunk range replacement must advance grid revision");
  staleRangeStep.release();
  await assert.rejects(staleRangeStep.step, /Discarded stale GPU readback/);
  assert.equal(engine.grid.activeChunkRange.minX, originalRange.minX - 1,
    "stale GPU data must not overwrite newer active-chunk range metadata");
  engine.grid.activeChunkRange = originalRange;

  // Public chunk metadata collections are authoritative mutation surfaces too.
  // Mutating them while readback is pending must invalidate the in-flight result.
  const staleDirtyStep = await beginPendingReadback(engine, engine.grid.buffer.slice());
  const beforeDirtyMutation = engine.grid.mutationRevision;
  engine.grid.dirtyChunks.add("7,8,9");
  assert.ok(engine.grid.mutationRevision > beforeDirtyMutation,
    "dirty-chunk Set.add must advance grid revision");
  staleDirtyStep.release();
  await assert.rejects(staleDirtyStep.step, /Discarded stale GPU readback/);
  assert.ok(engine.grid.dirtyChunks.has("7,8,9"), "stale GPU data must not undo newer dirty-chunk metadata");

  const staleOwnerStep = await beginPendingReadback(engine, engine.grid.buffer.slice());
  const beforeOwnerMutation = engine.grid.mutationRevision;
  engine.grid.chunkOwners.set("7,8,9", "test-owner");
  assert.ok(engine.grid.mutationRevision > beforeOwnerMutation,
    "chunk-owner Map.set must advance grid revision");
  staleOwnerStep.release();
  await assert.rejects(staleOwnerStep.step, /Discarded stale GPU readback/);
  assert.equal(engine.grid.chunkOwners.get("7,8,9"), "test-owner",
    "stale GPU data must not overwrite newer chunk ownership metadata");

  // delete() and clear() must also invalidate pending readbacks, not only advance
  // the revision in isolated unit assertions.
  engine.grid.dirtyChunks.add("8,8,8");
  const staleDirtyDeleteStep = await beginPendingReadback(engine, engine.grid.buffer.slice());
  assert.equal(engine.grid.dirtyChunks.delete("8,8,8"), true);
  staleDirtyDeleteStep.release();
  await assert.rejects(staleDirtyDeleteStep.step, /Discarded stale GPU readback/);
  assert.equal(engine.grid.dirtyChunks.has("8,8,8"), false,
    "stale GPU readback must not resurrect a deleted dirty-chunk entry");

  engine.grid.dirtyChunks.add("8,8,8");
  engine.grid.dirtyChunks.add("9,8,8");
  const staleDirtyClearStep = await beginPendingReadback(engine, engine.grid.buffer.slice());
  engine.grid.dirtyChunks.clear();
  staleDirtyClearStep.release();
  await assert.rejects(staleDirtyClearStep.step, /Discarded stale GPU readback/);
  assert.equal(engine.grid.dirtyChunks.size, 0,
    "stale GPU readback must not restore cleared dirty-chunk entries");
  // Restore the legacy fixture key used by the original delete/clear assertions below.
  engine.grid.dirtyChunks.add("7,8,9");

  engine.grid.chunkOwners.set("8,8,8", "delete-owner");
  const staleOwnerDeleteStep = await beginPendingReadback(engine, engine.grid.buffer.slice());
  assert.equal(engine.grid.chunkOwners.delete("8,8,8"), true);
  staleOwnerDeleteStep.release();
  await assert.rejects(staleOwnerDeleteStep.step, /Discarded stale GPU readback/);
  assert.equal(engine.grid.chunkOwners.has("8,8,8"), false,
    "stale GPU readback must not resurrect a deleted chunk-owner entry");

  engine.grid.chunkOwners.set("8,8,8", "clear-owner-a");
  engine.grid.chunkOwners.set("9,8,8", "clear-owner-b");
  const staleOwnerClearStep = await beginPendingReadback(engine, engine.grid.buffer.slice());
  engine.grid.chunkOwners.clear();
  staleOwnerClearStep.release();
  await assert.rejects(staleOwnerClearStep.step, /Discarded stale GPU readback/);
  assert.equal(engine.grid.chunkOwners.size, 0,
    "stale GPU readback must not restore cleared chunk-owner entries");
  // Restore the legacy fixture key used by the original delete/clear assertions below.
  engine.grid.chunkOwners.set("7,8,9", "test-owner");

  // Public chunk map writes must preserve the key-to-spatial-coordinate contract.
  const mapInvariantGrid = new SparseVoxelGrid(1, 1, 1);
  const badCoordinateChunk = new Chunk(4, 5, 6);
  const beforeInvalidChunkInsert = mapInvariantGrid.mutationRevision;
  assert.throws(
    () => mapInvariantGrid.chunks.set("4,5,7", badCoordinateChunk),
    /Chunk map key must match chunk coordinates/,
    "chunk map must reject a key that disagrees with the physical chunk coordinates",
  );
  assert.equal(mapInvariantGrid.chunks.has("4,5,7"), false,
    "rejected chunk map insertion must not change topology");
  assert.equal(mapInvariantGrid.mutationRevision, beforeInvalidChunkInsert,
    "rejected chunk map insertion must not advance mutation revision");
  const badCoordinateRevision = mapInvariantGrid.mutationRevision;
  badCoordinateChunk.buffer[0] = 10;
  assert.equal(mapInvariantGrid.mutationRevision, badCoordinateRevision,
    "rejected chunk instance must not attach a grid mutation listener");

  const beforeDirtyDelete = engine.grid.mutationRevision;
  assert.equal(engine.grid.dirtyChunks.delete("7,8,9"), true);
  assert.ok(engine.grid.mutationRevision > beforeDirtyDelete, "dirty-chunk Set.delete must advance grid revision");
  engine.grid.dirtyChunks.add("7,8,9");
  const beforeDirtyClear = engine.grid.mutationRevision;
  engine.grid.dirtyChunks.clear();
  assert.ok(engine.grid.mutationRevision > beforeDirtyClear, "dirty-chunk Set.clear must advance grid revision");

  const beforeOwnerDelete = engine.grid.mutationRevision;
  assert.equal(engine.grid.chunkOwners.delete("7,8,9"), true);
  assert.ok(engine.grid.mutationRevision > beforeOwnerDelete, "chunk-owner Map.delete must advance grid revision");
  engine.grid.chunkOwners.set("7,8,9", "test-owner");
  const beforeOwnerClear = engine.grid.mutationRevision;
  engine.grid.chunkOwners.clear();
  assert.ok(engine.grid.mutationRevision > beforeOwnerClear, "chunk-owner Map.clear must advance grid revision");

  assert.ok(engine.grid.mutationRevision > publicRevision, "all external mutation scenarios should be revision-visible");

  // Removed chunks must stop reporting mutations to the grid that no longer owns them.
  const deleteGrid = new SparseVoxelGrid(1, 1, 1);
  const deletedChunk = deleteGrid.getOrCreateChunk(3, 3, 3);
  const deletedKey = deleteGrid.getChunkKey(3, 3, 3);
  assert.equal(deleteGrid.activeChunkRange.maxX, 3, "creating an edge chunk must expand active range");
  assert.equal(deleteGrid.chunks.delete(deletedKey), true);
  assert.deepEqual(deleteGrid.activeChunkRange,
    { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 },
    "deleting an edge chunk must recompute the active range from remaining topology");
  const beforeDeletedChunkWrite = deleteGrid.mutationRevision;
  deletedChunk.buffer[0] = 701;
  assert.equal(deleteGrid.mutationRevision, beforeDeletedChunkWrite,
    "deleting a chunk must detach its grid mutation listener");

  // clear() must detach listeners for every removed entry as well.
  const clearGrid = new SparseVoxelGrid(1, 1, 1);
  const clearedChunk = clearGrid.getOrCreateChunk(3, 3, 3);
  clearGrid.chunks.clear();
  assert.deepEqual(clearGrid.activeChunkRange,
    { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 },
    "clearing the chunk map must reset the derived active range");
  const beforeClearedChunkWrite = clearGrid.mutationRevision;
  clearedChunk.buffer[0] = 702;
  assert.equal(clearGrid.mutationRevision, beforeClearedChunkWrite,
    "clearing the chunk map must detach all grid mutation listeners");

  // Supported mutation boundaries must invalidate a GPU result already in flight.
  // Keep these separate from the raw public-view checks above so rollback, restore,
  // publication, and legacy synchronous ticks are all exercised explicitly.
  const boundaryEngine = new SimulationEngine(4, 4, 4);
  (boundaryEngine as unknown as { _gpuReady: boolean })._gpuReady = true;
  const boundaryFieldIndex = boundaryEngine.grid.idx(1, 1, 1) + F.ENERGY;
  boundaryEngine.grid.buffer[boundaryFieldIndex] = 10;

  // A successful authoritative transaction must reject the older readback.
  const authoritativeStale = boundaryEngine.grid.buffer.slice();
  authoritativeStale[boundaryFieldIndex] = 9001;
  const pendingAuthoritative = await beginPendingReadback(boundaryEngine, authoritativeStale);
  boundaryEngine.mutateAuthoritativeState(() => {
    boundaryEngine.grid.buffer[boundaryFieldIndex] = 30;
  });
  pendingAuthoritative.release(authoritativeStale);
  await assert.rejects(pendingAuthoritative.step, /Discarded stale GPU readback/);
  assert.equal(boundaryEngine.grid.buffer[boundaryFieldIndex], 30,
    "stale GPU data must not overwrite a committed authoritative mutation");

  // Failed authoritative mutation must roll CPU state back and still invalidate
  // any readback that began before the failed transaction.
  const beforeFailedTransaction = boundaryEngine.grid.buffer[boundaryFieldIndex];
  const rollbackStale = boundaryEngine.grid.buffer.slice();
  rollbackStale[boundaryFieldIndex] = 9002;
  const pendingRollback = await beginPendingReadback(boundaryEngine, rollbackStale);
  assert.throws(() => boundaryEngine.mutateAuthoritativeState(() => {
    boundaryEngine.grid.buffer[boundaryFieldIndex] = 99;
    throw new Error("injected-authoritative-mutation-failure");
  }), /injected-authoritative-mutation-failure/);
  pendingRollback.release(rollbackStale);
  await assert.rejects(pendingRollback.step, /Discarded stale GPU readback/);
  assert.equal(boundaryEngine.grid.buffer[boundaryFieldIndex], beforeFailedTransaction,
    "failed authoritative transaction must restore CPU state without stale GPU overwrite");

  // Recovery restore must invalidate pending work and preserve the restored snapshot.
  const recoverySnapshot = boundaryEngine.captureCoreRecoveryState();
  boundaryEngine.grid.buffer[boundaryFieldIndex] = 42;
  const restoreStale = boundaryEngine.grid.buffer.slice();
  restoreStale[boundaryFieldIndex] = 9003;
  const pendingRestore = await beginPendingReadback(boundaryEngine, restoreStale);
  boundaryEngine.restoreCoreRecoveryState(recoverySnapshot);
  pendingRestore.release(restoreStale);
  await assert.rejects(pendingRestore.step, /Discarded stale GPU readback/);
  assert.equal(boundaryEngine.grid.buffer[boundaryFieldIndex], beforeFailedTransaction,
    "stale GPU result must not overwrite recovery-restored CPU state");

  // The legacy publication boundary and zero-step synchronous tick also invalidate.
  boundaryEngine.grid.buffer[boundaryFieldIndex] = 55;
  const syncStale = boundaryEngine.grid.buffer.slice();
  syncStale[boundaryFieldIndex] = 9004;
  const pendingSync = await beginPendingReadback(boundaryEngine, syncStale);
  boundaryEngine.syncToGPU();
  pendingSync.release(syncStale);
  await assert.rejects(pendingSync.step, /Discarded stale GPU readback/);
  assert.equal(boundaryEngine.grid.buffer[boundaryFieldIndex], 55,
    "syncToGPU publication must preserve newer CPU state");

  boundaryEngine.grid.buffer[boundaryFieldIndex] = 65;
  const syncTickStale = boundaryEngine.grid.buffer.slice();
  syncTickStale[boundaryFieldIndex] = 9005;
  const pendingSyncTick = await beginPendingReadback(boundaryEngine, syncTickStale);
  boundaryEngine.syncTick(0);
  pendingSyncTick.release(syncTickStale);
  await assert.rejects(pendingSyncTick.step, /Discarded stale GPU readback/);
  assert.equal(boundaryEngine.grid.buffer[boundaryFieldIndex], 65,
    "syncTick(0) must invalidate any readback already in flight");

  // Sculpt undo/redo must invalidate pending GPU results before applying history,
  // then publish the resulting dense/chunk state as one synchronous UI operation.
  const sculptManager = new SculptManager(
    boundaryEngine.grid,
    () => boundaryEngine.syncToGPU(),
    () => boundaryEngine.invalidatePendingGPUReadback(),
  );
  sculptManager.currentBrush.radius = 1;
  sculptManager.currentBrush.fields = {
    energy: 1, density: 0, temperature: 0, bio: 0, information: 0, entropy: 0,
  };
  const sculptStartEnergy = boundaryEngine.grid.buffer[boundaryFieldIndex];
  await sculptManager.onMouseDrag([1, 1, 1], "inject");
  const sculptAfterEnergy = boundaryEngine.grid.buffer[boundaryFieldIndex];
  assert.ok(sculptAfterEnergy > sculptStartEnergy,
    "sculpt regression setup must commit a measurable energy change");

  const staleUndo = boundaryEngine.grid.buffer.slice();
  staleUndo[boundaryFieldIndex] = 9006;
  const pendingUndo = await beginPendingReadback(boundaryEngine, staleUndo);
  const undoStroke = sculptManager.undo();
  assert.ok(undoStroke, "sculpt undo must find the committed stroke");
  pendingUndo.release(staleUndo);
  await assert.rejects(pendingUndo.step, /Discarded stale GPU readback/);
  assert.equal(boundaryEngine.grid.buffer[boundaryFieldIndex], sculptStartEnergy,
    "stale GPU output must not overwrite the state restored by sculpt undo");

  const staleRedo = boundaryEngine.grid.buffer.slice();
  staleRedo[boundaryFieldIndex] = 9007;
  const pendingRedo = await beginPendingReadback(boundaryEngine, staleRedo);
  const redoStroke = sculptManager.redo();
  assert.ok(redoStroke, "sculpt redo must find the undone stroke");
  pendingRedo.release(staleRedo);
  await assert.rejects(pendingRedo.step, /Discarded stale GPU readback/);
  assert.equal(boundaryEngine.grid.buffer[boundaryFieldIndex], sculptAfterEnergy,
    "stale GPU output must not overwrite the state restored by sculpt redo");

  // Exercise the real WorldSaveSystem -> engine mutation boundary while GPU readback
  // is pending. This covers successful world restore and rollback of an invalid save.
  const restoreEngine = new SimulationEngine(4, 4, 4);
  (restoreEngine as unknown as { _gpuReady: boolean })._gpuReady = true;
  const restoreCell = restoreEngine.grid.idx(1, 1, 1);
  const restoreEnergyIndex = restoreCell + F.ENERGY;
  restoreEngine.grid.buffer[restoreEnergyIndex] = 41;

  const worldSave = new WorldSaveSystem(restoreEngine.grid, restoreEngine.laws, null, {
    mutateAuthoritativeState: mutation => restoreEngine.mutateAuthoritativeState(mutation),
    getTick: () => restoreEngine.tick,
    setTick: tick => restoreEngine.restoreTick(tick),
    getEntities: () => restoreEngine.entityLayer.getEntities(),
    getEntityLayerSnapshot: () => restoreEngine.entityLayer.snapshot(),
    restoreEntityLayerSnapshot: snapshot => restoreEngine.entityLayer.restore(snapshot, restoreEngine.grid.size),
    getAgentSystemSnapshot: () => restoreEngine.agents.snapshot(),
    restoreAgentSystemSnapshot: snapshot => restoreEngine.agents.restore(snapshot),
    getLawEngineSnapshot: () => restoreEngine.laws.snapshot(),
    restoreLawEngineSnapshot: snapshot => restoreEngine.laws.restore(snapshot),
  });

  const worldSnapshot = worldSave.captureSnapshot("pending-readback-world-restore");
  const restoredEnergyField = new Float32Array(worldSnapshot.fields.energy);
  restoredEnergyField[restoreCell / CELL_FIELDS] = 123;
  worldSnapshot.fields.energy = restoredEnergyField.buffer;
  restoreEngine.grid.buffer[restoreEnergyIndex] = 77;

  const staleWorldRestore = restoreEngine.grid.buffer.slice();
  staleWorldRestore[restoreEnergyIndex] = 9008;
  const pendingWorldRestore = await beginPendingReadback(restoreEngine, staleWorldRestore);
  await worldSave.applySnapshot(worldSnapshot);
  pendingWorldRestore.release(staleWorldRestore);
  await assert.rejects(pendingWorldRestore.step, /Discarded stale GPU readback/);
  assert.equal(restoreEngine.grid.buffer[restoreEnergyIndex], 123,
    "a stale GPU result must not overwrite a successfully restored world snapshot");

  const beforeRejectedWorldRestore = restoreEngine.grid.buffer[restoreEnergyIndex];
  const invalidWorldSnapshot = {
    ...worldSave.captureSnapshot("invalid-pending-readback-restore"),
    fields: {
      ...worldSave.captureSnapshot("invalid-pending-readback-restore").fields,
      energy: new Float32Array([1]).buffer,
    },
  };
  const staleInvalidRestore = restoreEngine.grid.buffer.slice();
  staleInvalidRestore[restoreEnergyIndex] = 9009;
  const pendingInvalidRestore = await beginPendingReadback(restoreEngine, staleInvalidRestore);
  await assert.rejects(worldSave.applySnapshot(invalidWorldSnapshot), /field "energy" has an invalid buffer size/);
  pendingInvalidRestore.release(staleInvalidRestore);
  await assert.rejects(pendingInvalidRestore.step, /Discarded stale GPU readback/);
  assert.equal(restoreEngine.grid.buffer[restoreEnergyIndex], beforeRejectedWorldRestore,
    "a failed world restore must roll back CPU state and reject old GPU output");

  // Chunk-map membership is authoritative too: set/delete/clear while a GPU
  // result is pending must reject the result before it can be committed.
  const topologyEngine = new SimulationEngine(8, 8, 8);
  (topologyEngine as unknown as { _gpuReady: boolean })._gpuReady = true;
  const topologyKey = topologyEngine.grid.getChunkKey(12, 12, 12);
  topologyEngine.grid.getOrCreateChunk(12, 12, 12);
  const staleTopologySet = topologyEngine.grid.buffer.slice();
  const pendingTopologySet = await beginPendingReadback(topologyEngine, staleTopologySet);
  const topologyReplacement = new Chunk(12, 12, 12);
  topologyEngine.grid.chunks.set(topologyKey, topologyReplacement);
  pendingTopologySet.release(staleTopologySet);
  await assert.rejects(pendingTopologySet.step, /Discarded stale GPU readback/);
  assert.equal(topologyEngine.grid.chunks.get(topologyKey), topologyReplacement,
    "stale GPU output must not override a newer chunk-map replacement");

  const staleTopologyDelete = topologyEngine.grid.buffer.slice();
  const pendingTopologyDelete = await beginPendingReadback(topologyEngine, staleTopologyDelete);
  assert.equal(topologyEngine.grid.chunks.delete(topologyKey), true);
  pendingTopologyDelete.release(staleTopologyDelete);
  await assert.rejects(pendingTopologyDelete.step, /Discarded stale GPU readback/);
  assert.equal(topologyEngine.grid.chunks.has(topologyKey), false,
    "stale GPU output must not resurrect a deleted chunk");

  const clearTopologyEngine = new SimulationEngine(8, 8, 8);
  (clearTopologyEngine as unknown as { _gpuReady: boolean })._gpuReady = true;
  const staleTopologyClear = clearTopologyEngine.grid.buffer.slice();
  const pendingTopologyClear = await beginPendingReadback(clearTopologyEngine, staleTopologyClear);
  clearTopologyEngine.grid.chunks.clear();
  pendingTopologyClear.release(staleTopologyClear);
  await assert.rejects(pendingTopologyClear.step, /Discarded stale GPU readback/);
  assert.equal(clearTopologyEngine.grid.chunks.size, 0,
    "stale GPU output must not repopulate a cleared chunk map");

  console.log("SimulationEngine stale GPU readback mutation-revision regression: PASS");
}

await runSimulationEngineStaleReadbackRegression();
