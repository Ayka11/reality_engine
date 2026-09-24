import {
  createInfinityScaleBenchmarkScenarioSet,
  telemetryFromBenchmarkScenario,
} from "./InfinityScaleControlledBenchmark";

export function runInfinityScaleControlledBenchmarkRegression(): void {
  const set = createInfinityScaleBenchmarkScenarioSet(8);

  if (set.scenarios.length !== 5) {
    throw new Error("Expected five controlled benchmark scenarios");
  }
  if (!set.deterministic || !set.benchmarkHash) {
    throw new Error("Benchmark set must be deterministic and hashed");
  }

  const patterns = new Set(set.scenarios.map(scenario => scenario.pattern));
  for (const required of [
    "RISING_ERROR",
    "STABLE_ERROR",
    "SHOCK_FRONT",
    "OSCILLATORY_ERROR",
    "BUDGET_PRESSURE",
  ]) {
    if (!patterns.has(required as never)) {
      throw new Error(`Missing benchmark pattern: ${required}`);
    }
  }

  for (const scenario of set.scenarios) {
    const reactive = telemetryFromBenchmarkScenario(scenario, "REACTIVE");
    const predictive = telemetryFromBenchmarkScenario(scenario, "PREDICTIVE");

    if (reactive.length !== 8 || predictive.length !== 8) {
      throw new Error(`Unexpected telemetry length for ${scenario.scenarioId}`);
    }
    if (JSON.stringify(reactive.map(r => r.epoch)) !== JSON.stringify(predictive.map(r => r.epoch))) {
      throw new Error(`Policies do not share identical epoch history for ${scenario.scenarioId}`);
    }
  }

  const rising = set.scenarios.find(s => s.pattern === "RISING_ERROR");
  if (!rising) throw new Error("Rising-error scenario missing");

  const risingPredictive = telemetryFromBenchmarkScenario(rising, "PREDICTIVE");
  if (risingPredictive[0].mutationCount !== 1) {
    throw new Error("Predictive policy should respond to rising error in benchmark adapter");
  }

  const stable = set.scenarios.find(s => s.pattern === "STABLE_ERROR");
  if (!stable) throw new Error("Stable-error scenario missing");
  const stablePredictive = telemetryFromBenchmarkScenario(stable, "PREDICTIVE");
  if (stablePredictive.some(record => record.mutationCount !== 0)) {
    throw new Error("Stable benchmark should not create predictive mutations");
  }

  const replay = createInfinityScaleBenchmarkScenarioSet(8);
  if (replay.benchmarkHash !== set.benchmarkHash) {
    throw new Error("Benchmark generation is not deterministic");
  }
}
