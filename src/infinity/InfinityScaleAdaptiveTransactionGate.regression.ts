import { InfinityScaleAdaptiveTransferCompiler } from "./InfinityScaleAdaptiveTransferCompiler";
import { InfinityScaleAdaptiveExecutionGraphCompiler } from "./InfinityScaleAdaptiveExecutionGraphCompiler";
import { InfinityScaleGPUExecutionPlanAdapter } from "./InfinityScaleGPUExecutionPlanAdapter";
import { validateInfinityScaleAdaptiveTransactionGate } from "./InfinityScaleAdaptiveTransactionGate";

export function runInfinityScaleAdaptiveTransactionGateRegression(): void {
  const transferPlan = new InfinityScaleAdaptiveTransferCompiler().compile([
    { regionId: "A", fromLOD: 1, toLOD: 2 },
  ]);
  const graph = new InfinityScaleAdaptiveExecutionGraphCompiler().compile(transferPlan);
  const gpuPlan = new InfinityScaleGPUExecutionPlanAdapter().compile(graph, {
    maxDispatches: 10,
    maxWorkgroups: 10,
    maxDescriptors: 10,
  });

  const ready = validateInfinityScaleAdaptiveTransactionGate({
    sourceStateRevision: 7,
    expectedStateRevision: 7,
    sourceTopologyRevision: 11,
    expectedTopologyRevision: 11,
    graph,
    gpuPlan,
    conservationValid: true,
    gpuComplete: true,
  });

  if (!ready.executable || !ready.commitReady || ready.reasons.length !== 0) {
    throw new Error("Valid adaptive transaction was not commit-ready");
  }

  const stale = validateInfinityScaleAdaptiveTransactionGate({
    sourceStateRevision: 6,
    expectedStateRevision: 7,
    sourceTopologyRevision: 11,
    expectedTopologyRevision: 11,
    graph,
    gpuPlan,
    conservationValid: true,
    gpuComplete: true,
  });
  if (stale.executable || stale.commitReady || !stale.reasons.includes("state revision mismatch")) {
    throw new Error("Stale state revision was not rejected");
  }

  const conservationFailure = validateInfinityScaleAdaptiveTransactionGate({
    sourceStateRevision: 7,
    expectedStateRevision: 7,
    sourceTopologyRevision: 11,
    expectedTopologyRevision: 11,
    graph,
    gpuPlan,
    conservationValid: false,
    gpuComplete: true,
  });
  if (conservationFailure.executable !== true || conservationFailure.commitReady !== false) {
    throw new Error("Conservation failure incorrectly permitted commit");
  }

  const incompleteGPU = validateInfinityScaleAdaptiveTransactionGate({
    sourceStateRevision: 7,
    expectedStateRevision: 7,
    sourceTopologyRevision: 11,
    expectedTopologyRevision: 11,
    graph,
    gpuPlan,
    conservationValid: true,
    gpuComplete: false,
  });
  if (incompleteGPU.commitReady || !incompleteGPU.reasons.includes("GPU execution incomplete")) {
    throw new Error("Incomplete GPU execution incorrectly permitted commit");
  }
}
