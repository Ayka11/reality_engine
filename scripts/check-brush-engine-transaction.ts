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

console.log("PASS: BrushEngine commit/undo/redo rollback on chunk synchronization failure");
