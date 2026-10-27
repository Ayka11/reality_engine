import { CELL_FIELDS } from "../core/CellState";
import { InfinityScaleLODState, type InfinityScaleLODStateSnapshot } from "./InfinityScaleLODState";

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
  runInfinityScaleLODChunkIdentityValidationRegression();
  runInfinityScaleLODCellWriteValidationRegression();
}

export function runInfinityScaleLODCellWriteValidationRegression(): void {
  const state = new InfinityScaleLODState(2);
  const chunk = state.ensureChunk("0:0,0,0", 0);
  chunk.cells[0] = 5;

  const assertRejectedWithoutMutation = (label: string, operation: () => void): void => {
    const beforeRevision = state.getRevision();
    const beforeKeys = JSON.stringify(state.keys());
    const before = state.snapshot().chunks.find(candidate => candidate.key === "0:0,0,0")!.cells;
    let rejected = false;
    try {
      operation();
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error(`LOD state accepted invalid cell mutation: ${label}`);
    if (state.getRevision() !== beforeRevision || JSON.stringify(state.keys()) !== beforeKeys) {
      throw new Error(`Rejected LOD cell mutation changed topology/revision: ${label}`);
    }
    const after = state.snapshot().chunks.find(candidate => candidate.key === "0:0,0,0")!.cells;
    for (let index = 0; index < before.length; index++) {
      if (after[index] !== before[index]) {
        throw new Error(`Rejected LOD cell mutation partially changed data at field ${index}: ${label}`);
      }
    }
  };

  assertRejectedWithoutMutation("indexed NaN", () => { chunk.cells[0] = Number.NaN; });
  assertRejectedWithoutMutation("indexed Infinity", () => { chunk.cells[0] = Number.POSITIVE_INFINITY; });
  assertRejectedWithoutMutation("indexed Float32 overflow", () => { chunk.cells[0] = 1e100; });
  assertRejectedWithoutMutation("defineProperty Infinity", () => {
    Object.defineProperty(chunk.cells, "0", { value: Number.NEGATIVE_INFINITY });
  });
  assertRejectedWithoutMutation("fill NaN", () => { chunk.cells.fill(Number.NaN); });
  assertRejectedWithoutMutation("set with late NaN", () => {
    const values = new Array<number>(CELL_FIELDS).fill(12);
    values[CELL_FIELDS - 1] = Number.NaN;
    chunk.cells.set(values);
  });

  const validCellView = chunk.cells;
  const fillRevisionBefore = state.getRevision();
  const fillResult = validCellView.fill(2);
  if (fillResult !== validCellView) {
    throw new Error("Valid LOD cells.fill returned the raw backing array instead of the guarded proxy");
  }
  if (state.getRevision() !== fillRevisionBefore + 1) {
    throw new Error("Valid LOD cells.fill did not advance the mutation revision exactly once");
  }
  const detachedBuffer = fillResult.buffer;
  new Float32Array(detachedBuffer)[0] = 99;
  if (validCellView[0] !== 2) {
    throw new Error("LOD cells.fill returned a buffer view that could mutate authoritative storage");
  }

  const nonFiniteSource = new Array<number>(CELL_FIELDS).fill(4);
  nonFiniteSource[5] = Number.POSITIVE_INFINITY;
  assertRejectedWithoutMutation("writeBaseCell with Infinity", () => {
    state.writeBaseCell("0:0,0,0", 0, 0, 0, 0, nonFiniteSource);
  });

  const missingKey = "0:1,0,0";
  const missingRevision = state.getRevision();
  const missingKeys = JSON.stringify(state.keys());
  let missingRejected = false;
  try {
    state.writeBaseCellForTransaction(missingRevision, missingKey, 0, 2, 0, 0, new Array<number>(CELL_FIELDS).fill(1));
  } catch {
    missingRejected = true;
  }
  if (!missingRejected || state.getRevision() !== missingRevision || JSON.stringify(state.keys()) !== missingKeys) {
    throw new Error("Transaction-owned LOD write created a missing target chunk or changed revision");
  }

  const outOfRangeKey = "0:4,0,0";
  const rangeRevision = state.getRevision();
  const rangeKeys = JSON.stringify(state.keys());
  let rangeRejected = false;
  try {
    state.writeBaseCell(outOfRangeKey, 0, 999, 0, 0, new Array<number>(CELL_FIELDS).fill(1));
  } catch {
    rangeRejected = true;
  }
  if (!rangeRejected || state.getRevision() !== rangeRevision || JSON.stringify(state.keys()) !== rangeKeys) {
    throw new Error("Rejected out-of-range LOD cell write left a placeholder chunk behind");
  }

  let nonFiniteWriteRejected = false;
  try {
    state.writeBaseCell("0:0,0,0", 0, 0, 0, 0, nonFiniteSource);
  } catch {
    nonFiniteWriteRejected = true;
  }
  if (!nonFiniteWriteRejected || state.getRevision() !== rangeRevision || JSON.stringify(state.keys()) !== rangeKeys) {
    throw new Error("Rejected non-finite base-cell write changed state or revision");
  }

  const freshState = new InfinityScaleLODState(2);
  const freshValues = new Array<number>(CELL_FIELDS).fill(0);
  freshValues[0] = 7;
  const freshRevision = freshState.getRevision();
  freshState.writeBaseCell("0:1,0,0", 0, 2, 0, 0, freshValues);
  const freshCell = freshState.readBaseCell("0:1,0,0", 0, 2, 0, 0);
  if (!freshCell || freshCell[0] !== 7 || freshState.getRevision() <= freshRevision) {
    throw new Error("Valid writeBaseCell did not atomically materialize a new chunk and publish its cell values");
  }
}

export function runInfinityScaleLODChunkIdentityValidationRegression(): void {
  const state = new InfinityScaleLODState(2);
  const invalidRequests = [
    { key: "00:0,0,0", level: 0, label: "non-canonical level" },
    { key: "1:-0,0,0", level: 1, label: "negative-zero coordinate" },
    { key: "0:9007199254740992,0,0", level: 0, label: "unsafe coordinate" },
    { key: "0:0,0,0", level: 1, label: "key/argument level mismatch" },
    { key: "1:0,0,0", level: 0, label: "coarse key with fine level argument" },
    { key: "31:0,0,0", level: 31, label: "out-of-range LOD level" },
  ];

  for (const request of invalidRequests) {
    const revisionBefore = state.getRevision();
    const keysBefore = JSON.stringify(state.keys());
    let rejected = false;
    try {
      state.ensureChunk(request.key, request.level);
    } catch {
      rejected = true;
    }
    if (!rejected) {
      throw new Error(`LOD state accepted invalid chunk identity: ${request.label}`);
    }
    if (state.getRevision() !== revisionBefore || JSON.stringify(state.keys()) !== keysBefore) {
      throw new Error(`Rejected chunk identity changed authoritative state: ${request.label}`);
    }
  }

  const negativeChunk = state.ensureChunk("1:-1,0,0", 1);
  if (negativeChunk.key !== "1:-1,0,0" || negativeChunk.level !== 1 || negativeChunk.scale !== 2) {
    throw new Error("Canonical negative-coordinate LOD chunk identity was not preserved");
  }
  const baseCell = state.readBaseCell("1:-1,0,0", 1, -1, 0, 0);
  if (!baseCell || baseCell.length !== CELL_FIELDS) {
    throw new Error("Canonical negative-coordinate LOD chunk could not be resolved in base coordinates");
  }
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
  duplicateKey.chunks[1].level = duplicateKey.chunks[0].level;
  duplicateKey.chunks[1].scale = duplicateKey.chunks[0].scale;
  assertRejectedWithoutMutation(duplicateKey, "duplicate chunk key");
}

