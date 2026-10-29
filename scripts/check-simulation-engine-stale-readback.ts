import assert from "node:assert/strict";
import { CELL_FIELDS, F } from "../src/core/CellState.ts";
import { WORLD } from "../src/core/WorldConstants.ts";
import { Chunk } from "../src/core/Chunk.ts";
import { SparseVoxelGrid } from "../src/core/SparseVoxelGrid.ts";
import { SimulationEngine } from "../src/simulation/SimulationEngine.ts";
import { getMutableBuffer, withMutableBuffers } from "../src/core/TrackedFloat32Array.ts";
import { SculptManager } from "../src/sculpt/SculptManager.ts";
import { WorldSaveSystem } from "../src/world/save/WorldSaveSystem.ts";
import { PROC } from "../src/process/ProcessDef.ts";

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

  // Causality detection updates energy-spike IDs and previous-energy history in
  // one scoped buffer transaction. This also guards the >threshold event path.
  const causalityEngine = new SimulationEngine(4, 4, 4);
  const causalityCell = causalityEngine.grid.idx(1, 1, 1);
  causalityEngine.grid.buffer[causalityCell + F.ENERGY] = WORLD.CAUSALITY_THRESHOLD + 1;
  const causalityRevision = causalityEngine.grid.mutationRevision;
  (causalityEngine as unknown as { _detectCausality: () => void })._detectCausality();
  assert.equal(causalityEngine.grid.mutationRevision, causalityRevision + 1,
    "causality detection must use one synchronous scoped buffer revision");
  assert.ok(causalityEngine.grid.buffer[causalityCell + F.CAUSALITY_ID] > 0,
    "causality detection must still write an event ID for an above-threshold energy spike");

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

  // Scoped mutation coalesces front/back writes into one revision and
  // rejects asynchronous callbacks before their synchronous prefix can execute.
  const scopedBufferEngine = new SimulationEngine(4, 4, 4);
  const scopedFrontIndex = scopedBufferEngine.grid.idx(1, 1, 1) + F.ENERGY;
  const scopedBackIndex = scopedBufferEngine.grid.idx(1, 1, 1) + F.DENSITY;
  const scopedRevision = scopedBufferEngine.grid.mutationRevision;
  withMutableBuffers(scopedBufferEngine.grid, (front, back) => {
    front[scopedFrontIndex] = 606;
    back[scopedBackIndex] = 0.25;
  });
  assert.equal(scopedBufferEngine.grid.buffer[scopedFrontIndex], 606,
    "scoped mutation must commit front-buffer writes");
  assert.equal(scopedBufferEngine.grid.backBuffer[scopedBackIndex], Math.fround(0.25),
    "scoped mutation must commit back-buffer writes");
  assert.equal(scopedBufferEngine.grid.mutationRevision, scopedRevision + 1,
    "front/back writes in one scope must advance the revision exactly once");

  let asyncMutationInvoked = false;
  const revisionBeforeAsyncReject = scopedBufferEngine.grid.mutationRevision;
  assert.throws(() => withMutableBuffers(scopedBufferEngine.grid, async () => {
    asyncMutationInvoked = true;
  }), /callbacks are forbidden/);
  assert.equal(asyncMutationInvoked, false,
    "async callback must be rejected before its synchronous prefix can run");
  assert.equal(scopedBufferEngine.grid.mutationRevision, revisionBeforeAsyncReject,
    "rejecting an async callback before invocation must not mutate the grid");

  assert.throws(() => withMutableBuffers(scopedBufferEngine.grid, (front) => front),
    /must not return a value or buffer alias/);
  assert.throws(() => withMutableBuffers(scopedBufferEngine.grid, () => Promise.resolve()),
    /must be synchronous and must not return a Promise/);

  // Regression protecting the authoritative revision contract: the engine's
  // internal mutable-array API must not be exposed to external mutation callers.
  // Core hot paths use the same helper today; this test is a migration gate for
  // replacing that broad escape hatch with a scoped transaction-only capability.
  const rawAliasEngine = new SimulationEngine(4, 4, 4);
  const rawAliasIndex = rawAliasEngine.grid.idx(1, 1, 1) + F.ENERGY;
  const publicRevisionBeforeRawAccess = rawAliasEngine.grid.mutationRevision;
  const rawAlias = getMutableBuffer(rawAliasEngine.grid);
  assert.ok(rawAlias instanceof Float32Array, "internal hot-path accessor returns typed storage");
  assert.ok(rawAliasEngine.grid.mutationRevision > publicRevisionBeforeRawAccess,
    "acquiring internal storage must at least invalidate existing readback revisions");
  rawAlias[rawAliasIndex] = 606;
  assert.equal(rawAliasEngine.grid.buffer[rawAliasIndex], 606,
    "internal hot-path accessor is currently a direct writable alias; callers must remain transaction-local");

  // A retained raw alias can be mutated while the GPU readback promise is pending.
  // Indexed writes to the raw Float32Array do not notify the grid, so the readback
  // path must detect the content change independently of mutationRevision.
  const aliasDuringReadbackEngine = new SimulationEngine(4, 4, 4);
  (aliasDuringReadbackEngine as unknown as { _gpuReady: boolean })._gpuReady = true;
  const aliasDuringReadbackIndex = aliasDuringReadbackEngine.grid.idx(1, 1, 1) + F.ENERGY;
  const retainedAlias = getMutableBuffer(aliasDuringReadbackEngine.grid);
  const staleAliasReadback = aliasDuringReadbackEngine.grid.buffer.slice();
  const pendingAliasReadback = await beginPendingReadback(aliasDuringReadbackEngine, staleAliasReadback);
  const revisionBeforeUntrackedAliasWrite = aliasDuringReadbackEngine.grid.mutationRevision;
  retainedAlias[aliasDuringReadbackIndex] = 707;
  assert.equal(aliasDuringReadbackEngine.grid.mutationRevision, revisionBeforeUntrackedAliasWrite,
    "raw alias writes are not intrinsically revision-tracked; the pending-readback guard must cover them");
  pendingAliasReadback.release(staleAliasReadback);
  await assert.rejects(pendingAliasReadback.step, /Discarded stale GPU readback/);
  assert.equal(aliasDuringReadbackEngine.grid.buffer[aliasDuringReadbackIndex], 707,
    "an untracked alias write during readback must survive stale GPU result rejection");

  const aliasDuringBackReadbackEngine = new SimulationEngine(4, 4, 4);
  (aliasDuringBackReadbackEngine as unknown as { _gpuReady: boolean })._gpuReady = true;
  const aliasDuringBackIndex = aliasDuringBackReadbackEngine.grid.idx(1, 1, 1) + F.ENTROPY;
  const retainedBackAlias = getMutableBuffer(aliasDuringBackReadbackEngine.grid, "back");
  const staleBackAliasReadback = aliasDuringBackReadbackEngine.grid.buffer.slice();
  const pendingBackAliasReadback = await beginPendingReadback(aliasDuringBackReadbackEngine, staleBackAliasReadback);
  const revisionBeforeUntrackedBackWrite = aliasDuringBackReadbackEngine.grid.mutationRevision;
  retainedBackAlias[aliasDuringBackIndex] = 808;
  assert.equal(aliasDuringBackReadbackEngine.grid.mutationRevision, revisionBeforeUntrackedBackWrite,
    "raw back-alias writes also bypass direct revision tracking");
  pendingBackAliasReadback.release(staleBackAliasReadback);
  await assert.rejects(pendingBackAliasReadback.step, /Discarded stale GPU readback/);
  assert.equal(aliasDuringBackReadbackEngine.grid.backBuffer[aliasDuringBackIndex], 808,
    "an untracked back-buffer alias write must be preserved when stale readback is rejected");

  // Any dense-grid write while a GPU readback is pending must invalidate that result.
  const staleDense = engine.grid.buffer.slice();
  const pendingDense = await beginPendingReadback(engine, staleDense);
  const beforeDenseWrite = engine.grid.mutationRevision;
  engine.grid.buffer[fieldIndex] = 101;
  assert.ok(engine.grid.mutationRevision > beforeDenseWrite, "direct dense buffer write must advance grid revision");
  pendingDense.release(staleDense);
  await assert.rejects(pendingDense.step, /Discarded stale GPU readback/);
  assert.equal(engine.grid.buffer[fieldIndex], 101, "stale GPU data must not overwrite newer dense state");
  
  // The public back-buffer views are also authoritative mutable state.
  const backBufferEngine = new SimulationEngine(4, 4, 4);
  (backBufferEngine as unknown as { _gpuReady: boolean })._gpuReady = true;
  const backBufferIndex = backBufferEngine.grid.idx(1, 1, 1) + F.ENTROPY;
  const staleBackBuffer = backBufferEngine.grid.buffer.slice();
  staleBackBuffer[backBufferIndex] = 9101;
  const pendingBackBuffer = await beginPendingReadback(backBufferEngine, staleBackBuffer);
  const beforeBackBufferWrite = backBufferEngine.grid.mutationRevision;
  backBufferEngine.grid.backBuffer[backBufferIndex] = 0.75;
  assert.ok(backBufferEngine.grid.mutationRevision > beforeBackBufferWrite,
    "direct back-buffer writes must advance grid revision");
  pendingBackBuffer.release(staleBackBuffer);
  await assert.rejects(pendingBackBuffer.step, /Discarded stale GPU readback/);
  assert.equal(backBufferEngine.grid.backBuffer[backBufferIndex], Math.fround(0.75),
    "stale GPU readback must preserve a newer back-buffer write");

  // CellState views into the back buffer must obey the same invalidation contract.
  const cellBackIndex = backBufferEngine.grid.idx(2, 2, 2) + F.TEMPERATURE;
  const staleCellBack = backBufferEngine.grid.buffer.slice();
  staleCellBack[cellBackIndex] = 9102;
  const pendingCellBack = await beginPendingReadback(backBufferEngine, staleCellBack);
  const beforeCellBackWrite = backBufferEngine.grid.mutationRevision;
  backBufferEngine.grid.cellBack(2, 2, 2).temperature = 321;
  assert.ok(backBufferEngine.grid.mutationRevision > beforeCellBackWrite,
    "CellState writes through cellBack must advance grid revision");
  pendingCellBack.release(staleCellBack);
  await assert.rejects(pendingCellBack.step, /Discarded stale GPU readback/);
  assert.equal(backBufferEngine.grid.backBuffer[cellBackIndex], Math.fround(321),
    "stale GPU readback must preserve a newer cellBack write");

  // Direct SparseVoxelGrid.restoreState calls must invalidate an in-flight GPU
  // result even when the caller does not go through SimulationEngine's wrapper.
  const directRestoreEngine = new SimulationEngine(4, 4, 4);
  (directRestoreEngine as unknown as { _gpuReady: boolean })._gpuReady = true;
  const directRestoreIndex = directRestoreEngine.grid.idx(1, 1, 1) + F.ENERGY;
  const directRestoreSnapshot = directRestoreEngine.grid.captureState();
  directRestoreSnapshot.buffer[directRestoreIndex] = 124;
  const staleDirectRestore = directRestoreEngine.grid.buffer.slice();
  staleDirectRestore[directRestoreIndex] = 9103;
  const pendingDirectRestore = await beginPendingReadback(directRestoreEngine, staleDirectRestore);
  directRestoreEngine.grid.restoreState(directRestoreSnapshot);
  pendingDirectRestore.release(staleDirectRestore);
  await assert.rejects(pendingDirectRestore.step, /Discarded stale GPU readback/);
  assert.equal(directRestoreEngine.grid.buffer[directRestoreIndex], Math.fround(124),
    "stale GPU output must not overwrite state restored directly through SparseVoxelGrid");


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

  // Chunk back-buffer writes are also authoritative, even though GPU readback
  // targets the dense front buffer. They must invalidate any older GPU result.
  const staleChunkBackStep = await beginPendingReadback(engine, engine.grid.buffer.slice());
  const beforeChunkBackWrite = engine.grid.mutationRevision;
  chunk.backBuffer[chunkFieldIndex] = 212;
  assert.ok(engine.grid.mutationRevision > beforeChunkBackWrite,
    "direct chunk back-buffer writes must advance the grid mutation revision");
  staleChunkBackStep.release();
  await assert.rejects(staleChunkBackStep.step, /Discarded stale GPU readback/);
  assert.equal(chunk.backBuffer[chunkFieldIndex], 212,
    "stale GPU readback must not overwrite newer chunk back-buffer state");

  // The range getter must be detached. Because the range is derived from chunk
  // topology, callers cannot install a valid-looking but physically inconsistent override.
  const originalRange = engine.grid.activeChunkRange;
  const detachedRange = engine.grid.activeChunkRange;
  detachedRange.minX = originalRange.minX - 100;
  assert.equal(engine.grid.activeChunkRange.minX, originalRange.minX,
    "nested writes to a returned active-chunk range must not mutate authoritative state");
  const beforeInvalidRange = engine.grid.mutationRevision;
  let inconsistentRangeRejected = false;
  try {
    engine.grid.activeChunkRange = { ...originalRange, minX: originalRange.minX - 1 };
  } catch {
    inconsistentRangeRejected = true;
  }
  assert.ok(inconsistentRangeRejected,
    "active-chunk range replacement must reject values inconsistent with chunk topology");
  assert.equal(engine.grid.mutationRevision, beforeInvalidRange,
    "rejected active-chunk range overrides must not advance grid revision");
  assert.deepEqual(engine.grid.activeChunkRange, originalRange,
    "rejected range override must preserve the topology-derived range");

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

  // Law/process changes made while GPU readback is pending must reject the
  // result computed using the earlier mask/configuration.
  const lawBoundaryEngine = new SimulationEngine(4, 4, 4);
  (lawBoundaryEngine as unknown as { _gpuReady: boolean })._gpuReady = true;
  const lawBoundaryFieldIndex = lawBoundaryEngine.grid.idx(1, 1, 1) + F.ENERGY;
  lawBoundaryEngine.grid.buffer[lawBoundaryFieldIndex] = 21;
  const lawTreeRevision = lawBoundaryEngine.laws.mutationRevision;
  lawBoundaryEngine.laws[0].name = "Tracked law definition";
  assert.ok(lawBoundaryEngine.laws.mutationRevision > lawTreeRevision,
    "nested public law-definition edits must advance the law revision");
  const staleLawResult = lawBoundaryEngine.grid.buffer.slice();
  staleLawResult[lawBoundaryFieldIndex] = 9006;
  const pendingLawReadback = await beginPendingReadback(lawBoundaryEngine, staleLawResult);
  const beforeProcessMutation = lawBoundaryEngine.laws.mutationRevision;
  const waveWasEnabled = (lawBoundaryEngine.laws.activeProcessMask & (1 << PROC.WAVE_PROPAGATION)) !== 0;
  lawBoundaryEngine.laws.toggleProcess(PROC.WAVE_PROPAGATION, !waveWasEnabled);
  assert.ok(lawBoundaryEngine.laws.mutationRevision > beforeProcessMutation,
    "manual process-mask changes must advance the law revision");
  pendingLawReadback.release(staleLawResult);
  await assert.rejects(pendingLawReadback.step, /Discarded stale GPU readback/);
  assert.equal(lawBoundaryEngine.grid.buffer[lawBoundaryFieldIndex], 21,
    "stale GPU output computed with an old process mask must not overwrite current CPU state");

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

  // Explicit chunk-access timestamp writes influence inactive-chunk eviction and
  // therefore must be revision-visible. Internal getCell() LRU refreshes remain
  // bookkeeping-only so ordinary reads do not constantly invalidate GPU work.
  const recencyEngine = new SimulationEngine(4, 4, 4);
  (recencyEngine as unknown as { _gpuReady: boolean })._gpuReady = true;
  const recencyChunk = recencyEngine.grid.chunks.get("0,0,0");
  assert.ok(recencyChunk, "expected dense-window chunk for access-time regression");
  const beforeInvalidAccessTime = recencyEngine.grid.mutationRevision;
  assert.throws(() => { recencyChunk.lastAccessed = Number.NaN; },
    /Chunk\.lastAccessed must be a finite non-negative timestamp/);
  assert.equal(recencyEngine.grid.mutationRevision, beforeInvalidAccessTime,
    "rejected invalid access-time writes must not advance mutation revision");

  const recencyIndex = recencyEngine.grid.idx(1, 1, 1) + F.ENERGY;
  const staleRecency = recencyEngine.grid.buffer.slice();
  staleRecency[recencyIndex] = 9104;
  const pendingRecency = await beginPendingReadback(recencyEngine, staleRecency);
  const olderAccessTime = Math.max(0, recencyChunk.lastAccessed - 1);
  const beforeAccessTimeWrite = recencyEngine.grid.mutationRevision;
  recencyChunk.lastAccessed = olderAccessTime;
  assert.ok(recencyEngine.grid.mutationRevision > beforeAccessTimeWrite,
    "external chunk.lastAccessed writes must advance grid revision");
  pendingRecency.release(staleRecency);
  await assert.rejects(pendingRecency.step, /Discarded stale GPU readback/);
  assert.equal(recencyChunk.lastAccessed, olderAccessTime,
    "stale GPU output must not erase explicit chunk access-time changes");


  console.log("SimulationEngine stale GPU readback mutation-revision regression: PASS");
}

await runSimulationEngineStaleReadbackRegression();
