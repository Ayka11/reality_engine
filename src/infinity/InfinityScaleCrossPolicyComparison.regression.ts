import { compareInfinityScalePolicies } from "./InfinityScaleCrossPolicyComparison";
import type { InfinityScaleStatisticalSummary } from "./InfinityScaleStatisticalExperiment";

function summary(policy: string, mutationMean: number): InfinityScaleStatisticalSummary {
  const mean = {
    epochs: 8,
    executableRate: 1,
    commitSuccessRate: 1,
    conservationFailureRate: 0,
    gpuIncompleteRate: 0,
    deferredWorkRate: 0,
    averageMutationsPerEpoch: mutationMean,
    averageTransfersPerEpoch: mutationMean,
    averageTransfersPerMutation: mutationMean === 0 ? 0 : 1,
    lodStabilityRate: 1,
    deterministicProvenanceRate: 1,
  };
  const variance = {
    epochs: 0,
    executableRate: 0,
    commitSuccessRate: 0,
    conservationFailureRate: 0,
    gpuIncompleteRate: 0,
    deferredWorkRate: 0,
    averageMutationsPerEpoch: 0.01,
    averageTransfersPerEpoch: 0.01,
    averageTransfersPerMutation: 0,
    lodStabilityRate: 0,
    deterministicProvenanceRate: 0,
  };
  return {
    scenarioId: "cross-policy-v1",
    policy,
    runs: 3,
    mean,
    variance,
    standardDeviation: {
      epochs: 0,
      executableRate: 0,
      commitSuccessRate: 0,
      conservationFailureRate: 0,
      gpuIncompleteRate: 0,
      deferredWorkRate: 0,
      averageMutationsPerEpoch: 0.1,
      averageTransfersPerEpoch: 0.1,
      averageTransfersPerMutation: 0,
      lodStabilityRate: 0,
      deterministicProvenanceRate: 0,
    },
    deterministic: true,
    reproducibilityHash: `hash-${policy}`,
  };
}

export function runInfinityScaleCrossPolicyComparisonRegression(): void {
  const result = compareInfinityScalePolicies(
    "cross-policy-v1",
    [
      summary("REACTIVE", 0.75),
      summary("PREDICTIVE", 0.50),
      summary("GOAL_DIRECTED_PREDICTIVE", 0.40),
    ],
    "REACTIVE",
  );

  if (result.policies.length !== 3) throw new Error("Expected three policies");
  if (result.metrics.length !== 11) throw new Error("Expected all scientific metrics");
  if (!result.deterministic || !result.comparisonHash) {
    throw new Error("Comparison must preserve deterministic provenance");
  }

  const mutationMetric = result.metrics.find(
    metric => metric.metric === "averageMutationsPerEpoch",
  );
  if (!mutationMetric) throw new Error("Mutation metric missing");
  if (mutationMetric.deltasFromBaseline.PREDICTIVE !== -0.25) {
    throw new Error("Predictive baseline delta mismatch");
  }
  if (mutationMetric.deltasFromBaseline.GOAL_DIRECTED_PREDICTIVE !== -0.35) {
    throw new Error("Goal-directed baseline delta mismatch");
  }

  const replay = compareInfinityScalePolicies(
    "cross-policy-v1",
    [
      summary("REACTIVE", 0.75),
      summary("PREDICTIVE", 0.50),
      summary("GOAL_DIRECTED_PREDICTIVE", 0.40),
    ],
    "REACTIVE",
  );
  if (replay.comparisonHash !== result.comparisonHash) {
    throw new Error("Cross-policy comparison is not deterministic");
  }
}
