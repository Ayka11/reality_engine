import { InfinityScaleAdaptiveTransferCompiler, InfinityScaleAdaptiveMutation } from "./InfinityScaleAdaptiveTransferCompiler";
import { InfinityScaleAdaptiveExecutionGraphCompiler } from "./InfinityScaleAdaptiveExecutionGraphCompiler";
import { InfinityScaleGPUExecutionPlanAdapter, InfinityScaleGPUExecutionBudget } from "./InfinityScaleGPUExecutionPlanAdapter";
import { validateInfinityScaleAdaptiveGPUCompletion, type InfinityScaleAdaptiveGPUCompletion } from "./InfinityScaleAdaptiveGPUCompletion";
import { validateInfinityScaleAdaptiveTransactionGate, InfinityScaleAdaptiveTransactionGateResult } from "./InfinityScaleAdaptiveTransactionGate";

export interface InfinityScalePredictiveAdaptivePipelineInput {
  stateRevision: number;
  topologyRevision: number;
  expectedStateRevision: number;
  expectedTopologyRevision: number;
  mutations: InfinityScaleAdaptiveMutation[];
  gpuBudget: InfinityScaleGPUExecutionBudget;
  conservationValid: boolean;
  gpuComplete: boolean;
  completedGPUDispatchBatchIds?: string[];
}

export interface InfinityScalePredictiveAdaptivePipelineResult {
  transferPlanHash: string;
  graphHash: string;
  gpuPlanHash: string;
  mutationCount: number;
  transferCount: number;
  deferredNodeIds: string[];
  gpuCompletion?: InfinityScaleAdaptiveGPUCompletion;
  transaction: InfinityScaleAdaptiveTransactionGateResult;
  executable: boolean;
  commitReady: boolean;
  pipelineHash: string;
}

export class InfinityScalePredictiveAdaptivePipeline {
  private readonly transferCompiler = new InfinityScaleAdaptiveTransferCompiler();
  private readonly graphCompiler = new InfinityScaleAdaptiveExecutionGraphCompiler();
  private readonly gpuAdapter = new InfinityScaleGPUExecutionPlanAdapter();

  run(input: InfinityScalePredictiveAdaptivePipelineInput): InfinityScalePredictiveAdaptivePipelineResult {
    const transferPlan = this.transferCompiler.compile(input.mutations);
    const graph = this.graphCompiler.compile(transferPlan);
    const gpuPlan = this.gpuAdapter.compile(graph, input.gpuBudget);
    const gpuCompletion = input.completedGPUDispatchBatchIds
      ? validateInfinityScaleAdaptiveGPUCompletion(graph, gpuPlan, input.completedGPUDispatchBatchIds)
      : undefined;
    const transaction = validateInfinityScaleAdaptiveTransactionGate({
      sourceStateRevision: input.stateRevision,
      expectedStateRevision: input.expectedStateRevision,
      sourceTopologyRevision: input.topologyRevision,
      expectedTopologyRevision: input.expectedTopologyRevision,
      graph, gpuPlan,
      conservationValid: input.conservationValid,
      gpuComplete: input.gpuComplete,
      gpuCompletion,
    });
    const pipelineHash = stableHash(JSON.stringify({
      transferPlanHash: transferPlan.transferPlanHash, graphHash: graph.graphHash,
      gpuPlanHash: gpuPlan.planHash, gpuCompletion, transaction,
    }));
    return {
      transferPlanHash: transferPlan.transferPlanHash,
      graphHash: graph.graphHash,
      gpuPlanHash: gpuPlan.planHash,
      mutationCount: transferPlan.mutations.filter(m => m.fromLOD !== m.toLOD).length,
      transferCount: transferPlan.transfers.length,
      deferredNodeIds: gpuPlan.deferredNodeIds,
      gpuCompletion, transaction,
      executable: transaction.executable, commitReady: transaction.commitReady, pipelineHash,
    };
  }
}
function stableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
