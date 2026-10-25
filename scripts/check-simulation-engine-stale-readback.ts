import assert from "node:assert/strict";
import { F } from "../src/core/CellState.ts";
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
  const staleChunkStep = await beginPendingReadback(engine, engine.grid.buffer.slice());
  const beforeChunkWrite = engine.grid.mutationRevision;
  chunk.buffer[chunkFieldIndex] = 202;
  assert.ok(engine.grid.mutationRevision > beforeChunkWrite, "direct chunk write must advance grid revision");
  staleChunkStep.release();
  await assert.rejects(staleChunkStep.step, /Discarded stale GPU readback/);
  assert.equal(chunk.buffer[chunkFieldIndex], 202, "stale GPU readback must not mutate newer chunk state");

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

  assert.ok(engine.grid.mutationRevision > publicRevision, "all external mutation scenarios should be revision-visible");
  console.log("SimulationEngine stale GPU readback mutation-revision regression: PASS");
}

await runSimulationEngineStaleReadbackRegression();
