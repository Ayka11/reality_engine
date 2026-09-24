import { InfinityScaleClosedLoopAdaptiveController } from "./InfinityScaleClosedLoopAdaptiveController";
import { buildInfinityScaleAdaptiveMutationPlan } from "./InfinityScaleAdaptiveMutationPlanBuilder";
import { InfinityScaleClosedLoopExecutablePlanner } from "./InfinityScaleClosedLoopExecutablePlanner";
import type { InfinityScaleClosedLoopAdaptiveInput } from "./InfinityScaleClosedLoopAdaptiveController";
import type { InfinityScaleSpatialConstraintNode } from "./InfinityScaleSpatialConstraintClosure";

export interface InfinityScaleDeterministicReplayInput {
  regions: InfinityScaleClosedLoopAdaptiveInput[];
  topology: InfinityScaleSpatialConstraintNode[];
}

export interface InfinityScaleDeterministicReplayResult {
  epoch: number;
  recommendationHashes: string[];
  mutationPlanHash: string;
  executablePlanHash: string;
}

export function runInfinityScaleDeterministicReplay(
  input: InfinityScaleDeterministicReplayInput,
): InfinityScaleDeterministicReplayResult {
  const controller = new InfinityScaleClosedLoopAdaptiveController();
  const recommendations = input.regions
    .map(region => controller.observeAndRecommend(region))
    .sort((a, b) => a.regionId.localeCompare(b.regionId));

  const recommendationHashes = recommendations.map(recommendation =>
    stableHash(JSON.stringify({
      regionId: recommendation.regionId,
      epoch: recommendation.epoch,
      action: recommendation.action,
      prediction: recommendation.prediction,
      utility: recommendation.utility,
      stability: recommendation.stability,
      transitionAdjustedError: recommendation.transitionAdjustedError,
      transitionPenalty: recommendation.transitionPenalty,
      causalPredictiveError: recommendation.causalPredictiveError,
      causalAttributionHash: recommendation.causalAttributionHash,
    })),
  );

  const mutationPlan = buildInfinityScaleAdaptiveMutationPlan(recommendations);
  const executable = new InfinityScaleClosedLoopExecutablePlanner().compile(mutationPlan, input.topology);

  return {
    epoch: mutationPlan.epoch,
    recommendationHashes,
    mutationPlanHash: mutationPlan.deterministicHash,
    executablePlanHash: executable.deterministicHash,
  };
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
