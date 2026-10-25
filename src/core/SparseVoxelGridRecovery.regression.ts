import { CELL_FIELDS, F } from "./CellState";
import { SparseVoxelGrid, type SparseVoxelGridSnapshot } from "./SparseVoxelGrid";
import { VoxelGrid } from "./VoxelGrid";

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
    chunkOwners: snapshot.chunkOwners.map(([key, owner]) => [key, owner] as [string, string]),
  };
}

function runGridDimensionValidationRegression(): void {
  const invalidCases: Array<[number, number, number]> = [
    [0, 1, 1],
    [-1, 1, 1],
    [1.5, 1, 1],
    [Number.NaN, 1, 1],
    [1, Number.POSITIVE_INFINITY, 1],
    [Number.MAX_SAFE_INTEGER, 1, 1],
    [Number.MAX_SAFE_INTEGER, 2, 2],
  ];

  for (const dimensions of invalidCases) {
    let sparseRejected = false;
    try { new SparseVoxelGrid(...dimensions); } catch { sparseRejected = true; }
    if (!sparseRejected) {
      throw new Error(`SparseVoxelGrid accepted invalid dimensions: ${dimensions.join("x")}`);
    }

    let denseRejected = false;
    try { new VoxelGrid(...dimensions); } catch { denseRejected = true; }
    if (!denseRejected) {
      throw new Error(`VoxelGrid accepted invalid dimensions: ${dimensions.join("x")}`);
    }
  }
}

export function runSparseVoxelGridRecoveryRegression(): void {
  runGridDimensionValidationRegression();
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

  const metadataRevision = grid.mutationRevision;
  let invalidDirtyKeyRejected = false;
  try { grid.dirtyChunks.add("not-a-chunk-key"); } catch { invalidDirtyKeyRejected = true; }
  if (!invalidDirtyKeyRejected || grid.mutationRevision !== metadataRevision ||
      grid.dirtyChunks.has("not-a-chunk-key")) {
    throw new Error("Invalid dirty-chunk key was not rejected atomically");
  }
  let invalidOwnerKeyRejected = false;
  try { grid.chunkOwners.set("not-a-chunk-key", "worker-B"); } catch { invalidOwnerKeyRejected = true; }
  if (!invalidOwnerKeyRejected || grid.mutationRevision !== metadataRevision ||
      grid.chunkOwners.has("not-a-chunk-key")) {
    throw new Error("Invalid chunk-owner key was not rejected atomically");
  }
  let invalidOwnerValueRejected = false;
  try { grid.chunkOwners.set("0,0,0", 42 as unknown as string); } catch { invalidOwnerValueRejected = true; }
  if (!invalidOwnerValueRejected || grid.mutationRevision !== metadataRevision ||
      grid.chunkOwners.has("0,0,0")) {
    throw new Error("Invalid chunk-owner value was not rejected atomically");
  }
  if (grid.getChunkBoundary("NaN,0,0").neighbors.length !== 0) {
    throw new Error("Invalid chunk key generated a boundary with NaN coordinates");
  }

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
  runSparseChunkSerializationAndLoadRegression();
}

function runSparseChunkSerializationAndLoadRegression(): void {
  const source = new SparseVoxelGrid(4, 4, 4);
  const denseCell = source.idx(1, 1, 1);
  // Energy is zero, but another field is meaningful. Serialization must not
  // classify this chunk as empty and silently discard information/entropy.
  source.buffer[denseCell + F.ENERGY] = 0;
  source.buffer[denseCell + F.INFORMATION] = 0.75;
  source.buffer[denseCell + F.ENTROPY] = 0.125;
  source.syncDenseToChunks();

  const remote = source.getOrCreateChunk(1, 0, 0);
  const remoteCell = remote.localIdx(0, 0, 0);
  remote.buffer[remoteCell + F.DENSITY] = 0.875;
  remote.backBuffer[remoteCell + F.DENSITY] = 0.25;

  const serialized = source.serializeChunks(false);
  if (!serialized.some(chunk => chunk.key === "0,0,0")) {
    throw new Error("Sparse chunk serializer dropped non-energy fields when energy was zero");
  }
  if (!serialized.some(chunk => chunk.key === "1,0,0")) {
    throw new Error("Sparse chunk serializer dropped non-energy fields outside the dense window");
  }

  const target = new SparseVoxelGrid(4, 4, 4);
  target.assignChunkOwner("0,0,0", "stale-owner");
  target.markChunksDirty(["0,0,0", "99,0,0"]);
  target.buffer.fill(99);
  target.backBuffer.fill(88);
  target.loadChunks(serialized);

  if (target.buffer[target.idx(1, 1, 1) + F.INFORMATION] !== 0.75 ||
      target.buffer[target.idx(1, 1, 1) + F.ENTROPY] !== 0.125) {
    throw new Error("Sparse chunk load did not restore non-energy fields");
  }
  if (target.getCell(32, 0, 0)?.density !== 0.875) {
    throw new Error("Sparse chunk load did not preserve data outside the dense window");
  }
  if (target.chunkOwners.size !== 0 || target.dirtyChunks.size !== 0) {
    throw new Error("Sparse chunk load retained ownership/dirty metadata from the previous world");
  }
  for (const chunk of target.chunks.values()) {
    if (chunk.backBuffer.some((value, i) => value !== chunk.buffer[i])) {
      throw new Error("Sparse chunk load left front/back chunk buffers inconsistent");
    }
  }
  if (target.backBuffer.some((value, i) => value !== target.buffer[i])) {
    throw new Error("Sparse chunk load left dense front/back buffers inconsistent");
  }

  const beforeMalformedLoad = JSON.stringify(target.captureState());
  const malformed = serialized.map(chunk => ({ ...chunk }));
  malformed[0] = { ...malformed[0], buffer: new Float32Array([1]).buffer };
  let rejected = false;
  try { target.loadChunks(malformed); } catch { rejected = true; }
  if (!rejected) throw new Error("Sparse chunk load accepted a malformed chunk buffer");
  if (JSON.stringify(target.captureState()) !== beforeMalformedLoad) {
    throw new Error("Sparse chunk load partially mutated state after rejecting malformed input");
  }

  // A runtime failure after live topology publication must restore the old
  // dense/sparse buffers, chunk keys and metadata, while still invalidating
  // revisions so a pending readback cannot overwrite the recovery boundary.
  const beforePublicationFailure = JSON.stringify(target.captureState());
  const revisionBeforePublicationFailure = target.mutationRevision;
  const originalSyncChunksToDense = target.syncChunksToDense.bind(target);
  target.syncChunksToDense = () => { throw new Error("injected load publication failure"); };
  let publicationFailureRejected = false;
  try {
    target.loadChunks(serialized);
  } catch (error) {
    publicationFailureRejected = error instanceof Error && error.message.includes("injected load publication failure");
  } finally {
    target.syncChunksToDense = originalSyncChunksToDense;
  }
  if (!publicationFailureRejected) {
    throw new Error("Sparse chunk load did not surface the injected publication failure");
  }
  if (JSON.stringify(target.captureState()) !== beforePublicationFailure) {
    throw new Error("Sparse chunk load failed to roll back after a post-publication synchronization error");
  }
  if (target.mutationRevision <= revisionBeforePublicationFailure) {
    throw new Error("Failed sparse chunk load did not invalidate the mutation revision");
  }

  // Inject a later failure after syncChunksToDense() has already copied the
  // replacement payload into the dense buffer. Rollback must restore that
  // dense field as well as the prior chunk topology/front/back buffers.
  const beforeLateFailure = JSON.stringify(target.captureState());
  const revisionBeforeLateFailure = target.mutationRevision;
  const replacement = serialized.map(chunk => ({ ...chunk, buffer: chunk.buffer.slice(0) }));
  const replacementBase = replacement.find(chunk => chunk.key === "0,0,0");
  if (!replacementBase) throw new Error("Replacement payload omitted the dense-window chunk");
  const replacementFields = new Float32Array(replacementBase.buffer);
  const sourceCenter = source.chunks.get("0,0,0");
  if (!sourceCenter) throw new Error("Source world omitted the center chunk");
  replacementFields[sourceCenter.localIdx(1, 1, 1) + F.INFORMATION] = 0.99;
  replacementBase.buffer = replacementFields.buffer;

  const originalSyncBackBuffers = target.syncBackBuffersFromFront.bind(target);
  target.syncBackBuffersFromFront = () => { throw new Error("injected back-buffer publication failure"); };
  let lateFailureRejected = false;
  try {
    target.loadChunks(replacement);
  } catch (error) {
    lateFailureRejected = error instanceof Error && error.message.includes("injected back-buffer publication failure");
  } finally {
    target.syncBackBuffersFromFront = originalSyncBackBuffers;
  }
  if (!lateFailureRejected) {
    throw new Error("Sparse chunk load did not surface the injected back-buffer publication failure");
  }
  if (JSON.stringify(target.captureState()) !== beforeLateFailure) {
    throw new Error("Sparse chunk load failed to roll back dense data after post-sync publication failure");
  }
  if (target.mutationRevision <= revisionBeforeLateFailure) {
    throw new Error("Late sparse chunk load failure did not invalidate the mutation revision");
  }
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

  const inconsistentRange = cloneSnapshot(baseline);
  inconsistentRange.activeChunkRange.maxX += 100;
  assertRejectedWithoutMutation(inconsistentRange, "active range inconsistent with chunk topology");

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
  duplicateOwner.chunkOwners.push([...duplicateOwner.chunkOwners[0]] as [string, string]);
  assertRejectedWithoutMutation(duplicateOwner, "duplicate owner key");

  const invalidDirtyChunk = cloneSnapshot(baseline);
  invalidDirtyChunk.dirtyChunks.push("not-a-key");
  assertRejectedWithoutMutation(invalidDirtyChunk, "invalid dirty chunk key");

  const duplicateDirtyChunk = cloneSnapshot(baseline);
  duplicateDirtyChunk.dirtyChunks.push(duplicateDirtyChunk.dirtyChunks[0]);
  assertRejectedWithoutMutation(duplicateDirtyChunk, "duplicate dirty chunk key");
}
