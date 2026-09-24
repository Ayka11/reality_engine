import { InfinityScalePredictiveAdaptiveController } from "./InfinityScalePredictiveAdaptiveController";
import { InfinityScaleResolutionGoalRegistry } from "./InfinityScaleResolutionGoalRegistry";

export function runInfinityScalePredictiveAdaptiveControllerRegression(): void {
  const goals = new InfinityScaleResolutionGoalRegistry();
  goals.register({
    goalId: "density-goal",
    name: "Density accuracy",
    fields: ["density"],
    minimumLOD: 1,
    preferredLOD: 2,
    maximumLOD: 4,
    priority: 1,
    accuracyTarget: 0.01,
    regions: ["critical"],
  });

  const controller = new InfinityScalePredictiveAdaptiveController({ goals });

  const inputBase = {
    epoch: 0,
    currentLOD: 0,
    error: 0.9,
    field: "density",
    estimatedErrorReduction: 0.9,
    estimatedNewCells: 1,
    estimatedTransferDescriptors: 1,
    estimatedMemoryBytes: 1,
    estimatedGPUWork: 1,
    physicalCriticality: 1,
    budget: {
      maxCells: 100,
      maxDescriptors: 100,
      maxMemoryBytes: 1000,
      maxGPUWork: 100,
    },
  };

  let recommendation = controller.recommend({ ...inputBase, regionId: "critical" });
  if (!recommendation.advisoryOnly) throw new Error("Controller must remain advisory-only");

  recommendation = controller.recommend({ ...inputBase, regionId: "critical", epoch: 1, error: 0.95 });
  if (recommendation.action === "COARSEN") {
    throw new Error("Predictive controller incorrectly requested coarsening under rising error");
  }

  const deterministicA = new InfinityScalePredictiveAdaptiveController({ goals });
  const deterministicB = new InfinityScalePredictiveAdaptiveController({ goals });
  const a0 = deterministicA.recommend({ ...inputBase, regionId: "critical" });
  const b0 = deterministicB.recommend({ ...inputBase, regionId: "critical" });
  if (JSON.stringify(a0) !== JSON.stringify(b0)) {
    throw new Error("Predictive adaptive recommendation is not deterministic");
  }

  const constrained = new InfinityScalePredictiveAdaptiveController({ goals });
  const first = constrained.recommend({
    ...inputBase,
    regionId: "critical",
    epoch: 0,
    budget: { maxCells: 0, maxDescriptors: 0, maxMemoryBytes: 0, maxGPUWork: 0 },
  });
  if (first.action === "REFINE") {
    throw new Error("Budget gate was bypassed");
  }
}
