import { createInfinityScaleReproducibilityManifest } from "./InfinityScaleReproducibilityManifest";
import type { InfinityScaleCrossPolicyComparison } from "./InfinityScaleCrossPolicyComparison";
import type { InfinityScaleStatisticalSummary } from "./InfinityScaleStatisticalExperiment";

function summary(policy: string): InfinityScaleStatisticalSummary {
  const metrics = {
    epochs: 8, executableRate: 1, commitSuccessRate: 1,
    conservationFailureRate: 0, gpuIncompleteRate: 0,
    deferredWorkRate: 0, averageMutationsPerEpoch: 0.5,
    averageTransfersPerEpoch: 0.5, averageTransfersPerMutation: 1,
    lodStabilityRate: 1, deterministicProvenanceRate: 1,
  };
  return {
    scenarioId: "manifest-v1", policy, runs: 2, mean: metrics,
    variance: { ...metrics, epochs: 0, executableRate: 0, commitSuccessRate: 0,
      conservationFailureRate: 0, gpuIncompleteRate: 0, deferredWorkRate: 0,
      averageMutationsPerEpoch: 0, averageTransfersPerEpoch: 0,
      averageTransfersPerMutation: 0, lodStabilityRate: 0,
      deterministicProvenanceRate: 0 },
    standardDeviation: { ...metrics, epochs: 0, executableRate: 0, commitSuccessRate: 0,
      conservationFailureRate: 0, gpuIncompleteRate: 0, deferredWorkRate: 0,
      averageMutationsPerEpoch: 0, averageTransfersPerEpoch: 0,
      averageTransfersPerMutation: 0, lodStabilityRate: 0,
      deterministicProvenanceRate: 0 },
    deterministic: true,
    reproducibilityHash: `hash-${policy}`,
  };
}

export function runInfinityScaleReproducibilityManifestRegression(): void {
  const summaries = [summary("REACTIVE"), summary("PREDICTIVE")];
  const comparison: InfinityScaleCrossPolicyComparison = {
    scenarioId: "manifest-v1",
    policies: summaries.map(summary => ({ policy: summary.policy, summary })),
    metrics: [],
    deterministic: true,
    comparisonHash: "comparison-v1",
  };

  const manifest = createInfinityScaleReproducibilityManifest({
    experimentId: "experiment-001",
    scenarioId: "manifest-v1",
    policies: ["REACTIVE", "PREDICTIVE"],
    seeds: [1, 2],
    summaries,
    comparison,
    configurationFingerprint: "cfg-v1",
    goalFingerprint: "goals-v1",
    budgetFingerprint: "budget-v1",
    predictionModelVersion: "linear-quadratic-v1",
    topologyConfigurationVersion: "topology-v1",
  });

  if (manifest.manifestVersion !== "1.0") throw new Error("Manifest version mismatch");
  if (!manifest.deterministic) throw new Error("Manifest must be deterministic");
  if (manifest.runsPerPolicy.PREDICTIVE !== 2) throw new Error("Run count missing");
  if (!manifest.manifestHash) throw new Error("Manifest hash missing");

  const replay = createInfinityScaleReproducibilityManifest({
    experimentId: "experiment-001",
    scenarioId: "manifest-v1",
    policies: ["REACTIVE", "PREDICTIVE"],
    seeds: [1, 2],
    summaries,
    comparison,
    configurationFingerprint: "cfg-v1",
    goalFingerprint: "goals-v1",
    budgetFingerprint: "budget-v1",
    predictionModelVersion: "linear-quadratic-v1",
    topologyConfigurationVersion: "topology-v1",
  });

  if (replay.manifestHash !== manifest.manifestHash) {
    throw new Error("Reproducibility manifest is not deterministic");
  }
}
