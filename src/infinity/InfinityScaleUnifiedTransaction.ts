import type { AgentMigrationRequest, AgentSystem } from "../simulation/AgentSystem";
import type { EntityLayer } from "../simulation/EntityLayer";
import type { VoxelGrid } from "../core/VoxelGrid";
import type { InfinityScaleChunkExecutionContext } from "./InfinityScaleChunkExecutionContext";
import type { InfinityScaleGlobalExecutionFrame } from "./InfinityScaleGlobalExecutionFrame";
import type { InfinityScaleExecutionPlan } from "./InfinityScaleExecutionAdapter";
import {
  InfinityScaleGlobalLODTransaction,
  commitInfinityScaleGlobalLODTransaction,
} from "./InfinityScaleGlobalLODTransaction";

export interface InfinityScaleUnifiedTransaction {
  frameRevision: number;
  planRevision: number;
  stateRevision: number;
  lod: InfinityScaleGlobalLODTransaction;
  entityLayer: EntityLayer;
  agentSystem: AgentSystem;
  grid: VoxelGrid;
  context: InfinityScaleChunkExecutionContext;
  stagedMigrations: AgentMigrationRequest[];
  entityCommitRequested: boolean;
  committed: boolean;
}

export interface InfinityScaleUnifiedTransactionValidation {
  readyToCommit: boolean;
  migrationConflicts: number;
  entityReady: boolean;
  lodReady: boolean;
  reasons: string[];
}

/**
 * Frame-level transaction coordinating LOD state, entity identity and agent
 * migration. Local execution may stage all three domains; only the global
 * boundary-reconciliation phase may commit them.
 */
export function beginInfinityScaleUnifiedTransaction(
  frame: InfinityScaleGlobalExecutionFrame,
  plan: InfinityScaleExecutionPlan,
  lod: InfinityScaleGlobalLODTransaction,
  entityLayer: EntityLayer,
  agentSystem: AgentSystem,
  grid: VoxelGrid,
  context: InfinityScaleChunkExecutionContext,
): InfinityScaleUnifiedTransaction {
  if (frame.planRevision !== plan.revision) {
    throw new Error("Unified transaction rejected: frame/plan revision mismatch");
  }
  return {
    frameRevision: frame.revision,
    planRevision: plan.revision,
    stateRevision: lod.stateRevision,
    lod,
    entityLayer,
    agentSystem,
    grid,
    context,
    stagedMigrations: [],
    entityCommitRequested: false,
    committed: false,
  };
}

export function stageInfinityScaleEntityCommit(
  transaction: InfinityScaleUnifiedTransaction,
): void {
  if (transaction.committed) throw new Error("Unified transaction already committed");
  transaction.entityCommitRequested = true;
}

export function stageInfinityScaleAgentMigrations(
  transaction: InfinityScaleUnifiedTransaction,
  requests: AgentMigrationRequest[],
): void {
  if (transaction.committed) throw new Error("Unified transaction already committed");
  const seen = new Set(
    transaction.stagedMigrations.map(request =>
      migrationKey(request),
    ),
  );
  for (const request of requests) {
    const key = migrationKey(request);
    if (!seen.has(key)) {
      transaction.stagedMigrations.push({
        ...request,
        from: [...request.from] as [number, number, number],
        to: [...request.to] as [number, number, number],
      });
      seen.add(key);
    }
  }
}

export function validateInfinityScaleUnifiedTransaction(
  transaction: InfinityScaleUnifiedTransaction,
  frame: InfinityScaleGlobalExecutionFrame,
): InfinityScaleUnifiedTransactionValidation {
  const reasons: string[] = [];

  if (frame.revision !== transaction.frameRevision) {
    reasons.push("frame revision changed");
  }
  if (frame.phase !== "boundary-reconciliation") {
    reasons.push(`invalid commit phase: ${frame.phase}`);
  }
  if (transaction.committed) reasons.push("transaction already committed");

  const lodValidation = transaction.lod.synchronization.validate();
  if (!lodValidation.readyToCommit) reasons.push("LOD synchronization is not ready");

  const entityReady =
    !transaction.entityCommitRequested ||
    transaction.entityLayer.canCommitChunkReconciliation();
  if (!entityReady) reasons.push("entity reconciliation is not commit-ready");

  const migrationConflicts = countMigrationConflicts(
    transaction.stagedMigrations,
    transaction.context,
    transaction.agentSystem,
  );
  if (migrationConflicts > 0) {
    reasons.push(`agent migration conflicts: ${migrationConflicts}`);
  }

  return {
    readyToCommit:
      reasons.length === 0 &&
      lodValidation.readyToCommit &&
      entityReady &&
      migrationConflicts === 0,
    migrationConflicts,
    entityReady,
    lodReady: lodValidation.readyToCommit,
    reasons,
  };
}

export function commitInfinityScaleUnifiedTransaction(
  transaction: InfinityScaleUnifiedTransaction,
  frame: InfinityScaleGlobalExecutionFrame,
): void {
  const validation = validateInfinityScaleUnifiedTransaction(transaction, frame);
  if (!validation.readyToCommit) {
    throw new Error(
      `Infinity Scale unified transaction rejected: ${validation.reasons.join("; ")}`,
    );
  }

  // All domains are prevalidated before the first mutation. The commit phase
  // itself is deliberately deterministic: LOD boundary state, entity identity,
  // then agent positions.
  commitInfinityScaleGlobalLODTransaction(transaction.lod, frame);

  if (transaction.entityCommitRequested) {
    if (!transaction.entityLayer.applyChunkReconciliation(
      transaction.grid,
      transaction.context,
    )) {
      throw new Error("Infinity Scale unified transaction entity commit failed");
    }
  }

  if (transaction.stagedMigrations.length > 0) {
    transaction.agentSystem.applyMigrationRequests(
      transaction.grid,
      transaction.stagedMigrations,
      transaction.context,
    );
  }

  transaction.committed = true;
}

function migrationKey(request: AgentMigrationRequest): string {
  return [
    request.agentId,
    request.from.join(","),
    request.to.join(","),
  ].join("|");
}

function countMigrationConflicts(
  requests: AgentMigrationRequest[],
  context: InfinityScaleChunkExecutionContext,
  agents: AgentSystem,
): number {
  const byAgent = new Map<number, AgentMigrationRequest>();
  let conflicts = 0;

  for (const request of requests) {
    if (!context.containsSimulationCell(request.to[0], request.to[1], request.to[2])) {
      conflicts++;
    }
    const previous = byAgent.get(request.agentId);
    if (previous && (
      previous.to[0] !== request.from[0] ||
      previous.to[1] !== request.from[1] ||
      previous.to[2] !== request.from[2]
    )) {
      conflicts++;
    }
    byAgent.set(request.agentId, request);
  }

  for (const request of requests) {
    const agent = agents.getAgents().find(candidate => candidate.id === request.agentId);
    if (!agent ||
        agent.x !== request.from[0] ||
        agent.y !== request.from[1] ||
        agent.z !== request.from[2]) {
      conflicts++;
    }
  }

  return conflicts;
}
