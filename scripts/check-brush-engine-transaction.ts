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

console.log("PASS: BrushEngine commit/undo/redo rollback on chunk synchronization failure");
