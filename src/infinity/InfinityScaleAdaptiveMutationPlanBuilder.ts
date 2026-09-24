import type { InfinityScaleResolutionAction } from "./InfinityScaleResolutionUtility";
import type { InfinityScaleAdaptiveMutation } from "./InfinityScaleAdaptiveTransferCompiler";
import type { InfinityScaleClosedLoopAdaptiveRecommendation } from "./InfinityScaleClosedLoopAdaptiveController";

export interface InfinityScaleAdaptiveMutationPlan {
  epoch: number;
  mutations: InfinityScaleAdaptiveMutation[];
  deferredRegionIds: string[];
  keptRegionIds: string[];
  coarsenedRegionIds: string[];
  sourceRecommendationHashes: string[];
  deterministicHash: string;
}

export function buildInfinityScaleAdaptiveMutationPlan(
  recommendations: InfinityScaleClosedLoopAdaptiveRecommendation[],
): InfinityScaleAdaptiveMutationPlan {
  const ordered = [...recommendations].sort((a, b) => a.regionId.localeCompare(b.regionId));
  const mutations: InfinityScaleAdaptiveMutation[] = [];
  const deferredRegionIds: string[] = [];
  const keptRegionIds: string[] = [];
  const coarsenedRegionIds: string[] = [];

  for (const recommendation of ordered) {
    const action = recommendation.action;
    if (action === "REFINE") {
      mutations.push({
        regionId: recommendation.regionId,
        fromLOD: recommendation.candidate.currentLOD,
        toLOD: recommendation.candidate.currentLOD + 1,
      });
    } else if (action === "COARSEN") {
      mutations.push({
        regionId: recommendation.regionId,
        fromLOD: recommendation.candidate.currentLOD,
        toLOD: Math.max(0, recommendation.candidate.currentLOD - 1),
      });
      coarsenedRegionIds.push(recommendation.regionId);
    } else if (action === "DEFER") {
      deferredRegionIds.push(recommendation.regionId);
    } else {
      keptRegionIds.push(recommendation.regionId);
    }
  }

  const sourceRecommendationHashes = ordered.map(recommendation =>
    stableHash(JSON.stringify({
      regionId: recommendation.regionId,
      epoch: recommendation.epoch,
      prediction: recommendation.prediction,
      utility: recommendation.utility,
      stability: recommendation.stability,
      action: recommendation.action,
    })),
  );

  return {
    epoch: ordered[0]?.epoch ?? 0,
    mutations,
    deferredRegionIds,
    keptRegionIds,
    coarsenedRegionIds,
    sourceRecommendationHashes,
    deterministicHash: stableHash(JSON.stringify({
      epoch: ordered[0]?.epoch ?? 0,
      mutations,
      deferredRegionIds,
      keptRegionIds,
      coarsenedRegionIds,
      sourceRecommendationHashes,
    })),
  };
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
