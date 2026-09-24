import { runInfinityScaleFullPipelineReplay } from "./InfinityScaleFullPipelineReplay";

export interface InfinityScaleFailureReplayResult {
  deferredDeterministic: boolean;
  incompleteDeterministic: boolean;
  commitBlocked: boolean;
  deferredCount: number;
  incompleteCount: number;
}

export function runInfinityScaleFailureReplay(): InfinityScaleFailureReplayResult {
  const base = {
    stateRevision: 7,
    topologyRevision: 3,
    mutations: [{ regionId: "front", fromLOD: 0, toLOD: 1 }],
    gpuBudget: { maxDispatches: 0, maxWorkgroups: 0, maxDescriptors: 0 },
    conservationValid: true,
  };

  const deferredA = runInfinityScaleFullPipelineReplay({
    ...base,
    gpuComplete: false,
  });
  const deferredB = runInfinityScaleFullPipelineReplay({
    ...base,
    gpuComplete: false,
  });

  const incompleteA = runInfinityScaleFullPipelineReplay({
    ...base,
    gpuBudget: { maxDispatches: 2, maxWorkgroups: 2, maxDescriptors: 2 },
    gpuComplete: false,
    completedGPUDispatchBatchIds: [],
  });
  const incompleteB = runInfinityScaleFullPipelineReplay({
    ...base,
    gpuBudget: { maxDispatches: 2, maxWorkgroups: 2, maxDescriptors: 2 },
    gpuComplete: false,
    completedGPUDispatchBatchIds: [],
  });

  return {
    deferredDeterministic: deferredA.deterministic === deferredB.deterministic &&
      deferredA.firstPipelineHash === deferredB.firstPipelineHash &&
      deferredA.firstGPUPlanHash === deferredB.firstGPUPlanHash,
    incompleteDeterministic: incompleteA.deterministic === incompleteB.deterministic &&
      incompleteA.firstPipelineHash === incompleteB.firstPipelineHash &&
      incompleteA.firstGPUPlanHash === incompleteB.firstGPUPlanHash,
    commitBlocked: !deferredA.firstCommitReady && !incompleteA.firstCommitReady,
    deferredCount: 1,
    incompleteCount: 1,
  };
}
