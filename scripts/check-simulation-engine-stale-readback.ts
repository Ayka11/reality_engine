import assert from "node:assert/strict";
import { F } from "../src/core/CellState.ts";
import { Chunk } from "../src/core/Chunk.ts";
import { SparseVoxelGrid } from "../src/core/SparseVoxelGrid.ts";
import { SimulationEngine } from "../src/simulation/SimulationEngine.ts";

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

  console.log("SimulationEngine stale GPU readback mutation-revision regression: PASS");
}

await runSimulationEngineStaleReadbackRegression();
