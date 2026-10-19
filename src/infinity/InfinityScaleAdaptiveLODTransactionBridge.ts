import type { InfinityScaleExecutionPlan } from "./InfinityScaleExecutionAdapter";
import type { InfinityScaleGlobalExecutionFrame } from "./InfinityScaleGlobalExecutionFrame";
import {
  beginInfinityScaleGlobalLODTransaction,
  commitInfinityScaleGlobalLODTransaction,
  rollbackInfinityScaleGlobalLODTransaction,
  type InfinityScaleGlobalLODTransaction,
} from "./InfinityScaleGlobalLODTransaction";
import { InfinityScaleLODState } from "./InfinityScaleLODState";
import type { InfinityScaleAdaptiveMutation, InfinityScaleCompiledTransfer } from "./InfinityScaleAdaptiveTransferCompiler";
import type { InfinityScaleBoundaryTransferSpec } from "./InfinityScaleChunkExecutionContext";

export interface InfinityScaleAdaptiveTransferExecution {
  transferId: string;
  spec: InfinityScaleBoundaryTransferSpec;
  targetCell: [number, number, number];
  sourceCells: ReadonlyArray<ReadonlyArray<number>>;
}

export interface InfinityScaleAdaptiveLODTransactionResult {
  committed: boolean;
  frameRevision: number;
  stateRevisionBefore: number;
  stateRevisionAfter: number;
  mutationCount: number;
  transferCount: number;
  topologyChanged: boolean;
  reason: string;
}

export class InfinityScaleAdaptiveLODTransactionBridge {
  private transaction: InfinityScaleGlobalLODTransaction | undefined;

  constructor(private readonly plan: InfinityScaleExecutionPlan, private readonly state: InfinityScaleLODState) {}

  begin(frame: InfinityScaleGlobalExecutionFrame): InfinityScaleGlobalLODTransaction {
    if (this.transaction) throw new Error("Adaptive LOD transaction already begun");
    if (frame.planRevision !== this.plan.revision) throw new Error("Adaptive LOD transaction rejected: frame/plan revision mismatch");
    this.transaction = beginInfinityScaleGlobalLODTransaction(frame, this.plan, this.state);
    return this.transaction;
  }

  commit(
    frame: InfinityScaleGlobalExecutionFrame,
    mutations: InfinityScaleAdaptiveMutation[],
    transfers: InfinityScaleAdaptiveTransferExecution[] = [],
  ): InfinityScaleAdaptiveLODTransactionResult {
    if (!this.transaction) throw new Error("Adaptive LOD transaction has not begun");
    const stateRevisionBefore = this.state.getRevision();
    const createdChunks: string[] = [];
    let stateMutationStarted = false;

    try {
      // Keep all input processing inside cleanup: malformed runtime input must
      // not leave a failed transaction attached to this bridge.
      if (!Array.isArray(mutations) || !Array.isArray(transfers)) {
        throw new Error("Adaptive LOD transaction requires mutation and transfer arrays");
      }
      const changed = mutations.filter(m => m.fromLOD !== m.toLOD).slice().sort((a, b) => a.regionId.localeCompare(b.regionId));
      const expectedTransferIds = new Set(changed.map(m => m.regionId + ":" + m.fromLOD + "->" + m.toLOD));
      const executionById = new Map(transfers.map(t => [t.transferId, t]));

      // Every rejection after begin must pass through cleanup so this bridge
      // cannot retain a failed transaction and accidentally reuse it.
      if (frame.phase !== "boundary-reconciliation") {
        throw new Error("Adaptive LOD transaction commit requires boundary-reconciliation phase");
      }
      this.state.assertRevision(this.transaction.stateRevision);
      if (changed.length > 0) {
        throw new Error("Adaptive LOD topology commit is disabled until physical chunk remapping and full-cell transfer are implemented");
      }
      for (const mutation of changed) {
        const chunk = this.state.getChunk(mutation.regionId);
        if (chunk && chunk.level !== mutation.fromLOD) throw new Error("Adaptive LOD state conflict for region: " + mutation.regionId);
      }
      for (const execution of transfers) {
        if (!expectedTransferIds.has(execution.transferId)) throw new Error("Unexpected adaptive transfer: " + execution.transferId);
      }

      for (const mutation of changed) {
        if (!this.state.hasChunk(mutation.regionId)) {
          stateMutationStarted = true;
          this.state.ensureChunk(mutation.regionId, mutation.toLOD);
          createdChunks.push(mutation.regionId);
        }
      }

      if (createdChunks.length > 0) {
        // Chunk creation is an owned topology mutation in this transaction.
        // Rebase only across the exact revision delta caused by these chunks;
        // any additional change means another mutation raced with this commit.
        const expectedRevision = this.transaction.stateRevision + createdChunks.length;
        if (this.state.getRevision() !== expectedRevision) {
          throw new Error("Adaptive LOD transaction rejected: unexpected state revision during topology staging");
        }
        this.transaction.stateRevision = expectedRevision;
        this.transaction.synchronization.begin(expectedRevision);
      }

      for (const mutation of changed) {
        const transferId = mutation.regionId + ":" + mutation.fromLOD + "->" + mutation.toLOD;
        const execution = executionById.get(transferId);
        if (!execution) continue;
        const compiled: InfinityScaleCompiledTransfer = {
          transferId,
          regionId: mutation.regionId,
          operation: transferOperation(mutation),
          ratio: 2 ** Math.abs(mutation.toLOD - mutation.fromLOD),
          sourceLOD: mutation.fromLOD,
          targetLOD: mutation.toLOD,
          conservationRequired: true,
          dependencyIds: [],
        };
        validateConcreteTransfer(compiled, execution);
        this.transaction.synchronization.stageTransfer(execution.spec, execution.targetCell, execution.sourceCells);
      }

      // Commit may partially write boundary cells before rejecting an invalid
      // target. Mark the state as potentially mutated before entering it so the
      // catch path restores the snapshot on every partial-commit failure.
      stateMutationStarted = true;
      const synchronization = commitInfinityScaleGlobalLODTransaction(this.transaction, frame);
      if (!synchronization.readyToCommit) throw new Error("Adaptive LOD synchronization was not ready to commit");
      return {
        committed: true,
        frameRevision: frame.revision,
        stateRevisionBefore,
        stateRevisionAfter: synchronization.revision,
        mutationCount: changed.length,
        transferCount: transfers.length,
        topologyChanged: changed.length > 0,
        reason: transfers.length === 0 && changed.length > 0 ? "topology-committed-without-boundary-transfer" : "committed",
      };
    } catch (error) {
      // Fail-closed validation before any state mutation is a true no-op: do
      // not restore an identical snapshot, because restore intentionally bumps
      // the revision and would make a rejected topology request observable.
      // Once chunk creation or commit starts, rollback is required to recover
      // from partial writes and invalidate outstanding transaction tokens.
      if (
        stateMutationStarted &&
        this.transaction &&
        !this.transaction.committed &&
        // The global commit helper already restores the snapshot when its own
        // commit fails. Do not run synchronization rollback a second time, and
        // never restore over a newer revision owned by an external mutation.
        this.state.getRevision() === this.transaction.stateRevision
      ) {
        rollbackInfinityScaleGlobalLODTransaction(this.transaction);
      }
      throw error;
    } finally {
      this.transaction = undefined;
    }
  }

  rollback(): void {
    if (!this.transaction) return;
    if (!this.transaction.committed) rollbackInfinityScaleGlobalLODTransaction(this.transaction);
    this.transaction = undefined;
  }
}

function transferOperation(mutation: InfinityScaleAdaptiveMutation): InfinityScaleCompiledTransfer["operation"] {
  return mutation.toLOD < mutation.fromLOD ? "TOPOLOGY_PROLONGATION" : "TOPOLOGY_RESTRICTION";
}

function validateConcreteTransfer(compiled: InfinityScaleCompiledTransfer, execution: InfinityScaleAdaptiveTransferExecution): void {
  const expectedRelation = compiled.operation === "TOPOLOGY_PROLONGATION" ? "coarse-to-fine" : "fine-to-coarse";
  if (execution.spec.relation !== expectedRelation) throw new Error("Adaptive transfer relation mismatch: " + compiled.transferId);
  if (execution.spec.sourceLevel !== compiled.sourceLOD || execution.spec.targetLevel !== compiled.targetLOD) {
    throw new Error("Adaptive transfer level mismatch: " + compiled.transferId);
  }
  if (execution.spec.refinementRatio !== compiled.ratio) throw new Error("Adaptive transfer ratio mismatch: " + compiled.transferId);
}
