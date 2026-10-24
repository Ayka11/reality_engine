export interface InfinityScaleAdaptiveTransactionPreflightInput {
  sourceStateRevision: number;
  expectedStateRevision: number;
  sourceTopologyRevision: number;
  expectedTopologyRevision: number;
  graphValid: boolean;
  gpuPlanValid: boolean;
  deferredRequiredNodeCount: number;
  conservationValid: boolean;
  /** Must be evidence from the executor, not a caller-supplied success flag. */
  completion?: {
    executionId: string;
    planId: string;
    requiredWorkItems: number;
    completedWorkItems: number;
    allRequiredCompleted: boolean;
  };
}

export interface InfinityScaleAdaptiveTransactionPreflightResult {
  preflightValid: boolean;
  reasons: string[];
}

/**
 * Pure fail-closed preflight checks extracted from the legacy transaction gate.
 * This is diagnostic only: a valid result is NOT permission to mutate topology
 * or commit state. The authoritative runtime transaction must still enforce
 * its own revisions, transfer coverage, conservation, rollback and feature gates.
 */
export function validateInfinityScaleAdaptiveTransactionPreflight(
  input: InfinityScaleAdaptiveTransactionPreflightInput,
): InfinityScaleAdaptiveTransactionPreflightResult {
  const reasons: string[] = [];
  if (!Number.isSafeInteger(input.sourceStateRevision) || input.sourceStateRevision < 0 ||
      !Number.isSafeInteger(input.expectedStateRevision) || input.expectedStateRevision < 0 ||
      input.sourceStateRevision !== input.expectedStateRevision) {
    reasons.push("state revision mismatch or invalid");
  }
  if (!Number.isSafeInteger(input.sourceTopologyRevision) || input.sourceTopologyRevision < 0 ||
      !Number.isSafeInteger(input.expectedTopologyRevision) || input.expectedTopologyRevision < 0 ||
      input.sourceTopologyRevision !== input.expectedTopologyRevision) {
    reasons.push("topology revision mismatch or invalid");
  }
  if (input.graphValid !== true) reasons.push("execution graph invalid");
  if (input.gpuPlanValid !== true) reasons.push("GPU execution plan invalid");
  if (!Number.isSafeInteger(input.deferredRequiredNodeCount) || input.deferredRequiredNodeCount < 0) {
    reasons.push("deferred required node count invalid");
  } else if (input.deferredRequiredNodeCount > 0) {
    reasons.push("GPU execution plan has deferred required nodes");
  }
  if (input.conservationValid !== true) reasons.push("conservation validation failed");

  const completion = input.completion;
  if (!completion) {
    reasons.push("GPU completion evidence missing");
  } else {
    if (typeof completion.executionId !== "string" || completion.executionId.trim() === "") {
      reasons.push("GPU completion execution ID missing");
    }
    if (typeof completion.planId !== "string" || completion.planId.trim() === "") {
      reasons.push("GPU completion plan ID missing");
    }
    if (!Number.isSafeInteger(completion.requiredWorkItems) || completion.requiredWorkItems < 0 ||
        !Number.isSafeInteger(completion.completedWorkItems) || completion.completedWorkItems < 0 ||
        completion.completedWorkItems > completion.requiredWorkItems) {
      reasons.push("GPU completion work-item counts invalid");
    } else if (completion.completedWorkItems !== completion.requiredWorkItems) {
      reasons.push("GPU execution incomplete");
    }
    if (completion.allRequiredCompleted !== true) reasons.push("GPU completion record incomplete");
  }

  return { preflightValid: reasons.length === 0, reasons };
}
