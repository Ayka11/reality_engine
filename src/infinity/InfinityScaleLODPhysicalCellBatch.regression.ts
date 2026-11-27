import { CELL_FIELDS, F } from "../core/CellState";
import { InfinityScaleLODState } from "./InfinityScaleLODState";
import { stageDenseWindowPhysicalReductions } from "./InfinityScaleDenseWindowReduction";
import { commitDenseWindowPhysicalReductions } from "./InfinityScaleDenseWindowCommit";

function expectRejected(label: string, operation: () => unknown, fragment: string): void {
  let failure: unknown;
  try { operation(); } catch (error) { failure = error; }
  if (!(failure instanceof Error) || !failure.message.includes(fragment)) {
    throw new Error(label + " was not rejected at the expected boundary: " + String(failure));
  }
}

function readCell(state: InfinityScaleLODState, index: number): Float32Array {
  const chunk = state.cloneChunk("0:0,0,0");
  if (!chunk) throw new Error("Expected physical LOD chunk");
  return chunk.cells.slice(index * CELL_FIELDS, (index + 1) * CELL_FIELDS);
}

export function runInfinityScaleLODPhysicalCellBatchRegression(): void {
  const state = new InfinityScaleLODState(2);
  state.ensureChunk("0:0,0,0", 0);
  const initialRevision = state.getRevision();

  const first = new Array<number>(CELL_FIELDS).fill(0);
  first[F.ENERGY] = 11;
  first[F.DENSITY] = 3;
  const second = new Array<number>(CELL_FIELDS).fill(0);
  second[F.ENERGY] = 22;
  second[F.TEMPERATURE] = 290;

  const committedRevision = state.writePhysicalCellBatchForTransaction(initialRevision, [
    { chunkKey: "0:0,0,0", cellIndex: 0, level: 0, values: first },
    { chunkKey: "0:0,0,0", cellIndex: 7, level: 0, values: second },
  ]);
  if (committedRevision !== initialRevision + 1 || state.getRevision() !== committedRevision) {
    throw new Error("Physical cell batch did not advance the state revision exactly once");
  }
  if (readCell(state, 0)[F.ENERGY] !== 11 ||
      readCell(state, 0)[F.DENSITY] !== 3 ||
      readCell(state, 7)[F.ENERGY] !== 22 ||
      readCell(state, 7)[F.TEMPERATURE] !== 290) {
    throw new Error("Physical cell batch did not publish complete cell vectors");
  }

  const beforeRejectedBatch = state.snapshot();
  const revisionBeforeRejectedBatch = state.getRevision();
  const validCandidate = new Array<number>(CELL_FIELDS).fill(0);
  validCandidate[F.ENERGY] = 99;
  const invalidCandidate = new Array<number>(CELL_FIELDS).fill(0);
  invalidCandidate[F.ENERGY] = Number.NaN;
  expectRejected("batch with a later non-finite cell", () =>
    state.writePhysicalCellBatchForTransaction(revisionBeforeRejectedBatch, [
      { chunkKey: "0:0,0,0", cellIndex: 1, level: 0, values: validCandidate },
      { chunkKey: "0:0,0,0", cellIndex: 2, level: 0, values: invalidCandidate },
    ]),
  "finite Float32 value");
  if (state.getRevision() !== revisionBeforeRejectedBatch ||
      readCell(state, 1)[F.ENERGY] !== 0 ||
      readCell(state, 2)[F.ENERGY] !== 0) {
    throw new Error("Rejected physical cell batch partially published an earlier valid target");
  }

  expectRejected("duplicate physical targets", () =>
    state.writePhysicalCellBatchForTransaction(revisionBeforeRejectedBatch, [
      { chunkKey: "0:0,0,0", cellIndex: 3, level: 0, values: validCandidate },
      { chunkKey: "0:0,0,0", cellIndex: 3, level: 0, values: validCandidate },
    ]),
  "duplicate target");
  expectRejected("missing target chunk", () =>
    state.writePhysicalCellBatchForTransaction(revisionBeforeRejectedBatch, [
      { chunkKey: "0:1,0,0", cellIndex: 0, level: 0, values: validCandidate },
    ]),
  "missing or inconsistent");
  expectRejected("cell index outside chunk", () =>
    state.writePhysicalCellBatchForTransaction(revisionBeforeRejectedBatch, [
      { chunkKey: "0:0,0,0", cellIndex: 8, level: 0, values: validCandidate },
    ]),
  "outside chunk");
  expectRejected("stale state revision", () =>
    state.writePhysicalCellBatchForTransaction(initialRevision, [
      { chunkKey: "0:0,0,0", cellIndex: 4, level: 0, values: validCandidate },
    ]),
  "revision mismatch");

  // Inject a failure after the first target write to exercise actual rollback,
  // not merely preflight rejection. The prototype is restored in all cases.
  const rollbackRevision = state.getRevision();
  const rollbackBefore = state.snapshot();
  const originalTypedArraySet = Float32Array.prototype.set;
  let setCalls = 0;
  Object.defineProperty(Float32Array.prototype, "set", {
    configurable: true,
    writable: true,
    value: function(source: ArrayLike<number>, offset?: number): void {
      setCalls += 1;
      if (setCalls === 2) throw new Error("injected physical batch publication failure");
      Reflect.apply(originalTypedArraySet, this, [source, offset]);
    },
  });
  let injectedFailure: unknown;
  try {
    state.writePhysicalCellBatchForTransaction(rollbackRevision, [
      { chunkKey: "0:0,0,0", cellIndex: 4, level: 0, values: validCandidate },
      { chunkKey: "0:0,0,0", cellIndex: 5, level: 0, values: validCandidate },
    ]);
  } catch (error) {
    injectedFailure = error;
  } finally {
    Object.defineProperty(Float32Array.prototype, "set", {
      configurable: true,
      writable: true,
      value: originalTypedArraySet,
    });
  }
  const rollbackAfter = state.snapshot();
  if (!(injectedFailure instanceof Error) ||
      !injectedFailure.message.includes("rolled back") ||
      state.getRevision() !== rollbackRevision ||
      rollbackAfter.chunks[0].cells.some((value, index) => value !== rollbackBefore.chunks[0].cells[index])) {
    throw new Error("Injected physical cell batch publication failure did not restore all authoritative bytes and revision");
  }

  const emptyRevision = state.writePhysicalCellBatchForTransaction(revisionBeforeRejectedBatch, []);
  if (emptyRevision !== revisionBeforeRejectedBatch || state.getRevision() !== revisionBeforeRejectedBatch) {
    throw new Error("Empty physical cell batch unexpectedly changed state revision");
  }

  // The snapshot remains a detached record of the pre-rejection state.
  if (beforeRejectedBatch.chunks[0].cells[0] !== 11 ||
      beforeRejectedBatch.chunks[0].cells[7 * CELL_FIELDS + F.ENERGY] !== 22) {
    throw new Error("Physical cell batch mutated a previously captured state snapshot");
  }

  // End-to-end staged reduction -> revision-bound physical publication.
  const coarseState = new InfinityScaleLODState(2);
  coarseState.ensureChunk("1:0,0,0", 1);
  const dense = new Float32Array(8 * CELL_FIELDS);
  for (let index = 0; index < 8; index++) {
    dense[index * CELL_FIELDS + F.ENERGY] = index + 1;
    dense[index * CELL_FIELDS + F.DENSITY] = 10 + index;
  }
  const coverage = {
    width: 2, height: 2, depth: 2, revision: 5,
    complete: true, incompleteCellCount: 0,
    cells: [{
      chunkKey: "1:0,0,0", cellIndex: 0, level: 1,
      expectedBaseSamples: 8, observedBaseSamples: 8,
      denseIndices: [0, 1, 2, 3, 4, 5, 6, 7], complete: true,
    }],
  };
  const staged = stageDenseWindowPhysicalReductions(dense, coverage, 5);
  const beforePublish = coarseState.getRevision();
  const afterPublish = commitDenseWindowPhysicalReductions(coarseState, beforePublish, staged);
  const coarseChunk = coarseState.cloneChunk("1:0,0,0");
  if (!coarseChunk || afterPublish !== beforePublish + 1 ||
      coarseChunk.cells[F.ENERGY] !== 36 ||
      coarseChunk.cells[F.DENSITY] !== 13.5) {
    throw new Error("Staged dense-window reduction was not atomically published to the physical LOD cell");
  }

  // SparseVoxelGrid uses the legacy unprefixed key for LOD0. The bridge
  // must normalize it to InfinityScaleLODState's explicit level-prefixed key.
  const fineState = new InfinityScaleLODState(2);
  fineState.ensureChunk("0:0,0,0", 0);
  const fineDense = new Float32Array(8 * CELL_FIELDS);
  fineDense[5 * CELL_FIELDS + F.ENERGY] = 123;
  const fineCoverage = {
    width: 2, height: 2, depth: 2, revision: 6,
    complete: true, incompleteCellCount: 0,
    cells: [{
      chunkKey: "0,0,0", cellIndex: 5, level: 0,
      expectedBaseSamples: 1, observedBaseSamples: 1,
      denseIndices: [5], complete: true,
    }],
  };
  const fineStaged = stageDenseWindowPhysicalReductions(fineDense, fineCoverage, 6);
  const fineRevision = fineState.getRevision();
  commitDenseWindowPhysicalReductions(fineState, fineRevision, fineStaged);
  const fineChunk = fineState.cloneChunk("0:0,0,0");
  if (!fineChunk || fineChunk.cells[5 * CELL_FIELDS + F.ENERGY] !== 123) {
    throw new Error("Level-zero physical key was not normalized and committed to hierarchical state");
  }

  console.log("Infinity Scale physical cell batch atomic preflight, complete-vector publication, revision ownership, duplicate target and rollback-safe rejection regressions: PASS");
}
