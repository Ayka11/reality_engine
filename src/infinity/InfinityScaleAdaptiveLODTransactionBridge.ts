import type { InfinityScaleExecutionPlan } from "./InfinityScaleExecutionAdapter";
import type { InfinityScaleGlobalExecutionFrame } from "./InfinityScaleGlobalExecutionFrame";
import { validateInfinityScaleGlobalFrameCommit } from "./InfinityScaleGlobalExecutionFrame";
import {
  beginInfinityScaleGlobalLODTransaction,
  commitInfinityScaleGlobalLODTransaction,
  rollbackInfinityScaleGlobalLODTransaction,
  type InfinityScaleGlobalLODTransaction,
} from "./InfinityScaleGlobalLODTransaction";
import { InfinityScaleLODState } from "./InfinityScaleLODState";
import type { InfinityScaleAdaptiveMutation } from "./InfinityScaleAdaptiveTransferCompiler";
import { InfinityScaleAdaptiveTransferCompiler } from "./InfinityScaleAdaptiveTransferCompiler";
import { InfinityScaleAdaptiveExecutionGraphCompiler } from "./InfinityScaleAdaptiveExecutionGraphCompiler";
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
    let stateMutationStarted = false;

    try {
      // Keep all input processing inside cleanup: malformed runtime input must
      // not leave a failed transaction attached to this bridge.
      if (!Array.isArray(mutations) || !Array.isArray(transfers)) {
        throw new Error("Adaptive LOD transaction requires mutation and transfer arrays");
      }
      // Revalidate the captured frame against the live plan at commit time.
      // The plan object may have changed after begin(); never commit under stale
      // revision or ownership geometry, even for an otherwise empty mutation set.
      validateInfinityScaleGlobalFrameCommit(frame, this.plan);
      const compiledPlan = new InfinityScaleAdaptiveTransferCompiler().compile(mutations);
      const seenRegionIds = new Set<string>();
      for (const mutation of compiledPlan.mutations) {
        if (seenRegionIds.has(mutation.regionId)) {
          throw new Error("Adaptive LOD transaction rejected: duplicate region ID " + mutation.regionId);
        }
        seenRegionIds.add(mutation.regionId);
      }
      const executionGraph = new InfinityScaleAdaptiveExecutionGraphCompiler().compile(compiledPlan);
      if (!executionGraph.valid) {
        throw new Error("Adaptive LOD transaction rejected: execution dependency graph is invalid");
      }
      // Decide whether the request changes topology from the compiler's
      // detached snapshot, not caller-owned objects that may contain accessors
      // or be mutated after compilation.
      const changed = compiledPlan.mutations.filter(m => m.fromLOD !== m.toLOD)
        .slice()
        .sort((a, b) => a.regionId.localeCompare(b.regionId));

      // Every rejection after begin must pass through cleanup so this bridge
      // cannot retain a failed transaction and accidentally reuse it.
      if (frame.phase !== "boundary-reconciliation") {
        throw new Error("Adaptive LOD transaction commit requires boundary-reconciliation phase");
      }
      this.state.assertRevision(this.transaction.stateRevision);
      if (changed.length > 0) {
        throw new Error("Adaptive LOD topology commit is disabled until physical chunk remapping and full-cell transfer are implemented");
      }
      // No topology changes are allowed above, so there can be no valid
      // transfer execution in the current fail-closed mode.
      if (transfers.length > 0) {
        throw new Error("Unexpected adaptive transfer: " + transfers[0].transferId);
      }

      // Commit may partially write boundary cells during a no-op synchronization
      // only if an injected failure occurs. Keep rollback centralized here.
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

