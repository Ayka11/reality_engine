import { InfinityScaleClosedLoopAdaptiveController, type InfinityScaleClosedLoopRuntimeRegion } from "./InfinityScaleClosedLoopAdaptiveController";
import { buildInfinityScaleAdaptiveMutationPlan } from "./InfinityScaleAdaptiveMutationPlanBuilder";
import { InfinityScaleClosedLoopExecutablePlanner } from "./InfinityScaleClosedLoopExecutablePlanner";

export interface InfinityScaleRuntimeReplayEpoch {
  epoch: number;
  stateRevision: number;
  topologyRevision: number;
  regions: InfinityScaleClosedLoopRuntimeRegion[];
  errorAfterCommit: number;
  committed: boolean;
  topologyChanged: boolean;
}

export interface InfinityScaleRuntimeReplayResult {
  epochs: number;
  recommendationHashes: string[];
  mutationPlanHashes: string[];
  executablePlanHashes: string[];
  transitionPenalties: number[];
  finalStateRevision: number;
  finalTopologyRevision: number;
  deterministicHash: string;
}

export function runInfinityScaleRuntimeReplay(
  epochs: InfinityScaleRuntimeReplayEpoch[],
): InfinityScaleRuntimeReplayResult {
  const controller = new InfinityScaleClosedLoopAdaptiveController();
  const recommendationHashes: string[] = [];
  const mutationPlanHashes: string[] = [];
  const executablePlanHashes: string[] = [];
  const transitionPenalties: number[] = [];

  for (const epoch of [...epochs].sort((a, b) => a.epoch - b.epoch)) {
    const recommendations = epoch.regions
      .map(region => controller.observeAndRecommend({
        ...region,
        currentLOD: region.currentLOD ?? region.topology.currentLOD,
        error: region.runtimeError,
      }))
      .sort((a, b) => a.regionId.localeCompare(b.regionId));

    recommendationHashes.push(stableHash(JSON.stringify(recommendations)));
    transitionPenalties.push(...recommendations.map(r => r.transitionPenalty));

    const mutationPlan = buildInfinityScaleAdaptiveMutationPlan(recommendations);
    mutationPlanHashes.push(mutationPlan.deterministicHash);

    const executable = new InfinityScaleClosedLoopExecutablePlanner().compile(
      mutationPlan,
      epoch.regions.map(region => ({
        ...region.topology,
        currentLOD: region.currentLOD ?? region.topology.currentLOD,
      })),
    );
    executablePlanHashes.push(executable.deterministicHash);

    for (const region of epoch.regions) {
      const recommendation = recommendations.find(r => r.regionId === region.regionId);
      if (recommendation && epoch.committed) {
        controller.observePostCommit({
          regionId: region.regionId,
          epoch: epoch.epoch,
          errorBefore: region.runtimeError,
          errorAfter: epoch.errorAfterCommit,
          committed: epoch.committed,
          topologyChanged: epoch.topologyChanged,
        });
      }
    }
  }

  return {
    epochs: epochs.length,
    recommendationHashes,
    mutationPlanHashes,
    executablePlanHashes,
    transitionPenalties,
    finalStateRevision: epochs.length ? epochs[epochs.length - 1].stateRevision : 0,
    finalTopologyRevision: epochs.length ? epochs[epochs.length - 1].topologyRevision : 0,
    deterministicHash: stableHash(JSON.stringify({
      recommendationHashes,
      mutationPlanHashes,
      executablePlanHashes,
      transitionPenalties,
      finalStateRevision: epochs.length ? epochs[epochs.length - 1].stateRevision : 0,
      finalTopologyRevision: epochs.length ? epochs[epochs.length - 1].topologyRevision : 0,
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
