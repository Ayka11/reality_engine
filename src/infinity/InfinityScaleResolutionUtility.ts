export type InfinityScaleResolutionAction = "REFINE" | "KEEP" | "COARSEN" | "DEFER";

/** Structural prediction contract: no dependency on a specific prediction runtime. */
export interface InfinityScaleResolutionPrediction {
  predictedError: number;
  confidence: number;
}

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
  estimatedGPUWork: number;
  causalPhysicalBenefit?: number;
  causalTransitionDisturbance?: number;
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
  cellCostWeight: 0.01,
  descriptorCostWeight: 0.1,
  memoryCostWeight: 0.001,
  gpuCostWeight: 0.01,
  minimumUtility: 0.01,
};

/**
 * Pure advisory scoring and budget ranking only. It does not compile GPU work,
 * mutate topology, or authorize a transaction commit.
 */
export class InfinityScaleResolutionUtilityEngine {
  private readonly config: InfinityScaleResolutionUtilityConfig;

  constructor(config: Partial<InfinityScaleResolutionUtilityConfig> = {}) {
    this.config = { ...DEFAULT_INFINITY_SCALE_RESOLUTION_UTILITY, ...config };
    validateConfig(this.config);
  }

  score(
    candidate: InfinityScaleResolutionCandidate,
    prediction: InfinityScaleResolutionPrediction,
  ): InfinityScaleResolutionUtility {
    validateCandidate(candidate);
    validatePrediction(prediction);

    const causalPhysicalBenefit = candidate.causalPhysicalBenefit ?? 1;
    const causalTransitionDisturbance = candidate.causalTransitionDisturbance ?? 0;
    const signal = weightedSignal(
      prediction.predictedError,
      candidate.goalRelevance,
      candidate.physicalCriticality,
      this.config.errorWeight,
      this.config.goalWeight,
      this.config.criticalityWeight,
    );
    const baselineBenefit = prediction.confidence * candidate.estimatedErrorReduction * signal;
    const benefit = clamp01(
      baselineBenefit * causalPhysicalBenefit * (1 - causalTransitionDisturbance),
    );

    const cost =
      this.config.cellCostWeight * normalizeCost(candidate.estimatedNewCells) +
      this.config.descriptorCostWeight * normalizeCost(candidate.estimatedTransferDescriptors) +
      this.config.memoryCostWeight * normalizeCost(candidate.estimatedMemoryBytes) +
      this.config.gpuCostWeight * normalizeCost(candidate.estimatedGPUWork);

    const utility = benefit / Math.max(1e-9, cost);
    if (!Number.isFinite(benefit) || !Number.isFinite(cost) || !Number.isFinite(utility)) {
      throw new Error("Resolution utility calculation must remain finite");
    }

    let action: InfinityScaleResolutionAction = utility >= this.config.minimumUtility ? "REFINE" : "KEEP";
    if (prediction.confidence === 0 && candidate.predictedError < 0.98) action = "KEEP";
    return { benefit, cost, utility, action };
  }

  prioritize(
    candidates: InfinityScaleResolutionCandidate[],
    predictions: Map<string, InfinityScaleResolutionPrediction>,
    budget: InfinityScaleResolutionBudget,
  ): Array<InfinityScaleResolutionCandidate & { utility: InfinityScaleResolutionUtility; selected: boolean }> {
    validateBudget(budget);
    const ids = new Set<string>();
    const scored = candidates.map(candidate => {
      validateCandidate(candidate);
      if (ids.has(candidate.regionId)) throw new Error("Resolution candidate region IDs must be unique");
      ids.add(candidate.regionId);
      const prediction = predictions.get(candidate.regionId);
      if (!prediction) {
        return {
          ...candidate,
          utility: { benefit: 0, cost: Number.POSITIVE_INFINITY, utility: 0, action: "DEFER" as const },
          selected: false,
        };
      }
      return { ...candidate, utility: this.score(candidate, prediction), selected: false };
    });

    scored.sort((a, b) =>
      b.utility.utility - a.utility.utility || a.regionId.localeCompare(b.regionId),
    );

    let cells = 0;
    let descriptors = 0;
    let memory = 0;
    let gpu = 0;
    for (const item of scored) {
      if (item.utility.action !== "REFINE") continue;
      const nextCells = cells + item.estimatedNewCells;
      const nextDescriptors = descriptors + item.estimatedTransferDescriptors;
      const nextMemory = memory + item.estimatedMemoryBytes;
      const nextGPU = gpu + item.estimatedGPUWork;
      if (![nextCells, nextDescriptors, nextMemory, nextGPU].every(Number.isSafeInteger)) {
        throw new Error("Resolution budget accounting overflowed safe integer range");
      }
      const fits = nextCells <= budget.maxCells &&
        nextDescriptors <= budget.maxDescriptors &&
        nextMemory <= budget.maxMemoryBytes &&
        nextGPU <= budget.maxGPUWork;
      if (!fits) {
        item.utility = { ...item.utility, action: "DEFER" };
        continue;
      }
      item.selected = true;
      cells = nextCells;
      descriptors = nextDescriptors;
      memory = nextMemory;
      gpu = nextGPU;
    }
    return scored;
  }
}

function validateConfig(config: InfinityScaleResolutionUtilityConfig): void {
  for (const [key, value] of Object.entries(config)) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`Resolution config ${key} must be finite and non-negative`);
  }
}

function validateCandidate(candidate: InfinityScaleResolutionCandidate): void {
  if (typeof candidate.regionId !== "string" || candidate.regionId.trim().length === 0) {
    throw new Error("Resolution candidate regionId must be non-empty");
  }
  if (!Number.isSafeInteger(candidate.currentLOD) || candidate.currentLOD < 0) {
    throw new Error("Resolution currentLOD must be a non-negative safe integer");
  }
  for (const [key, value] of Object.entries(candidate)) {
    if (key === "regionId" || key === "currentLOD" || value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error(`Resolution candidate ${key} must be finite and non-negative`);
    }
  }
  for (const key of ["predictedError", "predictionConfidence", "goalRelevance", "physicalCriticality", "estimatedErrorReduction"] as const) {
    if (candidate[key] > 1) throw new Error(`Resolution candidate ${key} must be in [0, 1]`);
  }
  if (candidate.causalPhysicalBenefit !== undefined && candidate.causalPhysicalBenefit > 1) {
    throw new Error("Resolution causalPhysicalBenefit must be in [0, 1]");
  }
  if (candidate.causalTransitionDisturbance !== undefined && candidate.causalTransitionDisturbance > 1) {
    throw new Error("Resolution causalTransitionDisturbance must be in [0, 1]");
  }
  for (const key of ["estimatedNewCells", "estimatedTransferDescriptors", "estimatedMemoryBytes", "estimatedGPUWork"] as const) {
    if (!Number.isSafeInteger(candidate[key])) throw new Error(`Resolution candidate ${key} must be a non-negative safe integer`);
  }
}

function validatePrediction(prediction: InfinityScaleResolutionPrediction): void {
  if (!Number.isFinite(prediction.predictedError) || prediction.predictedError < 0 || prediction.predictedError > 1) {
    throw new Error("Resolution prediction predictedError must be in [0, 1]");
  }
  if (!Number.isFinite(prediction.confidence) || prediction.confidence < 0 || prediction.confidence > 1) {
    throw new Error("Resolution prediction confidence must be in [0, 1]");
  }
}

function validateBudget(budget: InfinityScaleResolutionBudget): void {
  for (const [key, value] of Object.entries(budget)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Resolution budget ${key} must be a non-negative safe integer`);
  }
}

function weightedSignal(
  error: number,
  goal: number,
  criticality: number,
  errorWeight: number,
  goalWeight: number,
  criticalityWeight: number,
): number {
  const denominator = errorWeight + goalWeight + criticalityWeight;
  if (denominator === 0) return 0;
  return clamp01((error * errorWeight + goal * goalWeight + criticality * criticalityWeight) / denominator);
}

function normalizeCost(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Resolution cost must be a non-negative safe integer");
  return Math.max(1e-6, value);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
