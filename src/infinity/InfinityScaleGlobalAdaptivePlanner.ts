import type { InfinityScaleResolutionBudget, InfinityScaleResolutionCandidate, InfinityScaleResolutionAction } from "./InfinityScaleResolutionUtility";
import type { InfinityScalePredictionResult } from "./InfinityScalePredictionEngine";
import { InfinityScaleResolutionUtilityEngine } from "./InfinityScaleResolutionUtility";

export interface InfinityScaleGlobalAdaptiveRegion {
  candidate: InfinityScaleResolutionCandidate;
  prediction: InfinityScalePredictionResult;
  requestedAction: InfinityScaleResolutionAction;
  neighborRegionIds?: string[];
}

export interface InfinityScaleGlobalAdaptivePlan {
  selectedRegionIds: string[];
  deferredRegionIds: string[];
  actions: Map<string, InfinityScaleResolutionAction>;
  usedBudget: InfinityScaleResolutionBudget;
  remainingBudget: InfinityScaleResolutionBudget;
}

export class InfinityScaleGlobalAdaptivePlanner {
  private readonly utility: InfinityScaleResolutionUtilityEngine;

  constructor(utility = new InfinityScaleResolutionUtilityEngine()) {
    this.utility = utility;
  }

  plan(
    regions: InfinityScaleGlobalAdaptiveRegion[],
    budget: InfinityScaleResolutionBudget,
  ): InfinityScaleGlobalAdaptivePlan {
    const predictions = new Map(regions.map(region => [region.candidate.regionId, region.prediction]));
    const candidates = regions.map(region => region.candidate);
    const ranked = this.utility.prioritize(candidates, predictions, budget);

    const actions = new Map<string, InfinityScaleResolutionAction>();
    for (const region of regions) actions.set(region.candidate.regionId, "KEEP");

    const selectedRegionIds: string[] = [];
    const deferredRegionIds: string[] = [];

    for (const item of ranked) {
      if (item.selected) {
        actions.set(item.regionId, "REFINE");
        selectedRegionIds.push(item.regionId);
      } else if (item.utility.action === "DEFER") {
        actions.set(item.regionId, "DEFER");
        deferredRegionIds.push(item.regionId);
      }
    }

    const usedBudget = subtractBudget(budget, budgetFromSelected(regions, selectedRegionIds));
    const remainingBudget = {
      maxCells: Math.max(0, usedBudget.maxCells),
      maxDescriptors: Math.max(0, usedBudget.maxDescriptors),
      maxMemoryBytes: Math.max(0, usedBudget.maxMemoryBytes),
      maxGPUWork: Math.max(0, usedBudget.maxGPUWork),
    };

    return {
      selectedRegionIds,
      deferredRegionIds,
      actions,
      usedBudget: budgetFromSelected(regions, selectedRegionIds),
      remainingBudget,
    };
  }
}

function budgetFromSelected(
  regions: InfinityScaleGlobalAdaptiveRegion[],
  selected: string[],
): InfinityScaleResolutionBudget {
  const set = new Set(selected);
  return regions.reduce((sum, region) => {
    if (!set.has(region.candidate.regionId)) return sum;
    return {
      maxCells: sum.maxCells + region.candidate.estimatedNewCells,
      maxDescriptors: sum.maxDescriptors + region.candidate.estimatedTransferDescriptors,
      maxMemoryBytes: sum.maxMemoryBytes + region.candidate.estimatedMemoryBytes,
      maxGPUWork: sum.maxGPUWork + region.candidate.estimatedGPUWork,
    };
  }, { maxCells: 0, maxDescriptors: 0, maxMemoryBytes: 0, maxGPUWork: 0 });
}

function subtractBudget(a: InfinityScaleResolutionBudget, b: InfinityScaleResolutionBudget): InfinityScaleResolutionBudget {
  return {
    maxCells: a.maxCells - b.maxCells,
    maxDescriptors: a.maxDescriptors - b.maxDescriptors,
    maxMemoryBytes: a.maxMemoryBytes - b.maxMemoryBytes,
    maxGPUWork: a.maxGPUWork - b.maxGPUWork,
  };
}
