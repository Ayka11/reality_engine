import {
  InfinityScaleAdaptiveStability,
  type InfinityScaleAdaptiveDecision,
} from "./InfinityScaleAdaptiveStability";
import {
  InfinityScalePredictionEngine,
  type InfinityScalePredictionResult,
} from "./InfinityScalePredictionEngine";
import {
  InfinityScaleResolutionUtilityEngine,
  type InfinityScaleResolutionAction,
  type InfinityScaleResolutionBudget,
  type InfinityScaleResolutionCandidate,
} from "./InfinityScaleResolutionUtility";
import { InfinityScaleResolutionGoalRegistry } from "./InfinityScaleResolutionGoalRegistry";

export interface InfinityScalePredictiveAdaptiveInput {
  regionId: string;
  epoch: number;
  currentLOD: number;
  error: number;
  field: string;
  estimatedErrorReduction: number;
  estimatedNewCells: number;
  estimatedTransferDescriptors: number;
  estimatedMemoryBytes: number;
  estimatedGPUWork: number;
  physicalCriticality: number;
  budget: InfinityScaleResolutionBudget;
}

export interface InfinityScalePredictiveAdaptiveRecommendation {
  regionId: string;
  epoch: number;
  prediction: InfinityScalePredictionResult;
  goalRelevance: number;
  candidate: InfinityScaleResolutionCandidate;
  utility: {
    benefit: number;
    cost: number;
    utility: number;
    action: InfinityScaleResolutionAction;
  };
  stability: InfinityScaleAdaptiveDecision;
  action: InfinityScaleResolutionAction;
  advisoryOnly: true;
  reason: string;
}

export class InfinityScalePredictiveAdaptiveController {
  private readonly predictor: InfinityScalePredictionEngine;
  private readonly goals: InfinityScaleResolutionGoalRegistry;
  private readonly utility: InfinityScaleResolutionUtilityEngine;
  private readonly stability: InfinityScaleAdaptiveStability;

  constructor(options: {
    predictor?: InfinityScalePredictionEngine;
    goals?: InfinityScaleResolutionGoalRegistry;
    utility?: InfinityScaleResolutionUtilityEngine;
    stability?: InfinityScaleAdaptiveStability;
  } = {}) {
    this.predictor = options.predictor ?? new InfinityScalePredictionEngine();
    this.goals = options.goals ?? new InfinityScaleResolutionGoalRegistry();
    this.utility = options.utility ?? new InfinityScaleResolutionUtilityEngine();
    this.stability = options.stability ?? new InfinityScaleAdaptiveStability();
  }

  recommend(input: InfinityScalePredictiveAdaptiveInput): InfinityScalePredictiveAdaptiveRecommendation {
    const goalRelevance = this.goals.relevance(input.regionId, input.field, input.currentLOD);

    this.predictor.observe(input.regionId, input.epoch, input.error);
    const prediction = this.predictor.predict(input.regionId, 1);

    const candidate: InfinityScaleResolutionCandidate = {
      regionId: input.regionId,
      currentLOD: input.currentLOD,
      predictedError: prediction.predictedError,
      predictionConfidence: prediction.confidence,
      goalRelevance,
      physicalCriticality: clamp01(input.physicalCriticality),
      estimatedErrorReduction: clamp01(input.estimatedErrorReduction),
      estimatedNewCells: input.estimatedNewCells,
      estimatedTransferDescriptors: input.estimatedTransferDescriptors,
      estimatedMemoryBytes: input.estimatedMemoryBytes,
      estimatedGPUWork: input.estimatedGPUWork,
    };

    const utility = this.utility.score(candidate, prediction);
    const stability = this.stability.decide(
      input.regionId,
      input.epoch,
      {
        score: Math.max(prediction.predictedError, input.error),
        estimatedError: prediction.predictedError,
      },
      input.currentLOD,
    );

    let action: InfinityScaleResolutionAction = utility.action;

    if (stability.decision === "HOLD") action = "DEFER";
    else if (stability.decision === "KEEP" && action === "REFINE") action = "KEEP";
    else if (stability.decision === "COARSEN") action = "COARSEN";

    if (prediction.confidence === 0 && input.error < 0.98 && action === "REFINE") {
      action = "KEEP";
    }

    return {
      regionId: input.regionId,
      epoch: input.epoch,
      prediction,
      goalRelevance,
      candidate,
      utility,
      stability,
      action,
      advisoryOnly: true,
      reason: buildReason(prediction, utility.action, stability.decision, action),
    };
  }
}

function buildReason(
  prediction: InfinityScalePredictionResult,
  utilityAction: InfinityScaleResolutionAction,
  stabilityAction: string,
  finalAction: InfinityScaleResolutionAction,
): string {
  if (stabilityAction === "HOLD") return "stability gate deferred adaptive mutation";
  if (utilityAction === "DEFER") return "utility or budget gate deferred refinement";
  if (prediction.confidence === 0) return "prediction confidence is insufficient; reactive-safe action retained";
  return `predictive utility=${finalAction.toLowerCase()}`;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
