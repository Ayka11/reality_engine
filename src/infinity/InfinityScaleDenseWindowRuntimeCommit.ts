import type { SparseVoxelGridDenseWindow } from "../core/SparseVoxelGridPhysicalAddressAdapter";
import { SparseVoxelGridPhysicalAddressAdapter } from "../core/SparseVoxelGridPhysicalAddressAdapter";
import { stageDenseWindowPhysicalReductions } from "./InfinityScaleDenseWindowReduction";
import { commitDenseWindowPhysicalReductions } from "./InfinityScaleDenseWindowCommit";
import { InfinityScaleLODState } from "./InfinityScaleLODState";

/**
 * Connect an immutable physical-topology coverage snapshot to the hierarchical
 * LOD state publication boundary. The adapter revision is checked both before
 * staging and immediately before the synchronous state commit.
 *
 * The denseValues argument must be a detached snapshot from the caller's
 * authoritative dense simulation state. This API cannot infer or validate
 * that external source's revision; callers must capture it consistently with
 * the supplied physical adapter snapshot.
 */
export function commitDenseWindowFromPhysicalAdapter(
  adapter: SparseVoxelGridPhysicalAddressAdapter,
  window: SparseVoxelGridDenseWindow,
  denseValues: ArrayLike<number>,
  state: InfinityScaleLODState,
  expectedStateRevision: number,
): number {
  if (!(adapter instanceof SparseVoxelGridPhysicalAddressAdapter) ||
      !(state instanceof InfinityScaleLODState) ||
      !Number.isSafeInteger(expectedStateRevision) || expectedStateRevision < 0) {
    throw new TypeError("Dense-window runtime commit requires physical adapter, LOD state and expected state revision");
  }

  const expectedAdapterRevision = adapter.revision;
  const coverage = adapter.analyzeDenseWindowCoverage(window);
  if (coverage.revision !== expectedAdapterRevision || adapter.revision !== expectedAdapterRevision) {
    throw new Error("Dense-window runtime commit rejected: physical adapter changed while coverage was captured");
  }

  const staged = stageDenseWindowPhysicalReductions(
    denseValues,
    coverage,
    expectedAdapterRevision,
  );

  // Recheck both independently versioned stores at the final publication
  // boundary. JavaScript synchronous execution prevents an interleaving
  // between this check and the immediately following state batch commit.
  if (adapter.revision !== expectedAdapterRevision) {
    throw new Error("Dense-window runtime commit rejected: physical adapter revision became stale before publication");
  }
  state.assertRevision(expectedStateRevision);
  return commitDenseWindowPhysicalReductions(state, expectedStateRevision, staged);
}
