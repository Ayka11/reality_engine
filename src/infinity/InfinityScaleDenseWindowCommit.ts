import { InfinityScaleLODState } from "./InfinityScaleLODState";
import type { DenseWindowPhysicalReduction } from "./InfinityScaleDenseWindowReduction";

/**
 * Publish a fully staged dense-window reduction batch into hierarchical LOD
 * storage. The LOD state performs complete preflight and one revision-bound
 * atomic batch publication. This adapter does not create chunks or alter
 * topology; every target physical chunk must already exist.
 */
export function commitDenseWindowPhysicalReductions(
  state: InfinityScaleLODState,
  expectedStateRevision: number,
  staged: ReadonlyArray<DenseWindowPhysicalReduction>,
): number {
  if (!(state instanceof InfinityScaleLODState) ||
      !Number.isSafeInteger(expectedStateRevision) || expectedStateRevision < 0 ||
      !Array.isArray(staged)) {
    throw new TypeError("Dense-window physical reduction commit requires a state, revision and staged result array");
  }
  return state.writePhysicalCellBatchForTransaction(
    expectedStateRevision,
    staged.map(result => ({
      chunkKey: result.chunkKey,
      cellIndex: result.cellIndex,
      level: result.level,
      values: result.values,
    })),
  );
}
