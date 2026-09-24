import { analyzeInfinityScaleAdaptiveTelemetry } from "./InfinityScaleAdaptiveScientificMetrics";

export function runInfinityScaleAdaptiveScientificMetricsRegression(): void {
  const records = [
    {
      epoch: 1, stateRevision: 1, topologyRevision: 1,
      mutationCount: 2, transferCount: 2, deferredNodeCount: 0,
      conservationValid: true, gpuComplete: true, executable: true, commitReady: true,
      transferPlanHash: "a", graphHash: "b", gpuPlanHash: "c", pipelineHash: "d",
    },
    {
      epoch: 2, stateRevision: 2, topologyRevision: 2,
      mutationCount: 0, transferCount: 0, deferredNodeCount: 0,
      conservationValid: true, gpuComplete: true, executable: true, commitReady: true,
      transferPlanHash: "e", graphHash: "f", gpuPlanHash: "g", pipelineHash: "h",
    },
    {
      epoch: 3, stateRevision: 3, topologyRevision: 3,
      mutationCount: 1, transferCount: 1, deferredNodeCount: 1,
      conservationValid: false, gpuComplete: false, executable: true, commitReady: false,
      transferPlanHash: "i", graphHash: "j", gpuPlanHash: "k", pipelineHash: "l",
    },
  ];

  const metrics = analyzeInfinityScaleAdaptiveTelemetry(records);

  if (metrics.epochs !== 3) throw new Error("Incorrect epoch count");
  if (metrics.executableRate !== 1) throw new Error("Incorrect executable rate");
  if (metrics.commitSuccessRate !== 2 / 3) throw new Error("Incorrect commit rate");
  if (metrics.conservationFailureRate !== 1 / 3) throw new Error("Incorrect conservation failure rate");
  if (metrics.gpuIncompleteRate !== 1 / 3) throw new Error("Incorrect GPU incomplete rate");
  if (metrics.deferredWorkRate !== 1 / 3) throw new Error("Incorrect deferred work rate");
  if (metrics.averageMutationsPerEpoch !== 1) throw new Error("Incorrect mutation average");
  if (metrics.averageTransfersPerEpoch !== 1) throw new Error("Incorrect transfer average");
  if (metrics.averageTransfersPerMutation !== 1) throw new Error("Incorrect transfer/mutation ratio");
  if (metrics.lodStabilityRate !== 2 / 3) throw new Error("Incorrect LOD stability rate");
  if (metrics.deterministicProvenanceRate !== 1) throw new Error("Incorrect provenance rate");

  const empty = analyzeInfinityScaleAdaptiveTelemetry([]);
  if (empty.epochs !== 0 || empty.commitSuccessRate !== 0) {
    throw new Error("Empty telemetry metrics are not zeroed");
  }
}
