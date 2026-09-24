import { createInfinityScaleBenchmarkMatrix } from "./InfinityScaleBenchmarkMatrix";
import { createInfinityScaleScientificEvaluationReport } from "./InfinityScaleScientificEvaluationReport";
import type { InfinityScaleAdaptiveTelemetryRecord } from "./InfinityScaleAdaptiveTelemetryRecorder";
import type { InfinityScaleCrossPolicyComparison } from "./InfinityScaleCrossPolicyComparison";
import type { InfinityScaleReproducibilityManifest } from "./InfinityScaleReproducibilityManifest";

function record(epoch: number): InfinityScaleAdaptiveTelemetryRecord {
  return {
    epoch,
    stateRevision: epoch,
    topologyRevision: epoch,
    mutationCount: 1,
    transferCount: 1,
    deferredNodeCount: 0,
    conservationValid: true,
    gpuComplete: true,
    executable: true,
    commitReady: true,
    transferPlanHash: `t-${epoch}`,
    graphHash: `g-${epoch}`,
    gpuPlanHash: `gpu-${epoch}`,
    pipelineHash: `p-${epoch}`,
  };
}

export function runInfinityScaleScientificEvaluationReportRegression(): void {
  const matrix = createInfinityScaleBenchmarkMatrix(
    "report-001",
    ["scenario-a"],
    ["REACTIVE", "PREDICTIVE"],
    [1, 2],
    () => [record(1), record(2)],
  );

  const comparison = {
    scenarioId: "scenario-a",
    policies: [],
    metrics: [{
      metric: "commitSuccessRate",
      values: { REACTIVE: 1, PREDICTIVE: 1 },
      baselinePolicy: "REACTIVE",
      deltasFromBaseline: { REACTIVE: 0, PREDICTIVE: 0 },
      pooledStandardDeviation: { REACTIVE: 0, PREDICTIVE: 0 },
    }],
    deterministic: true,
    comparisonHash: "comparison-001",
  } as InfinityScaleCrossPolicyComparison;

  const manifest = {
    manifestVersion: "1.0",
    experimentId: "report-001",
    scenarioId: "scenario-a",
    policies: ["REACTIVE", "PREDICTIVE"],
    seeds: [1, 2],
    runsPerPolicy: { REACTIVE: 2, PREDICTIVE: 2 },
    configurationFingerprint: "config",
    goalFingerprint: "goals",
    budgetFingerprint: "budget",
    predictionModelVersion: "linear-quadratic-v1",
    topologyConfigurationVersion: "topology-v1",
    statisticalReproducibilityHashes: { REACTIVE: "r", PREDICTIVE: "p" },
    comparisonHash: "comparison-001",
    deterministic: true,
    manifestHash: "manifest-001",
  } as InfinityScaleReproducibilityManifest;

  const report = createInfinityScaleScientificEvaluationReport(
    matrix,
    [comparison],
    manifest,
  );

  if (!report.complete || !report.deterministic) {
    throw new Error("Scientific evaluation report should be complete and deterministic");
  }
  if (report.runs !== 4) throw new Error("Scientific report run count mismatch");
  if (!report.reportHash) throw new Error("Scientific report hash missing");
  if (report.manifestHash !== "manifest-001") {
    throw new Error("Scientific report manifest linkage failed");
  }
}
