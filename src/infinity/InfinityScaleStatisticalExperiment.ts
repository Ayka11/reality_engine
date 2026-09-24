import {
  InfinityScaleAdaptiveScientificMetrics,
  analyzeInfinityScaleAdaptiveTelemetry,
} from "./InfinityScaleAdaptiveScientificMetrics";
import type { InfinityScaleAdaptiveTelemetryRecord } from "./InfinityScaleAdaptiveTelemetryRecorder";

export interface InfinityScaleStatisticalRun {
  scenarioId: string;
  policy: string;
  seed: number;
  metrics: InfinityScaleAdaptiveScientificMetrics;
}

export interface InfinityScaleStatisticalSummary {
  scenarioId: string;
  policy: string;
  runs: number;
  mean: InfinityScaleAdaptiveScientificMetrics;
  variance: InfinityScaleAdaptiveScientificMetrics;
  standardDeviation: InfinityScaleAdaptiveScientificMetrics;
  deterministic: boolean;
  reproducibilityHash: string;
}

export function runInfinityScaleStatisticalExperiment(
  scenarioId: string,
  policy: string,
  telemetryRuns: Array<{ seed: number; records: InfinityScaleAdaptiveTelemetryRecord[] }>,
): InfinityScaleStatisticalSummary {
  if (!scenarioId || !policy) throw new Error("Scenario and policy are required");
  if (telemetryRuns.length === 0) throw new Error("At least one statistical run is required");

  const runs: InfinityScaleStatisticalRun[] = telemetryRuns.map(run => ({
    scenarioId,
    policy,
    seed: run.seed,
    metrics: analyzeInfinityScaleAdaptiveTelemetry(run.records),
  }));

  const metricKeys = Object.keys(runs[0].metrics) as Array<keyof InfinityScaleAdaptiveScientificMetrics>;
  const mean = {} as InfinityScaleAdaptiveScientificMetrics;
  const variance = {} as InfinityScaleAdaptiveScientificMetrics;
  const standardDeviation = {} as InfinityScaleAdaptiveScientificMetrics;

  for (const key of metricKeys) {
    const values = runs.map(run => Number(run.metrics[key]));
    const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
    const varianceValue = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;

    mean[key] = avg;
    variance[key] = varianceValue;
    standardDeviation[key] = Math.sqrt(varianceValue);
  }

  const deterministic = runs.every(run =>
    run.metrics.deterministicProvenanceRate === 1,
  );

  const reproducibilityHash = stableHash(JSON.stringify({
    scenarioId,
    policy,
    runs: runs.map(run => ({
      seed: run.seed,
      metrics: run.metrics,
    })),
  }));

  return {
    scenarioId,
    policy,
    runs: runs.length,
    mean,
    variance,
    standardDeviation,
    deterministic,
    reproducibilityHash,
  };
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
