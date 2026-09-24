import type { InfinityScaleAdaptiveTelemetryRecord } from "./InfinityScaleAdaptiveTelemetryRecorder";

export interface InfinityScaleAdaptiveScientificMetrics {
  epochs: number;
  executableRate: number;
  commitSuccessRate: number;
  conservationFailureRate: number;
  gpuIncompleteRate: number;
  deferredWorkRate: number;
  averageMutationsPerEpoch: number;
  averageTransfersPerEpoch: number;
  averageTransfersPerMutation: number;
  lodStabilityRate: number;
  deterministicProvenanceRate: number;
}

export function analyzeInfinityScaleAdaptiveTelemetry(
  records: InfinityScaleAdaptiveTelemetryRecord[],
): InfinityScaleAdaptiveScientificMetrics {
  if (records.length === 0) {
    return {
      epochs: 0,
      executableRate: 0,
      commitSuccessRate: 0,
      conservationFailureRate: 0,
      gpuIncompleteRate: 0,
      deferredWorkRate: 0,
      averageMutationsPerEpoch: 0,
      averageTransfersPerEpoch: 0,
      averageTransfersPerMutation: 0,
      lodStabilityRate: 0,
      deterministicProvenanceRate: 0,
    };
  }

  const executable = records.filter(r => r.executable).length;
  const committed = records.filter(r => r.commitReady).length;
  const conservationFailures = records.filter(r => !r.conservationValid).length;
  const gpuIncomplete = records.filter(r => !r.gpuComplete).length;
  const deferred = records.filter(r => r.deferredNodeCount > 0).length;
  const stable = records.filter(r => r.mutationCount <= 1).length;
  const provenance = records.filter(r =>
    r.transferPlanHash.length > 0 &&
    r.graphHash.length > 0 &&
    r.gpuPlanHash.length > 0 &&
    r.pipelineHash.length > 0,
  ).length;

  const mutationTotal = records.reduce((sum, r) => sum + r.mutationCount, 0);
  const transferTotal = records.reduce((sum, r) => sum + r.transferCount, 0);

  return {
    epochs: records.length,
    executableRate: executable / records.length,
    commitSuccessRate: committed / records.length,
    conservationFailureRate: conservationFailures / records.length,
    gpuIncompleteRate: gpuIncomplete / records.length,
    deferredWorkRate: deferred / records.length,
    averageMutationsPerEpoch: mutationTotal / records.length,
    averageTransfersPerEpoch: transferTotal / records.length,
    averageTransfersPerMutation: mutationTotal === 0 ? 0 : transferTotal / mutationTotal,
    lodStabilityRate: stable / records.length,
    deterministicProvenanceRate: provenance / records.length,
  };
}
