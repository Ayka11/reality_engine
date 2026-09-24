import type { InfinityScaleAdaptiveScientificMetrics } from "./InfinityScaleAdaptiveScientificMetrics";
import type { InfinityScaleStatisticalSummary } from "./InfinityScaleStatisticalExperiment";

export interface InfinityScalePolicyComparison {
  policy: string;
  summary: InfinityScaleStatisticalSummary;
}

export interface InfinityScaleCrossPolicyMetric {
  metric: keyof InfinityScaleAdaptiveScientificMetrics;
  values: Record<string, number>;
  baselinePolicy: string;
  deltasFromBaseline: Record<string, number>;
  pooledStandardDeviation: Record<string, number>;
}

export interface InfinityScaleCrossPolicyComparison {
  scenarioId: string;
  policies: InfinityScalePolicyComparison[];
  metrics: InfinityScaleCrossPolicyMetric[];
  deterministic: boolean;
  comparisonHash: string;
}

export function compareInfinityScalePolicies(
  scenarioId: string,
  summaries: InfinityScaleStatisticalSummary[],
  baselinePolicy: string,
): InfinityScaleCrossPolicyComparison {
  if (!scenarioId) throw new Error("Scenario is required");
  if (summaries.length < 2) throw new Error("At least two policies are required");

  const uniquePolicies = new Set(summaries.map(summary => summary.policy));
  if (uniquePolicies.size !== summaries.length) {
    throw new Error("Policy names must be unique");
  }

  const baseline = summaries.find(summary => summary.policy === baselinePolicy);
  if (!baseline) throw new Error(`Baseline policy not found: ${baselinePolicy}`);

  const metricKeys = Object.keys(baseline.mean) as Array<keyof InfinityScaleAdaptiveScientificMetrics>;
  const metrics = metricKeys.map(metric => {
    const values: Record<string, number> = {};
    const deltasFromBaseline: Record<string, number> = {};
    const pooledStandardDeviation: Record<string, number> = {};

    for (const summary of summaries) {
      values[summary.policy] = Number(summary.mean[metric]);
      deltasFromBaseline[summary.policy] =
        Number(summary.mean[metric]) - Number(baseline.mean[metric]);
      pooledStandardDeviation[summary.policy] = pooledStd(
        Number(summary.standardDeviation[metric]),
        Number(baseline.standardDeviation[metric]),
      );
    }

    return {
      metric,
      values,
      baselinePolicy,
      deltasFromBaseline,
      pooledStandardDeviation,
    };
  });

  const deterministic =
    summaries.every(summary => summary.deterministic) &&
    summaries.every(summary => summary.scenarioId === scenarioId);

  const comparisonHash = stableHash(JSON.stringify({
    scenarioId,
    baselinePolicy,
    summaries: summaries.map(summary => ({
      policy: summary.policy,
      runs: summary.runs,
      mean: summary.mean,
      variance: summary.variance,
      standardDeviation: summary.standardDeviation,
      reproducibilityHash: summary.reproducibilityHash,
    })),
  }));

  return {
    scenarioId,
    policies: summaries.map(summary => ({
      policy: summary.policy,
      summary,
    })),
    metrics,
    deterministic,
    comparisonHash,
  };
}

function pooledStd(a: number, b: number): number {
  return Math.sqrt((a * a + b * b) / 2);
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
