import type { InfinityScaleExecutionCapabilities, InfinityScaleExecutionPlan } from "./InfinityScaleExecutionAdapter";
import {
  advanceInfinityScaleGlobalFrame,
  assertInfinityScaleGlobalFramePlan,
  validateInfinityScaleGlobalFrameCommit,
  type InfinityScaleGlobalExecutionFrame,
} from "./InfinityScaleGlobalExecutionFrame";
import {
  InfinityScaleAdaptiveRuntime,
  type InfinityScaleAdaptiveRuntimeResult,
  type InfinityScaleAdaptiveRuntimeStep,
} from "./InfinityScaleAdaptiveRuntime";

export interface InfinityScaleAdaptiveGlobalFrameCommit {
  frame: InfinityScaleGlobalExecutionFrame;
  runtime: InfinityScaleAdaptiveRuntimeResult;
}

export class InfinityScaleAdaptiveGlobalFrameBridge {
  constructor(
    private readonly runtime: InfinityScaleAdaptiveRuntime,
    private readonly plan: InfinityScaleExecutionPlan,
    private readonly capabilities?: InfinityScaleExecutionCapabilities,
  ) {}

  commitAtBoundary(
    frame: InfinityScaleGlobalExecutionFrame,
    step: InfinityScaleAdaptiveRuntimeStep,
  ): InfinityScaleAdaptiveGlobalFrameCommit {
    assertInfinityScaleGlobalFramePlan(frame, this.plan);
    validateInfinityScaleGlobalFrameCommit(frame, this.plan, this.capabilities);

    if (frame.phase !== "boundary-reconciliation") {
      throw new Error(
        `Adaptive runtime commit requires boundary-reconciliation phase; received ${frame.phase}`,
      );
    }

    if (step.stateRevision !== this.runtime.getStateRevision()) {
      throw new Error("Adaptive runtime/frame state revision mismatch");
    }

    const runtime = this.runtime.step(step);
    if (runtime.committed) {
      return {
        frame,
        runtime,
      };
    }

    return { frame, runtime };
  }

  advanceToBoundary(
    frame: InfinityScaleGlobalExecutionFrame,
  ): InfinityScaleGlobalExecutionFrame {
    let current = frame;
    while (current.phase !== "boundary-reconciliation") {
      const next = nextPhase(current.phase);
      current = advanceInfinityScaleGlobalFrame(current, next);
    }
    return current;
  }
}

function nextPhase(
  phase: InfinityScaleGlobalExecutionFrame["phase"],
): InfinityScaleGlobalExecutionFrame["phase"] {
  const order: InfinityScaleGlobalExecutionFrame["phase"][] = [
    "begin",
    "local-execution",
    "local-commit",
    "boundary-reconciliation",
    "global-metrics",
    "global-control",
    "observation",
    "finalize",
  ];
  const index = order.indexOf(phase);
  if (index < 0 || index >= 3) {
    throw new Error(`Cannot advance adaptive bridge from phase ${phase}`);
  }
  return order[index + 1];
}
