import { CELL_FIELDS } from "./CellState";
import { SparseVoxelGrid, type SparseVoxelGridSnapshot } from "./SparseVoxelGrid";

function cloneSnapshot(snapshot: SparseVoxelGridSnapshot): SparseVoxelGridSnapshot {
  return {
    width: snapshot.width,
    height: snapshot.height,
    depth: snapshot.depth,
    buffer: new Float32Array(snapshot.buffer),
    backBuffer: new Float32Array(snapshot.backBuffer),
    denseOrigin: { ...snapshot.denseOrigin },
    activeChunkRange: { ...snapshot.activeChunkRange },
    chunks: snapshot.chunks.map(chunk => ({
      ...chunk,
      buffer: new Float32Array(chunk.buffer),
      backBuffer: new Float32Array(chunk.backBuffer),
    })),
    dirtyChunks: [...snapshot.dirtyChunks],
    chunkOwners: snapshot.chunkOwners.map(([key, owner]) => [key, owner]),
  };
}

export function runSparseVoxelGridRecoveryRegression(): void {
  const grid = new SparseVoxelGrid(4, 3, 2);
  const denseIndex = grid.idx(1, 1, 1) + CELL_FIELDS - 1;
  grid.buffer[denseIndex] = 13;
  grid.backBuffer[denseIndex] = 27;

  const sparse = grid.getOrCreateChunk(-2, 1, 0);
  sparse.buffer[0] = 31;
  sparse.backBuffer[1] = 15;
  sparse.active = false;
  sparse.lastAccessed = 1234;

  grid.assignChunkOwner("-2,1,0", "worker-A");
  // Dirty chunks may be known before the corresponding sparse chunk is resident.
  grid.markChunksDirty(["-2,1,0", "99,0,0"]);

  const snapshot = grid.captureState();
  const expected = JSON.stringify(snapshot);

  // Mutate both dense buffers, sparse buffers, topology, and auxiliary metadata.
  grid.buffer.fill(-10);
  grid.backBuffer.fill(-20);
  sparse.buffer.fill(44);
  sparse.backBuffer.fill(55);
  grid.getOrCreateChunk(8, 8, 8);
  grid.assignChunkOwner("0,0,0", "unexpected-owner");
  grid.markChunksDirty(["8,8,8"]);

  grid.restoreState(snapshot);
  const restored = grid.captureState();
  if (JSON.stringify(restored) !== expected) {
    throw new Error("SparseVoxelGrid recovery did not restore dense/sparse buffers and metadata exactly");
  }
  if (grid.chunks.has("8,8,8")) {
    throw new Error("SparseVoxelGrid recovery retained topology created after the snapshot");
  }

  // The snapshot must be detached from live data in both directions.
  const detached = grid.captureState();
  detached.buffer[denseIndex] = -999;
  detached.backBuffer[denseIndex] = -888;
  const detachedChunk = detached.chunks.find(chunk => chunk.key === "-2,1,0");
  if (!detachedChunk) throw new Error("SparseVoxelGrid recovery snapshot omitted the sparse chunk");
  detachedChunk.buffer[0] = -777;
  if (grid.buffer[denseIndex] !== 13 ||
      grid.backBuffer[denseIndex] !== 27 ||
      grid.chunks.get("-2,1,0")?.buffer[0] !== 31) {
    throw new Error("SparseVoxelGrid recovery snapshot aliases live buffers");
  }

  runSparseVoxelGridInvalidSnapshotRegression(grid);
}

export function runSparseVoxelGridInvalidSnapshotRegression(grid = new SparseVoxelGrid(4, 3, 2)): void {
  grid.buffer[0] = 7;
  grid.backBuffer[0] = 11;
  grid.assignChunkOwner("0,0,0", "owner");
  grid.markChunksDirty(["0,0,0"]);
  const baseline = grid.captureState();

  const assertRejectedWithoutMutation = (candidate: unknown, label: string): void => {
    const before = JSON.stringify(grid.captureState());
    let rejected = false;
    try {
      grid.restoreState(candidate as SparseVoxelGridSnapshot);
    } catch {
      rejected = true;
    }
    if (!rejected) {
      throw new Error(`SparseVoxelGrid recovery accepted malformed snapshot: ${label}`);
    }
    if (JSON.stringify(grid.captureState()) !== before) {
      throw new Error(`Rejected SparseVoxelGrid snapshot partially mutated live state: ${label}`);
    }
  };

  assertRejectedWithoutMutation(null, "null snapshot");
  assertRejectedWithoutMutation({ ...cloneSnapshot(baseline), width: baseline.width + 1 }, "dimension mismatch");

  const invalidDense = cloneSnapshot(baseline);
  invalidDense.buffer[0] = Number.NaN;
  assertRejectedWithoutMutation(invalidDense, "non-finite dense buffer");

  const invalidBackBuffer = cloneSnapshot(baseline);
  invalidBackBuffer.backBuffer[0] = Number.POSITIVE_INFINITY;
  assertRejectedWithoutMutation(invalidBackBuffer, "non-finite dense back buffer");

  const invalidOrigin = cloneSnapshot(baseline);
  invalidOrigin.denseOrigin.x = Number.NaN;
  assertRejectedWithoutMutation(invalidOrigin, "invalid dense origin");

  const invalidRange = cloneSnapshot(baseline);
  invalidRange.activeChunkRange.minX = invalidRange.activeChunkRange.maxX + 1;
  assertRejectedWithoutMutation(invalidRange, "inverted active chunk range");

  const invalidChunkKey = cloneSnapshot(baseline);
  invalidChunkKey.chunks[0].key = "not-a-grid-key";
  assertRejectedWithoutMutation(invalidChunkKey, "invalid chunk key");

  const duplicateChunk = cloneSnapshot(baseline);
  duplicateChunk.chunks.push({ ...duplicateChunk.chunks[0],
    buffer: new Float32Array(duplicateChunk.chunks[0].buffer),
    backBuffer: new Float32Array(duplicateChunk.chunks[0].backBuffer),
  });
  assertRejectedWithoutMutation(duplicateChunk, "duplicate chunk key");

  const wrongChunkBuffer = cloneSnapshot(baseline);
  (wrongChunkBuffer.chunks[0] as unknown as { buffer: unknown }).buffer = [0];
  assertRejectedWithoutMutation(wrongChunkBuffer, "wrong sparse buffer type");

  const invalidSparseValue = cloneSnapshot(baseline);
  invalidSparseValue.chunks[0].buffer[0] = Number.POSITIVE_INFINITY;
  assertRejectedWithoutMutation(invalidSparseValue, "non-finite sparse buffer");

  const invalidOwner = cloneSnapshot(baseline);
  invalidOwner.chunkOwners.push(["not-a-key", "owner"]);
  assertRejectedWithoutMutation(invalidOwner, "invalid owner chunk key");

  const duplicateOwner = cloneSnapshot(baseline);
  duplicateOwner.chunkOwners.push([...duplicateOwner.chunkOwners[0]]);
  assertRejectedWithoutMutation(duplicateOwner, "duplicate owner key");

  const invalidDirtyChunk = cloneSnapshot(baseline);
  invalidDirtyChunk.dirtyChunks.push("not-a-key");
  assertRejectedWithoutMutation(invalidDirtyChunk, "invalid dirty chunk key");

  const duplicateDirtyChunk = cloneSnapshot(baseline);
  duplicateDirtyChunk.dirtyChunks.push(duplicateDirtyChunk.dirtyChunks[0]);
  assertRejectedWithoutMutation(duplicateDirtyChunk, "duplicate dirty chunk key");
}
