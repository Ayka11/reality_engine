import { F } from "../core/CellState";
import { SparseVoxelGrid } from "../core/SparseVoxelGrid";

export function runSparseVoxelGridRecoveryRegression(): void {
  const grid = new SparseVoxelGrid(4, 4, 2);
  const denseIndex = grid.idx(1, 2, 1) + F.ENERGY;
  grid.buffer[denseIndex] = 123.5;
  grid.backBuffer[denseIndex] = 17.25;

  const chunk = grid.getOrCreateChunk(2, 0, 0);
  chunk.buffer[0] = 55;
  chunk.backBuffer[1] = 66;
  grid.markChunksDirty([chunk]);
  chunk.active = false;
  // markChunksDirty refreshes lastAccessed; set the snapshot fixture value afterward.
  chunk.lastAccessed = 123456;
  grid.assignChunkOwner("2,0,0", "worker-A");
  grid.activeChunkRange = { minX: -2, maxX: 4, minY: -1, maxY: 5, minZ: 0, maxZ: 3 };

  const snapshot = grid.captureState();
  grid.buffer[denseIndex] = -1;
  grid.backBuffer[denseIndex] = -2;
  chunk.buffer[0] = -3;
  grid.chunks.delete("2,0,0");
  grid.clearDirtyChunks();
  grid.chunkOwners.clear();
  grid.activeChunkRange = { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };

  grid.restoreState(snapshot);
  const restoredChunk = grid.chunks.get("2,0,0");
  if (!restoredChunk) throw new Error("SparseVoxelGrid restore did not recover chunk membership");
  if (grid.buffer[denseIndex] !== 123.5 || grid.backBuffer[denseIndex] !== 17.25 ||
      restoredChunk.buffer[0] !== 55 || restoredChunk.backBuffer[1] !== 66 ||
      restoredChunk.active !== false || restoredChunk.lastAccessed !== 123456) {
    throw new Error("SparseVoxelGrid restore did not recover dense or chunk buffers");
  }
  if (!grid.dirtyChunks.has("2,0,0") || grid.chunkOwners.get("2,0,0") !== "worker-A" ||
      grid.activeChunkRange.minX !== -2 || grid.activeChunkRange.maxZ !== 3) {
    throw new Error("SparseVoxelGrid restore did not recover scheduling metadata");
  }

  snapshot.buffer[denseIndex] = -500;
  snapshot.chunks.find(item => item.key === "2,0,0")!.buffer[0] = -600;
  if (grid.buffer[denseIndex] !== 123.5 || grid.chunks.get("2,0,0")!.buffer[0] !== 55) {
    throw new Error("SparseVoxelGrid restore retained aliases to snapshot arrays");
  }

  const invalid = grid.captureState();
  invalid.width += 1;
  let rejected = false;
  try {
    grid.restoreState(invalid);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("SparseVoxelGrid restore accepted incompatible dimensions");

  const invalidRange = grid.captureState();
  invalidRange.activeChunkRange = { minX: 3, maxX: -1, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
  rejected = false;
  try {
    grid.restoreState(invalidRange);
  } catch {
    rejected = true;
  }
  if (!rejected || grid.activeChunkRange.minX !== -2 || grid.activeChunkRange.maxX !== 4) {
    throw new Error("SparseVoxelGrid restore accepted an inverted active chunk range or mutated live state");
  }

  const unsafeOrigin = grid.captureState();
  unsafeOrigin.denseOrigin.x = Number.MAX_SAFE_INTEGER + 1;
  rejected = false;
  try {
    grid.restoreState(unsafeOrigin);
  } catch {
    rejected = true;
  }
  if (!rejected || grid.activeChunkRange.minX !== -2 || grid.chunks.get("2,0,0")?.buffer[0] !== 55) {
    throw new Error("SparseVoxelGrid restore accepted an unsafe integer origin or mutated live state");
  }

  const invalidChunkCoordinates = grid.captureState();
  invalidChunkCoordinates.chunks[0].cx = Number.MAX_SAFE_INTEGER + 1;
  rejected = false;
  try {
    grid.restoreState(invalidChunkCoordinates);
  } catch {
    rejected = true;
  }
  if (!rejected || grid.chunks.get("2,0,0")?.buffer[0] !== 55) {
    throw new Error("SparseVoxelGrid restore accepted unsafe chunk coordinates or mutated live state");
  }

  const invalidDirtyKey = grid.captureState();
  invalidDirtyKey.dirtyChunks = ["not-a-chunk-key"];
  rejected = false;
  try {
    grid.restoreState(invalidDirtyKey);
  } catch {
    rejected = true;
  }
  if (!rejected || !grid.dirtyChunks.has("2,0,0") || grid.chunks.get("2,0,0")?.buffer[0] !== 55) {
    throw new Error("SparseVoxelGrid restore accepted a malformed dirty chunk key or mutated live state");
  }

  const invalidOwnerKey = grid.captureState();
  invalidOwnerKey.chunkOwners = [["2,0,0,extra", "worker-B"]];
  rejected = false;
  try {
    grid.restoreState(invalidOwnerKey);
  } catch {
    rejected = true;
  }
  if (!rejected || grid.chunkOwners.get("2,0,0") !== "worker-A" || grid.chunks.get("2,0,0")?.buffer[0] !== 55) {
    throw new Error("SparseVoxelGrid restore accepted a malformed owner chunk key or mutated live state");
  }

  const duplicateDirtyKey = grid.captureState();
  duplicateDirtyKey.dirtyChunks = ["2,0,0", "2,0,0"];
  rejected = false;
  try {
    grid.restoreState(duplicateDirtyKey);
  } catch {
    rejected = true;
  }
  if (!rejected || grid.dirtyChunks.size !== 1 || grid.chunks.get("2,0,0")?.buffer[0] !== 55) {
    throw new Error("SparseVoxelGrid restore accepted duplicate dirty chunk keys or mutated live state");
  }

  const invalidDense = grid.captureState();
  invalidDense.buffer[denseIndex] = Number.NaN;
  rejected = false;
  try {
    grid.restoreState(invalidDense);
  } catch {
    rejected = true;
  }
  if (!rejected || grid.buffer[denseIndex] !== 123.5) {
    throw new Error("SparseVoxelGrid restore accepted non-finite dense data or mutated live state");
  }

  const invalidChunk = grid.captureState();
  invalidChunk.chunks.find(item => item.key === "2,0,0")!.backBuffer[1] = Number.POSITIVE_INFINITY;
  rejected = false;
  try {
    grid.restoreState(invalidChunk);
  } catch {
    rejected = true;
  }
  if (!rejected || grid.chunks.get("2,0,0")!.backBuffer[1] !== 66) {
    throw new Error("SparseVoxelGrid restore accepted non-finite chunk data or mutated live state");
  }
}
