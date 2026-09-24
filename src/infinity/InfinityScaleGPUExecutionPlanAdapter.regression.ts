import { InfinityScaleAdaptiveTransferCompiler } from "./InfinityScaleAdaptiveTransferCompiler";
import { InfinityScaleAdaptiveExecutionGraphCompiler } from "./InfinityScaleAdaptiveExecutionGraphCompiler";
import { InfinityScaleGPUExecutionPlanAdapter } from "./InfinityScaleGPUExecutionPlanAdapter";

export function runInfinityScaleGPUExecutionPlanAdapterRegression(): void {
  const transferCompiler = new InfinityScaleAdaptiveTransferCompiler();
  const graphCompiler = new InfinityScaleAdaptiveExecutionGraphCompiler();
  const adapter = new InfinityScaleGPUExecutionPlanAdapter();

  const plan = transferCompiler.compile([
    { regionId: "A", fromLOD: 1, toLOD: 2 },
    { regionId: "B", fromLOD: 2, toLOD: 1 },
  ]);
  const graph = graphCompiler.compile(plan);

  const execution = adapter.compile(graph, {
    maxDispatches: 10,
    maxWorkgroups: 10,
    maxDescriptors: 10,
  });

  if (!execution.valid) throw new Error("GPU execution plan is invalid");
  if (execution.dispatches.length !== 3) {
    throw new Error("Expected two transfer dispatches and one GPU execution dispatch");
  }
  if (execution.usedDescriptors !== 2) {
    throw new Error("Unexpected descriptor usage");
  }
  if (execution.dispatches[0].executionClass !== "DEADLINE_CLASS_0") {
    throw new Error("Topology transfer was not classified as mandatory");
  }
  if (execution.dispatches[2].executionClass !== "DEADLINE_CLASS_1") {
    throw new Error("GPU execution was not classified as conditional");
  }

  const constrained = adapter.compile(graph, {
    maxDispatches: 1,
    maxWorkgroups: 1,
    maxDescriptors: 1,
  });
  if (!constrained.valid) throw new Error("Budget-constrained plan became invalid");
  if (constrained.deferredNodeIds.length === 0) {
    throw new Error("Budget exhaustion did not produce deferrals");
  }

  const replay = adapter.compile(graph, {
    maxDispatches: 10,
    maxWorkgroups: 10,
    maxDescriptors: 10,
  });
  if (replay.planHash !== execution.planHash) {
    throw new Error("GPU execution plan is not deterministic");
  }

  const invalidBudget = adapter.compile(graph, {
    maxDispatches: -1,
    maxWorkgroups: 10,
    maxDescriptors: 10,
  });
  if (invalidBudget.valid) throw new Error("Invalid GPU budget was accepted");
}
