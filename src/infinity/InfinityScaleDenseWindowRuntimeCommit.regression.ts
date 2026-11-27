import { CELL_FIELDS, F } from "../core/CellState";
import { SparseVoxelGridPhysicalAddressAdapter } from "../core/SparseVoxelGridPhysicalAddressAdapter";
import { SparseVoxelGridPhysicalChunk } from "../core/SparseVoxelGridPhysicalChunk";
import { InfinityScaleLODState } from "./InfinityScaleLODState";
import { commitDenseWindowFromPhysicalAdapter } from "./InfinityScaleDenseWindowRuntimeCommit";

function rejected(label: string, operation: () => unknown, fragment: string): void {
  let error: unknown;
  try { operation(); } catch (caught) { error = caught; }
  if (!(error instanceof Error) || !error.message.includes(fragment)) {
    throw new Error(label + " was not rejected at the expected boundary: " + String(error));
  }
}

export function runInfinityScaleDenseWindowRuntimeCommitRegression(): void {
  const physicalChunk = new SparseVoxelGridPhysicalChunk("1:0,0,0");
  const adapter = new SparseVoxelGridPhysicalAddressAdapter([physicalChunk]);
  const window = { width: 2, height: 2, depth: 2, origin: { x: 2, y: 4, z: 6 } };
  const address = adapter.resolve(2, 4, 6);
  if (!address) throw new Error("Expected coarse physical address for runtime commit regression");

  const state = new InfinityScaleLODState(32);
  state.ensureChunk("1:0,0,0", 1);
  const dense = new Float32Array(8 * CELL_FIELDS);
  for (let index = 0; index < 8; index++) {
    dense[index * CELL_FIELDS + F.ENERGY] = index + 1;
    dense[index * CELL_FIELDS + F.DENSITY] = 10 + index;
  }
  const before = state.getRevision();
  const after = commitDenseWindowFromPhysicalAdapter(adapter, window, dense, state, before);
  const stored = state.cloneChunk("1:0,0,0");
  const offset = address.cellIndex * CELL_FIELDS;
  if (!stored || after !== before + 1 ||
      stored.cells[offset + F.ENERGY] !== 36 ||
      stored.cells[offset + F.DENSITY] !== 13.5) {
    throw new Error("Physical adapter coverage was not reduced and published to its matching LOD cell");
  }

  // An independently advanced LOD state revision must block publication.
  const staleStateRevision = state.getRevision();
  state.writePhysicalCellBatchForTransaction(staleStateRevision, []);
  // Empty batches do not advance revision; explicitly mutate a tracked cell.
  state.writeBaseCell("1:0,0,0", 1, 2, 4, 6, new Array<number>(CELL_FIELDS).fill(7));
  const revisionAfterExternalWrite = state.getRevision();
  rejected("stale LOD state revision", () =>
    commitDenseWindowFromPhysicalAdapter(adapter, window, dense, state, staleStateRevision),
  "revision mismatch");
  if (state.getRevision() !== revisionAfterExternalWrite) {
    throw new Error("Rejected stale LOD revision changed authoritative state");
  }

  // Incomplete coarse coverage is rejected before the target state is changed.
  const partialState = new InfinityScaleLODState(32);
  partialState.ensureChunk("1:0,0,0", 1);
  const partialBefore = partialState.getRevision();
  rejected("partial physical coverage", () =>
    commitDenseWindowFromPhysicalAdapter(
      adapter,
      { width: 1, height: 1, depth: 1, origin: { x: 2, y: 4, z: 6 } },
      dense,
      partialState,
      partialBefore,
    ),
  "incomplete physical-cell coverage");
  if (partialState.getRevision() !== partialBefore) {
    throw new Error("Rejected partial coverage changed hierarchical LOD state");
  }

  // A topology key with no corresponding hierarchical target cannot publish.
  const missingTargetState = new InfinityScaleLODState(32);
  const missingBefore = missingTargetState.getRevision();
  rejected("missing hierarchical target", () =>
    commitDenseWindowFromPhysicalAdapter(adapter, window, dense, missingTargetState, missingBefore),
  "missing or inconsistent");
  if (missingTargetState.getRevision() !== missingBefore) {
    throw new Error("Missing target rejection changed hierarchical LOD state");
  }

  console.log("Infinity Scale physical-adapter-to-LOD runtime commit revision, coverage and target-identity regressions: PASS");
}
