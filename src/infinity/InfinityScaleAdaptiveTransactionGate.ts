import type { InfinityScaleAdaptiveExecutionGraph } from "./InfinityScaleAdaptiveExecutionGraphCompiler";
import type { InfinityScaleGPUExecutionPlan } from "./InfinityScaleGPUExecutionPlanAdapter";

export interface InfinityScaleAdaptiveTransactionGateInput {
  sourceStateRevision: number;
  expectedStateRevision: number;
  sourceTopologyRevision: number;
  expectedTopologyRevision: number;
  graph: InfinityScaleAdaptiveExecutionGraph;
  gpuPlan: InfinityScaleGPUExecutionPlan;
  conservationValid: boolean;
  gpuComplete: boolean;
}

export interface InfinityScaleAdaptiveTransactionGateResult {
  executable: boolean;
  commitReady: boolean;
  reasons: string[];
}

export function validateInfinityScaleAdaptiveTransactionGate(
  input: InfinityScaleAdaptiveTransactionGateInput,
): InfinityScaleAdaptiveTransactionGateResult {
  const reasons: string[] = [];

  if (input.sourceStateRevision !== input.expectedStateRevision) {
    reasons.push("state revision mismatch");
  }
  if (input.sourceTopologyRevision !== input.expectedTopologyRevision) {
    reasons.push("topology revision mismatch");
  }
  if (!input.graph.valid) reasons.push("execution graph invalid");
  if (!input.gpuPlan.valid) reasons.push("GPU execution plan invalid");
  if (!input.conservationValid) reasons.push("conservation validation failed");
  if (!input.gpuComplete) reasons.push("GPU execution incomplete");

  const executable =
    input.sourceStateRevision === input.expectedStateRevision &&
    input.sourceTopologyRevision === input.expectedTopologyRevision &&
    input.graph.valid &&
    input.gpuPlan.valid;

  return {
    executable,
    commitReady: executable && input.conservationValid && input.gpuComplete,
    reasons,
  };
}
