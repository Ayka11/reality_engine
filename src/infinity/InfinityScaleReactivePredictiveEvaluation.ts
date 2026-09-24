import type { InfinityScaleAdaptiveTelemetryRecord } from "./InfinityScaleAdaptiveTelemetryRecorder";
import { analyzeInfinityScaleAdaptiveTelemetry, InfinityScaleAdaptiveScientificMetrics } from "./InfinityScaleAdaptiveScientificMetrics";

export type InfinityScaleEvaluationPolicy = "REACTIVE" | "PREDICTIVE";

export interface InfinityScaleEvaluationScenario {
  scenarioId: string;
  reactive: InfinityScaleAdaptiveTelemetryRecord[];
  predictive: InfinityScaleAdaptiveTelemetryRecord[];
}

export interface InfinityScalePolicyEvaluation {
  policy: InfinityScaleEvaluationPolicy;
  metrics: InfinityScaleAdaptiveScientificMetrics;
  epochs: number;
}

export interface InfinityScaleComparativeEvaluation {
  scenarioId: string;
  reactive: InfinityScalePolicyEvaluation;
  predictive: InfinityScalePolicyEvaluation;
  metricDeltas: Record<string, number>;
  deterministic: boolean;
  comparisonHash: string;
}

export function evaluateInfinityScaleScenario(
  scenario: InfinityScaleEvaluationScenario,
): InfinityScaleComparativeEvaluation {
  const reactiveMetrics = analyzeInfinityScaleAdaptiveTelemetry(scenario.reactive);
  const predictiveMetrics = analyzeInfinityScaleAdaptiveTelemetry(scenario.predictive);

  const metricDeltas: Record<string, number> = {};
  const keys = Object.keys(reactiveMetrics) as Array<keyof InfinityScaleAdaptiveScientificMetrics>;
  for (const key of keys) {
    if (key === "epochs") continue;
    metricDeltas[key] =
      Number(predictiveMetrics[key]) - Number(reactiveMetrics[key]);
  }

  const deterministic =
    scenario.reactive.length === scenario.predictive.length &&
    reactiveMetrics.deterministicProvenanceRate === 1 &&
    predictiveMetrics.deterministicProvenanceRate === 1;

  const comparisonHash = stableHash(
    JSON.stringify({
      scenarioId: scenario.scenarioId,
      reactiveMetrics,
      predictiveMetrics,
      metricDeltas,
    }),
  );

  return {
    scenarioId: scenario.scenarioId,
    reactive: {
      policy: "REACTIVE",
      metrics: reactiveMetrics,
      epochs: scenario.reactive.length,
    },
    predictive: {
      policy: "PREDICTIVE",
      metrics: predictiveMetrics,
      epochs: scenario.predictive.length,
    },
    metricDeltas,
    deterministic,
    comparisonHash,
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
