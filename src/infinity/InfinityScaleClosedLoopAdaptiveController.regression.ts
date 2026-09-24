import { InfinityScaleClosedLoopAdaptiveController } from "./InfinityScaleClosedLoopAdaptiveController";

export function runInfinityScaleClosedLoopAdaptiveControllerRegression(): void {
  const controller = new InfinityScaleClosedLoopAdaptiveController();
  const base = {
    regionId: "front",
    epoch: 1,
    currentLOD: 0,
    field: "density",
    estimatedErrorReduction: 0.8,
    estimatedNewCells: 8,
    estimatedTransferDescriptors: 2,
    estimatedMemoryBytes: 1024,
    estimatedGPUWork: 4,
    physicalCriticality: 0.9,
    budget: { maxCells: 100, maxDescriptors: 100, maxMemoryBytes: 100000, maxGPUWork: 100 },
  };
  controller.observeAndRecommend({ ...base, runtimeError: 0.2 });
  controller.observeAndRecommend({ ...base, epoch: 2, runtimeError: 0.35 });
  const result = controller.observeAndRecommend({ ...base, epoch: 3, runtimeError: 0.55 });
  if (result.feedbackPrediction.prediction.trend <= 0) throw new Error("Closed-loop feedback trend was not propagated");
  if (result.prediction.trend <= 0) throw new Error("Adaptive controller did not observe rising runtime error");
  if (!result.action) throw new Error("Closed-loop controller returned no adaptive action");
  if (result.advisoryOnly !== true) throw new Error("Closed-loop controller must remain advisory-only");
}
