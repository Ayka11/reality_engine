import type { InfinityScaleExecutionPlan } from "./InfinityScaleExecutionAdapter";
import type { InfinityScaleGlobalExecutionFrame } from "./InfinityScaleGlobalExecutionFrame";
import {
  InfinityScaleLODState,
  type InfinityScaleLODStateSnapshot,
} from "./InfinityScaleLODState";
import {
  InfinityScaleLODSynchronization,
  type InfinityScaleLODSynchronizationResult,
} from "./InfinityScaleLODSynchronization";

export interface InfinityScaleGlobalLODTransaction {
  frameRevision: number;
  stateRevision: number;
  synchronization: InfinityScaleLODSynchronization;
  committed: boolean;
  state: InfinityScaleLODState;
  /** Deep state captured before any local execution writes for this frame. */
  rollbackSnapshot: InfinityScaleLODStateSnapshot;
}

export function beginInfinityScaleGlobalLODTransaction(
  frame: InfinityScaleGlobalExecutionFrame,
  plan: InfinityScaleExecutionPlan,
  state: InfinityScaleLODState,
): InfinityScaleGlobalLODTransaction {
  if (frame.planRevision !== plan.revision) {
    throw new Error("Infinity Scale LOD transaction rejected: frame/plan revision mismatch");
  }
  const stateRevision = state.getRevision();
  const rollbackSnapshot = state.snapshot();
  const synchronization = new InfinityScaleLODSynchronization(state);
  synchronization.begin(stateRevision);

  return {
    frameRevision: frame.revision,
    stateRevision,
    synchronization,
    committed: false,
    state,
    rollbackSnapshot,
  };
}

export function commitInfinityScaleGlobalLODTransaction(
  transaction: InfinityScaleGlobalLODTransaction,
  frame: InfinityScaleGlobalExecutionFrame,
): InfinityScaleLODSynchronizationResult {
  try {
    if (frame.revision !== transaction.frameRevision) {
      throw new Error("Infinity Scale LOD transaction rejected: frame revision changed");
    }
    if (frame.phase !== "boundary-reconciliation") {
      throw new Error(
        `Infinity Scale LOD transaction commit requires boundary-reconciliation phase; received ${frame.phase}`,
      );
    }
    if (transaction.committed) {
      throw new Error("Infinity Scale LOD transaction has already committed");
    }

    const result = transaction.synchronization.commit();
    transaction.committed = true;
    return result;
  } catch (error) {
    // A failed commit must not leave local execution writes or a partial set of
    // boundary writes in the authoritative state. A previously committed
    // transaction is never reverted by a duplicate commit attempt.
    if (!transaction.committed) {
      try {
        transaction.synchronization.rollback();
        // Do not overwrite an external state mutation (e.g. clear/reset) that
        // already invalidated this transaction. Restore only while this
        // transaction still owns the captured state revision.
        if (transaction.state.getRevision() === transaction.stateRevision) {
          transaction.state.restore(transaction.rollbackSnapshot);
        }
      } catch (rollbackError) {
        throw new Error(
          `Infinity Scale LOD commit failed (${String(error)}); rollback also failed (${String(rollbackError)})`,
        );
      }
    }
    throw error;
  }
}

export function rollbackInfinityScaleGlobalLODTransaction(
  transaction: InfinityScaleGlobalLODTransaction,
): void {
  if (transaction.committed) {
    throw new Error("Infinity Scale LOD transaction cannot rollback after commit");
  }
  transaction.synchronization.rollback();
  // A reset/clear that changed the revision is authoritative; rolling back a
  // stale transaction must never resurrect the pre-reset chunk set.
  if (transaction.state.getRevision() === transaction.stateRevision) {
    transaction.state.restore(transaction.rollbackSnapshot);
  }
}
