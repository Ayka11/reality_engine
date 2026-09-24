import { runInfinityScaleFullPipelineReplay } from "./InfinityScaleFullPipelineReplay";

export function runInfinityScaleFullPipelineReplayRegression(): void {
  const result = runInfinityScaleFullPipelineReplay({
    stateRevision: 7,
    topologyRevision: 3,
    mutations: [
      { regionId: "front", fromLOD: 0, toLOD: 1 },
      { regionId: "background", fromLOD: 1, toLOD: 0 },
    ],
    gpuBudget: {
      maxDispatches: 10,
      maxWorkgroups: 10,
      maxDescriptors: 10,
    },
    conservationValid: true,
    gpuComplete: true,
  });

  if (!result.deterministic) throw new Error("Full adaptive pipeline replay is not deterministic");
  if (result.firstPipelineHash.length === 0) throw new Error("Missing first pipeline hash");
  if (result.firstGPUPlanHash !== result.secondGPUPlanHash) throw new Error("GPU plan replay hash mismatch");
}
