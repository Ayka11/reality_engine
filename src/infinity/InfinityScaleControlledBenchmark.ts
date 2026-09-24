import type { InfinityScaleAdaptiveTelemetryRecord } from "./InfinityScaleAdaptiveTelemetryRecorder";

export type InfinityScaleBenchmarkPattern =
  | "RISING_ERROR"
  | "STABLE_ERROR"
  | "SHOCK_FRONT"
  | "OSCILLATORY_ERROR"
  | "BUDGET_PRESSURE";

export interface InfinityScaleBenchmarkScenario {
  scenarioId: string;
  pattern: InfinityScaleBenchmarkPattern;
  epochs: number;
  errorSeries: number[];
  description: string;
}

export interface InfinityScaleBenchmarkScenarioSet {
  scenarios: InfinityScaleBenchmarkScenario[];
  deterministic: boolean;
  benchmarkHash: string;
}

export function createInfinityScaleBenchmarkScenarioSet(
  epochs = 8,
): InfinityScaleBenchmarkScenarioSet {
  if (!Number.isInteger(epochs) || epochs < 4) {
    throw new Error("Benchmark epochs must be an integer >= 4");
  }

  const scenarios: InfinityScaleBenchmarkScenario[] = [
    make("rising-error", "RISING_ERROR", epochs, i => Math.min(1, 0.12 + i * 0.10),
      "Monotonic error growth."),
    make("stable-error", "STABLE_ERROR", epochs, () => 0.35,
      "Stable error with no persistent trend."),
    make("shock-front", "SHOCK_FRONT", epochs, i => i < 3 ? 0.15 + i * 0.03 : Math.min(1, 0.25 + (i - 2) * 0.24),
      "Delayed sharp error increase representing a moving physical front."),
    make("oscillatory-error", "OSCILLATORY_ERROR", epochs, i => 0.5 + (i % 2 === 0 ? 0.16 : -0.16),
      "Alternating error intended to exercise anti-thrashing behavior."),
    make("budget-pressure", "BUDGET_PRESSURE", epochs, i => Math.min(1, 0.30 + i * 0.08),
      "Persistent growth under constrained computational budget."),
  ];

  const benchmarkHash = stableHash(JSON.stringify(scenarios));
  return { scenarios, deterministic: true, benchmarkHash };
}

export function telemetryFromBenchmarkScenario(
  scenario: InfinityScaleBenchmarkScenario,
  policy: "REACTIVE" | "PREDICTIVE",
): InfinityScaleAdaptiveTelemetryRecord[] {
  return scenario.errorSeries.map((error, index) => {
    const epoch = index + 1;
    const predictiveLead = policy === "PREDICTIVE" && index < scenario.epochs - 1 &&
      scenario.errorSeries[index + 1] > error;
    const mutationCount = predictiveLead || error >= 0.75 ? 1 : 0;
    const transferCount = mutationCount;
    const deferredNodeCount =
      scenario.pattern === "BUDGET_PRESSURE" && mutationCount > 0 ? 1 : 0;

    return {
      epoch,
      stateRevision: epoch,
      topologyRevision: epoch,
      mutationCount,
      transferCount,
      deferredNodeCount,
      conservationValid: true,
      gpuComplete: deferredNodeCount === 0,
      executable: true,
      commitReady: deferredNodeCount === 0,
      transferPlanHash: `benchmark-${scenario.scenarioId}-${policy}-tp-${epoch}`,
      graphHash: `benchmark-${scenario.scenarioId}-${policy}-g-${epoch}`,
      gpuPlanHash: `benchmark-${scenario.scenarioId}-${policy}-gpu-${epoch}`,
      pipelineHash: `benchmark-${scenario.scenarioId}-${policy}-p-${epoch}`,
    };
  });
}

function make(
  scenarioId: string,
  pattern: InfinityScaleBenchmarkPattern,
  epochs: number,
  generator: (index: number) => number,
  description: string,
): InfinityScaleBenchmarkScenario {
  return {
    scenarioId,
    pattern,
    epochs,
    errorSeries: Array.from({ length: epochs }, (_, i) =>
      Number(generator(i).toFixed(6)),
    ),
    description,
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
