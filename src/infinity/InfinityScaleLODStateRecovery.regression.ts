import { CELL_FIELDS } from "../core/CellState";
import { InfinityScaleLODState } from "./InfinityScaleLODState";

export function runInfinityScaleLODStateRecoveryRegression(): void {
  const state = new InfinityScaleLODState(2);
  const key = "0:0,0,0";
  const original = state.ensureChunk(key, 0);
  original.cells[0] = 17;
  original.cells[1] = 3.5;

  const snapshot = state.snapshot();
  original.cells[0] = 99;
  state.ensureChunk("1:1,0,0", 1).cells[0] = 42;
  state.beginRevision();
  const revisionBeforeRestore = state.getRevision();

  state.restore(snapshot);

  const restored = state.getChunk(key);
  if (!restored) throw new Error("LOD recovery did not restore the original chunk");
  if (restored.cells[0] !== 17 || restored.cells[1] !== 3.5) {
    throw new Error("LOD recovery did not restore original cell values");
  }
  if (state.hasChunk("1:1,0,0")) {
    throw new Error("LOD recovery retained a chunk created after the snapshot");
  }
  if (state.getRevision() <= revisionBeforeRestore) {
    throw new Error("LOD recovery did not invalidate outstanding transaction revisions");
  }
  if (restored.cells.length !== 2 ** 3 * CELL_FIELDS) {
    throw new Error("LOD recovery restored a malformed cell buffer");
  }

  // The snapshot must not share storage with the restored state.
  snapshot.chunks[0].cells[0] = -1;
  if (restored.cells[0] !== 17) {
    throw new Error("LOD recovery snapshot aliases restored mutable state");
  }

  runInfinityScaleLODStateInvalidSnapshotRegression();
}

export function runInfinityScaleLODStateInvalidSnapshotRegression(): void {
  const state = new InfinityScaleLODState(2);
  state.ensureChunk("0:0,0,0", 0).cells[0] = 5;
  state.ensureChunk("1:-1,0,0", 1).cells[1] = 9;
  const baseline = state.snapshot();

  const cloneBaseline = (): InfinityScaleLODStateSnapshot => ({
    chunks: baseline.chunks.map(chunk => ({
      key: chunk.key,
      level: chunk.level,
      scale: chunk.scale,
      cells: new Float32Array(chunk.cells),
    })),
  });

  const assertRejectedWithoutMutation = (candidate: unknown, label: string): void => {
    const before = JSON.stringify(state.snapshot());
    const revisionBefore = state.getRevision();
    let rejected = false;
    try {
      state.restore(candidate as InfinityScaleLODStateSnapshot);
    } catch {
      rejected = true;
    }
    if (!rejected) {
      throw new Error(`LOD recovery accepted malformed snapshot: ${label}`);
    }
    if (state.getRevision() !== revisionBefore) {
      throw new Error(`Rejected LOD snapshot changed revision: ${label}`);
    }
    if (JSON.stringify(state.snapshot()) !== before) {
      throw new Error(`Rejected LOD snapshot partially mutated live state: ${label}`);
    }
  };

  assertRejectedWithoutMutation(null, "null snapshot");
  assertRejectedWithoutMutation({ chunks: null }, "non-array chunk collection");
  assertRejectedWithoutMutation({ chunks: [null] }, "null chunk entry");

  const invalidKey = cloneBaseline();
  invalidKey.chunks[0].key = "not-a-lod-key";
  assertRejectedWithoutMutation(invalidKey, "invalid chunk key");

  const nonCanonicalKey = cloneBaseline();
  nonCanonicalKey.chunks[0].key = "00:0,0,0";
  assertRejectedWithoutMutation(nonCanonicalKey, "non-canonical chunk key");

  const unsafeCoordinate = cloneBaseline();
  unsafeCoordinate.chunks[0].key = "0:9007199254740992,0,0";
  assertRejectedWithoutMutation(unsafeCoordinate, "unsafe chunk coordinate");

  const keyLevelMismatch = cloneBaseline();
  keyLevelMismatch.chunks[0].key = "1:0,0,0";
  assertRejectedWithoutMutation(keyLevelMismatch, "key level mismatch");

  const wrongScale = cloneBaseline();
  wrongScale.chunks[0].scale = 2;
  assertRejectedWithoutMutation(wrongScale, "level/scale mismatch");

  const wrongBufferType = cloneBaseline();
  (wrongBufferType.chunks[0] as unknown as { cells: unknown }).cells = [5];
  assertRejectedWithoutMutation(wrongBufferType, "non-Float32Array cell buffer");

  const wrongBufferLength = cloneBaseline();
  wrongBufferLength.chunks[0].cells = new Float32Array(1);
  assertRejectedWithoutMutation(wrongBufferLength, "wrong cell buffer length");

  const nanCell = cloneBaseline();
  nanCell.chunks[0].cells[0] = Number.NaN;
  assertRejectedWithoutMutation(nanCell, "NaN cell value");

  const infiniteCell = cloneBaseline();
  infiniteCell.chunks[0].cells[0] = Number.POSITIVE_INFINITY;
  assertRejectedWithoutMutation(infiniteCell, "infinite cell value");

  const duplicateKey = cloneBaseline();
  duplicateKey.chunks[1].key = duplicateKey.chunks[0].key;
  assertRejectedWithoutMutation(duplicateKey, "duplicate chunk key");
}

import type { InfinityScaleLODStateSnapshot } from "./InfinityScaleLODState";
