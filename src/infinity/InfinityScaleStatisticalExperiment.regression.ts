import {
  runInfinityScaleStatisticalExperiment,
} from "./InfinityScaleStatisticalExperiment";

function telemetry(epoch: number, mutations: number) {
  return {
    epoch,
    stateRevision: epoch,
    topologyRevision: epoch,
    mutationCount: mutations,
    transferCount: mutations,
    deferredNodeCount: 0,
    conservationValid: true,
    gpuComplete: true,
    executable: true,
    commitReady: true,
    transferPlanHash: `tp-${epoch}`,
    graphHash: `g-${epoch}`,
    gpuPlanHash: `gpu-${epoch}`,
    pipelineHash: `p-${epoch}`,
  };
}

export function runInfinityScaleStatisticalExperimentRegression(): void {
  const result = runInfinityScaleStatisticalExperiment(
    "statistics-v1",
    "PREDICTIVE",
    [
      { seed: 1, records: [telemetry(1, 1), telemetry(2, 1), telemetry(3, 0)] },
      { seed: 2, records: [telemetry(1, 2), telemetry(2, 1), telemetry(3, 0)] },
      { seed: 3, records: [telemetry(1, 0), telemetry(2, 1), telemetry(3, 1)] },
    ],
  );

  if (result.runs !== 3) throw new Error("Expected three statistical runs");
  if (result.mean.epochs !== 3) throw new Error("Mean epoch count mismatch");
  if (result.standardDeviation.averageMutationsPerEpoch <= 0) {
    throw new Error("Expected non-zero run variance");
  }
  if (!result.deterministic || !result.reproducibilityHash) {
    throw new Error("Statistical result must preserve deterministic provenance");
  }

  const replay = runInfinityScaleStatisticalExperiment(
    "statistics-v1",
    "PREDICTIVE",
    [
      { seed: 1, records: [telemetry(1, 1), telemetry(2, 1), telemetry(3, 0)] },
      { seed: 2, records: [telemetry(1, 2), telemetry(2, 1), telemetry(3, 0)] },
      { seed: 3, records: [telemetry(1, 0), telemetry(2, 1), telemetry(3, 1)] },
    ],
  );

  if (replay.reproducibilityHash !== result.reproducibilityHash) {
    throw new Error("Statistical experiment replay is not deterministic");
  }
}
