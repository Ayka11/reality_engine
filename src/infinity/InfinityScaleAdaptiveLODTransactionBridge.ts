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
import { compileInfinityScaleSpatialRegionMappings } from "./InfinityScaleSpatialRegionMapping";

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
      let compiledPlan = new InfinityScaleAdaptiveTransferCompiler().compile(mutations);
      const seenRegionIds = new Set<string>();
      for (const mutation of compiledPlan.mutations) {
        if (seenRegionIds.has(mutation.regionId)) {
          throw new Error("Adaptive LOD transaction rejected: duplicate region ID " + mutation.regionId);
        }
        seenRegionIds.add(mutation.regionId);
      }

      // Decide whether the request changes topology from the compiler's
      // detached snapshot, not caller-owned objects that may contain accessors
      // or be mutated after compilation.
      let changed = compiledPlan.mutations.filter(m => m.fromLOD !== m.toLOD)
        .slice()
        .sort((a, b) => a.regionId.localeCompare(b.regionId));

      // Frame/phase/revision checks precede any authoritative ownership lookup.
      // The state registry, not a caller-supplied array, is the source of truth
      // for which physical chunks currently belong to a logical region.
      if (frame.phase !== "boundary-reconciliation") {
        throw new Error("Adaptive LOD transaction commit requires boundary-reconciliation phase");
      }
      this.state.assertRevision(this.transaction.stateRevision);

      if (changed.length > 0) {
        const normalizedMutations = compiledPlan.mutations.map(mutation => {
          if (mutation.fromLOD === mutation.toLOD) return mutation;
          const authoritativeKeys = this.state.getRegionChunkKeys(mutation.regionId);
          if (!authoritativeKeys) {
            throw new Error(
              "Adaptive LOD transaction requires authoritative physical chunk remapping metadata for region " +
              mutation.regionId,
            );
          }

          const normalizedKeys = [...authoritativeKeys].sort();
          const declaredKeys = mutation.spatialChunkKeys;
          if (declaredKeys !== undefined &&
              (declaredKeys.length !== normalizedKeys.length ||
               declaredKeys.some((key, index) => key !== normalizedKeys[index]))) {
            throw new Error(
              "Adaptive LOD caller-supplied spatial chunk keys do not match authoritative region ownership for " +
              mutation.regionId,
            );
          }

          for (const sourceKey of normalizedKeys) {
            const sourceChunk = this.state.cloneChunk(sourceKey);
            if (!sourceChunk ||
                sourceChunk.level !== mutation.fromLOD ||
                sourceChunk.scale !== 2 ** mutation.fromLOD) {
              throw new Error(
                "Adaptive LOD authoritative source chunk is missing or inconsistent for region " +
                mutation.regionId + ": " + sourceKey,
              );
            }
          }

          return {
            ...mutation,
            spatialChunkKeys: Object.freeze(normalizedKeys),
          };
        });

        // Recompile after injecting state-owned ownership so the transfer-plan
        // hash and execution graph are bound to authoritative physical keys.
        compiledPlan = new InfinityScaleAdaptiveTransferCompiler().compile(normalizedMutations);
        changed = compiledPlan.mutations.filter(m => m.fromLOD !== m.toLOD)
          .slice()
          .sort((a, b) => a.regionId.localeCompare(b.regionId));

        const spatialMappings = compileInfinityScaleSpatialRegionMappings(changed);
        const sourceKeys = new Set(changed.flatMap(m => [...(m.spatialChunkKeys ?? [])]));
        for (const mapping of spatialMappings) {
          for (const targetKey of mapping.targetChunkKeys) {
            if (!sourceKeys.has(targetKey) && this.state.hasChunk(targetKey)) {
              throw new Error(
                "Adaptive LOD target chunk is already occupied and cannot be replaced safely: " + targetKey,
              );
            }
          }
        }

        // This mapping is now backed by the authoritative region registry and
        // live hierarchical source chunks, but it is still only a preflight.
        // We do not publish it until full cell transfer, field-specific
        // conservation, dependency barriers and atomic topology rollback exist.
        throw new Error(
          "Adaptive LOD topology commit remains disabled until full-cell transfer, " +
          "field-specific conservation and atomic physical chunk remapping publication are implemented " +
          "(validated " + spatialMappings.length + " authoritative spatial region mapping(s))",
        );
      }

      const executionGraph = new InfinityScaleAdaptiveExecutionGraphCompiler().compile(compiledPlan);
      if (!executionGraph.valid) {
        throw new Error("Adaptive LOD transaction rejected: execution dependency graph is invalid");
      }
      // Every rejection after begin must pass through cleanup so this bridge
      // cannot retain a failed transaction and accidentally reuse it.
      if (frame.phase !== "boundary-reconciliation") {
        throw new Error("Adaptive LOD transaction commit requires boundary-reconciliation phase");
      }
      this.state.assertRevision(this.transaction.stateRevision);
      if (changed.length > 0) {
        // Bind each logical region to an explicit, deterministic set of current
        // hierarchical chunks and prove its proposed target covers the exact
        // same physical SparseVoxelGrid footprint. This remains preflight only:
        // the bridge still refuses to publish topology until cell transfer,
        // field-specific conservation and atomic chunk mutation are implemented.
        const spatialMappings = compileInfinityScaleSpatialRegionMappings(changed);
        throw new Error(
          "Adaptive LOD topology commit remains disabled until full-cell transfer, " +
          "field-specific conservation and atomic physical chunk remapping publication are implemented " +
          "(validated " + spatialMappings.length + " spatial region mapping(s))",
        );
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

