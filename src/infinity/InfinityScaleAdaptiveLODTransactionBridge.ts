import type { InfinityScaleExecutionPlan } from "./InfinityScaleExecutionAdapter";
import type { InfinityScaleGlobalExecutionFrame } from "./InfinityScaleGlobalExecutionFrame";
import {
  beginInfinityScaleGlobalLODTransaction,
  commitInfinityScaleGlobalLODTransaction,
  rollbackInfinityScaleGlobalLODTransaction,
  type InfinityScaleGlobalLODTransaction,
} from "./InfinityScaleGlobalLODTransaction";
import { InfinityScaleLODState } from "./InfinityScaleLODState";
import type { InfinityScaleAdaptiveMutation } from "./InfinityScaleAdaptiveTransferCompiler";

export interface InfinityScaleAdaptiveLODTransactionResult {
  committed: boolean;
  frameRevision: number;
  stateRevisionBefore: number;
  stateRevisionAfter: number;
  mutationCount: number;
  topologyChanged: boolean;
  reason: string;
}

export class InfinityScaleAdaptiveLODTransactionBridge {
  private transaction: InfinityScaleGlobalLODTransaction | undefined;

  constructor(
    private readonly plan: InfinityScaleExecutionPlan,
    private readonly state: InfinityScaleLODState,
  ) {}

  begin(frame: InfinityScaleGlobalExecutionFrame): InfinityScaleGlobalLODTransaction {
    if (frame.planRevision !== this.plan.revision) {
      throw new Error("Adaptive LOD transaction rejected: frame/plan revision mismatch");
    }
    this.transaction = beginInfinityScaleGlobalLODTransaction(frame, this.plan, this.state);
    return this.transaction;
  }

  commit(
    frame: InfinityScaleGlobalExecutionFrame,
    mutations: InfinityScaleAdaptiveMutation[],
  ): InfinityScaleAdaptiveLODTransactionResult {
    if (!this.transaction) throw new Error("Adaptive LOD transaction has not begun");
    if (frame.phase !== "boundary-reconciliation") {
      throw new Error("Adaptive LOD transaction commit requires boundary-reconciliation phase");
    }

    const stateRevisionBefore = this.state.getRevision();
    this.state.assertRevision(this.transaction.stateRevision);

    const changed = mutations.filter(mutation => mutation.fromLOD !== mutation.toLOD);
    for (const mutation of changed) {
      const chunk = this.state.getChunk(mutation.regionId);
      if (chunk && chunk.level !== mutation.fromLOD) {
        throw new Error(`Adaptive LOD state conflict for region: ${mutation.regionId}`);
      }
    }

    try {
      for (const mutation of changed) {
        this.state.ensureChunk(mutation.regionId, mutation.toLOD);
      }

      const synchronization = commitInfinityScaleGlobalLODTransaction(
        this.transaction,
        frame,
      );

      if (!synchronization.readyToCommit) {
        throw new Error("Adaptive LOD synchronization was not ready to commit");
      }

      return {
        committed: true,
        frameRevision: frame.revision,
        stateRevisionBefore,
        stateRevisionAfter: synchronization.revision,
        mutationCount: changed.length,
        topologyChanged: changed.length > 0,
        reason: "committed",
      };
    } catch (error) {
      if (this.transaction && !this.transaction.committed) {
        rollbackInfinityScaleGlobalLODTransaction(this.transaction);
      }
      throw error;
    } finally {
      this.transaction = undefined;
    }
  }

  rollback(): void {
    if (!this.transaction) return;
    if (!this.transaction.committed) {
      rollbackInfinityScaleGlobalLODTransaction(this.transaction);
    }
    this.transaction = undefined;
  }
}
