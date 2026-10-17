import { InfinityScaleClosedLoopAdaptiveController } from "./InfinityScaleClosedLoopAdaptiveController";

export function runInfinityScaleClosedLoopPostCommitFeedbackRegression(): void {
  const controller = new InfinityScaleClosedLoopAdaptiveController();

  controller.observePostCommit({
    regionId: "front",
    epoch: 10,
    errorBefore: 0.8,
    errorAfter: 0.4,
    committed: true,
    topologyChanged: true,
  });

  const next = controller.observeAndRecommend({
    regionId: "front",
    epoch: 11,
    runtimeError: 0.4,
    currentLOD: 1,
    field: "density",
    estimatedErrorReduction: 0.8,
    estimatedNewCells: 8,
    estimatedTransferDescriptors: 2,
    estimatedMemoryBytes: 1024,
    estimatedGPUWork: 4,
    physicalCriticality: 0.8,
    budget: { maxCells: 100, maxDescriptors: 100, maxMemoryBytes: 100000, maxGPUWork: 100 },
  });

  if (next.transitionPenalty <= 0) throw new Error("Post-commit transition penalty was not propagated");
  if (next.transitionAdjustedError <= 0.4) throw new Error("Transition-adjusted error was not applied");
  if (next.feedbackPrediction.observedError !== next.transitionAdjustedError) throw new Error("Prediction feedback did not receive adjusted error");

  const state = controller.getTransitionState("front");
  if (!state || state.epoch !== 10 || state.delta !== -0.4) throw new Error("Transition state is not deterministic");
}
