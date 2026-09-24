import { InfinityScaleAdaptiveFeedbackLoop } from "./InfinityScaleAdaptiveFeedbackLoop";
import { InfinityScaleAdaptiveTransferCompiler } from "./InfinityScaleAdaptiveTransferCompiler";
import { InfinityScaleAdaptiveExecutionGraphCompiler } from "./InfinityScaleAdaptiveExecutionGraphCompiler";
import { InfinityScaleGPUExecutionPlanAdapter } from "./InfinityScaleGPUExecutionPlanAdapter";
import { validateInfinityScaleAdaptiveGPUCompletion } from "./InfinityScaleAdaptiveGPUCompletion";
import { validateInfinityScaleAdaptiveTransactionGate } from "./InfinityScaleAdaptiveTransactionGate";

export function runInfinityScaleAdaptiveFeedbackLoopRegression(): void {
  const transfer = new InfinityScaleAdaptiveTransferCompiler().compile([{ regionId: "r1", fromLOD: 0, toLOD: 1 }]);
  const graph = new InfinityScaleAdaptiveExecutionGraphCompiler().compile(transfer);
  const gpu = new InfinityScaleGPUExecutionPlanAdapter().compile(graph, { maxDispatches: 4, maxWorkgroups: 4, maxDescriptors: 4 });
  const completion = validateInfinityScaleAdaptiveGPUCompletion(graph, gpu, gpu.dispatches.map(d => d.batchId));
  const gate = validateInfinityScaleAdaptiveTransactionGate({
    sourceStateRevision: 0, expectedStateRevision: 0,
    sourceTopologyRevision: 0, expectedTopologyRevision: 0,
    graph, gpuPlan: gpu, conservationValid: true, gpuComplete: true, gpuCompletion: completion,
  });
  if (!gate.commitReady) throw new Error("Synthetic feedback pipeline should be commit-ready");

  const loop = new InfinityScaleAdaptiveFeedbackLoop();
  loop.observe({ epoch: 1, error: 0.2, stateRevision: 0, topologyRevision: 0, pipeline: {
    transferPlanHash: transfer.transferPlanHash, graphHash: graph.graphHash, gpuPlanHash: gpu.planHash,
    mutationCount: 1, transferCount: 1, deferredNodeIds: [], gpuCompletion: completion,
    transaction: gate, executable: gate.executable, commitReady: gate.commitReady,
    pipelineHash: "synthetic-1",
  }});
  loop.observe({ epoch: 2, error: 0.1, stateRevision: 1, topologyRevision: 1, pipeline: {
    transferPlanHash: transfer.transferPlanHash, graphHash: graph.graphHash, gpuPlanHash: gpu.planHash,
    mutationCount: 0, transferCount: 0, deferredNodeIds: [], gpuCompletion: completion,
    transaction: gate, executable: gate.executable, commitReady: gate.commitReady,
    pipelineHash: "synthetic-2",
  }});
  const summary = loop.summary();
  if (summary.epochs !== 2) throw new Error("Feedback loop epoch count mismatch");
  if (summary.errorTrend >= 0) throw new Error("Feedback loop error trend was not recorded");
  if (summary.commitReadyRate !== 1) throw new Error("Feedback loop commit-ready rate mismatch");
  if (loop.getErrorHistory().length !== 2) throw new Error("Feedback error history mismatch");
}
