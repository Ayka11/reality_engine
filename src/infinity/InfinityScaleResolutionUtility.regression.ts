import { InfinityScaleResolutionUtilityEngine } from "./InfinityScaleResolutionUtility";
import type { InfinityScaleResolutionCandidate, InfinityScaleResolutionPrediction } from "./InfinityScaleResolutionUtility";

export function runInfinityScaleResolutionUtilityRegression(): void {
  const engine = new InfinityScaleResolutionUtilityEngine();
  const prediction: InfinityScaleResolutionPrediction = { predictedError: 0.9, confidence: 1 };
  const candidate = (regionId: string, overrides: Partial<InfinityScaleResolutionCandidate> = {}): InfinityScaleResolutionCandidate => ({
    regionId, currentLOD: 1, predictedError: 0.9, predictionConfidence: 1,
    goalRelevance: 1, physicalCriticality: 1, estimatedErrorReduction: 0.9,
    estimatedNewCells: 10, estimatedTransferDescriptors: 2, estimatedMemoryBytes: 100, estimatedGPUWork: 10,
    ...overrides,
  });
  const high = engine.score(candidate("critical"), prediction);
  if (high.action !== "REFINE" || high.utility <= 0) throw new Error("High-value region should be advisory REFINE");

  const ranked = engine.prioritize([
    candidate("B", { goalRelevance: 0.5, physicalCriticality: 0.5, estimatedErrorReduction: 0.5 }),
    candidate("A"),
  ], new Map([["A", prediction], ["B", prediction]]), {
    maxCells: 10, maxDescriptors: 2, maxMemoryBytes: 100, maxGPUWork: 10,
  });
  if (ranked[0].regionId !== "A" || !ranked[0].selected || ranked[1].selected) {
    throw new Error("Budget-aware ranking failed");
  }
  const tie = engine.prioritize([candidate("Z"), candidate("A")], new Map([["A", prediction], ["Z", prediction]]), {
    maxCells: 10, maxDescriptors: 2, maxMemoryBytes: 100, maxGPUWork: 10,
  });
  if (tie[0].regionId !== "A" || !tie[0].selected) throw new Error("Deterministic tie-break failed");

  const missing = engine.prioritize([candidate("missing")], new Map(), {
    maxCells: 10, maxDescriptors: 2, maxMemoryBytes: 100, maxGPUWork: 10,
  });
  if (missing[0].selected || missing[0].utility.action !== "DEFER") throw new Error("Missing prediction was not deferred");

  const invalidCases: Array<[InfinityScaleResolutionCandidate, InfinityScaleResolutionPrediction]> = [
    [candidate("nan", { goalRelevance: Number.NaN }), prediction],
    [candidate("infinite", { estimatedGPUWork: Number.POSITIVE_INFINITY }), prediction],
    [candidate("negative", { estimatedNewCells: -1 }), prediction],
    [candidate("out-of-range", { predictedError: 1.1 }), prediction],
    [candidate("bad-causal", { causalPhysicalBenefit: Number.NaN }), prediction],
  ];
  for (const [badCandidate, badPrediction] of invalidCases) {
    let rejected = false;
    try { engine.score(badCandidate, badPrediction); } catch { rejected = true; }
    if (!rejected) throw new Error("Invalid resolution input was accepted");
  }
  let badBudgetRejected = false;
  try {
    engine.prioritize([candidate("A")], new Map([["A", prediction]]), {
      maxCells: -1, maxDescriptors: 2, maxMemoryBytes: 100, maxGPUWork: 10,
    });
  } catch { badBudgetRejected = true; }
  if (!badBudgetRejected) throw new Error("Invalid resource budget was accepted");

  // This module ranks candidates only; a REFINE score is not commit permission.
  if (high.action !== "REFINE") throw new Error("Expected advisory decision changed unexpectedly");
}
