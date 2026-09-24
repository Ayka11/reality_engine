import { InfinityScaleGPUExecutionPlanAdapter } from "./InfinityScaleGPUExecutionPlanAdapter";

export function runInfinityScaleCausalGPUBudgetRegression(): void {
  const graph = {
    valid: true,
    nodes: [
      { nodeId: "low", type: "GPU_EXECUTION", dependencyIds: [] },
      { nodeId: "high", type: "GPU_EXECUTION", dependencyIds: [] },
    ],
  } as any;

  const adapter = new InfinityScaleGPUExecutionPlanAdapter();
  const plan = adapter.compile(graph, {
    maxDispatches: 1,
    maxWorkgroups: 1,
    maxDescriptors: 0,
  }, [
    { nodeId: "low", priorityScore: 0.2 },
    { nodeId: "high", priorityScore: 0.9 },
  ]);

  if (plan.dispatches.length !== 1 || plan.dispatches[0].nodeId !== "high") {
    throw new Error("GPU budget did not prioritize the highest utility candidate");
  }
  if (!plan.deferredNodeIds.includes("low")) throw new Error("Lower-priority GPU work was not deferred");
}
