import { InfinityScalePredictiveAdaptivePipeline } from "./InfinityScalePredictiveAdaptivePipeline";
import type { InfinityScaleAdaptiveMutation } from "./InfinityScaleAdaptiveTransferCompiler";
import type { InfinityScaleGPUExecutionBudget } from "./InfinityScaleGPUExecutionPlanAdapter";

export interface InfinityScaleFullPipelineReplayInput {
  stateRevision: number;
  topologyRevision: number;
  mutations: InfinityScaleAdaptiveMutation[];
  gpuBudget: InfinityScaleGPUExecutionBudget;
  conservationValid: boolean;
  gpuComplete: boolean;
  completedGPUDispatchBatchIds?: string[];
}

export interface InfinityScaleFullPipelineReplayResult {
  firstPipelineHash: string;
  secondPipelineHash: string;
  firstTransferPlanHash: string;
  secondTransferPlanHash: string;
  firstGraphHash: string;
  secondGraphHash: string;
  firstGPUPlanHash: string;
  secondGPUPlanHash: string;
  firstCommitReady: boolean;
  secondCommitReady: boolean;
  deterministic: boolean;
}

export function runInfinityScaleFullPipelineReplay(
  input: InfinityScaleFullPipelineReplayInput,
): InfinityScaleFullPipelineReplayResult {
  const run = () => new InfinityScalePredictiveAdaptivePipeline().run({
    ...input,
    expectedStateRevision: input.stateRevision,
    expectedTopologyRevision: input.topologyRevision,
  });

  const first = run();
  const second = run();

  return {
    firstPipelineHash: first.pipelineHash,
    secondPipelineHash: second.pipelineHash,
    firstTransferPlanHash: first.transferPlanHash,
    secondTransferPlanHash: second.transferPlanHash,
    firstGraphHash: first.graphHash,
    secondGraphHash: second.graphHash,
    firstGPUPlanHash: first.gpuPlanHash,
    secondGPUPlanHash: second.gpuPlanHash,
    firstCommitReady: first.commitReady,
    secondCommitReady: second.commitReady,
    deterministic:
      first.pipelineHash === second.pipelineHash &&
      first.transferPlanHash === second.transferPlanHash &&
      first.graphHash === second.graphHash &&
      first.gpuPlanHash === second.gpuPlanHash,
  };
}
