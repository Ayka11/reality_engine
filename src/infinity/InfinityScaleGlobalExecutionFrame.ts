import type { InfinityScaleExecutionPlan } from "./InfinityScaleExecutionAdapter";
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
  };
}

function fingerprintPlan(plan: InfinityScaleExecutionPlan): string {
  return [
    plan.revision,
    ...plan.chunks.map(chunk => chunk.key).sort(),
    "|",
    ...plan.boundaryReadChunks.slice().sort(),
  ].join("|");
}

export function validateInfinityScaleGlobalFrameCommit(
  frame: InfinityScaleGlobalExecutionFrame,
  plan: InfinityScaleExecutionPlan,
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
    if (context.simulationCellCount !== frame.simulationCellCount) {
      throw new Error("Infinity Scale simulation geometry changed during frame");
    }
    if (context.readCellCount !== frame.boundaryReadCellCount) {
      throw new Error("Infinity Scale boundary geometry changed during frame");
    }
  }
}
