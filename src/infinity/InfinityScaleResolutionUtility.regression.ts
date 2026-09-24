import { InfinityScaleResolutionUtilityEngine } from "./InfinityScaleResolutionUtility";
import type { InfinityScalePredictionResult } from "./InfinityScalePredictionEngine";

export function runInfinityScaleResolutionUtilityRegression(): void {
  const engine = new InfinityScaleResolutionUtilityEngine();

  const prediction: InfinityScalePredictionResult = {
    predictedError: 0.9,
    trend: 0.1,
    acceleration: 0,
    horizon: 2,
    confidence: 1,
    modelVersion: "linear-quadratic-v1",
  };

  const highValue = engine.score({
    regionId: "critical",
    currentLOD: 1,
    predictedError: 0.9,
    predictionConfidence: 1,
    goalRelevance: 1,
    physicalCriticality: 1,
    estimatedErrorReduction: 0.9,
    estimatedNewCells: 10,
    estimatedTransferDescriptors: 2,
    estimatedMemoryBytes: 100,
    estimatedGPUWork: 10,
  }, prediction);

  if (highValue.action !== "REFINE" || highValue.utility <= 0) {
    throw new Error("High-value region was not selected for refinement");
  }

  const predictions = new Map<string, InfinityScalePredictionResult>([
    ["A", prediction],
    ["B", prediction],
  ]);

  const ranked = engine.prioritize([
    {
      regionId: "A",
      currentLOD: 1,
      predictedError: 0.9,
      predictionConfidence: 1,
      goalRelevance: 1,
      physicalCriticality: 1,
      estimatedErrorReduction: 0.9,
      estimatedNewCells: 10,
      estimatedTransferDescriptors: 2,
      estimatedMemoryBytes: 100,
      estimatedGPUWork: 10,
    },
    {
      regionId: "B",
      currentLOD: 1,
      predictedError: 0.8,
      predictionConfidence: 1,
      goalRelevance: 0.5,
      physicalCriticality: 0.5,
      estimatedErrorReduction: 0.5,
      estimatedNewCells: 10,
      estimatedTransferDescriptors: 2,
      estimatedMemoryBytes: 100,
      estimatedGPUWork: 10,
    },
  ], {
    maxCells: 10,
    maxDescriptors: 2,
    maxMemoryBytes: 100,
    maxGPUWork: 10,
  });

  if (!ranked[0].selected || ranked[1].selected) {
    throw new Error("Budget-aware deterministic prioritization failed");
  }

  const tie = engine.prioritize([
    {
      regionId: "Z",
      currentLOD: 1,
      predictedError: 0.9,
      predictionConfidence: 1,
      goalRelevance: 1,
      physicalCriticality: 1,
      estimatedErrorReduction: 0.9,
      estimatedNewCells: 10,
      estimatedTransferDescriptors: 2,
      estimatedMemoryBytes: 100,
      estimatedGPUWork: 10,
    },
    {
      regionId: "A",
      currentLOD: 1,
      predictedError: 0.9,
      predictionConfidence: 1,
      goalRelevance: 1,
      physicalCriticality: 1,
      estimatedErrorReduction: 0.9,
      estimatedNewCells: 10,
      estimatedTransferDescriptors: 2,
      estimatedMemoryBytes: 100,
      estimatedGPUWork: 10,
    },
  ], {
    maxCells: 10,
    maxDescriptors: 2,
    maxMemoryBytes: 100,
    maxGPUWork: 10,
  });

  if (tie[0].regionId !== "A" || !tie[0].selected) {
    throw new Error("Deterministic region tie-break failed");
  }
}
