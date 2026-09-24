import type { InfinityScaleAdaptiveExecutionGraph } from "./InfinityScaleAdaptiveExecutionGraphCompiler";
import type { InfinityScaleGPUExecutionPlan } from "./InfinityScaleGPUExecutionPlanAdapter";

export interface InfinityScaleAdaptiveGPUCompletion {
  planHash: string;
  completedBatchIds: string[];
  incompleteBatchIds: string[];
  allRequiredCompleted: boolean;
  completionHash: string;
}

export function validateInfinityScaleAdaptiveGPUCompletion(
  graph: InfinityScaleAdaptiveExecutionGraph,
  plan: InfinityScaleGPUExecutionPlan,
  completedBatchIds: ReadonlyArray<string>,
): InfinityScaleAdaptiveGPUCompletion {
  if (!graph.valid) throw new Error("Cannot validate GPU completion for invalid execution graph");
  if (!plan.valid) throw new Error("Cannot validate GPU completion for invalid GPU execution plan");

  const completed = new Set(completedBatchIds);
  const required = plan.dispatches.map(dispatch => dispatch.batchId);
  const incompleteBatchIds = required.filter(batchId => !completed.has(batchId));
  const completedRequired = required.filter(batchId => completed.has(batchId));

  const allRequiredCompleted = incompleteBatchIds.length === 0 && plan.deferredNodeIds.length === 0;
  const completionHash = stableHash(JSON.stringify({
    planHash: plan.planHash,
    completedRequired,
    incompleteBatchIds,
    deferredNodeIds: plan.deferredNodeIds,
  }));

  return {
    planHash: plan.planHash,
    completedBatchIds: completedRequired,
    incompleteBatchIds,
    allRequiredCompleted,
    completionHash,
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
