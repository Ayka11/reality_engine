import assert from "node:assert/strict";
import { BrushEngine } from "../src/sculpt/BrushEngine.ts";
import { SparseVoxelGrid } from "../src/core/SparseVoxelGrid.ts";
import { F } from "../src/core/CellState.ts";

function makeStroke() {
  return {
    tool: "inject" as const,
    position: [3, 3, 3] as [number, number, number],
    radius: 1,
    strength: 1,
    falloff: "sharp" as const,
    parameters: { fields: { energy: 1 } },
    affectedChunks: [],
  };
}

function assertBufferEqual(actual: Float32Array, expected: Float32Array, message: string) {
  assert.deepEqual(Array.from(actual), Array.from(expected), message);
}

const grid = new SparseVoxelGrid(8, 8, 8);
const engine = new BrushEngine(grid);
grid.buffer[grid.idx(3, 3, 3) + F.ENERGY] = 7;
grid.syncDenseToChunks();
const sync = grid.syncDenseToChunks.bind(grid);

// Segment planning must map non-aligned and negative dense origins across
// multiple physical chunks without losing or shifting any field values.
const offsetGrid = new SparseVoxelGrid(19, 3, 2);
offsetGrid.denseOrigin = { x: 14, y: -2, z: 31 };
for (let z = 0; z < offsetGrid.D; z++) {
  for (let y = 0; y < offsetGrid.H; y++) {
    for (let x = 0; x < offsetGrid.W; x++) {
      const base = offsetGrid.idx(x, y, z);
      offsetGrid.buffer[base + F.ENERGY] = 1000 + x + 100 * y + 10000 * z;
      offsetGrid.buffer[base + F.INFORMATION] = x + y + z + 0.25;
    }
  }
}
const offsetBaseline = offsetGrid.buffer.slice();
offsetGrid.syncDenseToChunks();
for (let z = 0; z < offsetGrid.D; z++) {
  for (let y = 0; y < offsetGrid.H; y++) {
    for (let x = 0; x < offsetGrid.W; x++) {
      const gx = x + offsetGrid.denseOrigin.x;
      const gy = y + offsetGrid.denseOrigin.y;
      const gz = z + offsetGrid.denseOrigin.z;
      const cell = offsetGrid.getCell(gx, gy, gz);
      assert.ok(cell, `chunk cell must exist at (${gx}, ${gy}, ${gz})`);
      const base = offsetGrid.idx(x, y, z);
      assert.equal(cell.energy, offsetBaseline[base + F.ENERGY], "segmented sync must preserve energy across chunk boundaries");
      assert.equal(cell.information, offsetBaseline[base + F.INFORMATION], "segmented sync must preserve information across chunk boundaries");
    }
  }
}
offsetGrid.buffer.fill(0);
offsetGrid.syncChunksToDense();
assertBufferEqual(offsetGrid.buffer, offsetBaseline, "chunk-to-dense round-trip must preserve non-aligned multi-chunk windows");

// A staging failure must not publish a partial dense-to-chunk copy.
const seededChunk = grid.chunks.values().next().value!;
const chunkBeforeStagingFailure = seededChunk.buffer.slice();
const denseBeforeStagingFailure = grid.buffer.slice();
const originalLocalIdx = seededChunk.localIdx.bind(seededChunk);
let localIdxCalls = 0;
seededChunk.localIdx = (lx: number, ly: number, lz: number) => {
  localIdxCalls++;
  if (localIdxCalls === 12) throw new Error("injected staging failure");
  return originalLocalIdx(lx, ly, lz);
};
grid.buffer[grid.idx(3, 3, 3) + F.ENERGY] = 777;
assert.throws(() => grid.syncDenseToChunks(), /injected staging failure/);
assertBufferEqual(seededChunk.buffer, chunkBeforeStagingFailure, "staging failure must not publish partial chunk data");
seededChunk.localIdx = originalLocalIdx;
grid.buffer.set(denseBeforeStagingFailure);

const beforeFailedApply = grid.buffer.slice();
grid.syncDenseToChunks = () => { throw new Error("injected sync failure"); };
await assert.rejects(() => engine.applyStroke(makeStroke()), /injected sync failure/);
assertBufferEqual(grid.buffer, beforeFailedApply, "failed stroke must restore dense state");
assert.equal(engine.historyLength, 0, "failed stroke must not create history");
assert.equal(engine.redoLength, 0, "failed stroke must not clear or create redo history");

grid.syncDenseToChunks = sync;
await engine.applyStroke(makeStroke());
const afterApply = grid.buffer.slice();
assert.ok(afterApply.some((value, index) => value !== beforeFailedApply[index]), "successful stroke must mutate the dense grid");
const historyAfterApply = engine.historyLength;

grid.syncDenseToChunks = () => { throw new Error("injected undo sync failure"); };
assert.throws(() => engine.undo(), /injected undo sync failure/);
assertBufferEqual(grid.buffer, afterApply, "failed undo must restore the pre-undo dense state");
assert.equal(engine.historyLength, historyAfterApply, "failed undo must preserve its history record");
assert.equal(engine.redoLength, 0, "failed undo must not create redo history");

grid.syncDenseToChunks = sync;
assert.ok(engine.undo(), "undo should succeed after synchronization recovers");
const afterUndo = grid.buffer.slice();
assert.equal(engine.historyLength, 0);
assert.equal(engine.redoLength, 1);

grid.syncDenseToChunks = () => { throw new Error("injected redo sync failure"); };
assert.throws(() => engine.redo(), /injected redo sync failure/);
assertBufferEqual(grid.buffer, afterUndo, "failed redo must restore the pre-redo dense state");
assert.equal(engine.historyLength, 0, "failed redo must not create history");
assert.equal(engine.redoLength, 1, "failed redo must preserve the redo record");

grid.syncDenseToChunks = sync;
assert.ok(engine.redo(), "redo should succeed after synchronization recovers");
assert.equal(engine.historyLength, 1);
assert.equal(engine.redoLength, 0);

const customEngine = new BrushEngine(grid);
const beforeCustom = grid.buffer.slice();
grid.syncDenseToChunks = () => { throw new Error("injected custom sync failure"); };
await assert.rejects(() => customEngine.applyCustomStroke(makeStroke(), () => {
  grid.buffer[grid.idx(3, 3, 3) + F.ENERGY] = 999;
}), /injected custom sync failure/);
assertBufferEqual(grid.buffer, beforeCustom, "failed custom stroke must restore dense state");
assert.equal(customEngine.historyLength, 0, "failed custom stroke must not create history");

grid.syncDenseToChunks = sync;
const beforeCallbackFailure = grid.buffer.slice();
const affectedChunk = grid.getOrCreateChunk(0, 0, 0);
const chunkBeforeCallbackFailure = affectedChunk.buffer.slice();
await assert.rejects(() => customEngine.applyCustomStroke(makeStroke(), () => {
  grid.buffer[grid.idx(3, 3, 3) + F.ENERGY] = 555;
  affectedChunk.buffer[affectedChunk.localIdx(3, 3, 3) + F.ENERGY] = 666;
  throw new Error("injected custom callback failure");
}), /injected custom callback failure/);
assertBufferEqual(grid.buffer, beforeCallbackFailure, "failed custom callback must restore dense state");
assertBufferEqual(affectedChunk.buffer, chunkBeforeCallbackFailure, "failed custom callback must restore direct chunk writes");
assert.equal(customEngine.historyLength, 0, "failed custom callback must not create history");

// Async callbacks must be rejected before invocation; otherwise delayed writes
// could occur after the custom stroke has captured history and published chunks.
const beforeAsyncCallback = grid.buffer.slice();
let asyncCallbackInvoked = false;
const spoofedAsyncCustomCallback = async () => {
  asyncCallbackInvoked = true;
  grid.buffer[grid.idx(3, 3, 3) + F.ENERGY] = 12345;
  await Promise.resolve();
};
Object.defineProperty(spoofedAsyncCustomCallback, Symbol.toStringTag, { value: "Function" });
await assert.rejects(
  () => customEngine.applyCustomStroke(makeStroke(), spoofedAsyncCustomCallback),
  /must remain synchronous/,
);
await Promise.resolve();
assert.equal(asyncCallbackInvoked, false,
  "async custom sculpt callback must be rejected before its first instruction");
assertBufferEqual(grid.buffer, beforeAsyncCallback,
  "rejected async custom callback must not mutate dense state");
assert.equal(customEngine.historyLength, 0,
  "rejected async custom callback must not create history");

// Opaque bound callbacks fail closed, and ordinary callbacks returning thenables
// are rejected with the same rollback semantics.
const boundAsyncCustomCallback = (async () => {
  asyncCallbackInvoked = true;
}).bind(null);
await assert.rejects(
  () => customEngine.applyCustomStroke(makeStroke(), boundAsyncCustomCallback),
  /must remain synchronous/,
);
assert.equal(asyncCallbackInvoked, false,
  "bound async custom sculpt callback must be rejected before invocation");

let generatorCallbackInvoked = false;
const generatorCustomCallback = (function* () {
  generatorCallbackInvoked = true;
}) as unknown as () => void;
await assert.rejects(
  () => customEngine.applyCustomStroke(makeStroke(), generatorCustomCallback),
  /must remain synchronous/,
);
assert.equal(generatorCallbackInvoked, false,
  "generator custom sculpt callback must be rejected before invocation");

const beforeThenableCallback = grid.buffer.slice();
const thenableCustomCallback = (() => Promise.resolve()) as unknown as () => void;
await assert.rejects(
  () => customEngine.applyCustomStroke(makeStroke(), thenableCustomCallback),
  /must remain synchronous/,
);
assertBufferEqual(grid.buffer, beforeThenableCallback,
  "thenable-returning custom callback must not commit a partial stroke");
assert.equal(customEngine.historyLength, 0,
  "thenable-returning custom callback must not create history");

// A failure after dense-to-chunk synchronization must roll back both mirrors.
// markChunksDirty runs after the chunk copy, so dense-only rollback is insufficient.
const dirtyRollbackGrid = new SparseVoxelGrid(8, 8, 8);
const dirtyRollbackEngine = new BrushEngine(dirtyRollbackGrid);
dirtyRollbackGrid.buffer[dirtyRollbackGrid.idx(3, 3, 3) + F.ENERGY] = 17;
dirtyRollbackGrid.syncDenseToChunks();
const dirtyRollbackChunk = dirtyRollbackGrid.chunks.get("0,0,0")!;
const dirtyRollbackDenseBefore = dirtyRollbackGrid.buffer.slice();
const dirtyRollbackChunkBefore = dirtyRollbackChunk.buffer.slice();
const markChunksDirty = dirtyRollbackGrid.markChunksDirty.bind(dirtyRollbackGrid);
dirtyRollbackGrid.markChunksDirty = () => { throw new Error("injected dirty publication failure"); };
await assert.rejects(() => dirtyRollbackEngine.applyStroke(makeStroke()), /injected dirty publication failure/);
assertBufferEqual(dirtyRollbackGrid.buffer, dirtyRollbackDenseBefore,
  "failed dirty publication must restore the dense field");
assertBufferEqual(dirtyRollbackChunk.buffer, dirtyRollbackChunkBefore,
  "failed dirty publication must restore the already-synchronized chunk mirror");
assert.equal(dirtyRollbackEngine.historyLength, 0,
  "failed dirty publication must not create stroke history");

dirtyRollbackGrid.markChunksDirty = markChunksDirty;
await dirtyRollbackEngine.applyStroke(makeStroke());
const committedDirtyDense = dirtyRollbackGrid.buffer.slice();
const committedDirtyChunk = dirtyRollbackChunk.buffer.slice();
const historyBeforeDirtyUndo = dirtyRollbackEngine.historyLength;
dirtyRollbackGrid.markChunksDirty = () => { throw new Error("injected undo dirty publication failure"); };
assert.throws(() => dirtyRollbackEngine.undo(), /injected undo dirty publication failure/);
assertBufferEqual(dirtyRollbackGrid.buffer, committedDirtyDense,
  "failed undo dirty publication must restore the current dense field");
assertBufferEqual(dirtyRollbackChunk.buffer, committedDirtyChunk,
  "failed undo dirty publication must restore the current chunk mirror");
assert.equal(dirtyRollbackEngine.historyLength, historyBeforeDirtyUndo,
  "failed undo dirty publication must preserve its history record");
assert.equal(dirtyRollbackEngine.redoLength, 0);

dirtyRollbackGrid.markChunksDirty = markChunksDirty;
assert.ok(dirtyRollbackEngine.undo());
const undoneDirtyDense = dirtyRollbackGrid.buffer.slice();
const undoneDirtyChunk = dirtyRollbackChunk.buffer.slice();
dirtyRollbackGrid.markChunksDirty = () => { throw new Error("injected redo dirty publication failure"); };
assert.throws(() => dirtyRollbackEngine.redo(), /injected redo dirty publication failure/);
assertBufferEqual(dirtyRollbackGrid.buffer, undoneDirtyDense,
  "failed redo dirty publication must restore the pre-redo dense field");
assertBufferEqual(dirtyRollbackChunk.buffer, undoneDirtyChunk,
  "failed redo dirty publication must restore the pre-redo chunk mirror");
assert.equal(dirtyRollbackEngine.historyLength, 0);
assert.equal(dirtyRollbackEngine.redoLength, 1,
  "failed redo dirty publication must preserve its redo record");

dirtyRollbackGrid.markChunksDirty = markChunksDirty;
assert.ok(dirtyRollbackEngine.redo());
assertBufferEqual(dirtyRollbackGrid.buffer, committedDirtyDense);
assertBufferEqual(dirtyRollbackChunk.buffer, committedDirtyChunk);

const customDirtyRollbackEngine = new BrushEngine(dirtyRollbackGrid);
const customDirtyDenseBefore = dirtyRollbackGrid.buffer.slice();
const customDirtyChunkBefore = dirtyRollbackChunk.buffer.slice();
dirtyRollbackGrid.markChunksDirty = () => { throw new Error("injected custom dirty publication failure"); };
await assert.rejects(() => customDirtyRollbackEngine.applyCustomStroke(makeStroke(), () => {
  dirtyRollbackGrid.buffer[dirtyRollbackGrid.idx(3, 3, 3) + F.ENERGY] = 999;
}), /injected custom dirty publication failure/);
assertBufferEqual(dirtyRollbackGrid.buffer, customDirtyDenseBefore,
  "failed custom dirty publication must restore the dense field");
assertBufferEqual(dirtyRollbackChunk.buffer, customDirtyChunkBefore,
  "failed custom dirty publication must restore the chunk mirror");
assert.equal(customDirtyRollbackEngine.historyLength, 0);
dirtyRollbackGrid.markChunksDirty = markChunksDirty;

// Custom callbacks can touch chunks that are outside the current dense window.
// Their rollback and history must preserve topology and both front/back buffers.
const remoteChunkKey = "4,0,0";
const remoteFailureEngine = new BrushEngine(dirtyRollbackGrid);
assert.equal(dirtyRollbackGrid.chunks.has(remoteChunkKey), false);
await assert.rejects(() => remoteFailureEngine.applyCustomStroke(makeStroke(), () => {
  const remote = dirtyRollbackGrid.getOrCreateChunk(4, 0, 0);
  remote.buffer[F.ENERGY] = 4567;
  remote.backBuffer[F.ENERGY] = 7654;
  throw new Error("injected remote chunk callback failure");
}), /injected remote chunk callback failure/);
assert.equal(dirtyRollbackGrid.chunks.has(remoteChunkKey), false,
  "failed custom callback must remove chunks created outside the dense window");
assert.equal(remoteFailureEngine.historyLength, 0);
assert.equal(remoteFailureEngine.redoLength, 0);

const remoteHistoryEngine = new BrushEngine(dirtyRollbackGrid);
const remoteDenseBefore = dirtyRollbackGrid.buffer.slice();
const remoteBackBefore = dirtyRollbackGrid.backBuffer.slice();
const remoteOwnersBefore = [...dirtyRollbackGrid.chunkOwners.entries()];
const remoteDirtyBefore = [...dirtyRollbackGrid.dirtyChunks];
const remoteDenseIndex = dirtyRollbackGrid.idx(3, 3, 3) + F.ENERGY;
await remoteHistoryEngine.applyCustomStroke(makeStroke(), () => {
  const remote = dirtyRollbackGrid.getOrCreateChunk(4, 0, 0);
  remote.buffer[F.ENERGY] = 4567;
  remote.backBuffer[F.ENERGY] = 7654;
  dirtyRollbackGrid.buffer[remoteDenseIndex] = 9876;
  dirtyRollbackGrid.backBuffer[remoteDenseIndex] = 8765;
  dirtyRollbackGrid.chunkOwners.set(remoteChunkKey, "custom-stroke-owner");
  dirtyRollbackGrid.dirtyChunks.add(remoteChunkKey);
});
const remoteAfterCommit = dirtyRollbackGrid.chunks.get(remoteChunkKey)!;
assert.equal(remoteAfterCommit.buffer[F.ENERGY], 4567);
assert.equal(remoteAfterCommit.backBuffer[F.ENERGY], 7654);
assert.equal(remoteHistoryEngine.historyLength, 1);
assert.equal(dirtyRollbackGrid.buffer[remoteDenseIndex], 9876);
assert.equal(dirtyRollbackGrid.backBuffer[remoteDenseIndex], 8765);
assert.equal(dirtyRollbackGrid.chunkOwners.get(remoteChunkKey), "custom-stroke-owner");
const remoteHistoryInternals = remoteHistoryEngine as unknown as {
  history: Array<{ gridDelta?: {
    chunks: Array<{ key: string; afterFull?: unknown; front?: { indices: Uint32Array }; back?: { indices: Uint32Array } }>;
    buffer: { indices: Uint32Array };
  } }>;
  redoStack: Array<{ gridDelta?: unknown }>;
};
const remoteDelta = remoteHistoryInternals.history[0]?.gridDelta;
assert.ok(remoteDelta, "custom stroke history must store a sparse-grid delta");
const addedRemoteDelta = remoteDelta.chunks.find(chunk => chunk.key === remoteChunkKey);
assert.ok(addedRemoteDelta?.afterFull,
  "a newly created remote chunk must be retained as an addition delta");
assert.ok(remoteDelta.buffer.indices.length > 0,
  "custom stroke delta must include dense-window changes");

// A malformed history delta must fail closed without changing the committed
// world or consuming the undo record.
const validRemoteDenseDeltaIndex = remoteDelta.buffer.indices[0]!;
remoteDelta.buffer.indices[0] = dirtyRollbackGrid.buffer.length + 1;
const committedRemoteDense = dirtyRollbackGrid.buffer.slice();
assert.throws(() => remoteHistoryEngine.undo(), /Sparse-grid delta buffer index or value is invalid/);
assertBufferEqual(dirtyRollbackGrid.buffer, committedRemoteDense,
  "rejected custom undo delta must preserve the committed dense field");
assert.equal(remoteHistoryEngine.historyLength, 1,
  "rejected custom undo delta must preserve its history record");
remoteDelta.buffer.indices[0] = validRemoteDenseDeltaIndex;

assert.ok(remoteHistoryEngine.undo());
assert.equal(dirtyRollbackGrid.chunks.has(remoteChunkKey), false,
  "custom stroke undo must restore sparse topology outside the dense window");
assert.equal(remoteHistoryEngine.historyLength, 0);
assert.equal(remoteHistoryEngine.redoLength, 1);
assertBufferEqual(dirtyRollbackGrid.buffer, remoteDenseBefore,
  "custom stroke undo must restore dense values");
assertBufferEqual(dirtyRollbackGrid.backBuffer, remoteBackBefore,
  "custom stroke undo must restore dense back-buffer values");
assert.deepEqual([...dirtyRollbackGrid.chunkOwners.entries()], remoteOwnersBefore,
  "custom stroke undo must restore chunk ownership metadata");
assert.deepEqual([...dirtyRollbackGrid.dirtyChunks], remoteDirtyBefore,
  "custom stroke undo must restore dirty-chunk metadata");
assert.ok(remoteHistoryInternals.redoStack[0]?.gridDelta,
  "undo must retain the sparse delta required for redo");

assert.ok(remoteHistoryEngine.redo());
const remoteAfterRedo = dirtyRollbackGrid.chunks.get(remoteChunkKey);
assert.ok(remoteAfterRedo, "custom stroke redo must restore the remote sparse chunk");
assert.equal(remoteAfterRedo.buffer[F.ENERGY], 4567);
assert.equal(remoteAfterRedo.backBuffer[F.ENERGY], 7654);
assert.equal(remoteHistoryEngine.historyLength, 1);
assert.equal(remoteHistoryEngine.redoLength, 0);
assert.equal(dirtyRollbackGrid.buffer[remoteDenseIndex], 9876,
  "custom stroke redo must restore dense values");
assert.equal(dirtyRollbackGrid.backBuffer[remoteDenseIndex], 8765,
  "custom stroke redo must restore dense back-buffer values");
assert.equal(dirtyRollbackGrid.chunkOwners.get(remoteChunkKey), "custom-stroke-owner",
  "custom stroke redo must restore chunk ownership metadata");
assert.ok(remoteHistoryInternals.history[0]?.gridDelta,
  "redo must keep the compact sparse delta for subsequent undo");

// Existing sparse chunks outside the dense window must retain their original
// contents through a custom stroke's undo/redo cycle as well.
const existingRemoteKey = "5,0,0";
const existingRemoteChunk = dirtyRollbackGrid.getOrCreateChunk(5, 0, 0);
existingRemoteChunk.buffer[F.ENERGY] = 111;
existingRemoteChunk.backBuffer[F.ENERGY] = 222;
const existingRemoteEngine = new BrushEngine(dirtyRollbackGrid);
await existingRemoteEngine.applyCustomStroke(makeStroke(), () => {
  const remote = dirtyRollbackGrid.chunks.get(existingRemoteKey)!;
  remote.buffer[F.ENERGY] = 333;
  remote.backBuffer[F.ENERGY] = 444;
});
const changedRemote = dirtyRollbackGrid.chunks.get(existingRemoteKey)!;
assert.equal(changedRemote.buffer[F.ENERGY], 333);
assert.equal(changedRemote.backBuffer[F.ENERGY], 444);
const existingRemoteRecord = (existingRemoteEngine as unknown as {
  history: Array<{ gridDelta?: { chunks: Array<{
    key: string; beforeFull?: unknown; afterFull?: unknown;
    front?: { indices: Uint32Array }; back?: { indices: Uint32Array };
  }> } }>;
}).history[0];
const existingRemoteDelta = existingRemoteRecord?.gridDelta?.chunks.find(chunk => chunk.key === existingRemoteKey);
assert.ok(existingRemoteDelta, "existing remote chunk changes must be represented in the sparse delta");
assert.equal(existingRemoteDelta.beforeFull, undefined);
assert.equal(existingRemoteDelta.afterFull, undefined);
assert.equal(existingRemoteDelta.front?.indices.length, 1,
  "existing remote front-buffer delta must store only changed field positions");
assert.equal(existingRemoteDelta.back?.indices.length, 1,
  "existing remote back-buffer delta must store only changed field positions");
assert.ok(existingRemoteEngine.undo());
const restoredRemote = dirtyRollbackGrid.chunks.get(existingRemoteKey)!;
assert.equal(restoredRemote.buffer[F.ENERGY], 111,
  "custom undo must restore the previous front-buffer contents of existing remote chunks");
assert.equal(restoredRemote.backBuffer[F.ENERGY], 222,
  "custom undo must restore the previous back-buffer contents of existing remote chunks");
assert.ok(existingRemoteEngine.redo());
const replayedRemote = dirtyRollbackGrid.chunks.get(existingRemoteKey)!;
assert.equal(replayedRemote.buffer[F.ENERGY], 333);
assert.equal(replayedRemote.backBuffer[F.ENERGY], 444);

// Deleting a sparse chunk is represented as a removal delta and is reversible.
const removedRemoteKey = "6,0,0";
const removedRemoteChunk = dirtyRollbackGrid.getOrCreateChunk(6, 0, 0);
removedRemoteChunk.buffer[F.ENERGY] = 606;
removedRemoteChunk.backBuffer[F.ENERGY] = 707;
const removeChunkEngine = new BrushEngine(dirtyRollbackGrid);
await removeChunkEngine.applyCustomStroke(makeStroke(), () => {
  dirtyRollbackGrid.chunks.delete(removedRemoteKey);
});
assert.equal(dirtyRollbackGrid.chunks.has(removedRemoteKey), false);
const removeRecord = (removeChunkEngine as unknown as {
  history: Array<{ gridDelta?: { chunks: Array<{ key: string; beforeFull?: unknown; afterExists: boolean }> } }>;
}).history[0];
const removedDelta = removeRecord?.gridDelta?.chunks.find(chunk => chunk.key === removedRemoteKey);
assert.ok(removedDelta?.beforeFull,
  "removed sparse chunks must retain their pre-stroke chunk payload");
assert.equal(removedDelta.afterExists, false);
assert.ok(removeChunkEngine.undo());
const restoredRemovedChunk = dirtyRollbackGrid.chunks.get(removedRemoteKey);
assert.ok(restoredRemovedChunk, "undo must restore a removed sparse chunk");
assert.equal(restoredRemovedChunk.buffer[F.ENERGY], 606);
assert.equal(restoredRemovedChunk.backBuffer[F.ENERGY], 707);
assert.ok(removeChunkEngine.redo());
assert.equal(dirtyRollbackGrid.chunks.has(removedRemoteKey), false,
  "redo must remove the sparse chunk again");

console.log("PASS: BrushEngine commit/undo/redo rollback on chunk synchronization failure");
console.log("PASS: Custom sculpt rollback and history preserve sparse chunks outside the dense window");
console.log("PASS: BrushEngine dense and sparse mirrors roll back after dirty-publication failures");
console.log("PASS: BrushEngine custom callbacks reject async, bound, generator and thenable mutation paths");
