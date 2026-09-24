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
    if (frame.phase !== "boundary-reconciliation") throw new Error("Adaptive LOD transaction commit requires boundary-reconciliation phase");
    const stateRevisionBefore = this.state.getRevision();
    this.state.assertRevision(this.transaction.stateRevision);
    const changed = mutations.filter(m => m.fromLOD !== m.toLOD).slice().sort((a, b) => a.regionId.localeCompare(b.regionId));
    const expectedTransferIds = new Set(changed.map(m => m.regionId + ":" + m.fromLOD + "->" + m.toLOD));
    const executionById = new Map(transfers.map(t => [t.transferId, t]));
    const createdChunks: string[] = [];

    for (const mutation of changed) {
      const chunk = this.state.getChunk(mutation.regionId);
      if (chunk && chunk.level !== mutation.fromLOD) throw new Error("Adaptive LOD state conflict for region: " + mutation.regionId);
    }
    for (const execution of transfers) {
      if (!expectedTransferIds.has(execution.transferId)) throw new Error("Unexpected adaptive transfer: " + execution.transferId);
    }

    try {
      for (const mutation of changed) {
        if (!this.state.hasChunk(mutation.regionId)) {
          this.state.ensureChunk(mutation.regionId, mutation.toLOD);
          createdChunks.push(mutation.regionId);
        }
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
      for (const key of createdChunks) this.state.deleteChunk(key);
      if (this.transaction && !this.transaction.committed) rollbackInfinityScaleGlobalLODTransaction(this.transaction);
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
  return mutation.toLOD > mutation.fromLOD ? "TOPOLOGY_PROLONGATION" : "TOPOLOGY_RESTRICTION";
}

function validateConcreteTransfer(compiled: InfinityScaleCompiledTransfer, execution: InfinityScaleAdaptiveTransferExecution): void {
  const expectedRelation = compiled.operation === "TOPOLOGY_PROLONGATION" ? "coarse-to-fine" : "fine-to-coarse";
  if (execution.spec.relation !== expectedRelation) throw new Error("Adaptive transfer relation mismatch: " + compiled.transferId);
  if (execution.spec.sourceLevel !== compiled.sourceLOD || execution.spec.targetLevel !== compiled.targetLOD) {
    throw new Error("Adaptive transfer level mismatch: " + compiled.transferId);
  }
  if (execution.spec.refinementRatio !== compiled.ratio) throw new Error("Adaptive transfer ratio mismatch: " + compiled.transferId);
}
