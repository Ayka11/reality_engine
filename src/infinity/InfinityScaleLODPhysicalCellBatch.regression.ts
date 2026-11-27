import { CELL_FIELDS, F } from "../core/CellState";
import { InfinityScaleLODState } from "./InfinityScaleLODState";

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

  const emptyRevision = state.writePhysicalCellBatchForTransaction(revisionBeforeRejectedBatch, []);
  if (emptyRevision !== revisionBeforeRejectedBatch || state.getRevision() !== revisionBeforeRejectedBatch) {
    throw new Error("Empty physical cell batch unexpectedly changed state revision");
  }

  // The snapshot remains a detached record of the pre-rejection state.
  if (beforeRejectedBatch.chunks[0].cells[0] !== 11 ||
      beforeRejectedBatch.chunks[0].cells[7 * CELL_FIELDS + F.ENERGY] !== 22) {
    throw new Error("Physical cell batch mutated a previously captured state snapshot");
  }

  console.log("Infinity Scale physical cell batch atomic preflight, complete-vector publication, revision ownership, duplicate target and rollback-safe rejection regressions: PASS");
}
