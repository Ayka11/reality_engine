import { InfinityScaleClosedLoopExecutablePlanner } from "./InfinityScaleClosedLoopExecutablePlanner";
import { buildInfinityScaleAdaptiveMutationPlan } from "./InfinityScaleAdaptiveMutationPlanBuilder";
import { InfinityScaleClosedLoopAdaptiveController } from "./InfinityScaleClosedLoopAdaptiveController";

export function runInfinityScaleClosedLoopExecutablePlannerRegression(): void {
  const controller = new InfinityScaleClosedLoopAdaptiveController();
  const base = {
    currentLOD: 0, field: "density", estimatedErrorReduction: 0.9,
    estimatedNewCells: 8, estimatedTransferDescriptors: 2, estimatedMemoryBytes: 1024,
    estimatedGPUWork: 4, physicalCriticality: 0.9,
    budget: { maxCells: 100, maxDescriptors: 100, maxMemoryBytes: 100000, maxGPUWork: 100 },
  };
  controller.observeAndRecommend({ ...base, regionId: "a", epoch: 1, runtimeError: 0.2 });
  controller.observeAndRecommend({ ...base, regionId: "a", epoch: 2, runtimeError: 0.4 });
  const recommendation = controller.observeAndRecommend({ ...base, regionId: "a", epoch: 3, runtimeError: 0.8 });
  const mutationPlan = buildInfinityScaleAdaptiveMutationPlan([recommendation]);

  const executable = new InfinityScaleClosedLoopExecutablePlanner().compile(mutationPlan, [
    { regionId: "a", currentLOD: 0, proposedLOD: 1, neighbors: ["b"] },
    { regionId: "b", currentLOD: 0, proposedLOD: 0, neighbors: ["a"] },
  ]);

  if (!executable.closure.valid) throw new Error("Spatially closed adaptive plan is invalid");
  if (executable.mutations.length === 0) throw new Error("Executable plan lost adaptive mutation");
  if (executable.mutations[0].toLOD !== 1) throw new Error("Executable mutation target LOD mismatch");

  const replay = new InfinityScaleClosedLoopExecutablePlanner().compile(mutationPlan, [
    { regionId: "a", currentLOD: 0, proposedLOD: 1, neighbors: ["b"] },
    { regionId: "b", currentLOD: 0, proposedLOD: 0, neighbors: ["a"] },
  ]);
  if (replay.deterministicHash !== executable.deterministicHash) throw new Error("Executable adaptive plan is not deterministic");
}
