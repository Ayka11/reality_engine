import type { InfinityScaleExecutionPlan, InfinityScaleExecutionCapabilities } from "./InfinityScaleExecutionAdapter";
import type { InfinityScaleChunkExecutionContext } from "./InfinityScaleChunkExecutionContext";

/**
 * Transactional control-plane contract for one Infinity Scale simulation frame.
 *
 * Local chunk simulation and global observability/control are deliberately
 * separated. Global phases consume the committed world state produced by the
 * local phase and never become an implicit owner of chunk mutations.
 */
export type InfinityScaleGlobalPhase =
  | "begin"
  | "local-execution"
  | "local-commit"
  | "boundary-reconciliation"
  | "global-metrics"
  | "global-control"
  | "observation"
  | "finalize";

export interface InfinityScaleGlobalExecutionFrame {
  revision: number;
  tickStart: number;
  tickEnd: number;
  phase: InfinityScaleGlobalPhase;
  planRevision: number;
  simulationCellCount: number;
  boundaryReadCellCount: number;
  committed: boolean;
  finalized: boolean;
  ownershipFingerprint: string;
  capabilityFingerprint: string;
}

export function beginInfinityScaleGlobalFrame(
  plan: InfinityScaleExecutionPlan,
  tickStart: number,
  tickEnd: number,
): InfinityScaleGlobalExecutionFrame {
  return {
    revision: plan.revision,
    tickStart,
    tickEnd,
    phase: "begin",
    planRevision: plan.revision,
    simulationCellCount: plan.simulationCellCount,
    boundaryReadCellCount: plan.boundaryReadCellCount,
    committed: false,
    finalized: false,
    ownershipFingerprint: fingerprintPlan(plan),
    capabilityFingerprint: fingerprintCapabilities(plan),
  };
}

function fingerprintCapabilities(
  plan: Pick<
    InfinityScaleExecutionPlan,
    | "mode"
    | "selectiveCpuReady"
    | "selectiveGpuReady"
    | "gpuPhysicsReady"
    | "lodBoundaryTransferReady"
    | "mixedLodExecutionReady"
    | "entityExecutionReady"
    | "agentMigrationReady"
  >,
): string {
  return [
    plan.mode,
    plan.selectiveCpuReady,
    plan.selectiveGpuReady,
    plan.gpuPhysicsReady,
    plan.lodBoundaryTransferReady,
    plan.mixedLodExecutionReady,
    plan.entityExecutionReady,
    plan.agentMigrationReady,
  ].join("|");
}

export function fingerprintRuntimeCapabilities(
  capabilities: InfinityScaleExecutionCapabilities,
): string {
  return [
    capabilities.selectiveCpuReady,
    capabilities.selectiveGpuReady,
    capabilities.gpuPhysicsReady,
    capabilities.lodBoundaryTransferReady,
    capabilities.mixedLodExecutionReady,
  ].join("|");
}

function fingerprintPlan(plan: InfinityScaleExecutionPlan): string {
  // Include all execution-affecting scheduling and geometry fields, not just
  // chunk keys. The plan object is mutable, so a same-revision change to a
  // distance, budget, observer, dependency, or layer order must invalidate the
  // in-flight frame instead of silently committing against a different plan.
  const chunks = plan.chunks
    .map(chunk => ({
      key: chunk.key,
      lod: chunk.lod,
      amr: chunk.amr,
      distance: chunk.distance,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  const relations = plan.boundaryReadRelations
    .map(relation => ({
      sourceChunk: relation.sourceChunk,
      targetChunk: relation.targetChunk,
      relation: relation.relation,
    }))
    .sort((a, b) =>
      `${a.sourceChunk}>${a.targetChunk}:${a.relation}`.localeCompare(
        `${b.sourceChunk}>${b.targetChunk}:${b.relation}`,
      ),
    );

  return JSON.stringify({
    revision: plan.revision,
    observer: {
      x: plan.observer.x,
      y: plan.observer.y,
      z: plan.observer.z,
    },
    chunks,
    simulationBudget: plan.simulationBudget,
    requestedSimulationCount: plan.requestedSimulationCount,
    selectedSimulationCount: plan.selectedSimulationCount,
    maxSimulatingChunks: plan.maxSimulatingChunks,
    boundaryReadChunks: [...plan.boundaryReadChunks].sort(),
    boundaryReadCount: plan.boundaryReadCount,
    boundaryReadRelations: relations,
    simulationCellCount: plan.simulationCellCount,
    boundaryReadCellCount: plan.boundaryReadCellCount,
    // Layer order can affect execution order, so preserve it exactly.
    localExecutionLayers: [...plan.localExecutionLayers],
    globalExecutionLayers: [...plan.globalExecutionLayers],
  });
}

export function validateInfinityScaleGlobalFrameCommit(
  frame: InfinityScaleGlobalExecutionFrame,
  plan: InfinityScaleExecutionPlan,
  capabilities?: InfinityScaleExecutionCapabilities,
): void {
  if (frame.planRevision !== plan.revision) {
    throw new Error("Infinity Scale commit rejected: plan revision changed");
  }
  if (frame.ownershipFingerprint !== fingerprintPlan(plan)) {
    throw new Error("Infinity Scale commit rejected: ownership geometry changed");
  }
  if (frame.finalized) {
    throw new Error("Infinity Scale commit rejected: frame already finalized");
  }

  const currentCapabilityFingerprint = capabilities
    ? fingerprintCapabilities({
        mode: plan.mode,
        selectiveCpuReady: capabilities.selectiveCpuReady,
        selectiveGpuReady: capabilities.selectiveGpuReady,
        gpuPhysicsReady: capabilities.gpuPhysicsReady,
        lodBoundaryTransferReady: capabilities.lodBoundaryTransferReady,
        mixedLodExecutionReady: capabilities.mixedLodExecutionReady,
        entityExecutionReady: plan.entityExecutionReady,
        agentMigrationReady: plan.agentMigrationReady,
      })
    : fingerprintCapabilities(plan);

  if (frame.capabilityFingerprint !== currentCapabilityFingerprint) {
    throw new Error(
      "Infinity Scale commit rejected: execution capabilities changed",
    );
  }
}

export function advanceInfinityScaleGlobalFrame(
  frame: InfinityScaleGlobalExecutionFrame,
  phase: InfinityScaleGlobalPhase,
): InfinityScaleGlobalExecutionFrame {
  const order: InfinityScaleGlobalPhase[] = [
    "begin",
    "local-execution",
    "local-commit",
    "boundary-reconciliation",
    "global-metrics",
    "global-control",
    "observation",
    "finalize",
  ];

  const current = order.indexOf(frame.phase);
  const next = order.indexOf(phase);
  if (next !== current + 1) {
    throw new Error(
      `Invalid Infinity Scale global phase transition: ${frame.phase} -> ${phase}`,
    );
  }

  return {
    ...frame,
    phase,
    committed: frame.committed || phase === "boundary-reconciliation",
    finalized: phase === "finalize",
  };
}

export function assertInfinityScaleGlobalFramePlan(
  frame: InfinityScaleGlobalExecutionFrame,
  plan: InfinityScaleExecutionPlan,
  context?: InfinityScaleChunkExecutionContext,
): void {
  if (frame.planRevision !== plan.revision) {
    throw new Error(
      `Infinity Scale frame/plan revision mismatch: ${frame.planRevision} !== ${plan.revision}`,
    );
  }

  if (context) {
    if (fingerprintPlan(plan) !== frame.ownershipFingerprint) {
      throw new Error("Infinity Scale frame ownership changed");
    }
    if (context.simulationCellCount !== frame.simulationCellCount) {
      throw new Error("Infinity Scale simulation geometry changed during frame");
    }
    if (context.readCellCount !== frame.boundaryReadCellCount) {
      throw new Error("Infinity Scale boundary geometry changed during frame");
    }
  }
}
