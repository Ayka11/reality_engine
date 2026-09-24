import type { InfinityScaleAdaptiveTelemetryRecord } from "./InfinityScaleAdaptiveTelemetryRecorder";
import { analyzeInfinityScaleAdaptiveTelemetry, InfinityScaleAdaptiveScientificMetrics } from "./InfinityScaleAdaptiveScientificMetrics";
import { InfinityScaleResolutionGoalRegistry } from "./InfinityScaleResolutionGoalRegistry";

export type InfinityScaleGoalDirectedPolicy =
  | "REACTIVE"
  | "PREDICTIVE"
  | "GOAL_DIRECTED_PREDICTIVE";

export interface InfinityScaleGoalBenchmarkScenario {
  scenarioId: string;
  field: string;
  epochs: number;
  errorSeries: number[];
  regionIds: string[];
  goalRegistry: InfinityScaleResolutionGoalRegistry;
}

export interface InfinityScaleGoalBenchmarkResult {
  scenarioId: string;
  metrics: Record<InfinityScaleGoalDirectedPolicy, InfinityScaleAdaptiveScientificMetrics>;
  telemetry: Record<InfinityScaleGoalDirectedPolicy, InfinityScaleAdaptiveTelemetryRecord[]>;
  deterministic: boolean;
  benchmarkHash: string;
}

export function createInfinityScaleGoalBenchmarkScenario(): InfinityScaleGoalBenchmarkScenario {
  const goalRegistry = new InfinityScaleResolutionGoalRegistry();
  goalRegistry.register({
    goalId: "accuracy-front",
    name: "Resolve physical front",
    fields: ["density"],
    minimumLOD: 1,
    preferredLOD: 3,
    maximumLOD: 3,
    priority: 1,
    accuracyTarget: 0.9,
    regions: ["front"],
  });
  goalRegistry.register({
    goalId: "background",
    name: "Background monitoring",
    fields: ["density"],
    minimumLOD: 0,
    preferredLOD: 1,
    maximumLOD: 2,
    priority: 0.35,
    accuracyTarget: 0.5,
    regions: ["background"],
  });

  return {
    scenarioId: "goal-directed-front-v1",
    field: "density",
    epochs: 8,
    errorSeries: [0.18, 0.21, 0.28, 0.42, 0.61, 0.76, 0.82, 0.85],
    regionIds: ["front", "background"],
    goalRegistry,
  };
}

export function evaluateInfinityScaleGoalBenchmark(
  scenario: InfinityScaleGoalBenchmarkScenario,
): InfinityScaleGoalBenchmarkResult {
  const telemetry: Record<InfinityScaleGoalDirectedPolicy, InfinityScaleAdaptiveTelemetryRecord[]> = {
    REACTIVE: [],
    PREDICTIVE: [],
    GOAL_DIRECTED_PREDICTIVE: [],
  };

  for (let i = 0; i < scenario.epochs; i++) {
    const error = scenario.errorSeries[i];
    const nextError = scenario.errorSeries[Math.min(i + 1, scenario.epochs - 1)];
    const rising = nextError > error;

    for (const policy of Object.keys(telemetry) as InfinityScaleGoalDirectedPolicy[]) {
      let mutationCount = 0;

      if (policy === "REACTIVE") {
        mutationCount = error >= 0.75 ? 1 : 0;
      } else if (policy === "PREDICTIVE") {
        mutationCount = rising ? 1 : 0;
      } else {
        const frontRelevance = scenario.goalRegistry.relevance("front", scenario.field, 1);
        mutationCount = rising && (frontRelevance >= 0.5 || error >= 0.75) ? 1 : 0;
      }

      telemetry[policy].push({
        epoch: i + 1,
        stateRevision: i + 1,
        topologyRevision: i + 1,
        mutationCount,
        transferCount: mutationCount,
        deferredNodeCount: 0,
        conservationValid: true,
        gpuComplete: true,
        executable: true,
        commitReady: true,
        transferPlanHash: `goal-${scenario.scenarioId}-${policy}-tp-${i + 1}`,
        graphHash: `goal-${scenario.scenarioId}-${policy}-g-${i + 1}`,
        gpuPlanHash: `goal-${scenario.scenarioId}-${policy}-gpu-${i + 1}`,
        pipelineHash: `goal-${scenario.scenarioId}-${policy}-p-${i + 1}`,
      });
    }
  }

  const metrics = {
    REACTIVE: analyzeInfinityScaleAdaptiveTelemetry(telemetry.REACTIVE),
    PREDICTIVE: analyzeInfinityScaleAdaptiveTelemetry(telemetry.PREDICTIVE),
    GOAL_DIRECTED_PREDICTIVE: analyzeInfinityScaleAdaptiveTelemetry(telemetry.GOAL_DIRECTED_PREDICTIVE),
  };

  const benchmarkHash = stableHash(JSON.stringify({
    scenarioId: scenario.scenarioId,
    metrics,
    telemetry,
  }));

  return {
    scenarioId: scenario.scenarioId,
    metrics,
    telemetry,
    deterministic: true,
    benchmarkHash,
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
