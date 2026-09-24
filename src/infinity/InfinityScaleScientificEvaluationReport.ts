import type { InfinityScaleAdaptiveScientificMetrics } from "./InfinityScaleAdaptiveScientificMetrics";
import type { InfinityScaleBenchmarkMatrix } from "./InfinityScaleBenchmarkMatrix";
import type { InfinityScaleCrossPolicyComparison } from "./InfinityScaleCrossPolicyComparison";
import type { InfinityScaleReproducibilityManifest } from "./InfinityScaleReproducibilityManifest";

export interface InfinityScaleScientificEvaluationReport {
  reportVersion: string;
  experimentId: string;
  scenarios: string[];
  policies: string[];
  runs: number;
  complete: boolean;
  deterministic: boolean;
  scenarioEvaluations: InfinityScaleScenarioEvaluation[];
  manifestHash: string;
  reportHash: string;
}

export interface InfinityScaleScenarioEvaluation {
  scenarioId: string;
  policies: string[];
  metrics: Array<{
    metric: keyof InfinityScaleAdaptiveScientificMetrics;
    values: Record<string, number>;
    baselinePolicy: string;
    deltasFromBaseline: Record<string, number>;
  }>;
  comparisonHash: string;
  deterministic: boolean;
}

export function createInfinityScaleScientificEvaluationReport(
  matrix: InfinityScaleBenchmarkMatrix,
  comparisons: InfinityScaleCrossPolicyComparison[],
  manifest: InfinityScaleReproducibilityManifest,
): InfinityScaleScientificEvaluationReport {
  if (!matrix.experimentId) throw new Error("Benchmark matrix experiment is required");
  if (manifest.experimentId !== matrix.experimentId) {
    throw new Error("Manifest experiment does not match benchmark matrix");
  }
  if (comparisons.length !== matrix.scenarios.length) {
    throw new Error("One policy comparison is required per scenario");
  }

  const evaluations = matrix.scenarios.map(scenarioId => {
    const comparison = comparisons.find(item => item.scenarioId === scenarioId);
    if (!comparison) throw new Error(`Missing comparison for scenario: ${scenarioId}`);

    return {
      scenarioId,
      policies: comparison.policies.map(policy => policy.policy),
      metrics: comparison.metrics.map(metric => ({
        metric: metric.metric,
        values: { ...metric.values },
        baselinePolicy: metric.baselinePolicy,
        deltasFromBaseline: { ...metric.deltasFromBaseline },
      })),
      comparisonHash: comparison.comparisonHash,
      deterministic: comparison.deterministic,
    };
  });

  const deterministic =
    matrix.complete &&
    matrix.cells.every(cell => cell.run.metrics.deterministicProvenanceRate === 1) &&
    manifest.deterministic &&
    evaluations.every(evaluation => evaluation.deterministic);

  const reportPayload = {
    reportVersion: "1.0",
    experimentId: matrix.experimentId,
    scenarios: matrix.scenarios,
    policies: matrix.policies,
    runs: matrix.cells.length,
    complete: matrix.complete,
    deterministic,
    evaluations: evaluations.map(evaluation => ({
      scenarioId: evaluation.scenarioId,
      policies: evaluation.policies,
      metrics: evaluation.metrics,
      comparisonHash: evaluation.comparisonHash,
    })),
    manifestHash: manifest.manifestHash,
  };

  return {
    reportVersion: "1.0",
    experimentId: matrix.experimentId,
    scenarios: [...matrix.scenarios],
    policies: [...matrix.policies],
    runs: matrix.cells.length,
    complete: matrix.complete,
    deterministic,
    scenarioEvaluations: evaluations,
    manifestHash: manifest.manifestHash,
    reportHash: stableHash(JSON.stringify(reportPayload)),
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
