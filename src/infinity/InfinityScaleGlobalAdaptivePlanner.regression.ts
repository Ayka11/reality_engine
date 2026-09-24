import { InfinityScaleGlobalAdaptivePlanner } from "./InfinityScaleGlobalAdaptivePlanner";

const prediction = {
  predictedError: 0.9,
  trend: 0.1,
  acceleration: 0,
  horizon: 1,
  confidence: 1,
  modelVersion: "linear-quadratic-v1",
};

function candidate(regionId: string, utilityScale: number) {
  return {
    regionId,
    currentLOD: 1,
    predictedError: 0.9,
    predictionConfidence: 1,
    goalRelevance: utilityScale,
    physicalCriticality: utilityScale,
    estimatedErrorReduction: utilityScale,
    estimatedNewCells: 10,
    estimatedTransferDescriptors: 2,
    estimatedMemoryBytes: 100,
    estimatedGPUWork: 10,
  };
}

export function runInfinityScaleGlobalAdaptivePlannerRegression(): void {
  const planner = new InfinityScaleGlobalAdaptivePlanner();

  const plan = planner.plan([
    { candidate: candidate("high", 1), prediction, requestedAction: "REFINE" },
    { candidate: candidate("medium", 0.5), prediction, requestedAction: "REFINE" },
    { candidate: candidate("low", 0.1), prediction, requestedAction: "REFINE" },
  ], {
    maxCells: 10,
    maxDescriptors: 2,
    maxMemoryBytes: 100,
    maxGPUWork: 10,
  });

  if (plan.selectedRegionIds.length !== 1 || plan.selectedRegionIds[0] !== "high") {
    throw new Error("Global planner failed deterministic cross-region prioritization");
  }
  if (plan.actions.get("medium") !== "DEFER" || plan.actions.get("low") !== "DEFER") {
    throw new Error("Global planner failed to defer budget-excluded regions");
  }
  if (plan.remainingBudget.maxCells !== 0 || plan.remainingBudget.maxGPUWork !== 0) {
    throw new Error("Global planner reported incorrect remaining budget");
  }

  const replay = planner.plan([
    { candidate: candidate("B", 1), prediction, requestedAction: "REFINE" },
    { candidate: candidate("A", 1), prediction, requestedAction: "REFINE" },
  ], {
    maxCells: 10,
    maxDescriptors: 2,
    maxMemoryBytes: 100,
    maxGPUWork: 10,
  });

  if (replay.selectedRegionIds[0] !== "A") {
    throw new Error("Global planner tie-break is not deterministic");
  }
}
