import { validateInfinityScaleAdaptiveGPUCompletion } from "./InfinityScaleAdaptiveGPUCompletion";
import { InfinityScaleAdaptiveExecutionGraphCompiler } from "./InfinityScaleAdaptiveExecutionGraphCompiler";
import { InfinityScaleAdaptiveTransferCompiler } from "./InfinityScaleAdaptiveTransferCompiler";
import { InfinityScaleGPUExecutionPlanAdapter } from "./InfinityScaleGPUExecutionPlanAdapter";

export function runInfinityScaleAdaptiveGPUCompletionRegression(): void {
  const transfer = new InfinityScaleAdaptiveTransferCompiler().compile([
    { regionId: "r1", fromLOD: 0, toLOD: 1 },
  ]);
  const graph = new InfinityScaleAdaptiveExecutionGraphCompiler().compile(transfer);
  const plan = new InfinityScaleGPUExecutionPlanAdapter().compile(graph, {
    maxDispatches: 4, maxWorkgroups: 4, maxDescriptors: 4,
  });
  if (!plan.valid) throw new Error("GPU plan should be valid");

  const incomplete = validateInfinityScaleAdaptiveGPUCompletion(graph, plan, []);
  if (incomplete.allRequiredCompleted) throw new Error("Incomplete GPU execution was accepted");

  const complete = validateInfinityScaleAdaptiveGPUCompletion(
    graph,
    plan,
    plan.dispatches.map(dispatch => dispatch.batchId),
  );
  if (!complete.allRequiredCompleted) throw new Error("Complete GPU execution was rejected");

  const replay = validateInfinityScaleAdaptiveGPUCompletion(
    graph,
    plan,
    plan.dispatches.map(dispatch => dispatch.batchId),
  );
  if (replay.completionHash !== complete.completionHash) throw new Error("GPU completion is not deterministic");
}
