import { InfinityScaleResolutionUtilityEngine } from "./InfinityScaleResolutionUtility";

export function runInfinityScaleCausalUtilityRegression(): void {
  const engine = new InfinityScaleResolutionUtilityEngine({ minimumUtility: 0.01 });
  const prediction = { predictedError: 0.9, trend: 0, acceleration: 0, horizon: 1, confidence: 1, modelVersion: "test" };

  const physical = engine.score({
    regionId: "physical",
    currentLOD: 0,
    predictedError: 0.9,
    predictionConfidence: 1,
    goalRelevance: 1,
    physicalCriticality: 1,
    estimatedErrorReduction: 1,
    estimatedNewCells: 1,
    estimatedTransferDescriptors: 1,
    estimatedMemoryBytes: 1,
    estimatedGPUWork: 1,
    causalPhysicalBenefit: 0.9,
    causalTransitionDisturbance: 0,
  }, prediction);

  const transition = engine.score({
    regionId: "transition",
    currentLOD: 0,
    predictedError: 0.9,
    predictionConfidence: 1,
    goalRelevance: 1,
    physicalCriticality: 1,
    estimatedErrorReduction: 1,
    estimatedNewCells: 1,
    estimatedTransferDescriptors: 1,
    estimatedMemoryBytes: 1,
    estimatedGPUWork: 1,
    causalPhysicalBenefit: 0.1,
    causalTransitionDisturbance: 0.8,
  }, prediction);

  if (physical.benefit <= transition.benefit) throw new Error("Causal utility did not distinguish physical benefit from transition disturbance");
  if (physical.action !== "REFINE") throw new Error("Physical benefit did not produce refinement utility");
}
