import type { InfinityScalePredictionResult } from "./InfinityScalePredictionEngine";

export type InfinityScaleResolutionAction = "REFINE" | "KEEP" | "COARSEN" | "DEFER";

export interface InfinityScaleResolutionCandidate {
  regionId: string;
  currentLOD: number;
  predictedError: number;
  predictionConfidence: number;
  goalRelevance: number;
  physicalCriticality: number;
  estimatedErrorReduction: number;
  estimatedNewCells: number;
  estimatedTransferDescriptors: number;
  estimatedMemoryBytes: number;
  estimatedGPUWork: number;\n  causalPhysicalBenefit?: number;\n  causalTransitionDisturbance?: number;
}

export interface InfinityScaleResolutionUtilityConfig {
  errorWeight: number;
  goalWeight: number;
  criticalityWeight: number;
  cellCostWeight: number;
  descriptorCostWeight: number;
  memoryCostWeight: number;
  gpuCostWeight: number;
  minimumUtility: number;
}

export interface InfinityScaleResolutionUtility {
  benefit: number;
  cost: number;
  utility: number;
  action: InfinityScaleResolutionAction;
}

export interface InfinityScaleResolutionBudget {
  maxCells: number;
  maxDescriptors: number;
  maxMemoryBytes: number;
  maxGPUWork: number;
}

export const DEFAULT_INFINITY_SCALE_RESOLUTION_UTILITY: InfinityScaleResolutionUtilityConfig = {
  errorWeight: 1,
  goalWeight: 1,
  criticalityWeight: 1,
  cellCostWeight: 1,
  descriptorCostWeight: 1,
  memoryCostWeight: 1,
  gpuCostWeight: 1,
  minimumUtility: 0.05,
};

export class InfinityScaleResolutionUtilityEngine {
  private readonly config: InfinityScaleResolutionUtilityConfig;

  constructor(config: Partial<InfinityScaleResolutionUtilityConfig> = {}) {
    this.config = { ...DEFAULT_INFINITY_SCALE_RESOLUTION_UTILITY, ...config };
  }

  score(
    candidate: InfinityScaleResolutionCandidate,
    prediction: InfinityScalePredictionResult,
  ): InfinityScaleResolutionUtility {
    const benefit = clamp01(
      prediction.predictedError *
      prediction.confidence *
      candidate.estimatedErrorReduction *
      weightedSignal(
        candidate.goalRelevance,
        candidate.physicalCriticality,
        this.config.goalWeight,
        this.config.criticalityWeight,
      ),
    );

    const cost =
      this.config.cellCostWeight * normalizeCost(candidate.estimatedNewCells) +
      this.config.descriptorCostWeight * normalizeCost(candidate.estimatedTransferDescriptors) +
      this.config.memoryCostWeight * normalizeCost(candidate.estimatedMemoryBytes) +
      this.config.gpuCostWeight * normalizeCost(candidate.estimatedGPUWork);

    const utility = benefit / Math.max(1e-9, cost);

    let action: InfinityScaleResolutionAction = "KEEP";
    if (utility >= this.config.minimumUtility) action = "REFINE";
    if (prediction.confidence === 0 && candidate.predictedError < 0.98) action = "KEEP";

    return { benefit, cost, utility, action };
  }

  prioritize(
    candidates: InfinityScaleResolutionCandidate[],
    predictions: Map<string, InfinityScalePredictionResult>,
    budget: InfinityScaleResolutionBudget,
  ): Array<InfinityScaleResolutionCandidate & {
    utility: InfinityScaleResolutionUtility;
    selected: boolean;
  }> {
    const scored = candidates.map(candidate => {
      const prediction = predictions.get(candidate.regionId);
      if (!prediction) {
        return {
          ...candidate,
          utility: {
            benefit: 0,
            cost: Number.POSITIVE_INFINITY,
            utility: 0,
            action: "DEFER" as const,
          },
          selected: false,
        };
      }
      return {
        ...candidate,
        utility: this.score(candidate, prediction),
        selected: false,
      };
    });

    scored.sort((a, b) =>
      b.utility.utility - a.utility.utility ||
      a.regionId.localeCompare(b.regionId),
    );

    let cells = 0;
    let descriptors = 0;
    let memory = 0;
    let gpu = 0;

    for (const item of scored) {
      if (item.utility.action !== "REFINE") continue;
      const fits =
        cells + item.estimatedNewCells <= budget.maxCells &&
        descriptors + item.estimatedTransferDescriptors <= budget.maxDescriptors &&
        memory + item.estimatedMemoryBytes <= budget.maxMemoryBytes &&
        gpu + item.estimatedGPUWork <= budget.maxGPUWork;

      if (!fits) {
        item.utility = { ...item.utility, action: "DEFER" };
        continue;
      }

      item.selected = true;
      cells += item.estimatedNewCells;
      descriptors += item.estimatedTransferDescriptors;
      memory += item.estimatedMemoryBytes;
      gpu += item.estimatedGPUWork;
    }

    return scored;
  }
}

function weightedSignal(goal: number, criticality: number, goalWeight: number, criticalityWeight: number): number {
  const denominator = Math.max(1e-9, goalWeight + criticalityWeight);
  return clamp01((goal * goalWeight + criticality * criticalityWeight) / denominator);
}

function normalizeCost(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error("Resolution cost must be finite and non-negative");
  return Math.max(1e-6, value);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
