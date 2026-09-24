import type { InfinityScaleExecutionPlan } from "./InfinityScaleExecutionAdapter";
import type { InfinityScaleGlobalExecutionFrame } from "./InfinityScaleGlobalExecutionFrame";
import { InfinityScaleLODState } from "./InfinityScaleLODState";
import {
  InfinityScaleLODSynchronization,
  type InfinityScaleLODSynchronizationResult,
} from "./InfinityScaleLODSynchronization";

export interface InfinityScaleGlobalLODTransaction {
  frameRevision: number;
  stateRevision: number;
  synchronization: InfinityScaleLODSynchronization;
  committed: boolean;
}

/**
 * Connects the revisioned hierarchical LOD state to the global frame
 * transaction without making the frame itself an owner of cell data.
 *
 * The transaction can only commit during the boundary-reconciliation phase.
 * A state revision change invalidates the transaction before any write.
 */
export function beginInfinityScaleGlobalLODTransaction(
  frame: InfinityScaleGlobalExecutionFrame,
  plan: InfinityScaleExecutionPlan,
  state: InfinityScaleLODState,
): InfinityScaleGlobalLODTransaction {
  if (frame.planRevision !== plan.revision) {
    throw new Error("Infinity Scale LOD transaction rejected: frame/plan revision mismatch");
  }
  const stateRevision = state.getRevision();
  const synchronization = new InfinityScaleLODSynchronization(state);
  synchronization.begin(stateRevision);

  return {
    frameRevision: frame.revision,
    stateRevision,
    synchronization,
    committed: false,
  };
}

export function commitInfinityScaleGlobalLODTransaction(
  transaction: InfinityScaleGlobalLODTransaction,
  frame: InfinityScaleGlobalExecutionFrame,
): InfinityScaleLODSynchronizationResult {
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
}

export function rollbackInfinityScaleGlobalLODTransaction(
  transaction: InfinityScaleGlobalLODTransaction,
): void {
  if (transaction.committed) {
    throw new Error("Infinity Scale LOD transaction cannot rollback after commit");
  }
  transaction.synchronization.rollback();
}
