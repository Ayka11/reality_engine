import {
  createInfinityScaleBenchmarkMatrix,
  validateInfinityScaleBenchmarkMatrix,
} from "./InfinityScaleBenchmarkMatrix";
import type { InfinityScaleAdaptiveTelemetryRecord } from "./InfinityScaleAdaptiveTelemetryRecorder";

function telemetry(epoch: number, policy: string, seed: number): InfinityScaleAdaptiveTelemetryRecord {
  return {
    epoch,
    stateRevision: epoch + seed,
    topologyRevision: epoch,
    mutationCount: policy === "GOAL_DIRECTED_PREDICTIVE" ? 2 : 1,
    transferCount: 1,
    deferredNodeCount: policy === "REACTIVE" ? 1 : 0,
    conservationValid: true,
    gpuComplete: true,
    executable: true,
    commitReady: true,
    transferPlanHash: `transfer-${policy}-${seed}-${epoch}`,
    graphHash: `graph-${policy}-${seed}-${epoch}`,
    gpuPlanHash: `gpu-${policy}-${seed}-${epoch}`,
    pipelineHash: `pipeline-${policy}-${seed}-${epoch}`,
  };
}

export function runInfinityScaleBenchmarkMatrixRegression(): void {
  const matrix = createInfinityScaleBenchmarkMatrix(
    "matrix-001",
    ["shock-front", "stable"],
    ["REACTIVE", "PREDICTIVE", "GOAL_DIRECTED_PREDICTIVE"],
    [7, 11],
    (scenarioId, policy, seed) =>
      [1, 2, 3].map(epoch => ({
        ...telemetry(epoch, policy, seed),
        transferPlanHash: `${scenarioId}-${policy}-${seed}-${epoch}`,
      })),
  );

  if (matrix.cells.length !== 12) throw new Error("Benchmark matrix cell count mismatch");
  if (!matrix.complete) throw new Error("Benchmark matrix should be complete");
  if (!validateInfinityScaleBenchmarkMatrix(matrix)) {
    throw new Error("Benchmark matrix validation failed");
  }

  const replay = createInfinityScaleBenchmarkMatrix(
    "matrix-001",
    ["stable", "shock-front"],
    ["GOAL_DIRECTED_PREDICTIVE", "REACTIVE", "PREDICTIVE"],
    [11, 7],
    (scenarioId, policy, seed) =>
      [1, 2, 3].map(epoch => ({
        ...telemetry(epoch, policy, seed),
        transferPlanHash: `${scenarioId}-${policy}-${seed}-${epoch}`,
      })),
  );

  if (replay.matrixHash !== matrix.matrixHash) {
    throw new Error("Benchmark matrix replay is not deterministic");
  }
}
