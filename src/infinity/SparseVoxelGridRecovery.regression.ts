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
  chunk.lastAccessed = 123456;
  grid.markChunksDirty([chunk]);
  chunk.active = false;
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
}
