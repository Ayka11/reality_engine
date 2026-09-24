import type { AgentMigrationRequest, AgentSystem } from "../simulation/AgentSystem";
import type { EntityLayer } from "../simulation/EntityLayer";
import type { VoxelGrid } from "../core/VoxelGrid";
import type { InfinityScaleChunkExecutionContext } from "./InfinityScaleChunkExecutionContext";
import type { InfinityScaleGlobalExecutionFrame } from "./InfinityScaleGlobalExecutionFrame";
import type { InfinityScaleExecutionPlan } from "./InfinityScaleExecutionAdapter";
import { InfinityScaleGlobalLODTransaction, commitInfinityScaleGlobalLODTransaction } from "./InfinityScaleGlobalLODTransaction";
import { InfinityScaleLODBoundaryCellMapper } from "./InfinityScaleLODBoundaryCellMapper";

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
 * Frame-level commit barrier for LOD state, entity identity and agent migration.
 * Validation must pass before any domain is mutated.
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
  if (frame.planRevision !== plan.revision) throw new Error("Unified transaction rejected: frame/plan revision mismatch");
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

export function stageInfinityScaleEntityCommit(transaction: InfinityScaleUnifiedTransaction): void {
  if (transaction.committed) throw new Error("Unified transaction already committed");
  transaction.entityCommitRequested = true;
}

export function stageInfinityScaleAgentMigrations(transaction: InfinityScaleUnifiedTransaction, requests: AgentMigrationRequest[]): void {
  if (transaction.committed) throw new Error("Unified transaction already committed");
  const seen = new Set(transaction.stagedMigrations.map(migrationKey));
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
  if (frame.revision !== transaction.frameRevision) reasons.push("frame revision changed");
  if (frame.planRevision !== transaction.planRevision) reasons.push("frame plan revision changed");
  if (frame.phase !== "boundary-reconciliation") reasons.push(`invalid commit phase: ${frame.phase}`);
  if (transaction.committed) reasons.push("transaction already committed");
  if (transaction.lod.stateRevision !== transaction.stateRevision) reasons.push("LOD state revision changed");

  const lodValidation = transaction.lod.synchronization.validate();
  if (!lodValidation.readyToCommit) reasons.push("LOD synchronization is not ready");

  const mixedSpecs = transaction.context.boundaryTransferSpecs.filter(
    spec => spec.sourceLevel !== spec.targetLevel,
  );
  if (mixedSpecs.length > 0) {
    const staged = transaction.lod.synchronization.getStagedUpdates();
    const stagedKeys = new Set(
      staged.map(update => `${update.sourceChunk}|${update.targetChunk}|${update.targetCell.join(",")}`),
    );
    const missingBoundaryUpdates = mixedSpecs.reduce((count, spec) => {
      const targetCells = boundaryTargetCells(transaction.context, spec);
      return count + targetCells.filter(
        cell => !stagedKeys.has(`${spec.sourceChunk}|${spec.targetChunk}|${cell.join(",")}`),
      ).length;
    }, 0);
    if (missingBoundaryUpdates > 0) {
      reasons.push(`missing mixed-LOD boundary updates: ${missingBoundaryUpdates}`);
    }
  }

  const entityReady = !transaction.entityCommitRequested || transaction.entityLayer.canCommitChunkReconciliation();
  if (!entityReady) reasons.push("entity reconciliation is not commit-ready");

  const migrationConflicts = countMigrationConflicts(transaction.stagedMigrations, transaction.context, transaction.agentSystem);
  if (migrationConflicts > 0) reasons.push(`agent migration conflicts: ${migrationConflicts}`);

  return {
    readyToCommit: reasons.length === 0 && lodValidation.readyToCommit && entityReady && migrationConflicts === 0,
    migrationConflicts,
    entityReady,
    lodReady: lodValidation.readyToCommit && !reasons.some(reason => reason.startsWith("missing mixed-LOD boundary updates")),
    reasons,
  };
}

export function commitInfinityScaleUnifiedTransaction(
  transaction: InfinityScaleUnifiedTransaction,
  frame: InfinityScaleGlobalExecutionFrame,
): void {
  const validation = validateInfinityScaleUnifiedTransaction(transaction, frame);
  if (!validation.readyToCommit) {
    throw new Error(`Infinity Scale unified transaction rejected: ${validation.reasons.join("; ")}`);
  }

  // Preflight is complete. Domain commits occur only at the global barrier.
  // AgentSystem acknowledges exactly the requests it successfully applies,
  // preventing failed transactions from silently consuming pending migrations.
  commitInfinityScaleGlobalLODTransaction(transaction.lod, frame);

  if (transaction.entityCommitRequested) {
    if (!transaction.entityLayer.applyChunkReconciliation(transaction.grid, transaction.context)) {
      throw new Error("Infinity Scale unified transaction entity commit failed");
    }
  }

  if (transaction.stagedMigrations.length > 0) {
    transaction.agentSystem.applyMigrationRequests(transaction.grid, transaction.stagedMigrations, transaction.context);
  }

  transaction.committed = true;
}

function migrationKey(request: AgentMigrationRequest): string {
  return [request.agentId, request.from.join(","), request.to.join(",")].join("|");
}

function countMigrationConflicts(
  requests: AgentMigrationRequest[],
  context: InfinityScaleChunkExecutionContext,
  agents: AgentSystem,
): number {
  const byAgent = new Map<number, AgentMigrationRequest>();
  let conflicts = 0;
  for (const request of requests) {
    if (!context.containsSimulationCell(request.to[0], request.to[1], request.to[2])) conflicts++;
    const previous = byAgent.get(request.agentId);
    if (previous && (
      previous.to[0] !== request.from[0] ||
      previous.to[1] !== request.from[1] ||
      previous.to[2] !== request.from[2]
    )) conflicts++;
    byAgent.set(request.agentId, request);
  }
  for (const request of requests) {
    const agent = agents.getAgents().find(candidate => candidate.id === request.agentId);
    if (!agent || agent.x !== request.from[0] || agent.y !== request.from[1] || agent.z !== request.from[2]) conflicts++;
  }
  return conflicts;
}


function countMissingMixedLODUpdates(
  transaction: InfinityScaleUnifiedTransaction,
): number {
  const mixedSpecs = transaction.context.boundaryTransferSpecs.filter(
    spec => spec.sourceLevel !== spec.targetLevel,
  );
  if (mixedSpecs.length === 0) return 0;

  const staged = transaction.lod.synchronization.getStagedUpdates();
  const stagedKeys = new Set(
    staged.map(update =>
      `${update.sourceChunk}|${update.targetChunk}|${update.targetCell.join(",")}`,
    ),
  );
  const mapper = new InfinityScaleLODBoundaryCellMapper(
    transaction.lod.state,
    transaction.context.chunkSize,
  );
  let missing = 0;

  for (const spec of mixedSpecs) {
    const target = chunkRangeForContext(transaction.context, spec.targetChunk);
    const source = chunkRangeForContext(transaction.context, spec.sourceChunk);
    const scale = 2 ** spec.targetLevel;
    const pushFace = (
      axis: 0 | 1 | 2,
      coordinate: number,
      minU: number,
      maxU: number,
      minV: number,
      maxV: number,
    ) => {
      for (let v = minV; v <= maxV; v += scale) {
        for (let u = minU; u <= maxU; u += scale) {
          const cell: [number, number, number] =
            axis === 0 ? [coordinate, u, v] :
            axis === 1 ? [u, coordinate, v] :
            [u, v, coordinate];
          mapper.map(spec, cell);
          if (!stagedKeys.has(`${spec.sourceChunk}|${spec.targetChunk}|${cell.join(",")}`)) missing++;
        }
      }
    };
    const xo0 = Math.max(target.minX, source.minX), xo1 = Math.min(target.maxX, source.maxX);
    const yo0 = Math.max(target.minY, source.minY), yo1 = Math.min(target.maxY, source.maxY);
    const zo0 = Math.max(target.minZ, source.minZ), zo1 = Math.min(target.maxZ, source.maxZ);
    if (target.maxX + 1 === source.minX) pushFace(0, target.maxX, yo0, yo1, zo0, zo1);
    else if (source.maxX + 1 === target.minX) pushFace(0, target.minX, yo0, yo1, zo0, zo1);
    else if (target.maxY + 1 === source.minY) pushFace(1, target.maxY, xo0, xo1, zo0, zo1);
    else if (source.maxY + 1 === target.minY) pushFace(1, target.minY, xo0, xo1, zo0, zo1);
    else if (target.maxZ + 1 === source.minZ) pushFace(2, target.maxZ, xo0, xo1, yo0, yo1);
    else if (source.maxZ + 1 === target.minZ) pushFace(2, target.minZ, xo0, xo1, yo0, yo1);
  }
  return missing;
}

function chunkRangeForContext(
  context: InfinityScaleChunkExecutionContext,
  key: string,
) {
  const match = /^(\\d+):(-?\\d+),(-?\\d+),(-?\\d+)$/.exec(key);
  if (!match) throw new Error(`Invalid Infinity Scale chunk key: ${key}`);
  const level = Number(match[1]);
  const scale = 2 ** level;
  const extent = context.chunkSize * scale;
  const cx = Number(match[2]);
  const cy = Number(match[3]);
  const cz = Number(match[4]);
  return {
    minX: Math.max(0, cx * extent),
    maxX: Math.min(context.gridWidth - 1, cx * extent + extent - 1),
    minY: Math.max(0, cy * extent),
    maxY: Math.min(context.gridHeight - 1, cy * extent + extent - 1),
    minZ: Math.max(0, cz * extent),
    maxZ: Math.min(context.gridDepth - 1, cz * extent + extent - 1),
  };
}
