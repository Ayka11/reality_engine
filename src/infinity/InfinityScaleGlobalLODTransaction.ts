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
  readonly frameRevision: number;
  readonly stateRevision: number;
  readonly synchronization: InfinityScaleLODSynchronization;
  readonly committed: boolean;
  readonly state: InfinityScaleLODState;
}

interface InfinityScaleGlobalLODTransactionInternals {
  readonly stateRevision: number;
  readonly rollbackSnapshot: InfinityScaleLODStateSnapshot;
  committed: boolean;
}

const transactionInternals = new WeakMap<
  InfinityScaleGlobalLODTransaction,
  InfinityScaleGlobalLODTransactionInternals
>();

function getTransactionInternals(
  transaction: InfinityScaleGlobalLODTransaction,
): InfinityScaleGlobalLODTransactionInternals {
  const internals = transactionInternals.get(transaction);
  if (!internals) {
    throw new Error("Unknown Infinity Scale LOD transaction token");
  }
  return internals;
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
  const internals: InfinityScaleGlobalLODTransactionInternals = {
    stateRevision,
    rollbackSnapshot,
    committed: false,
  };

  const transaction: InfinityScaleGlobalLODTransaction = {
    frameRevision: frame.revision,
    get stateRevision() {
      return internals.stateRevision;
    },
    synchronization,
    get committed() {
      return internals.committed;
    },
    state,
  };

  transactionInternals.set(transaction, internals);
  // A transaction is an immutable handle; mutable state is kept in this
  // module's WeakMap so callers cannot alter revision ownership, committed
  // status, or the snapshot used to recover authoritative state.
  return Object.freeze(transaction);
}

export function commitInfinityScaleGlobalLODTransaction(
  transaction: InfinityScaleGlobalLODTransaction,
  frame: InfinityScaleGlobalExecutionFrame,
): InfinityScaleLODSynchronizationResult {
  const internals = getTransactionInternals(transaction);
  try {
    if (frame.revision !== transaction.frameRevision) {
      throw new Error("Infinity Scale LOD transaction rejected: frame revision changed");
    }
    if (frame.phase !== "boundary-reconciliation") {
      throw new Error(
        `Infinity Scale LOD transaction commit requires boundary-reconciliation phase; received ${frame.phase}`,
      );
    }
    if (internals.committed) {
      throw new Error("Infinity Scale LOD transaction has already committed");
    }

    const result = transaction.synchronization.commit();
    internals.committed = true;
    return result;
  } catch (error) {
    // A failed commit must not leave local execution writes or a partial set of
    // boundary writes in the authoritative state. A previously committed
    // transaction is never reverted by a duplicate commit attempt.
    if (!internals.committed) {
      try {
        transaction.synchronization.rollback();
        // Do not overwrite an external state mutation (e.g. clear/reset) that
        // already invalidated this transaction. Use the captured, private
        // revision, not public transaction metadata.
        if (transaction.state.getRevision() === internals.stateRevision) {
          transaction.state.restore(internals.rollbackSnapshot);
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
  const internals = getTransactionInternals(transaction);
  if (internals.committed) {
    throw new Error("Infinity Scale LOD transaction cannot rollback after commit");
  }
  transaction.synchronization.rollback();
  // A reset/clear that changed the revision is authoritative; rolling back a
  // stale transaction must never resurrect the pre-reset chunk set.
  if (transaction.state.getRevision() === internals.stateRevision) {
    transaction.state.restore(internals.rollbackSnapshot);
  }
}
