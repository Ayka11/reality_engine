import { buildInfinityScaleAdaptiveMutationPlan } from "./InfinityScaleAdaptiveMutationPlanBuilder";
import { InfinityScaleClosedLoopAdaptiveController } from "./InfinityScaleClosedLoopAdaptiveController";

export function runInfinityScaleAdaptiveMutationPlanBuilderRegression(): void {
  const controller = new InfinityScaleClosedLoopAdaptiveController();
  const base = {
    currentLOD: 0, field: "density", estimatedErrorReduction: 0.9,
    estimatedNewCells: 8, estimatedTransferDescriptors: 2, estimatedMemoryBytes: 1024,
    estimatedGPUWork: 4, physicalCriticality: 0.9,
    budget: { maxCells: 100, maxDescriptors: 100, maxMemoryBytes: 100000, maxGPUWork: 100 },
  };
  controller.observeAndRecommend({ ...base, regionId: "b", epoch: 1, runtimeError: 0.2 });
  controller.observeAndRecommend({ ...base, regionId: "b", epoch: 2, runtimeError: 0.4 });
  const b = controller.observeAndRecommend({ ...base, regionId: "b", epoch: 3, runtimeError: 0.7 });

  controller.observeAndRecommend({ ...base, regionId: "a", epoch: 1, runtimeError: 0.2 });
  controller.observeAndRecommend({ ...base, regionId: "a", epoch: 2, runtimeError: 0.3 });
  const a = controller.observeAndRecommend({ ...base, regionId: "a", epoch: 3, runtimeError: 0.6 });

  const plan = buildInfinityScaleAdaptiveMutationPlan([b, a]);
  if (plan.mutations.length === 0) throw new Error("Adaptive mutation plan did not produce a mutation");
  if (plan.mutations[0].regionId !== "a") throw new Error("Mutation plan ordering is not deterministic");
  if (plan.deterministicHash.length === 0) throw new Error("Mutation plan hash missing");

  const replay = buildInfinityScaleAdaptiveMutationPlan([a, b]);
  if (replay.deterministicHash !== plan.deterministicHash) throw new Error("Mutation plan is not deterministic");
}
