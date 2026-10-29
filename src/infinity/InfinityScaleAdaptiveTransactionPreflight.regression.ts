import { validateInfinityScaleAdaptiveTransactionPreflight } from "./InfinityScaleAdaptiveTransactionPreflight";

export function runInfinityScaleAdaptiveTransactionPreflightRegression(): void {
  const valid = {
    sourceStateRevision: 7,
    expectedStateRevision: 7,
    sourceTopologyRevision: 11,
    expectedTopologyRevision: 11,
    graphValid: true,
    gpuPlanValid: true,
    deferredRequiredNodeCount: 0,
    conservationValid: true,
    completion: {
      executionId: "exec-1",
      planId: "plan-1",
      requiredWorkItems: 3,
      completedWorkItems: 3,
      allRequiredCompleted: true,
    },
  };
  const result = validateInfinityScaleAdaptiveTransactionPreflight(valid);
  if (!result.preflightValid || result.reasons.length) throw new Error("Valid preflight evidence was rejected");

  const cases = [
    { ...valid, sourceStateRevision: 6 },
    { ...valid, sourceTopologyRevision: 10 },
    { ...valid, graphValid: false },
    { ...valid, gpuPlanValid: false },
    { ...valid, deferredRequiredNodeCount: 1 },
    { ...valid, conservationValid: false },
    { ...valid, completion: undefined },
    { ...valid, completion: { ...valid.completion, completedWorkItems: 2 } },
    { ...valid, completion: { ...valid.completion, allRequiredCompleted: false } },
    { ...valid, completion: { ...valid.completion, planId: "" } },
  ];
  for (const input of cases) {
    const rejected = validateInfinityScaleAdaptiveTransactionPreflight(input);
    if (rejected.preflightValid || rejected.reasons.length === 0) {
      throw new Error("Invalid transaction preflight evidence was accepted");
    }
  }

  // Preflight has no commitReady/executable output by design; it cannot authorize topology changes.
}
