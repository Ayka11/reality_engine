import {
  createInfinityScaleGoalBenchmarkScenario,
  evaluateInfinityScaleGoalBenchmark,
} from "./InfinityScaleGoalDirectedBenchmark";

export function runInfinityScaleGoalDirectedBenchmarkRegression(): void {
  const scenario = createInfinityScaleGoalBenchmarkScenario();
  const result = evaluateInfinityScaleGoalBenchmark(scenario);

  if (!result.deterministic || !result.benchmarkHash) {
    throw new Error("Goal-directed benchmark must be deterministic and hashed");
  }

  for (const policy of ["REACTIVE", "PREDICTIVE", "GOAL_DIRECTED_PREDICTIVE"] as const) {
    if (result.telemetry[policy].length !== scenario.epochs) {
      throw new Error(`Unexpected epoch count for ${policy}`);
    }
    if (result.metrics[policy].epochs !== scenario.epochs) {
      throw new Error(`Unexpected metrics epoch count for ${policy}`);
    }
  }

  const goal = scenario.goalRegistry.get("accuracy-front");
  if (!goal || goal.preferredLOD !== 3) {
    throw new Error("Front accuracy goal was not registered correctly");
  }

  const frontRelevance = scenario.goalRegistry.relevance("front", scenario.field, 1);
  const backgroundRelevance = scenario.goalRegistry.relevance("background", scenario.field, 1);
  if (frontRelevance <= backgroundRelevance) {
    throw new Error("Goal relevance did not distinguish front from background");
  }

  const replay = evaluateInfinityScaleGoalBenchmark(createInfinityScaleGoalBenchmarkScenario());
  if (replay.benchmarkHash !== result.benchmarkHash) {
    throw new Error("Goal-directed benchmark is not deterministic");
  }
}
